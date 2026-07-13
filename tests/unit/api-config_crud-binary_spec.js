const helper = require("node-red-node-test-helper");
const apiConfigNode = require("../../nodes/api-config.js");

helper.init(require.resolve("node-red"));

// Regression: issue #2 (secondary) - binary/IMAGE columns were bound as
// NVarChar, so auto-CRUD create/update failed with
// "Operand type clash: nvarchar is incompatible with image".
describe("api-config executeCrudOperation binary column binding", function () {
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
            cb(helper.getNode("c1"));
        });
    }

    function stubTypes(node, entries) {
        node.getTableColumnTypes = async function () {
            return new Map(entries);
        };
    }

    function captureExecuteQuery(node, calls) {
        node.executeQuery = async function (sql, params, paramTypes) {
            calls.push({ sql, params, paramTypes });
            return { recordset: [{}], rowsAffected: [1] };
        };
    }

    it("binds base64 strings as Buffer for image columns on create", function (done) {
        load(function (node) {
            stubTypes(node, [["photo", "image"], ["name", "nvarchar"]]);
            const calls = [];
            captureExecuteQuery(node, calls);
            node.executeCrudOperation(
                "create",
                { sql: "INSERT INTO [dbo].[t] (@columns) VALUES (@values)", primaryKey: "id", tableName: "dbo.t" },
                { body: { name: "x", photo: "aGVsbG8=" } }
            ).then(function () {
                const { params, paramTypes } = calls[0];
                params.col0.should.equal("x");
                (paramTypes.col0 === undefined).should.be.true();
                Buffer.isBuffer(params.col1).should.be.true();
                params.col1.toString("utf8").should.equal("hello");
                paramTypes.should.have.property("col1");
                done();
            }).catch(done);
        });
    });

    it("decodes 0x-prefixed hex strings for binary columns", function (done) {
        load(function (node) {
            stubTypes(node, [["blob", "varbinary"]]);
            const calls = [];
            captureExecuteQuery(node, calls);
            node.executeCrudOperation(
                "create",
                { sql: "INSERT INTO [dbo].[t] (@columns) VALUES (@values)", primaryKey: "id", tableName: "dbo.t" },
                { body: { blob: "0xDEADBEEF" } }
            ).then(function () {
                const { params } = calls[0];
                Buffer.isBuffer(params.col0).should.be.true();
                params.col0.toString("hex").should.equal("deadbeef");
                done();
            }).catch(done);
        });
    });

    it("reconstructs JSON-serialized Buffers ({type:'Buffer',data:[...]})", function (done) {
        load(function (node) {
            stubTypes(node, [["photo", "image"]]);
            const calls = [];
            captureExecuteQuery(node, calls);
            node.executeCrudOperation(
                "create",
                { sql: "INSERT INTO [dbo].[t] (@columns) VALUES (@values)", primaryKey: "id", tableName: "dbo.t" },
                { body: { photo: { type: "Buffer", data: [1, 2, 3] } } }
            ).then(function () {
                const { params } = calls[0];
                Buffer.isBuffer(params.col0).should.be.true();
                Array.from(params.col0).should.deepEqual([1, 2, 3]);
                done();
            }).catch(done);
        });
    });

    it("binds null binary values as typed null", function (done) {
        load(function (node) {
            stubTypes(node, [["photo", "image"]]);
            const calls = [];
            captureExecuteQuery(node, calls);
            node.executeCrudOperation(
                "create",
                { sql: "INSERT INTO [dbo].[t] (@columns) VALUES (@values)", primaryKey: "id", tableName: "dbo.t" },
                { body: { photo: null } }
            ).then(function () {
                const { params, paramTypes } = calls[0];
                (params.col0 === null).should.be.true();
                paramTypes.should.have.property("col0");
                done();
            }).catch(done);
        });
    });

    it("matches introspected columns case-insensitively", function (done) {
        load(function (node) {
            stubTypes(node, [["photo", "image"]]);
            const calls = [];
            captureExecuteQuery(node, calls);
            node.executeCrudOperation(
                "create",
                { sql: "INSERT INTO [dbo].[t] (@columns) VALUES (@values)", primaryKey: "id", tableName: "dbo.t" },
                { body: { Photo: "aGVsbG8=" } }
            ).then(function () {
                const { params, paramTypes } = calls[0];
                Buffer.isBuffer(params.col0).should.be.true();
                paramTypes.should.have.property("col0");
                done();
            }).catch(done);
        });
    });

    it("binds binary columns on update alongside the primary key", function (done) {
        load(function (node) {
            stubTypes(node, [["photo", "image"]]);
            const calls = [];
            captureExecuteQuery(node, calls);
            node.executeCrudOperation(
                "update",
                { sql: "UPDATE [dbo].[t] SET @assignments WHERE id = @id", primaryKey: "id", tableName: "dbo.t" },
                { params: { id: 1 }, body: { photo: "aGVsbG8=" } }
            ).then(function () {
                const { sql, params, paramTypes } = calls[0];
                sql.should.containEql("[photo] = @col0");
                params.id.should.equal(1);
                Buffer.isBuffer(params.col0).should.be.true();
                paramTypes.should.have.property("col0");
                done();
            }).catch(done);
        });
    });

    it("types text/ntext columns without buffering the value", function (done) {
        load(function (node) {
            stubTypes(node, [["notes", "text"]]);
            const calls = [];
            captureExecuteQuery(node, calls);
            node.executeCrudOperation(
                "create",
                { sql: "INSERT INTO [dbo].[t] (@columns) VALUES (@values)", primaryKey: "id", tableName: "dbo.t" },
                { body: { notes: "hello" } }
            ).then(function () {
                const { params, paramTypes } = calls[0];
                params.col0.should.equal("hello");
                paramTypes.should.have.property("col0");
                done();
            }).catch(done);
        });
    });

    it("falls back to legacy binding when no column types are known", function (done) {
        load(function (node) {
            stubTypes(node, []);
            const calls = [];
            captureExecuteQuery(node, calls);
            node.executeCrudOperation(
                "create",
                { sql: "INSERT INTO [dbo].[t] (@columns) VALUES (@values)", primaryKey: "id", tableName: "dbo.t" },
                { body: { photo: "aGVsbG8=" } }
            ).then(function () {
                const { params, paramTypes } = calls[0];
                params.col0.should.equal("aGVsbG8=");
                Object.keys(paramTypes).length.should.equal(0);
                done();
            }).catch(done);
        });
    });

    describe("getTableColumnTypes", function () {
        it("introspects INFORMATION_SCHEMA and caches per table", function (done) {
            load(function (node) {
                let queryCount = 0;
                let capturedSql = null;
                const inputs = {};
                node.mssqlPool = {
                    connected: true,
                    close: async function () {},
                    request() {
                        return {
                            input(name, type, value) { inputs[name] = value; },
                            async query(q) {
                                queryCount++;
                                capturedSql = q;
                                return { recordset: [{ COLUMN_NAME: "Photo", DATA_TYPE: "IMAGE" }] };
                            }
                        };
                    }
                };
                node.getTableColumnTypes("DEV.dbo.Clientes").then(function (map) {
                    map.get("photo").should.equal("image");
                    capturedSql.should.containEql("[DEV].INFORMATION_SCHEMA.COLUMNS");
                    capturedSql.should.containEql("TABLE_SCHEMA = @schema");
                    inputs.table.should.equal("Clientes");
                    inputs.schema.should.equal("dbo");
                    return node.getTableColumnTypes("DEV.dbo.Clientes");
                }).then(function (map2) {
                    queryCount.should.equal(1);
                    map2.get("photo").should.equal("image");
                    done();
                }).catch(done);
            });
        });

        it("strips brackets and scopes a bare name to the default schema", function (done) {
            load(function (node) {
                let capturedSql = null;
                const inputs = {};
                node.mssqlPool = {
                    connected: true,
                    close: async function () {},
                    request() {
                        return {
                            input(name, type, value) { inputs[name] = value; },
                            async query(q) {
                                capturedSql = q;
                                return { recordset: [] };
                            }
                        };
                    }
                };
                node.getTableColumnTypes("[my table]").then(function () {
                    // Bare names must be scoped to the connection's default
                    // schema so same-named tables in other schemas don't merge in.
                    capturedSql.should.containEql("TABLE_SCHEMA = SCHEMA_NAME()");
                    capturedSql.should.not.containEql("@schema");
                    inputs.table.should.equal("my table");
                    done();
                }).catch(done);
            });
        });

        it("does NOT cache failures (retries) and warns once", function (done) {
            load(function (node) {
                const warnings = [];
                node.warn = function (msg) { warnings.push(msg); };
                let requests = 0;
                node.mssqlPool = {
                    connected: true,
                    close: async function () {},
                    request() {
                        requests++;
                        return {
                            input() {},
                            async query() { throw new Error("permission denied"); }
                        };
                    }
                };
                node.getTableColumnTypes("dbo.secret").then(function (map) {
                    map.size.should.equal(0);
                    node._tableColumnTypes.has("dbo.secret").should.be.false();
                    return node.getTableColumnTypes("dbo.secret");
                }).then(function (map2) {
                    // Re-queried (transient failures are not cached)...
                    requests.should.equal(2);
                    map2.size.should.equal(0);
                    // ...but warned only once to avoid log spam.
                    warnings.length.should.equal(1);
                    String(warnings[0]).should.containEql("permission denied");
                    done();
                }).catch(done);
            });
        });

        it("returns an empty, uncached map when the pool is not connected", function (done) {
            load(function (node) {
                node.mssqlPool = null;
                node.getTableColumnTypes("dbo.t").then(function (map) {
                    map.size.should.equal(0);
                    node._tableColumnTypes.has("dbo.t").should.be.false();
                    done();
                }).catch(done);
            });
        });
    });
});
