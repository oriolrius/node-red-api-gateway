const { ConnectionStateManager } = require("../lib/connection-state");
const {
    HealthStatus,
    HealthCheckManager,
    createDatabaseHealthCheck,
    createKeycloakHealthCheck,
    createOpaHealthCheck
} = require("../lib/health-check");
const { ConnectionPoolManager } = require("../lib/connection-pool");
const { quoteIdentifierPart } = require("../lib/crud-generator");
const {
    LOG_DEFAULTS,
    createLogger,
    createRequestLogger,
    validateLoggerConfig,
    generateRequestId
} = require("../lib/logger");

// SQL Server support (lazy-loaded)
let mssql = null;
function getMssql() {
    if (!mssql) {
        try {
            mssql = require("mssql");
        } catch (err) {
            throw new Error("mssql package not installed. Run: npm install mssql");
        }
    }
    return mssql;
}

module.exports = function(RED) {
    function ApiConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Initialize connection state managers for each service
        node.connectionManagers = {};

        // Create connection manager for database if configured
        if (config.dbType && config.dbType !== "none") {
            node.connectionManagers.database = new ConnectionStateManager("database", {
                initialBackoff: 1000,
                maxBackoff: 30000,
                maxRetries: Infinity
            });
        }

        // Create connection manager for Keycloak if enabled
        if (config.oauth2Enabled) {
            node.connectionManagers.keycloak = new ConnectionStateManager("keycloak", {
                initialBackoff: 1000,
                maxBackoff: 30000,
                maxRetries: Infinity
            });
        }

        // Create connection manager for OPA if enabled
        if (config.opaEnabled) {
            node.connectionManagers.opa = new ConnectionStateManager("opa", {
                initialBackoff: config.opaTimeout || 5000,
                maxBackoff: 30000,
                maxRetries: config.opaRetryAttempts || 3
            });
        }

        // Initialize health check manager
        node.healthCheckManager = new HealthCheckManager({
            checkInterval: 30000,  // 30 seconds
            timeout: 5000,
            unhealthyThreshold: 3,
            healthyThreshold: 1
        });

        // Register health checks for configured services
        if (config.dbType && config.dbType !== "none") {
            node.healthCheckManager.registerCheck("database", createDatabaseHealthCheck({
                dbType: config.dbType,
                dbHost: config.dbHost,
                dbPort: config.dbPort,
                dbName: config.dbName
            }));
        }

        if (config.oauth2Enabled) {
            node.healthCheckManager.registerCheck("keycloak", createKeycloakHealthCheck({
                keycloakUrl: config.keycloakUrl,
                keycloakRealm: config.keycloakRealm
            }));
        }

        if (config.opaEnabled) {
            node.healthCheckManager.registerCheck("opa", createOpaHealthCheck({
                opaUrl: config.opaUrl,
                opaPolicyPath: config.opaPolicyPath,
                opaTimeout: config.opaTimeout
            }));
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
        node.dbPoolAcquireTimeout = config.dbPoolAcquireTimeout;

        // Initialize connection pool manager if database is configured
        node.connectionPool = null;
        node.mssqlPool = null;  // Native mssql ConnectionPool for SQL Server

        if (config.dbType && config.dbType !== "none") {
            node.connectionPool = new ConnectionPoolManager("database", {
                minConnections: config.dbPoolMin || 0,
                maxConnections: config.dbPoolMax || 10,
                idleTimeout: config.dbPoolIdleTimeout || 30000,
                acquireTimeout: config.dbPoolAcquireTimeout || 15000
            });

            // Initialize SQL Server connection pool if dbType is mssql
            if (config.dbType === "mssql") {
                const sql = getMssql();
                const mssqlConfig = {
                    server: config.dbHost || "localhost",
                    port: parseInt(config.dbPort, 10) || 1433,
                    database: config.dbName || "",
                    user: node.credentials?.dbUser || "",
                    password: node.credentials?.dbPassword || "",
                    options: {
                        encrypt: config.dbEncrypt !== false,
                        trustServerCertificate: config.dbTrustServerCertificate === true,
                        enableArithAbort: true
                    },
                    pool: {
                        min: config.dbPoolMin || 0,
                        max: config.dbPoolMax || 10,
                        idleTimeoutMillis: config.dbPoolIdleTimeout || 30000,
                        acquireTimeoutMillis: config.dbPoolAcquireTimeout || 15000
                    }
                };

                node.mssqlPool = new sql.ConnectionPool(mssqlConfig);

                // Connect to SQL Server
                node.mssqlPool.connect().then(() => {
                    node.log(`Connected to SQL Server: ${config.dbHost}/${config.dbName}`);
                    if (node.connectionManagers.database) {
                        node.connectionManagers.database.connected();
                    }
                }).catch(err => {
                    node.error(`Failed to connect to SQL Server: ${err.message}`);
                    if (node.connectionManagers.database) {
                        node.connectionManagers.database.error(err, false);
                    }
                });

                // Handle pool errors
                node.mssqlPool.on("error", err => {
                    node.error(`SQL Server pool error: ${err.message}`);
                    if (node.connectionManagers.database) {
                        node.connectionManagers.database.error(err, false);
                    }
                });
            }
        }

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
        node.tlsMinVersion = config.tlsMinVersion;
        node.tlsCertPath = config.tlsCertPath;
        node.tlsKeyPath = config.tlsKeyPath;
        node.tlsCaPath = config.tlsCaPath;

        // API Version configuration
        node.apiVersion = config.apiVersion;
        node.apiBasePath = config.apiBasePath;
        node.apiVersionInPath = config.apiVersionInPath;

        // OpenAPI configuration
        node.openapiTitle = config.openapiTitle || "API Gateway";
        node.openapiDescription = config.openapiDescription || "";
        node.openapiContactName = config.openapiContactName || "";
        node.openapiContactEmail = config.openapiContactEmail || "";
        node.openapiContactUrl = config.openapiContactUrl || "";
        node.openapiLicenseName = config.openapiLicenseName || "";
        node.openapiLicenseUrl = config.openapiLicenseUrl || "";
        node.openapiTermsOfService = config.openapiTermsOfService || "";

        // Logging configuration
        node.loggingEnabled = config.loggingEnabled !== false;  // Enabled by default
        node.logLevel = config.logLevel || "info";
        node.logOutput = config.logOutput || "console";
        node.logPrettyPrint = config.logPrettyPrint === true;
        node.logFilePath = config.logFilePath || "";
        node.logRedactHeaders = config.logRedactHeaders !== false;  // Enabled by default
        node.logIncludeUserContext = config.logIncludeUserContext !== false;  // Enabled by default

        // Initialize logger if enabled
        node.logger = null;
        if (node.loggingEnabled) {
            const logConfig = {
                level: node.logLevel,
                output: node.logOutput,
                prettyPrint: node.logPrettyPrint,
                filePath: node.logFilePath || LOG_DEFAULTS.filePath,
                redactPaths: node.logRedactHeaders ? LOG_DEFAULTS.redactPaths : []
            };

            const validation = validateLoggerConfig(logConfig);
            if (!validation.valid) {
                validation.errors.forEach(error => node.warn(`Logger config: ${error}`));
            }

            node.logger = createLogger(logConfig);
            node.log(`Logger initialized at level '${node.logger.level}'`);
        }

        /**
         * Get the full API base path including version if configured
         * @returns {string} Full base path (e.g., "/api/v1" or "/api")
         */
        node.getFullBasePath = function() {
            let basePath = node.apiBasePath || "";
            // Ensure basePath starts with /
            if (basePath && !basePath.startsWith("/")) {
                basePath = "/" + basePath;
            }
            // Remove trailing slash
            if (basePath.endsWith("/")) {
                basePath = basePath.slice(0, -1);
            }
            // Add version if configured
            if (node.apiVersionInPath && node.apiVersion) {
                basePath = basePath + "/" + node.apiVersion;
            }
            return basePath;
        };

        /**
         * Get OpenAPI info object for the API
         * @returns {Object} OpenAPI info object with full specification metadata
         */
        node.getOpenApiInfo = function() {
            const info = {
                title: node.openapiTitle || "API Gateway",
                version: node.apiVersion || "1.0.0"
            };

            // Add description if provided
            if (node.openapiDescription) {
                info.description = node.openapiDescription;
            }

            // Add contact info if any field is provided
            if (node.openapiContactName || node.openapiContactEmail || node.openapiContactUrl) {
                info.contact = {};
                if (node.openapiContactName) info.contact.name = node.openapiContactName;
                if (node.openapiContactEmail) info.contact.email = node.openapiContactEmail;
                if (node.openapiContactUrl) info.contact.url = node.openapiContactUrl;
            }

            // Add license info if provided
            if (node.openapiLicenseName) {
                info.license = { name: node.openapiLicenseName };
                if (node.openapiLicenseUrl) info.license.url = node.openapiLicenseUrl;
            }

            // Add terms of service if provided
            if (node.openapiTermsOfService) {
                info.termsOfService = node.openapiTermsOfService;
            }

            return {
                info,
                basePath: node.getFullBasePath()
            };
        };

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

        /**
         * Get the health check manager
         * @returns {HealthCheckManager}
         */
        node.getHealthCheckManager = function() {
            return node.healthCheckManager;
        };

        /**
         * Run all health checks and return results
         * @returns {Promise<Object>} Health check results
         */
        node.checkHealth = async function() {
            await node.healthCheckManager.checkAll();
            return node.healthCheckManager.getHealthReport();
        };

        /**
         * Get the current health status without running new checks
         * @returns {Object} Health report
         */
        node.getHealthStatus = function() {
            return node.healthCheckManager.getHealthReport();
        };

        /**
         * Get aggregated health status (healthy, degraded, unhealthy)
         * @returns {string} HealthStatus value
         */
        node.getAggregatedHealth = function() {
            return node.healthCheckManager.getAggregatedStatus();
        };

        /**
         * Check if all services are healthy
         * @returns {boolean}
         */
        node.isHealthy = function() {
            return node.healthCheckManager.getAggregatedStatus() === HealthStatus.HEALTHY;
        };

        /**
         * Start periodic health checks
         */
        node.startHealthChecks = function() {
            node.healthCheckManager.start();
        };

        /**
         * Stop periodic health checks
         */
        node.stopHealthChecks = function() {
            node.healthCheckManager.stop();
        };

        /**
         * Get the connection pool manager
         * @returns {ConnectionPoolManager|null}
         */
        node.getConnectionPool = function() {
            return node.connectionPool;
        };

        /**
         * Get connection pool statistics
         * @returns {Object|null} Pool statistics or null if no pool
         */
        node.getPoolStatistics = function() {
            if (!node.connectionPool) {
                return null;
            }
            return node.connectionPool.getStatistics();
        };

        /**
         * Get connection pool status (simplified)
         * @returns {Object|null} Pool status or null if no pool
         */
        node.getPoolStatus = function() {
            if (!node.connectionPool) {
                return null;
            }
            return node.connectionPool.getStatus();
        };

        /**
         * Set the connection factory for the pool
         * @param {Object} factory - Factory with create, destroy, validate functions
         */
        node.setPoolFactory = function(factory) {
            if (!node.connectionPool) {
                throw new Error("Connection pool not initialized");
            }
            node.connectionPool.setFactory(factory);
        };

        /**
         * Initialize the connection pool
         * @returns {Promise<void>}
         */
        node.initializePool = async function() {
            if (!node.connectionPool) {
                throw new Error("Connection pool not initialized");
            }
            await node.connectionPool.initialize();
        };

        /**
         * Acquire a connection from the pool
         * @param {number} [timeout] - Optional custom timeout
         * @returns {Promise<Object>} The acquired connection
         */
        node.acquireConnection = async function(timeout) {
            if (!node.connectionPool) {
                throw new Error("Connection pool not initialized");
            }
            return node.connectionPool.acquire(timeout);
        };

        /**
         * Release a connection back to the pool
         * @param {Object} connection - The connection to release
         */
        node.releaseConnection = async function(connection) {
            if (!node.connectionPool) {
                throw new Error("Connection pool not initialized");
            }
            await node.connectionPool.release(connection);
        };

        /**
         * Check if SQL Server is configured and connected
         * @returns {boolean}
         */
        node.isSqlServerReady = function() {
            return node.dbType === "mssql" && node.mssqlPool && node.mssqlPool.connected;
        };

        /**
         * Execute a SQL query with parameters
         * @param {string} query - SQL query string
         * @param {Object} [params] - Query parameters (name: value pairs)
         * @returns {Promise<Object>} Query result with recordset and rowsAffected
         */
        node.executeQuery = async function(query, params = {}) {
            if (!node.mssqlPool) {
                throw new Error("SQL Server not configured");
            }
            if (!node.mssqlPool.connected) {
                throw new Error("SQL Server not connected");
            }

            const sql = getMssql();
            const request = node.mssqlPool.request();

            // Add parameters to the request
            for (const [name, value] of Object.entries(params)) {
                if (value === null || value === undefined) {
                    request.input(name, sql.NVarChar, null);
                } else if (typeof value === "number") {
                    if (Number.isInteger(value)) {
                        request.input(name, sql.Int, value);
                    } else {
                        request.input(name, sql.Decimal(18, 4), value);
                    }
                } else if (typeof value === "boolean") {
                    request.input(name, sql.Bit, value);
                } else if (value instanceof Date) {
                    request.input(name, sql.DateTime, value);
                } else {
                    request.input(name, sql.NVarChar, String(value));
                }
            }

            const result = await request.query(query);
            return {
                recordset: result.recordset || [],
                recordsets: result.recordsets || [],
                rowsAffected: result.rowsAffected || [],
                output: result.output || {}
            };
        };

        /**
         * Execute a CRUD operation based on generated SQL
         * @param {string} operation - CRUD operation (list, get, create, update, delete)
         * @param {Object} sqlTemplate - SQL template from crud-generator
         * @param {Object} context - Request context with params, body, query, filtering, sorting
         * @returns {Promise<Object>} Operation result
         */
        node.executeCrudOperation = async function(operation, sqlTemplate, context = {}) {
            if (!sqlTemplate || !sqlTemplate.sql) {
                throw new Error("Invalid SQL template");
            }

            const params = {};
            const { body = {}, params: urlParams = {}, query = {}, filtering = null, sorting = null } = context;

            // Build base SQL - may need to inject WHERE clause for filtering
            let sql = sqlTemplate.sql;

            // Build parameters based on operation
            switch (operation) {
            case "list":
                // Pagination params with defaults (required for SQL Server OFFSET/FETCH)
                params.limit = parseInt(query.limit, 10) || 10;
                params.offset = parseInt(query.offset, 10) || 0;

                // Handle filtering - inject WHERE clause before ORDER BY
                if (filtering && filtering.whereClause && filtering.whereClause.clause) {
                    // Add filter params
                    for (const [key, value] of Object.entries(filtering.whereClause.params || {})) {
                        params[key] = value;
                    }

                    // Inject WHERE clause into SQL (before ORDER BY)
                    const orderByIndex = sql.indexOf("ORDER BY");
                    if (orderByIndex > -1) {
                        sql = sql.slice(0, orderByIndex) + filtering.whereClause.clause + " " + sql.slice(orderByIndex);
                    } else {
                        sql = sql + " " + filtering.whereClause.clause;
                    }
                }

                // Handle custom sorting if provided
                if (sorting && sorting.orderByClause) {
                    // Replace existing ORDER BY with custom sorting
                    const orderByMatch = sql.match(/ORDER BY [^O]+(?=OFFSET|$)/i);
                    if (orderByMatch) {
                        sql = sql.replace(orderByMatch[0], sorting.orderByClause + " ");
                    }
                }
                break;

            case "get": {
                // Bind primary-key parameter. Prefer urlParams[primaryKey];
                // fall back to the sole path param when paths use a
                // differently-named placeholder (e.g. :idCota vs PK id_cota);
                // legacy fallback to urlParams.id for paths that still use :id.
                const pkCol = sqlTemplate.primaryKey;
                let pkVal = pkCol ? urlParams[pkCol] : undefined;
                if (pkVal === undefined && Array.isArray(context.paramNames) && context.paramNames.length === 1) {
                    pkVal = urlParams[context.paramNames[0]];
                }
                if (pkVal === undefined) pkVal = urlParams.id;
                if (pkVal !== undefined && pkCol) params[pkCol] = pkVal;
                break;
            }

            case "create":
                // Insert body fields - build actual INSERT SQL from template.
                // Column identifiers are bracket-quoted (so names with special
                // chars like % are legal); parameter names are positional
                // (col0, col1, ...) and thus decoupled from the column names,
                // since a column name may be an invalid SQL parameter token.
                {
                    const columns = Object.keys(body);
                    const identifiers = columns.map(quoteIdentifierPart);
                    const placeholders = columns.map((c, i) => `@col${i}`);
                    // Replace @columns and @values placeholders with actual values
                    sql = sql.replace("@columns", identifiers.join(", "));
                    sql = sql.replace("@values", placeholders.join(", "));
                    // Add OUTPUT clause to return inserted row (SQL Server)
                    sql = sql.replace(") VALUES", ") OUTPUT INSERTED.* VALUES");
                    columns.forEach((c, i) => {
                        params[`col${i}`] = body[c];
                    });
                }
                break;

            case "update":
                // Update by primary key with body fields - build actual UPDATE SQL
                {
                    const pkCol = sqlTemplate.primaryKey;
                    let pkVal = pkCol ? urlParams[pkCol] : undefined;
                    if (pkVal === undefined && Array.isArray(context.paramNames) && context.paramNames.length === 1) {
                        pkVal = urlParams[context.paramNames[0]];
                    }
                    if (pkVal === undefined) pkVal = urlParams.id;
                    if (pkVal !== undefined && pkCol) params[pkCol] = pkVal;
                    // Bracket-quote column identifiers; use positional param
                    // names (col0, col1, ...) decoupled from column names so
                    // special-character columns bind to valid SQL parameters.
                    const columns = Object.keys(body);
                    const assignments = columns.map((c, i) => `${quoteIdentifierPart(c)} = @col${i}`);
                    // Replace @assignments placeholder with actual SET clause
                    sql = sql.replace("@assignments", assignments.join(", "));
                    // Add OUTPUT clause to return updated row (SQL Server)
                    const whereIndex = sql.indexOf("WHERE");
                    if (whereIndex > -1) {
                        sql = sql.slice(0, whereIndex) + "OUTPUT INSERTED.* " + sql.slice(whereIndex);
                    }
                    columns.forEach((c, i) => {
                        params[`col${i}`] = body[c];
                    });
                }
                break;

            case "delete": {
                // Delete by primary key (see 'get' for fallback chain).
                const pkCol = sqlTemplate.primaryKey;
                let pkVal = pkCol ? urlParams[pkCol] : undefined;
                if (pkVal === undefined && Array.isArray(context.paramNames) && context.paramNames.length === 1) {
                    pkVal = urlParams[context.paramNames[0]];
                }
                if (pkVal === undefined) pkVal = urlParams.id;
                if (pkVal !== undefined && pkCol) params[pkCol] = pkVal;
                break;
            }
            }

            // Execute the query
            const result = await node.executeQuery(sql, params);

            return {
                operation,
                data: result.recordset,
                rowsAffected: result.rowsAffected[0] || 0,
                success: true
            };
        };

        /**
         * Get the shared logger instance
         * @returns {Object|null} Pino logger instance or null if logging disabled
         */
        node.getLogger = function() {
            return node.logger;
        };

        /**
         * Create a child logger with additional context
         * @param {Object} bindings - Additional context to bind to the logger
         * @returns {Object|null} Child logger or null if logging disabled
         */
        node.createChildLogger = function(bindings) {
            if (!node.logger) {
                return null;
            }
            return node.logger.child(bindings);
        };

        /**
         * Create a request-scoped logger
         * @param {Object} context - Request context
         * @param {string} [context.requestId] - Request ID
         * @param {string} [context.method] - HTTP method
         * @param {string} [context.path] - Request path
         * @param {string} [context.userId] - User ID
         * @param {string} [context.username] - Username
         * @returns {Object|null} Request logger or null if logging disabled
         */
        node.createRequestLogger = function(context) {
            if (!node.logger) {
                return null;
            }
            return createRequestLogger(node.logger, context);
        };

        /**
         * Generate a new unique request ID
         * @returns {string} Request ID
         */
        node.generateRequestId = function() {
            return generateRequestId();
        };

        /**
         * Get logger configuration
         * @returns {Object} Logger configuration
         */
        node.getLoggerConfig = function() {
            return {
                enabled: node.loggingEnabled,
                level: node.logLevel,
                output: node.logOutput,
                prettyPrint: node.logPrettyPrint,
                filePath: node.logFilePath,
                redactHeaders: node.logRedactHeaders,
                includeUserContext: node.logIncludeUserContext
            };
        };

        node.on("close", async function(removed, done) {
            // Graceful shutdown: shutdown all connection managers
            for (const manager of Object.values(node.connectionManagers)) {
                manager.shutdown();
            }
            node.connectionManagers = {};

            // Shutdown health check manager
            if (node.healthCheckManager) {
                node.healthCheckManager.shutdown();
                node.healthCheckManager = null;
            }

            // Close SQL Server connection pool
            if (node.mssqlPool) {
                try {
                    await node.mssqlPool.close();
                    node.log("SQL Server connection pool closed");
                } catch (err) {
                    node.error("Error closing SQL Server pool: " + err.message);
                }
                node.mssqlPool = null;
            }

            // Shutdown connection pool (graceful with drain timeout)
            if (node.connectionPool) {
                try {
                    await node.connectionPool.shutdown(30000);
                } catch (err) {
                    // Log error but continue shutdown
                    node.error("Error shutting down connection pool: " + err.message);
                }
                node.connectionPool = null;
            }

            if (done) {
                done();
            }
        });
    }

    RED.nodes.registerType("apigw-config", ApiConfigNode, {
        credentials: {
            dbUser: { type: "text" },
            dbPassword: { type: "password" },
            keycloakClientSecret: { type: "password" }
        }
    });
};
