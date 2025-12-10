const helper = require("node-red-node-test-helper");
const apiConfigNode = require("../../nodes/api-config.js");

helper.init(require.resolve("node-red"));

describe("api-config Node", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it("should be loaded as a config node", function (done) {
        const flow = [{ id: "c1", type: "api-config", name: "Test Config" }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("name", "Test Config");
                c1.should.have.property("type", "api-config");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store database configuration", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "DB Config",
            dbType: "postgres",
            dbHost: "db.example.com",
            dbPort: 5432,
            dbName: "testdb"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("dbType", "postgres");
                c1.should.have.property("dbHost", "db.example.com");
                c1.should.have.property("dbPort", 5432);
                c1.should.have.property("dbName", "testdb");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store OAuth2/Keycloak configuration", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "OAuth Config",
            oauth2Enabled: true,
            keycloakUrl: "https://keycloak.example.com",
            keycloakRealm: "myrealm",
            keycloakClientId: "my-client"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("oauth2Enabled", true);
                c1.should.have.property("keycloakUrl", "https://keycloak.example.com");
                c1.should.have.property("keycloakRealm", "myrealm");
                c1.should.have.property("keycloakClientId", "my-client");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store OPA configuration", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "OPA Config",
            opaEnabled: true,
            opaUrl: "http://opa.example.com:8181",
            opaPolicyPath: "v1/data/authz/allow"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("opaEnabled", true);
                c1.should.have.property("opaUrl", "http://opa.example.com:8181");
                c1.should.have.property("opaPolicyPath", "v1/data/authz/allow");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store SQL Server specific configuration", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "MSSQL Config",
            dbType: "mssql",
            dbHost: "sql.example.com",
            dbPort: 1433,
            dbName: "testdb",
            dbEncrypt: true,
            dbTrustServerCertificate: false
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("dbType", "mssql");
                c1.should.have.property("dbEncrypt", true);
                c1.should.have.property("dbTrustServerCertificate", false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store connection pool settings", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "Pool Config",
            dbType: "postgres",
            dbPoolMin: 2,
            dbPoolMax: 20,
            dbPoolIdleTimeout: 60000
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("dbPoolMin", 2);
                c1.should.have.property("dbPoolMax", 20);
                c1.should.have.property("dbPoolIdleTimeout", 60000);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store TLS configuration", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "TLS Config",
            tlsEnabled: true,
            tlsRejectUnauthorized: true,
            tlsCertPath: "/path/to/cert.pem",
            tlsKeyPath: "/path/to/key.pem",
            tlsCaPath: "/path/to/ca.pem"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("tlsEnabled", true);
                c1.should.have.property("tlsRejectUnauthorized", true);
                c1.should.have.property("tlsCertPath", "/path/to/cert.pem");
                c1.should.have.property("tlsKeyPath", "/path/to/key.pem");
                c1.should.have.property("tlsCaPath", "/path/to/ca.pem");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store credentials securely", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "Credentials Config"
        }];
        const credentials = {
            c1: {
                dbUser: "testuser",
                dbPassword: "testpass",
                keycloakClientSecret: "secret123"
            }
        };
        helper.load(apiConfigNode, flow, credentials, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.credentials.should.have.property("dbUser", "testuser");
                c1.credentials.should.have.property("dbPassword", "testpass");
                c1.credentials.should.have.property("keycloakClientSecret", "secret123");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should have default values when not specified", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "Default Config"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                // These should be undefined when not set in flow config
                (c1.oauth2Enabled === undefined || c1.oauth2Enabled === false).should.be.true();
                (c1.opaEnabled === undefined || c1.opaEnabled === false).should.be.true();
                (c1.tlsEnabled === undefined || c1.tlsEnabled === false).should.be.true();
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store JWT validation settings", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "JWT Config",
            oauth2Enabled: true,
            keycloakUrl: "https://keycloak.example.com",
            keycloakRealm: "myrealm",
            keycloakClientId: "my-client",
            jwtValidateIssuer: true,
            jwtIssuer: "https://keycloak.example.com/realms/myrealm",
            jwtValidateAudience: true,
            jwtAudience: "my-client",
            jwtClockTolerance: 30,
            jwtAlgorithms: "RS256"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("jwtValidateIssuer", true);
                c1.should.have.property("jwtIssuer", "https://keycloak.example.com/realms/myrealm");
                c1.should.have.property("jwtValidateAudience", true);
                c1.should.have.property("jwtAudience", "my-client");
                c1.should.have.property("jwtClockTolerance", 30);
                c1.should.have.property("jwtAlgorithms", "RS256");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should allow disabling JWT issuer validation", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "JWT No Issuer Validation",
            oauth2Enabled: true,
            jwtValidateIssuer: false,
            jwtValidateAudience: true,
            jwtAudience: "my-client"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("jwtValidateIssuer", false);
                c1.should.have.property("jwtValidateAudience", true);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should allow disabling JWT audience validation", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "JWT No Audience Validation",
            oauth2Enabled: true,
            jwtValidateIssuer: true,
            jwtIssuer: "https://keycloak.example.com/realms/myrealm",
            jwtValidateAudience: false
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("jwtValidateIssuer", true);
                c1.should.have.property("jwtValidateAudience", false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should support different JWT algorithms", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "JWT ES256 Config",
            oauth2Enabled: true,
            jwtAlgorithms: "ES256"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("jwtAlgorithms", "ES256");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should handle close event properly", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "Close Test Config"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                // Verify node exists and can be unloaded
                c1.should.have.property("name", "Close Test Config");
                // The helper.unload() in afterEach will trigger close
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});
