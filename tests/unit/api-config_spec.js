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
            opaPolicyPath: "v1/data/authz/allow",
            opaCacheTTL: 120,
            opaTimeout: 10000,
            opaRetryAttempts: 5
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("opaEnabled", true);
                c1.should.have.property("opaUrl", "http://opa.example.com:8181");
                c1.should.have.property("opaPolicyPath", "v1/data/authz/allow");
                c1.should.have.property("opaCacheTTL", 120);
                c1.should.have.property("opaTimeout", 10000);
                c1.should.have.property("opaRetryAttempts", 5);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store OPA cache, timeout, and retry settings", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "OPA Advanced Config",
            opaEnabled: true,
            opaUrl: "http://opa.example.com:8181",
            opaPolicyPath: "v1/data/authz/allow",
            opaCacheTTL: 300,
            opaTimeout: 3000,
            opaRetryAttempts: 2
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("opaCacheTTL", 300);
                c1.should.have.property("opaTimeout", 3000);
                c1.should.have.property("opaRetryAttempts", 2);
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
            tlsMinVersion: "TLSv1.3",
            tlsCertPath: "/path/to/cert.pem",
            tlsKeyPath: "/path/to/key.pem",
            tlsCaPath: "/path/to/ca.pem"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("tlsEnabled", true);
                c1.should.have.property("tlsRejectUnauthorized", true);
                c1.should.have.property("tlsMinVersion", "TLSv1.3");
                c1.should.have.property("tlsCertPath", "/path/to/cert.pem");
                c1.should.have.property("tlsKeyPath", "/path/to/key.pem");
                c1.should.have.property("tlsCaPath", "/path/to/ca.pem");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should support different TLS minimum versions", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "TLS 1.2 Config",
            tlsEnabled: true,
            tlsMinVersion: "TLSv1.2"
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("tlsMinVersion", "TLSv1.2");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should store API version configuration", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "API Version Config",
            apiVersion: "v2",
            apiBasePath: "/api",
            apiVersionInPath: true
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.should.have.property("apiVersion", "v2");
                c1.should.have.property("apiBasePath", "/api");
                c1.should.have.property("apiVersionInPath", true);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should compute full base path with version", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "Full Path Config",
            apiVersion: "v1",
            apiBasePath: "/api",
            apiVersionInPath: true
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.getFullBasePath().should.equal("/api/v1");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should compute full base path without version", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "No Version Path Config",
            apiVersion: "v1",
            apiBasePath: "/api",
            apiVersionInPath: false
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                c1.getFullBasePath().should.equal("/api");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should normalize base path", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "Normalize Path Config",
            apiVersion: "v1",
            apiBasePath: "api/",
            apiVersionInPath: true
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                // Should add leading slash and remove trailing slash
                c1.getFullBasePath().should.equal("/api/v1");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should return OpenAPI info", function (done) {
        const flow = [{
            id: "c1",
            type: "api-config",
            name: "OpenAPI Info Config",
            apiVersion: "v2",
            apiBasePath: "/api",
            apiVersionInPath: true
        }];
        helper.load(apiConfigNode, flow, function () {
            const c1 = helper.getNode("c1");
            try {
                const info = c1.getOpenApiInfo();
                info.should.have.property("version", "v2");
                info.should.have.property("basePath", "/api/v2");
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

    describe("Connection State Management", function() {
        it("should create database connection manager when dbType is set", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "DB Config",
                dbType: "postgres",
                dbHost: "localhost"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.should.have.property("connectionManagers");
                    c1.connectionManagers.should.have.property("database");
                    c1.connectionManagers.database.serviceName.should.equal("database");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should not create database connection manager when dbType is none", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "No DB Config",
                dbType: "none"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.should.have.property("connectionManagers");
                    c1.connectionManagers.should.not.have.property("database");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should create keycloak connection manager when oauth2 is enabled", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "OAuth Config",
                oauth2Enabled: true,
                keycloakUrl: "https://keycloak.example.com"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.connectionManagers.should.have.property("keycloak");
                    c1.connectionManagers.keycloak.serviceName.should.equal("keycloak");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should create opa connection manager when opa is enabled", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "OPA Config",
                opaEnabled: true,
                opaUrl: "http://localhost:8181",
                opaRetryAttempts: 5
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.connectionManagers.should.have.property("opa");
                    c1.connectionManagers.opa.serviceName.should.equal("opa");
                    c1.connectionManagers.opa.config.maxRetries.should.equal(5);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should have helper methods for connection management", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Full Config",
                dbType: "postgres",
                oauth2Enabled: true,
                opaEnabled: true
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.should.have.property("registerNode").which.is.a.Function();
                    c1.should.have.property("unregisterNode").which.is.a.Function();
                    c1.should.have.property("getConnectionManager").which.is.a.Function();
                    c1.should.have.property("getConnectionStatus").which.is.a.Function();
                    c1.should.have.property("isAllConnected").which.is.a.Function();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return connection manager by service name", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Full Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    const dbManager = c1.getConnectionManager("database");
                    dbManager.should.be.ok();
                    dbManager.serviceName.should.equal("database");

                    const noManager = c1.getConnectionManager("nonexistent");
                    (noManager === undefined).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return aggregated connection status", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Multi Config",
                dbType: "postgres",
                oauth2Enabled: true
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    const status = c1.getConnectionStatus();
                    status.should.have.property("database");
                    status.should.have.property("keycloak");
                    status.database.should.have.property("state", "disconnected");
                    status.keycloak.should.have.property("state", "disconnected");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should check if all services are connected", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Check Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    // Initially not connected
                    c1.isAllConnected().should.be.false();

                    // Mark as connected
                    c1.connectionManagers.database.connected();
                    c1.isAllConnected().should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should shutdown connection managers on close", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Shutdown Config",
                dbType: "postgres",
                oauth2Enabled: true
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    // Verify managers exist
                    Object.keys(c1.connectionManagers).length.should.equal(2);

                    // Subscribe to shutdown events to verify they fire
                    let shutdownCount = 0;
                    for (const manager of Object.values(c1.connectionManagers)) {
                        manager.on('shutdown', function() {
                            shutdownCount++;
                        });
                    }

                    // Trigger close - note: the afterEach unload will also trigger close
                    // but managers will already be empty
                    c1.close(false).then(function() {
                        // After close, managers should be cleared
                        Object.keys(c1.connectionManagers).length.should.equal(0);
                        shutdownCount.should.equal(2);
                        done();
                    }).catch(done);
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Health Check Support", function() {
        it("should have health check manager", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Health Check Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.should.have.property("healthCheckManager");
                    c1.healthCheckManager.should.be.ok();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should register database health check when dbType is set", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "DB Health Config",
                dbType: "postgres",
                dbHost: "localhost"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.healthCheckManager._healthChecks.has('database').should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should register keycloak health check when oauth2 is enabled", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Keycloak Health Config",
                oauth2Enabled: true,
                keycloakUrl: "https://keycloak.example.com"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.healthCheckManager._healthChecks.has('keycloak').should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should register opa health check when opa is enabled", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "OPA Health Config",
                opaEnabled: true,
                opaUrl: "http://localhost:8181"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.healthCheckManager._healthChecks.has('opa').should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should have health check helper methods", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Health Methods Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.should.have.property("getHealthCheckManager").which.is.a.Function();
                    c1.should.have.property("checkHealth").which.is.a.Function();
                    c1.should.have.property("getHealthStatus").which.is.a.Function();
                    c1.should.have.property("getAggregatedHealth").which.is.a.Function();
                    c1.should.have.property("isHealthy").which.is.a.Function();
                    c1.should.have.property("startHealthChecks").which.is.a.Function();
                    c1.should.have.property("stopHealthChecks").which.is.a.Function();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return health status report", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Health Report Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    const status = c1.getHealthStatus();
                    status.should.have.property('status');
                    status.should.have.property('timestamp');
                    status.should.have.property('services');
                    status.should.have.property('config');
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should run health checks on demand", async function () {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "On Demand Health Config",
                dbType: "postgres",
                dbHost: "localhost"
            }];

            return new Promise((resolve, reject) => {
                helper.load(apiConfigNode, flow, async function () {
                    const c1 = helper.getNode("c1");
                    try {
                        const report = await c1.checkHealth();
                        report.should.have.property('status');
                        report.should.have.property('services');
                        report.services.should.have.property('database');
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        });

        it("should shutdown health check manager on close", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Health Shutdown Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.healthCheckManager.should.be.ok();

                    c1.close(false).then(function() {
                        (c1.healthCheckManager === null).should.be.true();
                        done();
                    }).catch(done);
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Connection Pool Management", function() {
        it("should create connection pool when dbType is set", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Pool Config",
                dbType: "postgres",
                dbPoolMin: 0,
                dbPoolMax: 10
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.should.have.property("connectionPool");
                    c1.connectionPool.should.be.ok();
                    c1.connectionPool.poolName.should.equal("database");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should not create connection pool when dbType is none", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "No Pool Config",
                dbType: "none"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    (c1.connectionPool === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should configure pool with custom settings", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Custom Pool Config",
                dbType: "postgres",
                dbPoolMin: 5,
                dbPoolMax: 25,
                dbPoolIdleTimeout: 60000,
                dbPoolAcquireTimeout: 20000
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.connectionPool.config.minConnections.should.equal(5);
                    c1.connectionPool.config.maxConnections.should.equal(25);
                    c1.connectionPool.config.idleTimeout.should.equal(60000);
                    c1.connectionPool.config.acquireTimeout.should.equal(20000);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should have pool helper methods", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Pool Methods Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.should.have.property("getConnectionPool").which.is.a.Function();
                    c1.should.have.property("getPoolStatistics").which.is.a.Function();
                    c1.should.have.property("getPoolStatus").which.is.a.Function();
                    c1.should.have.property("setPoolFactory").which.is.a.Function();
                    c1.should.have.property("initializePool").which.is.a.Function();
                    c1.should.have.property("acquireConnection").which.is.a.Function();
                    c1.should.have.property("releaseConnection").which.is.a.Function();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return null for pool stats when no pool", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "No Pool Stats Config",
                dbType: "none"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    (c1.getPoolStatistics() === null).should.be.true();
                    (c1.getPoolStatus() === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return pool statistics", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Stats Config",
                dbType: "postgres",
                dbPoolMin: 2,
                dbPoolMax: 10
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    const stats = c1.getPoolStatistics();
                    stats.should.have.property('pool', 'database');
                    stats.should.have.property('state');
                    stats.should.have.property('config');
                    stats.should.have.property('current');
                    stats.should.have.property('cumulative');
                    stats.should.have.property('peaks');

                    stats.config.should.have.property('minConnections', 2);
                    stats.config.should.have.property('maxConnections', 10);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return pool status", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Status Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    const status = c1.getPoolStatus();
                    status.should.have.property('state');
                    status.should.have.property('available');
                    status.should.have.property('borrowed');
                    status.should.have.property('pending');
                    status.should.have.property('total');
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should throw error when setting factory on null pool", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "No Pool Factory Config",
                dbType: "none"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    (function() {
                        c1.setPoolFactory({
                            create: async () => ({}),
                            destroy: async () => {}
                        });
                    }).should.throw(/not initialized/);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should throw error when initializing null pool", async function () {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "No Pool Init Config",
                dbType: "none"
            }];

            return new Promise((resolve, reject) => {
                helper.load(apiConfigNode, flow, async function () {
                    const c1 = helper.getNode("c1");
                    try {
                        await c1.initializePool();
                        reject(new Error('Expected error'));
                    } catch (err) {
                        err.message.should.containEql('not initialized');
                        resolve();
                    }
                });
            });
        });

        it("should throw error when acquiring from null pool", async function () {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "No Pool Acquire Config",
                dbType: "none"
            }];

            return new Promise((resolve, reject) => {
                helper.load(apiConfigNode, flow, async function () {
                    const c1 = helper.getNode("c1");
                    try {
                        await c1.acquireConnection();
                        reject(new Error('Expected error'));
                    } catch (err) {
                        err.message.should.containEql('not initialized');
                        resolve();
                    }
                });
            });
        });

        it("should throw error when releasing to null pool", async function () {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "No Pool Release Config",
                dbType: "none"
            }];

            return new Promise((resolve, reject) => {
                helper.load(apiConfigNode, flow, async function () {
                    const c1 = helper.getNode("c1");
                    try {
                        await c1.releaseConnection({});
                        reject(new Error('Expected error'));
                    } catch (err) {
                        err.message.should.containEql('not initialized');
                        resolve();
                    }
                });
            });
        });

        it("should shutdown connection pool on close", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Pool Shutdown Config",
                dbType: "postgres"
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.connectionPool.should.be.ok();

                    c1.close(false).then(function() {
                        (c1.connectionPool === null).should.be.true();
                        done();
                    }).catch(done);
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store dbPoolAcquireTimeout setting", function (done) {
            const flow = [{
                id: "c1",
                type: "api-config",
                name: "Acquire Timeout Config",
                dbType: "postgres",
                dbPoolAcquireTimeout: 25000
            }];
            helper.load(apiConfigNode, flow, function () {
                const c1 = helper.getNode("c1");
                try {
                    c1.should.have.property("dbPoolAcquireTimeout", 25000);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });
});
