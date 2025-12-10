const { ConnectionState, ConnectionStateManager } = require('../lib/connection-state');

module.exports = function(RED) {
    function ApiConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Initialize connection state managers for each service
        node.connectionManagers = {};

        // Create connection manager for database if configured
        if (config.dbType && config.dbType !== 'none') {
            node.connectionManagers.database = new ConnectionStateManager('database', {
                initialBackoff: 1000,
                maxBackoff: 30000,
                maxRetries: Infinity
            });
        }

        // Create connection manager for Keycloak if enabled
        if (config.oauth2Enabled) {
            node.connectionManagers.keycloak = new ConnectionStateManager('keycloak', {
                initialBackoff: 1000,
                maxBackoff: 30000,
                maxRetries: Infinity
            });
        }

        // Create connection manager for OPA if enabled
        if (config.opaEnabled) {
            node.connectionManagers.opa = new ConnectionStateManager('opa', {
                initialBackoff: config.opaTimeout || 5000,
                maxBackoff: 30000,
                maxRetries: config.opaRetryAttempts || 3
            });
        }

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

        /**
         * Register a node to receive connection state updates
         * @param {Object} usingNode - Node-RED node that uses this config
         */
        node.registerNode = function(usingNode) {
            for (const manager of Object.values(node.connectionManagers)) {
                manager.registerNode(usingNode);
            }
        };

        /**
         * Unregister a node from connection state updates
         * @param {Object} usingNode - Node-RED node that uses this config
         */
        node.unregisterNode = function(usingNode) {
            for (const manager of Object.values(node.connectionManagers)) {
                manager.unregisterNode(usingNode);
            }
        };

        /**
         * Get connection manager for a specific service
         * @param {string} service - Service name ('database', 'keycloak', 'opa')
         * @returns {ConnectionStateManager|undefined}
         */
        node.getConnectionManager = function(service) {
            return node.connectionManagers[service];
        };

        /**
         * Get aggregated connection status
         * @returns {Object} Status info for all services
         */
        node.getConnectionStatus = function() {
            const status = {};
            for (const [name, manager] of Object.entries(node.connectionManagers)) {
                status[name] = manager.getStateInfo();
            }
            return status;
        };

        /**
         * Check if all configured services are connected
         * @returns {boolean}
         */
        node.isAllConnected = function() {
            return Object.values(node.connectionManagers).every(m => m.isConnected);
        };

        node.on("close", function(removed, done) {
            // Graceful shutdown: shutdown all connection managers
            for (const manager of Object.values(node.connectionManagers)) {
                manager.shutdown();
            }
            node.connectionManagers = {};

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
