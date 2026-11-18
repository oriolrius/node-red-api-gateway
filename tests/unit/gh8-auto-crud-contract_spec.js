const helper = require("node-red-node-test-helper");
const sinon = require("sinon");
const should = require("should");
const sql = require("mssql");
const apiEndpointNode = require("../../nodes/api-endpoint.js");
const apiConfigNode = require("../../nodes/api-config.js");
const { OpenApiGenerator } = require("../../lib/openapi-generator");
const {
    columnReadSchema,
    buildRowSchema,
    buildBodySchema,
    buildAutoCrudOpenApi
} = require("../../lib/crud-schema");

helper.init(require.resolve("node-red"));

// GH-8: the HTTP contract of auto-CRUD endpoints must match the node
// configuration, the README and /openapi.json.
describe("GH-8 auto-CRUD contract", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        sinon.restore();
        helper.unload();
        helper.stopServer(done);
    });

    const COLUMNS = [
        { name: "id", dataType: "int", nullable: false, maxLength: null, hasDefault: false, identity: true, computed: false },
        { name: "code", dataType: "nchar", nullable: false, maxLength: 4, hasDefault: false, identity: false, computed: false },
        { name: "big", dataType: "bigint", nullable: true, maxLength: null, hasDefault: false, identity: false, computed: false },
        { name: "active", dataType: "bit", nullable: false, maxLength: null, hasDefault: true, identity: false, computed: false },
        { name: "created", dataType: "datetime", nullable: true, maxLength: null, hasDefault: false, identity: false, computed: false },
        { name: "photo", dataType: "image", nullable: true, maxLength: 2147483647, hasDefault: false, identity: false, computed: false },
        { name: "guid", dataType: "uniqueidentifier", nullable: false, maxLength: null, hasDefault: true, identity: false, computed: false }
    ];

    function mockRes(onEnd) {
        const res = { headers: {}, statusCode: null, body: undefined };
        res.set = (name, value) => { res.headers[name] = value; return res; };
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (body) => { res.body = body; onEnd(res); return res; };
        res.end = () => { onEnd(res); return res; };
        return res;
    }

    function endpointFlow(extra) {
        return [Object.assign({
            id: "n1",
            type: "apigw-endpoint",
            path: "/items",
            method: "GET",
            server: "s1",
            crudOperation: "list",
            tableName: "MYDB.dbo.items",
            primaryKey: "id",
            autoGenerateSql: true,
            useFlowOutput: false
        }, extra || {})];
    }

    function fakeConfig(executeCrudOperation, extra) {
        return Object.assign({
            dbType: "mssql",
            isSqlServerReady: () => true,
            executeQuery: sinon.stub(),
            executeCrudOperation,
            getTableColumns: sinon.stub().resolves(COLUMNS),
            getLogger: () => null
        }, extra || {});
    }

    function runEndpoint(flowExtra, query, result, check, configExtra) {
        return function (done) {
            helper.load(apiEndpointNode, endpointFlow(flowExtra), function () {
                const n1 = helper.getNode("n1");
                const executeCrudOperation = sinon.stub().resolves(result);
                n1.serverNode = { configNode: fakeConfig(executeCrudOperation, configExtra) };
                const res = mockRes(function (r) {
                    try {
                        check(r, executeCrudOperation);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({
                    payload: {},
                    req: { method: n1.method, headers: {}, body: {}, params: { id: "7" }, query },
                    res
                });
            });
        };
    }

    describe("1. pagination settings apply to auto-CRUD list", function () {
        const page = { data: [{ id: 1 }], rowsAffected: 1, total: 49 };
        const paged = { paginationEnabled: true, defaultPageSize: 20, maxPageSize: 100 };

        it("uses defaultPageSize when no limit is given", runEndpoint(paged, {}, page, function (r, exec) {
            exec.firstCall.args[2].pagination.should.eql({ limit: 20, offset: 0 });
            r.body.limit.should.equal(20);
            r.body.offset.should.equal(0);
        }));

        it("caps limit at maxPageSize", runEndpoint(paged, { limit: "1000" }, page, function (r, exec) {
            exec.firstCall.args[2].pagination.limit.should.equal(100);
            r.body.limit.should.equal(100);
        }));

        it("accepts page as well as offset", runEndpoint(paged, { limit: "10", page: "3" }, page, function (r, exec) {
            exec.firstCall.args[2].pagination.should.eql({ limit: 10, offset: 20 });
        }));

        it("rejects negative values", runEndpoint(paged, { limit: "-5", offset: "-1" }, page, function (r, exec) {
            exec.firstCall.args[2].pagination.should.eql({ limit: 20, offset: 0 });
        }));

        it("keeps the default of 10 without pagination but still caps the page", runEndpoint({}, { limit: "100000" }, page, function (r, exec) {
            exec.firstCall.args[2].pagination.limit.should.equal(100);
        }));

        it("keeps the default of 10 without pagination", runEndpoint({}, {}, page, function (r, exec) {
            exec.firstCall.args[2].pagination.should.eql({ limit: 10, offset: 0 });
        }));
    });

    describe("2. total is the number of matching rows", function () {
        it("returns the COUNT(*) total, not the page length", runEndpoint({}, { limit: "1" }, { data: [{ id: 1 }], rowsAffected: 1, total: 2000 }, function (r) {
            r.statusCode.should.equal(200);
            r.body.should.eql({ data: [{ id: 1 }], total: 2000, limit: 1, offset: 0 });
        }));

        it("executeCrudOperation runs a COUNT with the same WHERE", function (done) {
            helper.load(apiConfigNode, [{ id: "c1", type: "apigw-config", name: "cfg", dbType: "postgres" }], function () {
                const c1 = helper.getNode("c1");
                const calls = [];
                c1.executeQuery = async function (q, params) {
                    calls.push({ q, params });
                    if (q.startsWith("SELECT COUNT_BIG")) {
                        return { recordset: [{ total: "42" }], rowsAffected: [1] };
                    }
                    return { recordset: [{ id: 1 }, { id: 2 }], rowsAffected: [2] };
                };
                c1.executeCrudOperation(
                    "list",
                    { sql: "SELECT * FROM [MYDB].[dbo].[items] ORDER BY [id] OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY", tableName: "MYDB.dbo.items", primaryKey: "id" },
                    {
                        query: { limit: "999" },
                        pagination: { limit: 5, offset: 10 },
                        filtering: { whereClause: { clause: "WHERE [name] = @filter_name", params: { filter_name: "x" } } },
                        sorting: { orderByClause: "ORDER BY [name] DESC" }
                    }
                ).then(function (result) {
                    calls.length.should.equal(2);
                    calls[0].q.should.containEql("WHERE [name] = @filter_name ORDER BY [name] DESC OFFSET");
                    calls[0].params.limit.should.equal(5);
                    calls[0].params.offset.should.equal(10);
                    calls[1].q.should.equal("SELECT COUNT_BIG(*) AS total FROM [MYDB].[dbo].[items] WHERE [name] = @filter_name");
                    calls[1].params.filter_name.should.equal("x");
                    result.total.should.equal(42);
                    result.data.length.should.equal(2);
                    done();
                }).catch(done);
            });
        });
    });

    describe("4. problem type and 404 detail", function () {
        const empty = { data: [], rowsAffected: 0 };

        it("answers about:blank with a generic detail by default", runEndpoint({ crudOperation: "get", path: "/items/:id" }, {}, empty, function (r) {
            r.statusCode.should.equal(404);
            r.body.type.should.equal("about:blank");
            r.body.title.should.equal("Not Found");
            r.body.detail.should.equal("Resource not found");
            JSON.stringify(r.body).should.not.match(/items|MYDB/);
        }));

        it("uses the configured base", runEndpoint({ crudOperation: "delete", method: "DELETE", path: "/items/:id" }, {}, empty, function (r) {
            r.statusCode.should.equal(404);
            r.body.type.should.equal("urn:problem:not-found");
            r.body.detail.should.equal("Resource not found");
        }, { problemTypeBaseUri: "urn:problem:" }));
    });

    describe("5. useUTC and lowerCaseGuids", function () {
        function captureConfig(nodeConfig, done, check) {
            let captured = null;
            sinon.stub(sql, "ConnectionPool").callsFake(function (cfg) {
                captured = cfg;
                return { on() {}, connect: () => new Promise(() => {}), close: async () => {} };
            });
            helper.load(apiConfigNode, [Object.assign({ id: "c1", type: "apigw-config", dbType: "mssql" }, nodeConfig)], function () {
                try {
                    check(captured.options);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        }

        it("keeps the driver defaults for old flows", function (done) {
            captureConfig({}, done, function (options) {
                options.useUTC.should.be.true();
                options.lowerCaseGuids.should.be.false();
            });
        });

        it("passes the configured values to mssql", function (done) {
            captureConfig({ dbUseUTC: false, dbLowerCaseGuids: true }, done, function (options) {
                options.useUTC.should.be.false();
                options.lowerCaseGuids.should.be.true();
            });
        });
    });

    describe("6. non-unique primaryKey", function () {
        it("GET answers 409 when the key matches more than one row", runEndpoint({ crudOperation: "get", path: "/items/:id" }, {}, { data: [{ id: 7 }, { id: 7 }], rowsAffected: 2 }, function (r) {
            r.statusCode.should.equal(409);
            r.body.status.should.equal(409);
            r.body.detail.should.not.match(/items/);
        }));

        function loadConfig(cb) {
            helper.load(apiConfigNode, [{ id: "c1", type: "apigw-config", name: "cfg", dbType: "postgres" }], function () {
                cb(helper.getNode("c1"));
            });
        }

        // Runs the guard's transaction work with a fake run(); `matches` is
        // the number of rows that the locked key check finds.
        function fakeTransaction(c1, matches, calls) {
            c1.getTableColumnTypes = async () => new Map();
            c1.executeQuery = async () => { throw new Error("must run inside the transaction"); };
            c1.withTransaction = async function (work) {
                return work(async function (q, params) {
                    calls.push({ q, params });
                    if (q.startsWith("SELECT TOP (2)")) {
                        return { recordset: Array.from({ length: matches }, () => ({ found: 1 })), rowsAffected: [matches] };
                    }
                    return { recordset: [{ id: 7 }], rowsAffected: [1] };
                });
            };
        }

        const templates = {
            update: { sql: "UPDATE [dbo].[items] SET @assignments WHERE [id] = @id", tableName: "dbo.items", primaryKey: "id" },
            delete: { sql: "DELETE FROM [dbo].[items] WHERE [id] = @id", tableName: "dbo.items", primaryKey: "id" }
        };

        for (const operation of ["update", "delete"]) {
            it(`${operation} locks the key range and writes when exactly one row matches`, function (done) {
                loadConfig(function (c1) {
                    const calls = [];
                    fakeTransaction(c1, 1, calls);
                    c1.executeCrudOperation(operation, templates[operation], { params: { id: 7 }, body: { name: "n" } }).then(function (result) {
                        calls.length.should.equal(2);
                        calls[0].q.should.equal("SELECT TOP (2) 1 AS found FROM [dbo].[items] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = @id");
                        calls[0].params.should.eql({ id: 7 });
                        calls[1].q.should.startWith(operation === "update" ? "UPDATE [dbo].[items] SET [name] = @col0 OUTPUT INSERTED.* WHERE [id] = @id" : "DELETE FROM [dbo].[items] WHERE [id] = @id");
                        result.rowsAffected.should.equal(1);
                        done();
                    }).catch(done);
                });
            });

            it(`${operation} throws the 50409 guard error and writes nothing when the key matches two rows`, function (done) {
                loadConfig(function (c1) {
                    const calls = [];
                    fakeTransaction(c1, 2, calls);
                    c1.executeCrudOperation(operation, templates[operation], { params: { id: 7 }, body: { name: "n" } }).then(function () {
                        done(new Error("expected the guard error"));
                    }, function (err) {
                        try {
                            err.number.should.equal(50409);
                            calls.length.should.equal(1);
                            done();
                        } catch (e) {
                            done(e);
                        }
                    });
                });
            });

            it(`${operation} returns 0 rows (404) without writing when nothing matches`, function (done) {
                loadConfig(function (c1) {
                    const calls = [];
                    fakeTransaction(c1, 0, calls);
                    c1.executeCrudOperation(operation, templates[operation], { params: { id: 7 }, body: { name: "n" } }).then(function (result) {
                        calls.length.should.equal(1);
                        result.rowsAffected.should.equal(0);
                        done();
                    }).catch(done);
                });
            });
        }

        it("maps the guard error to 409", function (done) {
            helper.load(apiEndpointNode, endpointFlow({ crudOperation: "delete", method: "DELETE", path: "/items/:id" }), function () {
                const n1 = helper.getNode("n1");
                const err = Object.assign(new Error("primaryKey matches more than one row"), { number: 50409, code: "EREQUEST" });
                n1.serverNode = { configNode: fakeConfig(sinon.stub().rejects(err)) };
                n1.warn = function () {};
                n1.receive({
                    payload: {},
                    req: { method: "DELETE", headers: {}, body: {}, params: { id: "7" }, query: {} },
                    res: mockRes(function (r) {
                        try {
                            r.statusCode.should.equal(409);
                            r.body.type.should.equal("about:blank");
                            r.body.detail.should.not.match(/primaryKey/);
                            done();
                        } catch (e) {
                            done(e);
                        }
                    })
                });
            });
        });
    });

    describe("getTableColumns", function () {
        it("reads nullability, length, defaults and identity flags in column order", function (done) {
            helper.load(apiConfigNode, [{ id: "c1", type: "apigw-config", name: "cfg", dbType: "postgres" }], function () {
                const c1 = helper.getNode("c1");
                let captured = null;
                c1.mssqlPool = {
                    connected: true,
                    close: async function () {},
                    request() {
                        return {
                            input() {},
                            async query(q) {
                                captured = q;
                                return {
                                    recordset: [
                                        { COLUMN_NAME: "Id", DATA_TYPE: "INT", IS_NULLABLE: "NO", CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: 10, NUMERIC_SCALE: 0, COLUMN_DEFAULT: null, IS_IDENTITY: true, IS_COMPUTED: false },
                                        { COLUMN_NAME: "Name", DATA_TYPE: "nvarchar", IS_NULLABLE: "YES", CHARACTER_MAXIMUM_LENGTH: 50, NUMERIC_PRECISION: null, NUMERIC_SCALE: null, COLUMN_DEFAULT: "(N'x')", IS_IDENTITY: null, IS_COMPUTED: null }
                                    ]
                                };
                            }
                        };
                    }
                };
                c1.getTableColumns("MYDB.dbo.items").then(function (columns) {
                    captured.should.containEql("[MYDB].sys.columns");
                    captured.should.containEql("ORDER BY c.ORDINAL_POSITION");
                    columns.should.eql([
                        { name: "Id", dataType: "int", nullable: false, maxLength: null, precision: 10, scale: 0, hasDefault: false, identity: true, computed: false },
                        { name: "Name", dataType: "nvarchar", nullable: true, maxLength: 50, precision: null, scale: null, hasDefault: true, identity: false, computed: false }
                    ]);
                    return c1.getTableColumnTypes("MYDB.dbo.items");
                }).then(function (types) {
                    types.get("id").should.equal("int");
                    types.get("name").should.equal("nvarchar");
                    c1.mssqlPool = null;
                    done();
                }).catch(done);
            });
        });
    });

    describe("3. OpenAPI from introspected columns", function () {
        it("maps SQL types to the JSON that tedious returns", function () {
            columnReadSchema({ dataType: "int" }).should.eql({ type: "integer" });
            columnReadSchema({ dataType: "bigint" }).type.should.equal("string");
            columnReadSchema({ dataType: "decimal" }).should.eql({ type: "number" });
            columnReadSchema({ dataType: "bit" }).should.eql({ type: "boolean" });
            columnReadSchema({ dataType: "uniqueidentifier" }).format.should.equal("uuid");
            columnReadSchema({ dataType: "varchar", maxLength: 20 }).maxLength.should.equal(20);
            columnReadSchema({ dataType: "nvarchar", maxLength: -1 }).should.eql({ type: "string" });
            columnReadSchema({ dataType: "datetime" }).format.should.equal("date-time");
            columnReadSchema({ dataType: "varbinary" }).properties.type.should.eql({ const: "Buffer" });
        });

        it("builds a strict row schema with null for nullable columns", function () {
            const row = buildRowSchema(COLUMNS);
            row.required.should.eql(COLUMNS.map(c => c.name));
            row.additionalProperties.should.be.false();
            row.properties.id.readOnly.should.be.true();
            row.properties.big.type.should.eql(["string", "null"]);
            row.properties.active.type.should.equal("boolean");
            row.properties.photo.type.should.eql(["object", "null"]);
        });

        it("builds create/update bodies without identity columns", function () {
            const create = buildBodySchema(COLUMNS, "create");
            should(create.properties.id).be.undefined();
            create.required.should.eql(["code"]);
            create.properties.photo.oneOf.length.should.equal(3);
            should(buildBodySchema(COLUMNS, "update").required).be.undefined();
        });

        it("falls back to a generic object without columns", function () {
            const api = buildAutoCrudOpenApi({ operation: "get", columns: null, autoExecute: true });
            api.responses["200"].content["application/json"].schema.should.eql({ type: "object" });
        });

        it("describes no response when a flow answers", function () {
            const api = buildAutoCrudOpenApi({ operation: "list", columns: COLUMNS, autoExecute: false });
            should(api.responses).be.null();
        });

        function generate(flowExtra, done, check) {
            helper.load(apiEndpointNode, endpointFlow(flowExtra), function () {
                const n1 = helper.getNode("n1");
                n1.serverNode = { configNode: fakeConfig(sinon.stub()) };
                const generator = new OpenApiGenerator({});
                generator.registerEndpoint(n1);
                generator.generateAsync().then(function (spec) {
                    check(spec);
                    done();
                }).catch(done);
            });
        }

        it("describes the list envelope, pagination and typed filters", function (done) {
            generate({ paginationEnabled: true, defaultPageSize: 20, maxPageSize: 100, filteringEnabled: true, filterableFields: "big,active" }, done, function (spec) {
                const op = spec.paths["/items"].get;
                const body = op.responses["200"].content["application/json"].schema;
                body.required.should.eql(["data", "total", "limit", "offset"]);
                body.properties.data.items.properties.code.type.should.equal("string");
                const limit = op.parameters.find(p => p.name === "limit");
                limit.schema.should.containEql({ type: "integer", maximum: 100, default: 20 });
                op.parameters.find(p => p.name === "filter[active]").schema.should.eql({ type: "boolean" });
                op.parameters.find(p => p.name === "filter[big][gt]").schema.type.should.equal("string");
                op.parameters.find(p => p.name === "filter[active][in]").schema.should.eql({ type: "string" });
            });
        });

        it("describes the POST body and 201 row", function (done) {
            generate({ crudOperation: "create", method: "POST" }, done, function (spec) {
                const op = spec.paths["/items"].post;
                op.requestBody.content["application/json"].schema.required.should.eql(["code"]);
                op.responses["201"].content["application/json"].schema.properties.id.type.should.equal("integer");
                should(op.responses["200"]).be.undefined();
                op.responses["409"].should.be.ok();
            });
        });

        it("describes delete as 204 with 404", function (done) {
            generate({ crudOperation: "delete", method: "DELETE", path: "/items/:id" }, done, function (spec) {
                const op = spec.paths["/items/{id}"].delete;
                op.responses["204"].should.eql({ description: "Deleted" });
                op.responses["404"].content["application/json"].schema.properties.type.type.should.equal("string");
                should(op.responses["200"]).be.undefined();
            });
        });

        it("keeps hand-written response schemas", function (done) {
            const custom = JSON.stringify({ "200": { type: "object", properties: { mine: { type: "string" } } } });
            generate({ crudOperation: "get", path: "/items/:id", responseSchemas: custom }, done, function (spec) {
                const op = spec.paths["/items/{id}"].get;
                op.responses["200"].content["application/json"].schema.properties.should.have.property("mine");
                op.responses["404"].should.be.ok();
            });
        });
    });
    describe("review fixes", function () {
        function loadConfig(cb) {
            helper.load(apiConfigNode, [{ id: "c1", type: "apigw-config", name: "cfg", dbType: "postgres" }], function () {
                cb(helper.getNode("c1"));
            });
        }

        it("builds page and COUNT from parts when the table name contains SQL keywords", function (done) {
            loadConfig(function (c1) {
                const calls = [];
                c1.executeQuery = async function (q, params, types) {
                    calls.push({ q, params, types });
                    return { recordset: q.startsWith("SELECT COUNT_BIG") ? [{ total: 3 }] : [], rowsAffected: [0] };
                };
                const table = "dbo.Sales ORDER BY Region";
                c1.executeCrudOperation(
                    "list",
                    { sql: "SELECT * FROM [dbo].[Sales ORDER BY Region] ORDER BY [id] OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY", tableName: table, primaryKey: "id" },
                    {
                        pagination: { limit: 5, offset: 0 },
                        filtering: { whereClause: { clause: "WHERE [x] = @filter_x", params: { filter_x: 1 } } },
                        sorting: { orderByClause: "ORDER BY [x] DESC" }
                    }
                ).then(function (result) {
                    calls[0].q.should.equal("SELECT * FROM [dbo].[Sales ORDER BY Region] WHERE [x] = @filter_x ORDER BY [x] DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY");
                    calls[1].q.should.equal("SELECT COUNT_BIG(*) AS total FROM [dbo].[Sales ORDER BY Region] WHERE [x] = @filter_x");
                    result.total.should.equal(3);
                    done();
                }).catch(done);
            });
        });

        it("binds OFFSET as bigint so large page numbers do not overflow int", function (done) {
            loadConfig(function (c1) {
                const calls = [];
                c1.executeQuery = async function (q, params, types) {
                    calls.push({ q, params, types });
                    return { recordset: [], rowsAffected: [0] };
                };
                c1.executeCrudOperation(
                    "list",
                    { sql: "SELECT * FROM [t] ORDER BY [id] OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY", tableName: "t", primaryKey: "id" },
                    { pagination: { limit: 20, offset: 3999999980 } }
                ).then(function () {
                    calls[0].params.offset.should.equal(3999999980);
                    calls[0].types.offset.should.equal(sql.BigInt);
                    done();
                }).catch(done);
            });
        });

        it("binds bigint and decimal body values with the column type", function (done) {
            loadConfig(function (c1) {
                const calls = [];
                c1._tableColumns.set("t", [
                    { name: "big", dataType: "bigint" },
                    { name: "amount", dataType: "decimal", precision: 12, scale: 5 },
                    { name: "exact", dataType: "decimal", precision: 12, scale: 5 },
                    { name: "wide", dataType: "decimal", precision: 38, scale: 20 },
                    { name: "tiny", dataType: "numeric", precision: 38, scale: 20 }
                ]);
                c1.getTableColumnTypes = async () => new Map([["big", "bigint"], ["amount", "decimal"], ["exact", "decimal"], ["wide", "decimal"], ["tiny", "numeric"]]);
                c1.executeQuery = async function (q, params, types) {
                    calls.push({ q, params, types });
                    return { recordset: [{}], rowsAffected: [1] };
                };
                c1.executeCrudOperation(
                    "create",
                    { sql: "INSERT INTO [t] (@columns) VALUES (@values)", tableName: "t", primaryKey: "id" },
                    { body: { big: 3000000000, amount: 1.23456, exact: "12345.67891", wide: 1, tiny: 1e-7 } }
                ).then(function () {
                    const { types, params } = calls[0];
                    types.col0.should.equal(sql.BigInt);
                    // Numbers go as decimal text: exact, and no 64-bit
                    // encoder overflow (1 into decimal(38,20))
                    types.col1.should.equal(sql.NVarChar);
                    params.col1.should.equal("1.23456");
                    // Decimal strings keep the exact NVarChar conversion
                    should(types.col2).be.undefined();
                    params.col2.should.equal("12345.67891");
                    types.col3.should.equal(sql.NVarChar);
                    params.col3.should.equal("1");
                    // Exponent notation is not valid decimal text: float
                    types.col4.should.equal(sql.Float);
                    params.col4.should.equal(1e-7);
                    done();
                }).catch(done);
            });
        });

        it("resolves an unqualified name like the DML (default schema, then dbo)", function (done) {
            loadConfig(function (c1) {
                let captured = null;
                c1.mssqlPool = {
                    connected: true,
                    close: async function () {},
                    request() {
                        return { input() {}, async query(q) { captured = q; return { recordset: [] }; } };
                    }
                };
                c1.getTableColumns("items").then(function () {
                    captured.should.containEql("OBJECT_SCHEMA_NAME(OBJECT_ID(QUOTENAME(@table)))");
                    c1.mssqlPool = null;
                    done();
                }).catch(done);
            });
        });

        it("documents a configured success status for get under that code", function () {
            const api = buildAutoCrudOpenApi({ operation: "get", columns: COLUMNS, autoExecute: true, successStatusCode: 202 });
            api.successStatusCode.should.equal(202);
            api.responses.should.have.property("202");
            api.responses.should.not.have.property("200");
            buildAutoCrudOpenApi({ operation: "create", columns: COLUMNS, autoExecute: true, successStatusCode: 202 }).successStatusCode.should.equal(201);
            buildAutoCrudOpenApi({ operation: "delete", columns: COLUMNS, autoExecute: true, successStatusCode: 202 }).successStatusCode.should.equal(204);
        });

        it("the OpenAPI shows the configured code (202) and no extra 200", function (done) {
            helper.load(apiEndpointNode, endpointFlow({ crudOperation: "get", path: "/items/:id", successStatusCode: 202 }), function () {
                const n1 = helper.getNode("n1");
                n1.serverNode = { configNode: fakeConfig(sinon.stub()) };
                const generator = new OpenApiGenerator({});
                generator.registerEndpoint(n1);
                generator.generateAsync().then(function (spec) {
                    const op = spec.paths["/items/{id}"].get;
                    op.responses["202"].content["application/json"].schema.properties.should.have.property("code");
                    should(op.responses["200"]).be.undefined();
                    done();
                }).catch(done);
            });
        });

        it("the bigint body schema rejects unsafe integers and accepts digit strings", function () {
            const Ajv = require("ajv/dist/2020");
            const validate = new Ajv({ strict: false }).compile(buildBodySchema(COLUMNS, "update"));
            validate({ big: 3000000000 }).should.be.true();
            validate({ big: "9007199254740993" }).should.be.true();
            validate({ big: Number.MAX_SAFE_INTEGER + 2 }).should.be.false();
            validate({ big: "92233720368547758080" }).should.be.false();
        });

        it("documents a configured 204 for list/get/update without a body", function () {
            for (const operation of ["list", "get", "update"]) {
                const api = buildAutoCrudOpenApi({ operation, columns: COLUMNS, autoExecute: true, successStatusCode: 204 });
                api.responses["204"].should.eql({ description: "No content" });
            }
        });

        it("still counts the total for a custom list template", function (done) {
            loadConfig(function (c1) {
                const calls = [];
                c1.executeQuery = async function (q) {
                    calls.push(q);
                    return { recordset: q.startsWith("SELECT COUNT_BIG") ? [{ total: 50 }] : [{ id: 1 }], rowsAffected: [1] };
                };
                c1.executeCrudOperation(
                    "list",
                    { sql: "SELECT id FROM [items] ORDER BY [id] OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY", tableName: "items", primaryKey: "id" },
                    { pagination: { limit: 10, offset: 0 } }
                ).then(function (result) {
                    calls[1].should.equal("SELECT COUNT_BIG(*) AS total FROM [items]");
                    result.total.should.equal(50);
                    done();
                }).catch(done);
            });
        });

        it("releases the pool connection when BEGIN TRANSACTION fails", function (done) {
            loadConfig(function (c1) {
                const rollback = sinon.stub().rejects(new Error("no transaction"));
                sinon.stub(sql, "Transaction").callsFake(function () {
                    return { begin: sinon.stub().rejects(new Error("begin failed")), rollback, commit: sinon.stub() };
                });
                c1.mssqlPool = { connected: true, close: async function () {} };
                const work = sinon.stub();
                c1.withTransaction(work).then(function () {
                    done(new Error("expected the begin error"));
                }, function (err) {
                    try {
                        err.message.should.equal("begin failed");
                        sinon.assert.calledOnce(rollback);
                        sinon.assert.notCalled(work);
                        c1.mssqlPool = null;
                        done();
                    } catch (e) {
                        done(e);
                    }
                });
            });
        });

        it("answers 400 (not 500) for bigint and real values out of range", function (done) {
            const { buildDbErrorResponse } = require("../../lib/db-errors");
            loadConfig(function (c1) {
                c1.getTableColumnTypes = async () => new Map([["big", "bigint"], ["r", "real"]]);
                c1.executeQuery = async () => ({ recordset: [{}], rowsAffected: [1] });
                const tpl = { sql: "INSERT INTO [t] (@columns) VALUES (@values)", tableName: "t", primaryKey: "id" };
                const create = body => c1.executeCrudOperation("create", tpl, { body });
                const status = err => buildDbErrorResponse(err, { operation: "create" }).status;
                (async function () {
                    // Each case on its own: a valid value must never take the error path
                    await create({ big: "-9223372036854775808", r: 1.5 });
                    await create({ big: "9223372036854775807" });
                    const bigErr = await create({ big: "9223372036854775808" }).then(() => null, e => e);
                    should(bigErr).not.be.null();
                    bigErr.code.should.equal("EPARAM");
                    status(bigErr).should.equal(400);
                    const realErr = await create({ r: 1e40 }).then(() => null, e => e);
                    should(realErr).not.be.null();
                    realErr.code.should.equal("EPARAM");
                    status(realErr).should.equal(400);
                })().then(() => done(), done);
            });
        });

        it("an explicit 204 response schema is documented without a body", function (done) {
            const custom = JSON.stringify({ "204": { type: "object", description: "Done" } });
            helper.load(apiEndpointNode, endpointFlow({ crudOperation: "update", method: "PUT", path: "/items/:id", successStatusCode: 204, responseSchemas: custom }), function () {
                const n1 = helper.getNode("n1");
                n1.serverNode = { configNode: fakeConfig(sinon.stub()) };
                const generator = new OpenApiGenerator({});
                generator.registerEndpoint(n1);
                generator.generateAsync().then(function (spec) {
                    spec.paths["/items/{id}"].put.responses["204"].should.eql({ description: "Done" });
                    done();
                }).catch(done);
            });
        });

        it("clamps the auto-CRUD page offset to a safe integer", function (done) {
            helper.load(apiEndpointNode, endpointFlow({ paginationEnabled: true }), function () {
                const n1 = helper.getNode("n1");
                n1.getAutoCrudPage(null, { offset: "1e30" }).offset.should.equal(1);
                n1.getAutoCrudPage(null, { offset: "99999999999999999999" }).offset.should.equal(Number.MAX_SAFE_INTEGER);
                // A 309-digit page number gives Infinity: clamp, do not wrap to page 1
                n1.getAutoCrudPage(null, { page: "9".repeat(309), limit: "20" }).offset.should.equal(Number.MAX_SAFE_INTEGER);
                done();
            });
        });
    });
});
