"use strict";

require("should");
const sinon = require("sinon");
const helper = require("node-red-node-test-helper");
const apiServerNode = require("../../nodes/api-server.js");
const apiConfigNode = require("../../nodes/api-config.js");

helper.init(require.resolve("node-red"));

const STORED_URL = "https://opa.stored.internal";
const POLICY = "v1/data/gw/decision";
let PORT = 3851;

function flow() {
    return [
        { id: "cfg", type: "apigw-config", name: "OPA Cfg", opaEnabled: true, opaUrl: STORED_URL, opaPolicyPath: POLICY, opaMode: "enforce" },
        { id: "srv", type: "apigw-server", name: "OPA Srv", port: PORT, host: "127.0.0.1", config: "cfg" }
    ];
}

describe("api-server OPA admin test route (task-082)", function() {
    this.timeout(6000);
    let fetchStub;

    beforeEach(function(done) { PORT++; helper.startServer(done); });
    afterEach(function(done) {
        if (fetchStub) { fetchStub.restore(); fetchStub = null; }
        helper.unload();
        helper.stopServer(done);
    });

    function stubOpa(decisionBody) {
        fetchStub = sinon.stub(global, "fetch");
        fetchStub.callsFake(async (url) => {
            if (String(url).endsWith("/health")) {
                return { ok: true, status: 200, json: async () => ({}) };
            }
            return { ok: true, status: 200, json: async () => decisionBody };
        });
        return fetchStub;
    }

    it("reports reachability, a real policy-defined check, and the production input document", function(done) {
        stubOpa({ result: { allowed: true, reason: "ok" }, decision_id: "d-1" });
        helper.load([apiServerNode, apiConfigNode], flow(), { cfg: { opaToken: "gw-secret" } }, function() {
            helper.request().post("/api-gateway/test-opa").send({ config: "cfg" }).expect(200).end(function(err, res) {
                if (err) return done(err);
                try {
                    res.body.should.have.property("reachable", true);
                    res.body.should.have.property("policyDefined", true);
                    res.body.should.have.property("allowed", true);
                    res.body.should.have.property("reason", "ok");
                    res.body.should.have.property("input");
                    res.body.input.should.have.property("method");
                    done();
                } catch (e) { done(e); }
            });
        });
    });

    it("detects a configured-but-undefined policy (HTTP 200 {}) as policyDefined=false", function(done) {
        stubOpa({}); // undefined document — health check would still report healthy
        helper.load([apiServerNode, apiConfigNode], flow(), { cfg: { opaToken: "gw-secret" } }, function() {
            helper.request().post("/api-gateway/test-opa").send({ config: "cfg" }).expect(200).end(function(err, res) {
                if (err) return done(err);
                try {
                    res.body.should.have.property("reachable", true);
                    res.body.should.have.property("policyDefined", false);
                    done();
                } catch (e) { done(e); }
            });
        });
    });

    it("takes opaUrl from the stored config, never from the body (no SSRF)", function(done) {
        stubOpa({ result: { allowed: true } });
        helper.load([apiServerNode, apiConfigNode], flow(), { cfg: { opaToken: "gw-secret" } }, function() {
            helper.request().post("/api-gateway/test-opa")
                .send({ config: "cfg", opaUrl: "http://attacker.evil.internal", sample: { method: "GET", path: "/x" } })
                .expect(200).end(function(err) {
                    if (err) return done(err);
                    try {
                        // Every fetch must target the STORED url, not the body-supplied one.
                        fetchStub.called.should.be.true();
                        fetchStub.getCalls().forEach(function(call) {
                            String(call.args[0]).should.startWith(STORED_URL);
                            String(call.args[0]).should.not.containEql("attacker.evil.internal");
                        });
                        done();
                    } catch (e) { done(e); }
                });
        });
    });

    it("reads the gateway token server-side and sends it as a bearer to OPA", function(done) {
        stubOpa({ result: { allowed: true } });
        helper.load([apiServerNode, apiConfigNode], flow(), { cfg: { opaToken: "gw-secret" } }, function() {
            helper.request().post("/api-gateway/test-opa").send({ config: "cfg" }).expect(200).end(function(err) {
                if (err) return done(err);
                try {
                    const decisionCall = fetchStub.getCalls().find(c => !String(c.args[0]).endsWith("/health"));
                    decisionCall.args[1].headers.should.have.property("Authorization", "Bearer gw-secret");
                    done();
                } catch (e) { done(e); }
            });
        });
    });

    it("uses a throwaway client so the live client cache is never populated", function(done) {
        stubOpa({ result: { allowed: true } });
        helper.load([apiServerNode, apiConfigNode], flow(), { cfg: { opaToken: "gw-secret" } }, function() {
            const srv = helper.getNode("srv");
            const liveClient = srv.opaClientsByPath.get(POLICY);
            const before = liveClient ? liveClient._cache.size : 0;
            helper.request().post("/api-gateway/test-opa").send({ config: "cfg" }).expect(200).end(function(err) {
                if (err) return done(err);
                try {
                    const after = liveClient ? liveClient._cache.size : 0;
                    after.should.equal(before); // the test did not touch the live cache
                    done();
                } catch (e) { done(e); }
            });
        });
    });

    it("400s when the config node id is missing", function(done) {
        helper.load([apiServerNode, apiConfigNode], flow(), { cfg: { opaToken: "gw-secret" } }, function() {
            helper.request().post("/api-gateway/test-opa").send({}).expect(400).end(function(err, res) {
                if (err) return done(err);
                try {
                    res.body.should.have.property("success", false);
                    done();
                } catch (e) { done(e); }
            });
        });
    });
});
