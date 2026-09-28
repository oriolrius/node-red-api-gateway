require("should");
const fastify = require("fastify");
const {
    DEFAULT_BODY_LIMIT,
    parseBodyOptions,
    toContentTypeMatcher,
    registerBinaryParsers
} = require("../../lib/body-parsing");

const MiB = 1024 * 1024;

/** Build a Fastify app the same way apigw-server does, with one echo route. */
async function buildApp(config) {
    const opts = parseBodyOptions(config);
    const app = fastify({ bodyLimit: opts.bodyLimit, logger: false });
    registerBinaryParsers(app, opts);
    app.post("/echo", async (request) => ({
        isBuffer: Buffer.isBuffer(request.body),
        length: Buffer.isBuffer(request.body) ? request.body.length : JSON.stringify(request.body).length,
        firstByte: Buffer.isBuffer(request.body) ? request.body[0] : null,
        json: Buffer.isBuffer(request.body) ? null : request.body
    }));
    await app.ready();
    return app;
}

describe("body-parsing", function () {
    describe("parseBodyOptions", function () {
        it("defaults to Fastify's 1 MiB limit with raw bodies off", function () {
            const o = parseBodyOptions({});
            o.bodyLimit.should.equal(DEFAULT_BODY_LIMIT);
            o.binaryBodyEnabled.should.be.false();
            o.binaryContentTypes.should.eql(["image/*", "application/octet-stream"]);
        });

        it("accepts a numeric or string bodyLimit and trims/lower-cases types", function () {
            parseBodyOptions({ bodyLimit: 10 * MiB }).bodyLimit.should.equal(10 * MiB);
            parseBodyOptions({ bodyLimit: "10485760" }).bodyLimit.should.equal(10 * MiB);
            parseBodyOptions({ binaryContentTypes: " Image/PNG , application/pdf,," }).binaryContentTypes
                .should.eql(["image/png", "application/pdf"]);
        });

        it("falls back to the default for invalid limits", function () {
            parseBodyOptions({ bodyLimit: "abc" }).bodyLimit.should.equal(DEFAULT_BODY_LIMIT);
            parseBodyOptions({ bodyLimit: 0 }).bodyLimit.should.equal(DEFAULT_BODY_LIMIT);
            parseBodyOptions({ bodyLimit: -5 }).bodyLimit.should.equal(DEFAULT_BODY_LIMIT);
        });

        it("only enables raw bodies when explicitly true", function () {
            parseBodyOptions({ binaryBodyEnabled: "true" }).binaryBodyEnabled.should.be.false();
            parseBodyOptions({ binaryBodyEnabled: true }).binaryBodyEnabled.should.be.true();
        });
    });

    describe("toContentTypeMatcher", function () {
        it("turns type/* into a subtype regex and keeps exact types as strings", function () {
            const m = toContentTypeMatcher("image/*");
            m.should.be.instanceOf(RegExp);
            m.test("image/jpeg").should.be.true();
            m.test("image/").should.be.false();
            m.test("imagex/jpeg").should.be.false();
            toContentTypeMatcher("application/octet-stream").should.equal("application/octet-stream");
        });
    });

    describe("with a real Fastify instance", function () {
        let app;
        afterEach(async function () { if (app) await app.close(); app = null; });

        it("keeps today's behaviour by default: raw image -> 415", async function () {
            app = await buildApp({});
            const r = await app.inject({ method: "POST", url: "/echo", headers: { "content-type": "image/png" }, payload: Buffer.alloc(10, 1) });
            r.statusCode.should.equal(415);
        });

        it("keeps today's behaviour by default: JSON over 1 MiB -> 413", async function () {
            app = await buildApp({});
            const r = await app.inject({ method: "POST", url: "/echo", payload: { d: "x".repeat(1.1 * MiB) } });
            r.statusCode.should.equal(413);
        });

        it("accepts a 9 MiB JSON body when bodyLimit is 10 MiB", async function () {
            app = await buildApp({ bodyLimit: 10 * MiB });
            const r = await app.inject({ method: "POST", url: "/echo", payload: { d: "x".repeat(9 * MiB) } });
            r.statusCode.should.equal(200);
            r.json().isBuffer.should.be.false();
        });

        it("delivers a raw image as a Buffer when enabled (9 MiB, limit 10 MiB)", async function () {
            app = await buildApp({ bodyLimit: 10 * MiB, binaryBodyEnabled: true });
            const img = Buffer.alloc(9 * MiB, 0xab);
            const r = await app.inject({ method: "POST", url: "/echo", headers: { "content-type": "image/jpeg" }, payload: img });
            r.statusCode.should.equal(200);
            const b = r.json();
            b.isBuffer.should.be.true();
            b.length.should.equal(img.length);
            b.firstByte.should.equal(0xab);
        });

        it("accepts application/octet-stream and a custom exact type", async function () {
            app = await buildApp({ binaryBodyEnabled: true, binaryContentTypes: "application/octet-stream,application/pdf" });
            for (const ct of ["application/octet-stream", "application/pdf"]) {
                const r = await app.inject({ method: "POST", url: "/echo", headers: { "content-type": ct }, payload: Buffer.from("abc") });
                r.statusCode.should.equal(200, ct);
                r.json().isBuffer.should.be.true();
            }
            const r2 = await app.inject({ method: "POST", url: "/echo", headers: { "content-type": "image/png" }, payload: Buffer.from("abc") });
            r2.statusCode.should.equal(415);
        });

        it("rejects a raw body over the limit with 413", async function () {
            app = await buildApp({ bodyLimit: 1 * MiB, binaryBodyEnabled: true });
            const r = await app.inject({ method: "POST", url: "/echo", headers: { "content-type": "image/png" }, payload: Buffer.alloc(MiB + 1) });
            r.statusCode.should.equal(413);
        });

        it("leaves JSON parsing unchanged when raw bodies are enabled", async function () {
            app = await buildApp({ bodyLimit: 10 * MiB, binaryBodyEnabled: true });
            const r = await app.inject({ method: "POST", url: "/echo", payload: { hello: "world" } });
            r.statusCode.should.equal(200);
            r.json().json.should.eql({ hello: "world" });
        });
    });
});
