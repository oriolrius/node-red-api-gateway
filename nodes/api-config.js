module.exports = function(RED) {
    function ApiConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Store configuration properties
        node.name = config.name;

        // Database configuration
        node.dbType = config.dbType;
        node.dbHost = config.dbHost;
        node.dbPort = config.dbPort;
        node.dbName = config.dbName;
        // Credentials: dbUser, dbPassword are stored in credentials

        // SQL Server specific options
        node.dbEncrypt = config.dbEncrypt;
        node.dbTrustServerCertificate = config.dbTrustServerCertificate;

        // Connection pool settings
        node.dbPoolMin = config.dbPoolMin;
        node.dbPoolMax = config.dbPoolMax;
        node.dbPoolIdleTimeout = config.dbPoolIdleTimeout;

        // OAuth2/Keycloak configuration
        node.oauth2Enabled = config.oauth2Enabled;
        node.keycloakUrl = config.keycloakUrl;
        node.keycloakRealm = config.keycloakRealm;
        node.keycloakClientId = config.keycloakClientId;
        // Credentials: keycloakClientSecret stored in credentials

        // JWT validation settings
        node.jwtValidateIssuer = config.jwtValidateIssuer;
        node.jwtIssuer = config.jwtIssuer;
        node.jwtValidateAudience = config.jwtValidateAudience;
        node.jwtAudience = config.jwtAudience;
        node.jwtClockTolerance = config.jwtClockTolerance;
        node.jwtAlgorithms = config.jwtAlgorithms;

        // OPA (Open Policy Agent) configuration
        node.opaEnabled = config.opaEnabled;
        node.opaUrl = config.opaUrl;
        node.opaPolicyPath = config.opaPolicyPath;
        node.opaCacheTTL = config.opaCacheTTL;
        node.opaTimeout = config.opaTimeout;
        node.opaRetryAttempts = config.opaRetryAttempts;

        // TLS/SSL configuration
        node.tlsEnabled = config.tlsEnabled;
        node.tlsRejectUnauthorized = config.tlsRejectUnauthorized;
        node.tlsCertPath = config.tlsCertPath;
        node.tlsKeyPath = config.tlsKeyPath;
        node.tlsCaPath = config.tlsCaPath;

        node.on("close", function(removed, done) {
            // Cleanup resources if needed
            if (done) {
                done();
            }
        });
    }

    RED.nodes.registerType("api-config", ApiConfigNode, {
        credentials: {
            dbUser: { type: "text" },
            dbPassword: { type: "password" },
            keycloakClientSecret: { type: "password" }
        }
    });
};
