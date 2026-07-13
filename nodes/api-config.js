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
    closeLogger,
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

/**
 * Coerces a config value to an integer, falling back to a default when the
 * value is missing or non-numeric. The Node-RED editor stores edited numeric
 * inputs as strings, which tarn/mssql reject unless parsed.
 * @param {*} value - Raw config value
 * @param {number} fallback - Default when value is absent/non-numeric
 * @returns {number} Parsed integer or the fallback
 */
function toInt(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? fallback : n;
}

/**
 * Maps introspected column DATA_TYPEs that reject the default NVarChar
 * parameter binding (SQL Server raises "Operand type clash") to explicit
 * mssql parameter types.
 * @param {string|undefined} dataType - Lowercased DATA_TYPE from INFORMATION_SCHEMA
 * @param {Object} sql - The mssql module
 * @returns {{sqlType: Object, binary: boolean}|null} Explicit type or null for default binding
 */
function getExplicitParamType(dataType, sql) {
    switch (dataType) {
    case "binary":
    case "varbinary":
    case "image":
    case "rowversion":
    case "timestamp":
        return { sqlType: sql.VarBinary(sql.MAX), binary: true };
    case "text":
        return { sqlType: sql.Text, binary: false };
    case "ntext":
        return { sqlType: sql.NText, binary: false };
    default:
        return null;
    }
}

/**
 * Coerces a JSON-carried value to a Buffer for binary column binding.
 * Buffers pass through; "0x..." strings decode as hex; other strings decode
 * as base64; JSON-serialized Buffers ({type:"Buffer",data:[...]}, as produced
 * by res.json() on a fetched binary column) are reconstructed.
 * @param {*} value - Raw body value
 * @returns {Buffer|null|*} Buffer (or null) suitable for VarBinary binding
 */
function toBufferValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (typeof value === "string") {
        if (/^0x[0-9a-fA-F]*$/.test(value)) {
            return Buffer.from(value.slice(2), "hex");
        }
        return Buffer.from(value, "base64");
    }
    if (typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    return value;
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
            // OPA is configured and health-checked, but request-time policy
            // evaluation is not yet wired into the endpoint pipeline. Warn loudly
            // so operators don't assume requests are being authorized by policy
            // (it would otherwise fail open silently). Endpoint scope checks
            // (requiredScopes) still apply.
            node.warn("OPA is enabled but policy enforcement is NOT active in this version — requests are NOT evaluated against OPA policies. Use endpoint scope checks (requiredScopes) for authorization.");
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
                minConnections: toInt(config.dbPoolMin, 0),
                maxConnections: toInt(config.dbPoolMax, 10),
                idleTimeout: toInt(config.dbPoolIdleTimeout, 30000),
                acquireTimeout: toInt(config.dbPoolAcquireTimeout, 15000)
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
                        min: toInt(config.dbPoolMin, 0),
                        max: toInt(config.dbPoolMax, 10),
                        idleTimeoutMillis: toInt(config.dbPoolIdleTimeout, 30000),
                        acquireTimeoutMillis: toInt(config.dbPoolAcquireTimeout, 15000)
                    }
                };

                // Connect to SQL Server with automatic retry. mssql's
                // ConnectionPool does not retry a failed initial connect, and a
                // failed pool can't be reused, so on failure we build a fresh
                // pool and retry with capped exponential backoff. Without this
                // the gateway stays permanently dead if the DB is briefly down
                // at startup (e.g. host reboot) until a manual redeploy.
                node._dbReconnectTimer = null;
                node._dbReconnectAttempt = 0;
                const connectMssql = () => {
                    if (node._dbClosing) {
                        return;
                    }
                    node.mssqlPool = new sql.ConnectionPool(mssqlConfig);
                    // Swallow pool errors: a fresh pool is created per attempt,
                    // and reconnection is driven by the connect() promise below.
                    node.mssqlPool.on("error", err => {
                        node.error(`SQL Server pool error: ${err.message}`);
                        if (node.connectionManagers.database) {
                            node.connectionManagers.database.error(err, false);
                        }
                    });
                    node.mssqlPool.connect().then(() => {
                        node._dbReconnectAttempt = 0;
                        node.log(`Connected to SQL Server: ${config.dbHost}/${config.dbName}`);
                        if (node.connectionManagers.database) {
                            node.connectionManagers.database.connected();
                        }
                    }).catch(err => {
                        node.error(`Failed to connect to SQL Server: ${err.message}`);
                        if (node.connectionManagers.database) {
                            node.connectionManagers.database.error(err, false);
                        }
                        if (node._dbClosing) {
                            return;
                        }
                        // Capped exponential backoff: 1s, 2s, 4s ... max 30s.
                        const delay = Math.min(30000, 1000 * Math.pow(2, node._dbReconnectAttempt));
                        node._dbReconnectAttempt++;
                        node._dbReconnectTimer = setTimeout(connectMssql, delay);
                    });
                };
                connectMssql();
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
        // Editor number fields persist as strings; coerce so downstream numeric
        // use is arithmetic, not string concatenation (a string clockTolerance
        // would make `exp + tolerance` concatenate and disable expiry checks).
        node.jwtClockTolerance = toInt(config.jwtClockTolerance, 0);
        node.jwtAlgorithms = config.jwtAlgorithms;

        // OPA (Open Policy Agent) configuration
        node.opaEnabled = config.opaEnabled;
        node.opaUrl = config.opaUrl;
        node.opaPolicyPath = config.opaPolicyPath;
        node.opaCacheTTL = toInt(config.opaCacheTTL, 30);
        node.opaTimeout = toInt(config.opaTimeout, 5000);
        node.opaRetryAttempts = toInt(config.opaRetryAttempts, 3);

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
         * Introspect column data types for a table via INFORMATION_SCHEMA,
         * cached per table name for the lifetime of the node (reset on redeploy).
         * Returns a Map of lowercased column name -> lowercased DATA_TYPE.
         * Degrades to an empty map (legacy NVarChar binding) when the pool is
         * unavailable or the introspection query fails.
         * @param {string} tableName - Table name, optionally schema/db-qualified
         * @returns {Promise<Map<string, string>>} Column name -> data type map
         */
        node._tableColumnTypes = new Map();
        node._introspectWarned = new Set();
        node.getTableColumnTypes = async function(tableName) {
            if (!tableName || typeof tableName !== "string") {
                return new Map();
            }
            if (node._tableColumnTypes.has(tableName)) {
                return node._tableColumnTypes.get(tableName);
            }
            if (!node.mssqlPool || !node.mssqlPool.connected) {
                return new Map();
            }
            const columnTypes = new Map();
            try {
                const sql = getMssql();
                // Split the qualified name and strip one bracket layer per part.
                // Validated names cannot contain "." or "]" inside brackets, so
                // a plain split is safe.
                const parts = tableName.trim().split(".").map(p => p.trim().replace(/^\[(.*)\]$/, "$1"));
                const table = parts[parts.length - 1];
                const schema = parts.length >= 2 ? parts[parts.length - 2] : null;
                const database = parts.length === 3 ? parts[0] : null;
                // A db-qualified name reads that database's INFORMATION_SCHEMA
                const catalog = database ? `${quoteIdentifierPart(database)}.` : "";
                let query = `SELECT COLUMN_NAME, DATA_TYPE FROM ${catalog}INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table`;
                const request = node.mssqlPool.request();
                request.input("table", sql.NVarChar, table);
                if (schema) {
                    query += " AND TABLE_SCHEMA = @schema";
                    request.input("schema", sql.NVarChar, schema);
                } else {
                    // Unqualified name: scope to the connection's default schema,
                    // which is where the DML actually runs. Without this filter a
                    // same-named table/view in another schema would merge in and
                    // mistype columns.
                    query += " AND TABLE_SCHEMA = SCHEMA_NAME()";
                }
                const result = await request.query(query);
                for (const row of (result.recordset || [])) {
                    columnTypes.set(String(row.COLUMN_NAME).toLowerCase(), String(row.DATA_TYPE).toLowerCase());
                }
                // Cache only successful introspection. A transient failure
                // (timeout, failover blip) must not permanently disable typing.
                node._tableColumnTypes.set(tableName, columnTypes);
            } catch (err) {
                // Do NOT cache failures: retry on the next request. Warn once per
                // table to avoid log spam when INFORMATION_SCHEMA is unavailable.
                if (!node._introspectWarned.has(tableName)) {
                    node._introspectWarned.add(tableName);
                    node.warn(`Column type introspection failed for ${tableName}: ${err.message}`);
                }
            }
            return columnTypes;
        };

        /**
         * Execute a SQL query with parameters
         * @param {string} query - SQL query string
         * @param {Object} [params] - Query parameters (name: value pairs)
         * @param {Object} [paramTypes] - Optional explicit mssql types per param
         *   name (e.g. sql.VarBinary(sql.MAX)); overrides JS-type sniffing
         * @returns {Promise<Object>} Query result with recordset and rowsAffected
         */
        node.executeQuery = async function(query, params = {}, paramTypes = {}) {
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
                if (Object.prototype.hasOwnProperty.call(paramTypes, name)) {
                    request.input(name, paramTypes[name], value);
                } else if (value === null || value === undefined) {
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
                } else if (Buffer.isBuffer(value)) {
                    request.input(name, sql.VarBinary(sql.MAX), value);
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
            const paramTypes = {};
            const { body = {}, params: urlParams = {}, query = {}, filtering = null, sorting = null } = context;

            // Build base SQL - may need to inject WHERE clause for filtering
            let sql = sqlTemplate.sql;

            // Pick a positional body-parameter prefix that cannot collide with
            // the primary-key parameter (bound under its bare column name in the
            // WHERE clause). A table whose PK is literally named "col0" would
            // otherwise have its WHERE param overwritten by the first body field.
            const bodyParamPrefix = (pkCol, count) => {
                let prefix = "col";
                const collides = () => {
                    for (let i = 0; i < count; i++) {
                        if (`${prefix}${i}` === pkCol) return true;
                    }
                    return false;
                };
                // Prepending "_" always terminates: once the prefix is longer
                // than pkCol it can no longer equal any `${prefix}${i}`.
                while (pkCol && collides()) {
                    prefix = `_${prefix}`;
                }
                return prefix;
            };

            // Bind body fields to positional parameters (col0, col1, ...).
            // Column types are introspected (cached) so binary-family columns
            // (image, varbinary, ...) bind as VarBinary instead of NVarChar,
            // which SQL Server rejects with "Operand type clash".
            const bindBodyColumns = async (columns, prefix) => {
                const columnTypes = await node.getTableColumnTypes(sqlTemplate.tableName);
                const sqlLib = columnTypes.size > 0 ? getMssql() : null;
                columns.forEach((c, i) => {
                    const name = `${prefix}${i}`;
                    const hint = sqlLib ? getExplicitParamType(columnTypes.get(String(c).toLowerCase()), sqlLib) : null;
                    if (hint) {
                        paramTypes[name] = hint.sqlType;
                        params[name] = hint.binary ? toBufferValue(body[c]) : body[c];
                    } else {
                        params[name] = body[c];
                    }
                });
            };

            // First-occurrence replacement whose replacement text is treated
            // literally. String.prototype.replace interprets $-sequences ($&,
            // $', $`, $$) in the replacement, which would corrupt SQL built from
            // user-controlled column/field identifiers; a replacer function does
            // not. Only the first match is replaced (search is a literal string).
            const replaceLiteral = (haystack, search, replacement) =>
                haystack.replace(search, () => replacement);

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

                // Handle custom sorting if provided. Replace the generated
                // "ORDER BY <pk>" (which sits between ORDER BY and OFFSET) with
                // the custom clause using index math - a regex like
                // /ORDER BY [^O]+/i wrongly stops at any 'o' in the column name.
                if (sorting && sorting.orderByClause) {
                    const obStart = sql.indexOf("ORDER BY");
                    const offStart = obStart > -1 ? sql.indexOf("OFFSET", obStart) : -1;
                    if (obStart > -1 && offStart > -1) {
                        sql = sql.slice(0, obStart) + sorting.orderByClause + " " + sql.slice(offStart);
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
                    const prefix = bodyParamPrefix(sqlTemplate.primaryKey, columns.length);
                    const identifiers = columns.map(quoteIdentifierPart);
                    const placeholders = columns.map((c, i) => `@${prefix}${i}`);
                    // Replace @columns and @values placeholders with actual values.
                    // Use literal replacement: identifiers derive from user keys.
                    sql = replaceLiteral(sql, "@columns", identifiers.join(", "));
                    sql = replaceLiteral(sql, "@values", placeholders.join(", "));
                    // Add OUTPUT clause to return inserted row (SQL Server)
                    sql = sql.replace(") VALUES", ") OUTPUT INSERTED.* VALUES");
                    await bindBodyColumns(columns, prefix);
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
                    // names decoupled from column names so special-character
                    // columns bind to valid SQL parameters. The prefix avoids
                    // colliding with the primary-key param in the WHERE clause.
                    const columns = Object.keys(body);
                    const prefix = bodyParamPrefix(pkCol, columns.length);
                    const assignments = columns.map((c, i) => `${quoteIdentifierPart(c)} = @${prefix}${i}`);
                    // Replace @assignments placeholder with actual SET clause
                    // (literal replacement: identifiers derive from user keys).
                    sql = replaceLiteral(sql, "@assignments", assignments.join(", "));
                    // Add OUTPUT clause to return updated row (SQL Server)
                    const whereIndex = sql.indexOf("WHERE");
                    if (whereIndex > -1) {
                        sql = sql.slice(0, whereIndex) + "OUTPUT INSERTED.* " + sql.slice(whereIndex);
                    }
                    await bindBodyColumns(columns, prefix);
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
            const result = await node.executeQuery(sql, params, paramTypes);

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
            // Stop any pending SQL Server reconnection attempt.
            node._dbClosing = true;
            if (node._dbReconnectTimer) {
                clearTimeout(node._dbReconnectTimer);
                node._dbReconnectTimer = null;
            }

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

            // Flush and terminate the logger transport so its pino worker
            // thread and log-file handle are not leaked across redeploys.
            if (node.logger) {
                try {
                    await closeLogger(node.logger);
                } catch (err) {
                    // best-effort: never block shutdown on logger teardown
                }
                node.logger = null;
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
