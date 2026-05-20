const helper = require("node-red-node-test-helper");
const apiConfigNode = require("../../nodes/api-config.js");

helper.init(require.resolve("node-red"));

describe("api-config executeCrudOperation primary-key binding", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    function load(cb) {
        const flow = [{ id: "c1", type: "apigw-config", name: "cfg", dbType: "mssql" }];
        helper.load(apiConfigNode, flow, function () {
            const node = helper.getNode("c1");
            cb(node);
        });
    }

    it("binds non-id PK when path param matches PK column", function (done) {
        load(function (node) {
            const calls = [];
            node.executeQuery = async function (sql, params) {
                calls.push({ sql, params });
                return { recordset: [{ id_cota: 7 }], rowsAffected: [1] };
            };
            node.executeCrudOperation(
                "get",
                { sql: "SELECT * FROM DEV.dbo.inspec_cota WHERE id_cota = @id_cota", primaryKey: "id_cota" },
                { params: { id_cota: 7 } }
            ).then(function () {
                calls[0].params.should.deepEqual({ id_cota: 7 });
                done();
            }).catch(done);
        });
    });

    it("binds non-id PK when path param uses a different name (paramNames fallback)", function (done) {
        load(function (node) {
            const calls = [];
            node.executeQuery = async function (sql, params) {
                calls.push({ sql, params });
                return { recordset: [{ id_cota: 9 }], rowsAffected: [1] };
            };
            node.executeCrudOperation(
                "get",
                { sql: "SELECT * FROM DEV.dbo.inspec_cota WHERE id_cota = @id_cota", primaryKey: "id_cota" },
                { params: { idCota: 9 }, paramNames: ["idCota"] }
            ).then(function () {
                calls[0].params.should.deepEqual({ id_cota: 9 });
                done();
            }).catch(done);
        });
    });

    it("preserves legacy 'id' behavior when PK is literally 'id'", function (done) {
        load(function (node) {
            const calls = [];
            node.executeQuery = async function (sql, params) {
                calls.push({ sql, params });
                return { recordset: [{ id: 1 }], rowsAffected: [1] };
            };
            node.executeCrudOperation(
                "get",
                { sql: "SELECT * FROM t WHERE id = @id", primaryKey: "id" },
                { params: { id: 1 } }
            ).then(function () {
                calls[0].params.should.deepEqual({ id: 1 });
                done();
            }).catch(done);
        });
    });

    it("binds non-id PK for delete", function (done) {
        load(function (node) {
            const calls = [];
            node.executeQuery = async function (sql, params) {
                calls.push({ sql, params });
                return { recordset: [], rowsAffected: [1] };
            };
            node.executeCrudOperation(
                "delete",
                { sql: "DELETE FROM t WHERE id_tol = @id_tol", primaryKey: "id_tol" },
                { params: { id_tol: 42 } }
            ).then(function () {
                calls[0].params.should.deepEqual({ id_tol: 42 });
                done();
            }).catch(done);
        });
    });

    it("binds non-id PK for update alongside body fields", function (done) {
        load(function (node) {
            const calls = [];
            node.executeQuery = async function (sql, params) {
                calls.push({ sql, params });
                return { recordset: [{ id_cota: 5, descripcio: "x" }], rowsAffected: [1] };
            };
            node.executeCrudOperation(
                "update",
                { sql: "UPDATE t SET @assignments WHERE id_cota = @id_cota", primaryKey: "id_cota" },
                { params: { id_cota: 5 }, body: { descripcio: "x" } }
            ).then(function () {
                calls[0].params.should.deepEqual({ id_cota: 5, descripcio: "x" });
                done();
            }).catch(done);
        });
    });
});
