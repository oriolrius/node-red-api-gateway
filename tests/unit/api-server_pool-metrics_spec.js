"use strict";

require("should");
const helper = require("node-red-node-test-helper");
const apiServerNode = require("../../nodes/api-server.js");
const apiConfigNode = require("../../nodes/api-config.js");
const { resetSharedInstance } = require("../../lib/metrics-collector");

helper.init(require.resolve("node-red"));

let PORT = 3871;

async function getMetrics(port) {
    // The server starts listening asynchronously after the flow loads.
    for (let i = 0; i < 40; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/metrics`);
            return { status: res.status, text: await res.text() };
        } catch (err) {
            await new Promise(r => setTimeout(r, 50));
        }
    }
    throw new Error("metrics endpoint did not come up");
}

// GH-7: connection_pool_size must show the real mssql/tarn pool.
describe("api-server /metrics connection pool gauge", function() {
    this.timeout(6000);

    beforeEach(function(done) { PORT++; resetSharedInstance(); helper.startServer(done); });
    afterEach(function(done) {
        helper.unload().then(() => {
            resetSharedInstance();
            helper.stopServer(done);
        });
    });

    function flow() {
        return [
            { id: "cfg", type: "apigw-config", name: "Cfg", dbType: "postgres", dbPoolMax: "10" },
            { id: "srv", type: "apigw-server", name: "Srv", port: PORT, host: "127.0.0.1", config: "cfg", metricsEnabled: true }
        ];
    }

    it("reports active/idle/waiting from the live pool at scrape time", function(done) {
        helper.load([apiServerNode, apiConfigNode], flow(), async function() {
            try {
                const cfg = helper.getNode("cfg");
                cfg.mssqlPool = { pool: {}, size: 10, available: 0, borrowed: 10, pending: 42 };
                const { status, text } = await getMetrics(PORT);
                status.should.equal(200);
                text.should.match(/api_gateway_connection_pool_size\{[^}]*pool="database"[^}]*state="active"[^}]*\} 10/);
                text.should.match(/api_gateway_connection_pool_size\{[^}]*pool="database"[^}]*state="idle"[^}]*\} 0/);
                text.should.match(/api_gateway_connection_pool_size\{[^}]*pool="database"[^}]*state="waiting"[^}]*\} 42/);

                // Next scrape follows the pool
                cfg.mssqlPool.pending = 0;
                const again = await getMetrics(PORT);
                again.text.should.match(/state="waiting"[^}]*\} 0/);
                cfg.mssqlPool = null;
                done();
            } catch (e) { done(e); }
        });
    });

    it("leaves the gauge empty when no SQL Server pool exists", function(done) {
        helper.load([apiServerNode, apiConfigNode], flow(), async function() {
            try {
                const { status, text } = await getMetrics(PORT);
                status.should.equal(200);
                text.should.not.match(/api_gateway_connection_pool_size\{/);
                done();
            } catch (e) { done(e); }
        });
    });
});
