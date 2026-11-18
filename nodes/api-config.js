const { ConnectionStateManager } = require("../lib/connection-state");
const {
    HealthStatus,
    HealthCheckManager,
    createDatabaseHealthCheck,
    createKeycloakHealthCheck,
    createOpaHealthCheck
} = require("../lib/health-check");
const { quoteIdentifierPart, quoteTableName } = require("../lib/crud-generator");
const { isPoolAcquireTimeout, SQL_NON_UNIQUE_KEY } = require("../lib/db-errors");
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
 * @param {Object} [column] - Introspected column (precision/scale for decimals)
 * @param {*} [value] - The body value to bind
 * @returns {{sqlType: Object, binary: boolean}|null} Explicit type or null for default binding
 */
const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;

/**
 * Error for a body value that cannot be bound (db-errors maps EPARAM to 400).
 * @param {string} message
 * @returns {Error}
 */
function invalidParam(message) {
    const err = new Error(message);
    err.code = "EPARAM";
    return err;
}

function getExplicitParamType(dataType, sql, column, value) {
    switch (dataType) {
    case "bigint":
        // Int would reject values > 2^31-1. Strings keep values beyond
        // Number.MAX_SAFE_INTEGER exact. Non-integers keep the default
        // binding (SQL Server converts or rejects them with a 400).
        if ((typeof value === "string" && /^-?[0-9]+$/.test(value)) || Number.isInteger(value)) {
            // tedious rejects out-of-range values before SQL Server sees
            // them; that is the client's error (400), not a 500.
            const big = BigInt(value);
            if (big < BIGINT_MIN || big > BIGINT_MAX) {
                throw invalidParam("bigint value out of range");
            }
            return { sqlType: sql.BigInt, binary: false };
        }
        return null;
    case "decimal":
    case "numeric":
        // Never the JS-number default Decimal(18,4) (it drops digits), nor
        // Decimal(p,s): tedious encodes the scaled value in 64 bits and fails
        // for e.g. 1 into decimal(38,20). A number goes as its shortest
        // decimal text, which SQL Server converts exactly (overflow -> 400);
        // exponent notation goes as float. Strings keep NVarChar as well.
        if (typeof value === "number" && Number.isFinite(value)) {
            const text = String(value);
            return /e/i.test(text)
                ? { sqlType: sql.Float, binary: false }
                : { sqlType: sql.NVarChar, binary: false, value: text };
        }
        return null;
    case "float":
        return typeof value === "number" ? { sqlType: sql.Float, binary: false } : null;
    case "real":
        if (typeof value !== "number") {
            return null;
        }
        // A value beyond the float32 range would be sent as infinity and
        // rejected by SQL Server (error 8023) with a 500.
        if (!Number.isFinite(Math.fround(value))) {
            throw invalidParam("real value out of range");
        }
        return { sqlType: sql.Real, binary: false };
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

        // Note: no ConnectionStateManager is created for OPA. The OpaClient
        // (constructed on the apigw-server node) already owns retry, timeout and
        // circuit-breaker behaviour for the policy call; a second manager here
        // would be a third, uncoordinated retry mechanism over the same request
        // (decision-001, "Lifecycle").

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
            // Mode-aware, truthful messaging about what OPA will actually do
            // (decision-001 D5). Enforcement itself happens on the apigw-server
            // node; this reflects the config-node default mode so an operator is
            // never misled about whether requests are authorized.
            const opaMode = config.opaMode || "enforce";
            const opaPolicyPath = (config.opaPolicyPath || "").trim();
            if (!opaPolicyPath) {
                node.log("OPA is enabled but the policy path is blank — policy evaluation is disabled until a path is configured.");
            } else if (opaMode === "off") {
                node.log("OPA is enabled but mode is 'off' — policy evaluation is disabled for this gateway.");
            } else if (opaMode === "monitor") {
                // Monitor is an opt-OUT of protection, so warn rather than log.
                node.warn("OPA is in MONITOR mode — requests are evaluated and logged but NOT enforced (debugging mode). No request is denied by policy in this mode.");
            } else {
                node.log(`OPA enforcement active (mode=enforce, failOpen=${config.opaFailOpen ? "true" : "false"}). Endpoints inherit this unless overridden.`);
            }
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
        // tedious date/GUID semantics (GH-8). useUTC defaults to true (the
        // driver default, also for flows saved before the option existed).
        node.dbUseUTC = config.dbUseUTC !== false;
        node.dbLowerCaseGuids = config.dbLowerCaseGuids === true;

        // Connection pool settings
        node.dbPoolMin = config.dbPoolMin;
        node.dbPoolMax = config.dbPoolMax;
        node.dbPoolIdleTimeout = config.dbPoolIdleTimeout;
        node.dbPoolAcquireTimeout = config.dbPoolAcquireTimeout;

        // The native mssql ConnectionPool (backed by tarn) is the only DB pool:
        // it enforces dbPoolMax and queues extra requests until
        // dbPoolAcquireTimeout. getPoolStatistics() reads its live state.
        node.mssqlPool = null;

        if (config.dbType && config.dbType !== "none") {
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
                        enableArithAbort: true,
                        useUTC: node.dbUseUTC,
                        lowerCaseGuids: node.dbLowerCaseGuids
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
                node._lastAcquireTimeoutWarn = 0;
                const connectMssql = () => {
                    if (node._dbClosing) {
                        return;
                    }
                    node.mssqlPool = new sql.ConnectionPool(mssqlConfig);
                    // Swallow pool errors: a fresh pool is created per attempt,
                    // and reconnection is driven by the connect() promise below.
                    node.mssqlPool.on("error", err => {
                        // mssql emits "error" for every failed acquire too. An
                        // acquire timeout means the pool is saturated, not that
                        // the DB is down: warn (throttled) and keep the state.
                        if (isPoolAcquireTimeout(err)) {
                            const now = Date.now();
                            if (now - node._lastAcquireTimeoutWarn >= 10000) {
                                node._lastAcquireTimeoutWarn = now;
                                node.warn(`SQL Server pool saturated: acquire timed out after ${mssqlConfig.pool.acquireTimeoutMillis}ms (dbPoolMax=${mssqlConfig.pool.max})`);
                            }
                            return;
                        }
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

        // OPA (Open Policy Agent) configuration.
        // Defaults follow the decision-001 config-mapping table. These are
        // "editor units" (opaCacheTTL in seconds; timeouts in ms); the unit
        // conversions and 0-means-disabled handling happen at the boundary in
        // the apigw-server node's initializeOpaClient(), not here.
        node.opaEnabled = config.opaEnabled;
        // No built-in default for opaUrl: an unset URL must fail validation on
        // the server node rather than silently pointing at localhost:8181 (D7).
        node.opaUrl = config.opaUrl;
        node.opaPolicyPath = config.opaPolicyPath;
        node.opaMode = config.opaMode || "enforce";            // enforce | monitor | off
        node.opaFailOpen = config.opaFailOpen === true || config.opaFailOpen === "true";
        node.opaCacheTTL = toInt(config.opaCacheTTL, 60);      // seconds; 0 disables caching
        node.opaTimeout = toInt(config.opaTimeout, 2000);      // ms, per attempt
        node.opaRetryAttempts = toInt(config.opaRetryAttempts, 1);
        node.opaDeadline = toInt(config.opaDeadline, 3000);    // ms, wall-clock budget
        node.opaCacheMaxSize = toInt(config.opaCacheMaxSize, 5000);
        node.opaCbThreshold = toInt(config.opaCircuitBreakerThreshold, 5);
        node.opaCbTimeout = toInt(config.opaCircuitBreakerTimeout, 30000);
        node.opaTokenMode = config.opaTokenMode || "full";     // full | claims | none
        node.opaTokenClaims = config.opaTokenClaims || "";
        node.opaIncludeAuditFields = config.opaIncludeAuditFields === true || config.opaIncludeAuditFields === "true";

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
        node.problemTypeBaseUri = (config.problemTypeBaseUri || "").trim();
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
         * Live statistics of the SQL Server connection pool (mssql/tarn).
         * @returns {{size: number, available: number, borrowed: number, pending: number, min: number, max: number}|null}
         *   null when no SQL Server pool exists yet
         */
        node.getPoolStatistics = function() {
            const pool = node.mssqlPool;
            if (!pool || !pool.pool) {
                return null;
            }
            return {
                size: pool.size,
                available: pool.available,
                borrowed: pool.borrowed,
                pending: pool.pending,
                min: toInt(config.dbPoolMin, 0),
                max: toInt(config.dbPoolMax, 10)
            };
        };

        /**
         * Check if SQL Server is configured and connected
         * @returns {boolean}
         */
        node.isSqlServerReady = function() {
            return node.dbType === "mssql" && node.mssqlPool && node.mssqlPool.connected;
        };

        /**
         * Introspect the columns of a table via INFORMATION_SCHEMA (plus
         * sys.columns for identity/computed flags), cached per table name for
         * the lifetime of the node (reset on redeploy). Used to bind binary
         * parameters and to generate the auto-CRUD OpenAPI schemas (GH-8).
         * Degrades to an empty array when the pool is unavailable or the
         * introspection query fails (failures are not cached).
         * @param {string} tableName - Table name, optionally schema/db-qualified
         * @returns {Promise<Array<{name: string, dataType: string, nullable: boolean,
         *   maxLength: number|null, precision: number|null, scale: number|null,
         *   hasDefault: boolean, identity: boolean, computed: boolean}>>}
         */
        node._tableColumns = new Map();
        node._tableColumnTypes = new Map();
        node._introspectWarned = new Set();
        node.getTableColumns = async function(tableName) {
            if (!tableName || typeof tableName !== "string") {
                return [];
            }
            if (node._tableColumns.has(tableName)) {
                return node._tableColumns.get(tableName);
            }
            if (!node.mssqlPool || !node.mssqlPool.connected) {
                return [];
            }
            try {
                const sql = getMssql();
                // Split the qualified name and strip one bracket layer per part.
                // Validated names cannot contain "." or "]" inside brackets, so
                // a plain split is safe.
                const parts = tableName.trim().split(".").map(p => p.trim().replace(/^\[(.*)\]$/, "$1"));
                const table = parts[parts.length - 1];
                const schema = parts.length >= 2 ? parts[parts.length - 2] : null;
                const database = parts.length === 3 ? parts[0] : null;
                // A db-qualified name reads that database's catalog views
                const catalog = database ? `${quoteIdentifierPart(database)}.` : "";
                // sys.columns only adds the identity/computed flags. Without
                // VIEW DEFINITION it returns no rows (LEFT JOIN -> NULL flags)
                // instead of failing, so it never breaks binary binding.
                let query = "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.CHARACTER_MAXIMUM_LENGTH, " +
                    "c.NUMERIC_PRECISION, c.NUMERIC_SCALE, " +
                    "c.COLUMN_DEFAULT, sc.is_identity AS IS_IDENTITY, sc.is_computed AS IS_COMPUTED " +
                    `FROM ${catalog}INFORMATION_SCHEMA.COLUMNS c ` +
                    `LEFT JOIN ${catalog}sys.columns sc ON sc.object_id = OBJECT_ID(QUOTENAME(c.TABLE_CATALOG) + '.' + ` +
                    "QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)) AND sc.name = c.COLUMN_NAME " +
                    "WHERE c.TABLE_NAME = @table";
                const request = node.mssqlPool.request();
                request.input("table", sql.NVarChar, table);
                if (schema) {
                    query += " AND c.TABLE_SCHEMA = @schema";
                    request.input("schema", sql.NVarChar, schema);
                } else {
                    // Unqualified name: resolve it like the DML does (the user's
                    // default schema, then dbo) via OBJECT_ID, so the columns
                    // come from the same object. Without this filter a
                    // same-named table/view in another schema would merge in.
                    query += " AND c.TABLE_SCHEMA = COALESCE(OBJECT_SCHEMA_NAME(OBJECT_ID(QUOTENAME(@table))), SCHEMA_NAME())";
                }
                query += " ORDER BY c.ORDINAL_POSITION";
                const result = await request.query(query);
                const truthy = v => v === true || v === 1 || v === "1";
                const columns = (result.recordset || []).map(row => {
                    const maxLength = row.CHARACTER_MAXIMUM_LENGTH === null || row.CHARACTER_MAXIMUM_LENGTH === undefined
                        ? null
                        : Number(row.CHARACTER_MAXIMUM_LENGTH);
                    return {
                        name: String(row.COLUMN_NAME),
                        dataType: String(row.DATA_TYPE).toLowerCase(),
                        nullable: String(row.IS_NULLABLE || "").toUpperCase() === "YES",
                        maxLength: Number.isFinite(maxLength) ? maxLength : null,
                        precision: Number.isInteger(row.NUMERIC_PRECISION) ? row.NUMERIC_PRECISION : null,
                        scale: Number.isInteger(row.NUMERIC_SCALE) ? row.NUMERIC_SCALE : null,
                        hasDefault: row.COLUMN_DEFAULT !== null && row.COLUMN_DEFAULT !== undefined,
                        identity: truthy(row.IS_IDENTITY),
                        computed: truthy(row.IS_COMPUTED)
                    };
                });
                // Cache only successful introspection. A transient failure
                // (timeout, failover blip) must not permanently disable typing.
                node._tableColumns.set(tableName, columns);
                return columns;
            } catch (err) {
                // Do NOT cache failures: retry on the next request. Warn once per
                // table to avoid log spam when INFORMATION_SCHEMA is unavailable.
                if (!node._introspectWarned.has(tableName)) {
                    node._introspectWarned.add(tableName);
                    node.warn(`Column type introspection failed for ${tableName}: ${err.message}`);
                }
                return [];
            }
        };

        /**
         * Column data types of a table (see getTableColumns).
         * @param {string} tableName - Table name, optionally schema/db-qualified
         * @returns {Promise<Map<string, string>>} Lowercased column name -> lowercased DATA_TYPE
         */
        node.getTableColumnTypes = async function(tableName) {
            if (node._tableColumnTypes.has(tableName)) {
                return node._tableColumnTypes.get(tableName);
            }
            const columns = await node.getTableColumns(tableName);
            const columnTypes = new Map(columns.map(c => [c.name.toLowerCase(), c.dataType]));
            if (node._tableColumns.has(tableName)) {
                node._tableColumnTypes.set(tableName, columnTypes);
            }
            return columnTypes;
        };

        /**
         * Execute a SQL query with parameters
         * @param {string} query - SQL query string
         * @param {Object} [params] - Query parameters (name: value pairs)
         * @param {Object} [paramTypes] - Optional explicit mssql types per param
         *   name (e.g. sql.VarBinary(sql.MAX)); overrides JS-type sniffing
         * @param {Object} [transaction] - Optional mssql Transaction to run in
         * @returns {Promise<Object>} Query result with recordset and rowsAffected
         */
        node.executeQuery = async function(query, params = {}, paramTypes = {}, transaction = null) {
            if (!node.mssqlPool) {
                throw new Error("SQL Server not configured");
            }
            if (!node.mssqlPool.connected) {
                throw new Error("SQL Server not connected");
            }

            const sql = getMssql();
            const request = transaction ? new sql.Request(transaction) : node.mssqlPool.request();

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
         * Run work inside one mssql Transaction on one pooled connection.
         * `work` receives run(query, params, paramTypes) bound to the
         * transaction. Commits when work resolves; rolls back (and rethrows)
         * when it throws. mssql releases the connection in both cases, so no
         * session state (open transaction, SET options) leaks into the pool.
         * @param {function(function): Promise<*>} work
         * @returns {Promise<*>} The value of work
         */
        node.withTransaction = async function(work) {
            if (!node.mssqlPool) {
                throw new Error("SQL Server not configured");
            }
            if (!node.mssqlPool.connected) {
                throw new Error("SQL Server not connected");
            }
            const sql = getMssql();
            const transaction = new sql.Transaction(node.mssqlPool);
            try {
                await transaction.begin();
            } catch (err) {
                // mssql keeps the acquired connection when BEGIN TRANSACTION
                // fails; rollback() releases it (its own error is expected).
                try {
                    await transaction.rollback();
                } catch (releaseErr) {
                    /* nothing to roll back; the connection is released */
                }
                throw err;
            }
            try {
                const value = await work((q, p, t) => node.executeQuery(q, p, t, transaction));
                await transaction.commit();
                return value;
            } catch (err) {
                try {
                    await transaction.rollback();
                } catch (rollbackErr) {
                    /* already aborted by the driver */
                }
                throw err;
            }
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
            let countSql = null;

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
                // Precision/scale for decimal binding (GH-8 review)
                const details = new Map((node._tableColumns.get(sqlTemplate.tableName) || [])
                    .map(col => [col.name.toLowerCase(), col]));
                columns.forEach((c, i) => {
                    const name = `${prefix}${i}`;
                    const key = String(c).toLowerCase();
                    const hint = sqlLib ? getExplicitParamType(columnTypes.get(key), sqlLib, details.get(key), body[c]) : null;
                    if (hint) {
                        paramTypes[name] = hint.sqlType;
                        if (hint.binary) {
                            params[name] = toBufferValue(body[c]);
                        } else {
                            params[name] = Object.prototype.hasOwnProperty.call(hint, "value") ? hint.value : body[c];
                        }
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
            case "list": {
                // Pagination (required for SQL Server OFFSET/FETCH). The
                // endpoint passes the resolved page (defaultPageSize/maxPageSize
                // applied, GH-8); direct callers fall back to the raw query.
                const page = context.pagination || {};
                const rawLimit = Number.isInteger(page.limit) ? page.limit : parseInt(query.limit, 10);
                const rawOffset = Number.isInteger(page.offset) ? page.offset : parseInt(query.offset, 10);
                params.limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 10;
                params.offset = Number.isInteger(rawOffset) && rawOffset > 0
                    ? Math.min(rawOffset, Number.MAX_SAFE_INTEGER)
                    : 0;
                // OFFSET takes a bigint; an int would reject offsets > 2^31-1.
                paramTypes.offset = getMssql().BigInt;

                const whereSql = filtering && filtering.whereClause && filtering.whereClause.clause
                    ? filtering.whereClause.clause
                    : "";
                for (const [key, value] of Object.entries((whereSql && filtering.whereClause.params) || {})) {
                    params[key] = value;
                }
                const orderSql = sorting && sorting.orderByClause ? sorting.orderByClause : "";
                const PAGE_SUFFIX = " OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY";
                const table = sqlTemplate.tableName ? quoteTableName(sqlTemplate.tableName) : null;
                const generatedPrefix = table ? `SELECT * FROM ${table} ORDER BY ` : null;

                if (generatedPrefix && sql.startsWith(generatedPrefix) && sql.endsWith(PAGE_SUFFIX)) {
                    // Generated template: rebuild it from its parts. Searching
                    // the SQL text for keywords would match inside a quoted
                    // identifier such as [Sales ORDER BY Region].
                    const defaultOrder = sql.slice(generatedPrefix.length - "ORDER BY ".length, sql.length - PAGE_SUFFIX.length);
                    const where = whereSql ? ` ${whereSql}` : "";
                    sql = `SELECT * FROM ${table}${where} ${orderSql || defaultOrder}${PAGE_SUFFIX}`;
                    if (context.countTotal !== false) {
                        // COUNT(*) over the same FROM/WHERE gives the real total.
                        countSql = `SELECT COUNT_BIG(*) AS total FROM ${table}${where}`;
                    }
                } else {
                    // Custom template: legacy text injection. The count uses
                    // the template's FROM part (found by text search, so a
                    // keyword inside a quoted identifier can break it).
                    const fromStart = sql.indexOf(" FROM ");
                    const orderStart = sql.indexOf(" ORDER BY ");
                    if (fromStart > -1 && context.countTotal !== false) {
                        const fromClause = sql.slice(fromStart + 1, orderStart > fromStart ? orderStart : undefined);
                        countSql = `SELECT COUNT_BIG(*) AS total ${fromClause}${whereSql ? " " + whereSql : ""}`;
                    }
                    if (whereSql) {
                        const orderByIndex = sql.indexOf("ORDER BY");
                        sql = orderByIndex > -1
                            ? sql.slice(0, orderByIndex) + whereSql + " " + sql.slice(orderByIndex)
                            : sql + " " + whereSql;
                    }
                    if (orderSql) {
                        const obStart = sql.indexOf("ORDER BY");
                        const offStart = obStart > -1 ? sql.indexOf("OFFSET", obStart) : -1;
                        if (obStart > -1 && offStart > -1) {
                            sql = sql.slice(0, obStart) + orderSql + " " + sql.slice(offStart);
                        }
                    }
                }
                break;
            }

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
                    // Add OUTPUT clause to return updated row (SQL Server). Put it
                    // before the generated key predicate (the last WHERE); a
                    // first-match search could hit a quoted identifier.
                    const keyWhere = pkCol ? ` WHERE ${quoteIdentifierPart(pkCol)} = @${pkCol}` : null;
                    const keyIndex = keyWhere && sql.endsWith(keyWhere) ? sql.length - keyWhere.length : -1;
                    const whereIndex = keyIndex > -1 ? keyIndex + 1 : sql.indexOf("WHERE");
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

            // Guard writes by key (GH-8 section 6): when the configured
            // primaryKey is not unique, update/delete would change every
            // matching row. In one transaction, lock the key range
            // (UPDLOCK, HOLDLOCK: no concurrent insert/update/delete of that
            // key until commit), count up to two matches, and only then write.
            let result;
            let countResult = null;
            const pkCol = sqlTemplate.primaryKey;
            if ((operation === "update" || operation === "delete") && pkCol && sqlTemplate.tableName &&
                Object.prototype.hasOwnProperty.call(params, pkCol)) {
                const table = quoteTableName(sqlTemplate.tableName);
                const checkSql = `SELECT TOP (2) 1 AS found FROM ${table} WITH (UPDLOCK, HOLDLOCK) ` +
                    `WHERE ${quoteIdentifierPart(pkCol)} = @${pkCol}`;
                result = await node.withTransaction(async run => {
                    const check = await run(checkSql, { [pkCol]: params[pkCol] }, paramTypes[pkCol] ? { [pkCol]: paramTypes[pkCol] } : {});
                    const matches = (check.recordset || []).length;
                    if (matches > 1) {
                        const err = new Error("primaryKey matches more than one row");
                        err.number = SQL_NON_UNIQUE_KEY;
                        err.code = "EREQUEST";
                        throw err;
                    }
                    if (matches === 0) {
                        return { recordset: [], rowsAffected: [0] };
                    }
                    return run(sql, params, paramTypes);
                });
            } else {
                // List: page and COUNT(*) run in parallel on two pool
                // connections, so concurrent writes can make total differ
                // slightly from the page (documented).
                [result, countResult] = await Promise.all([
                    node.executeQuery(sql, params, paramTypes),
                    countSql ? node.executeQuery(countSql, params, paramTypes) : Promise.resolve(null)
                ]);
            }

            const out = {
                operation,
                data: result.recordset,
                rowsAffected: result.rowsAffected[0] || 0,
                success: true
            };
            if (operation === "list") {
                const counted = countResult && countResult.recordset && countResult.recordset[0]
                    ? Number(countResult.recordset[0].total)
                    : NaN;
                out.total = Number.isFinite(counted) ? counted : null;
                out.limit = params.limit;
                out.offset = params.offset;
            }
            return out;
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
            keycloakClientSecret: { type: "password" },
            // The gateway's OWN service token for calling OPA (D7). Stored as a
            // credential so it is never serialised into the flow JSON. This is
            // NOT a user token and is never derived from one.
            opaToken: { type: "password" }
        }
    });
};
