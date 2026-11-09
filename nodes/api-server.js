"use strict";

const fs = require("fs");
const { OpenApiGenerator } = require("../lib/openapi-generator");
const { OpenApiParser } = require("../lib/openapi-parser");
const {
    generateRequestId,
    createTimer
} = require("../lib/logger");
const { getMetricsCollector } = require("../lib/metrics-collector");
const { parseMetricsAccess, createMetricsGuard } = require("../lib/metrics-access");
const { parseBodyOptions, registerBinaryParsers } = require("../lib/body-parsing");
const {
    pathsConflict,
    combinePaths,
    normalizePath
} = require("../lib/path-utils");
const { KeycloakClient } = require("../lib/keycloak-client");
const { OpaClient, validateOpaConfig } = require("../lib/opa-client");
const { buildOpaInput, parseOpaMappings } = require("../lib/opa-input");

/**
 * Map an OPA client/transport error to a stable taxonomy code. The same code
 * appears in the 503 body `details.reason`, the opa_policy_check log field, the
 * Prometheus `reason` label and `msg.opa.error.code` (decision-001, task-081),
 * so a denial and an outage are never conflated.
 * @param {Error} err
 * @returns {string}
 */
function classifyOpaError(err) {
    if (!err) return "UNKNOWN";
    if (err.code === "DEADLINE") return "DEADLINE";
    if (err.code === "TIMEOUT") return "TIMEOUT";
    if (err.code === "CIRCUIT_OPEN") return "CIRCUIT_OPEN";
    if (err.code === "CONFIG_INVALID") return "CONFIG_INVALID";
    if (err.code === "POLICY_UNDEFINED") return "POLICY_UNDEFINED";
    if (typeof err.statusCode === "number") return `OPA_HTTP_${err.statusCode}`;
    return "NETWORK";
}

/**
 * Classify an OPA `result` payload as an undefined-document config fault rather
 * than a deny (decision-001, "The undefined-document trap"). OPA answers HTTP
 * 200 `{}` for a path it does not define; that must become a 503, not a silent
 * 403. Catches `undefined` or a non-array object carrying neither allow nor
 * allowed. It cannot catch a wrong-but-defined path (that is the Test button's job).
 * @param {*} result
 * @returns {boolean}
 */
function isUndefinedDecision(result) {
    if (result === undefined || result === null) return true;
    if (typeof result === "boolean") return false;
    if (Array.isArray(result)) return true;
    if (typeof result === "object") {
        return !(typeof result.allow === "boolean" || typeof result.allowed === "boolean");
    }
    return true;
}

module.exports = function(RED) {
    function ApiServerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Store configuration
        node.name = config.name;
        node.port = parseInt(config.port, 10) || 3000;
        node.host = config.host || "0.0.0.0";

        // OpenAPI configuration
        node.openapiEnabled = config.openapiEnabled !== false;  // Enabled by default
        node.openapiPath = config.openapiPath || "/openapi.json";
        node.swaggerUiEnabled = config.swaggerUiEnabled === true;
        node.swaggerUiPath = config.swaggerUiPath || "/docs";

        // Metrics configuration (opt-in; the route shares the API listener)
        node.metricsEnabled = config.metricsEnabled === true;
        node.metricsPath = config.metricsPath || "/metrics";
        node.metricsCollector = null;
        node.metricsAccess = parseMetricsAccess(config, node.credentials);

        // Request body configuration (bodyLimit in bytes; raw/binary bodies are opt-in)
        const bodyOptions = parseBodyOptions(config);
        node.bodyLimit = bodyOptions.bodyLimit;
        node.binaryBodyEnabled = bodyOptions.binaryBodyEnabled;
        node.binaryContentTypes = bodyOptions.binaryContentTypes;

        // Get reference to api-config node
        node.configNodeId = config.config;
        node.configNode = null;

        if (node.configNodeId) {
            node.configNode = RED.nodes.getNode(node.configNodeId);
        }

        // Registered endpoints
        node.endpoints = new Map();

        // OpenAPI generator instance
        node.openapiGenerator = null;

        // Fastify instance (will be created on deploy)
        node.fastify = null;
        node.serverStarted = false;
        node.closing = false;

        // Route registration tracking
        node.registeredRoutes = new Map();  // path+method -> endpointId
        node.pendingEndpoints = [];  // Endpoints waiting for server to start

        // Server restart management
        node.restartTimer = null;  // Debounce timer for restart
        node.restartPending = false;  // Flag to indicate restart is scheduled

        // Keycloak client for OAuth2 authentication
        node.keycloakClient = null;

        // OPA policy enforcement (decision-001). One OpaClient per distinct
        // resolved policy path — the decision cache key contains neither opaUrl
        // nor policyPath, so a shared client would cross-serve decisions (D3).
        node.opaClientsByPath = new Map();   // resolved policyPath -> OpaClient
        node._opaFetchFn = null;             // test seam: inject a fake fetch
        node._opaConfigInvalid = false;      // set when OPA config fails validation
        node._opaFetchWrapper = null;        // bearer-injecting fetch wrapper
        node._opaErrorDedup = new Set();     // deduped POLICY_UNDEFINED node.error keys

        /**
         * Initialize the OpenAPI generator with config settings
         */
        function initializeOpenApiGenerator() {
            const options = {
                info: {
                    title: "API Gateway",
                    description: "Node-RED powered API Gateway",
                    version: "1.0.0"
                },
                basePath: "",
                config: null
            };

            // Get settings from config node if available
            if (node.configNode) {
                const openApiInfo = node.configNode.getOpenApiInfo();
                options.info = openApiInfo.info;
                options.basePath = openApiInfo.basePath || "";
                options.config = node.configNode;
            }

            node.openapiGenerator = new OpenApiGenerator(options);
        }

        /**
         * Initialize Keycloak client for OAuth2 authentication
         */
        function initializeKeycloakClient() {
            if (!node.configNode || !node.configNode.oauth2Enabled) {
                return;
            }

            const logger = node.configNode.getLogger();
            // Normalize the configured signing algorithm(s). The editor stores a
            // single selection (e.g. "ES256") or a comma-separated list; pass it
            // through so a non-RS choice actually takes effect instead of being
            // silently rejected by the RS-only default allow-list.
            const configuredAlgorithms = typeof node.configNode.jwtAlgorithms === "string"
                ? node.configNode.jwtAlgorithms.split(",").map(a => a.trim()).filter(Boolean)
                : (Array.isArray(node.configNode.jwtAlgorithms) ? node.configNode.jwtAlgorithms : []);

            node.keycloakClient = new KeycloakClient({
                keycloakUrl: node.configNode.keycloakUrl,
                realm: node.configNode.keycloakRealm,
                clientId: node.configNode.keycloakClientId,
                clientSecret: node.configNode.credentials?.keycloakClientSecret,
                timeout: 5000,
                validateIssuer: node.configNode.jwtValidateIssuer !== false,
                // Honour an explicit issuer override when provided.
                issuer: (node.configNode.jwtIssuer || "").trim() || undefined,
                validateAudience: node.configNode.jwtValidateAudience === true,
                audience: node.configNode.jwtAudience,
                clockTolerance: node.configNode.jwtClockTolerance || 0,
                algorithms: configuredAlgorithms.length > 0 ? configuredAlgorithms : undefined,
                logger: logger
            });

            node.keycloakClient.on("circuitOpen", () => {
                node.warn("Keycloak circuit breaker opened - authentication may fail");
            });

            node.keycloakClient.on("circuitClosed", () => {
                node.log("Keycloak circuit breaker closed - authentication restored");
            });

            // Pre-fetch JWKS
            node.keycloakClient.getPublicKeys().catch(err => {
                node.warn(`Failed to pre-fetch Keycloak JWKS: ${err.message}`);
            });
        }

        /**
         * Build the bearer-injecting fetch wrapper used for EVERY outbound OPA
         * request — decisions and the health check alike (decision-001 D7). The
         * gateway authenticates to OPA with its OWN service token; the user's
         * token is never forwarded. Covers both _makeRequest and getHealthStatus
         * because both call `this._fetch`.
         * @returns {Function}
         */
        function buildOpaFetchWrapper() {
            return function(url, options = {}) {
                // Read the token and the test seam at CALL time so a rotated
                // credential — or a test-injected fetch (node._opaFetchFn) set
                // after construction — takes effect without rebuilding clients.
                const opaToken = node.configNode?.credentials?.opaToken;
                const baseFetch = node._opaFetchFn || globalThis.fetch;
                const headers = Object.assign({}, options.headers);
                if (opaToken) {
                    headers["Authorization"] = `Bearer ${opaToken}`;
                }
                return baseFetch(url, Object.assign({}, options, { headers }));
            };
        }

        /**
         * Config-node OPA settings -> OpaClient options, at the unit boundary:
         * opaCacheTTL is seconds in the editor and ms in the client; 0 means
         * "disable caching" (not "never expire"); opaIncludeAuditFields also
         * disables the cache. A ms-looking TTL earns a defensive warn.
         * @param {string} policyPath
         * @returns {Object}
         */
        function opaClientOptions(policyPath) {
            const cfg = node.configNode;
            const ttlParsed = parseInt(cfg.opaCacheTTL, 10);
            const ttl = Number.isNaN(ttlParsed) ? 60 : ttlParsed;
            if (ttl >= 1000) {
                node.warn(`OPA Cache TTL is ${ttl}s — that looks like milliseconds. This field is SECONDS.`);
            }
            const retry = parseInt(cfg.opaRetryAttempts, 10);
            const cacheEnabled = ttl > 0 && cfg.opaIncludeAuditFields !== true;
            return {
                opaUrl: (cfg.opaUrl || "").trim(),
                policyPath,
                timeout: parseInt(cfg.opaTimeout, 10) || 2000,
                retryAttempts: Number.isNaN(retry) ? 1 : retry,
                deadline: parseInt(cfg.opaDeadline, 10) || 3000,
                cacheEnabled,
                cacheTtl: ttl > 0 ? ttl * 1000 : 0,
                cacheMaxSize: parseInt(cfg.opaCacheMaxSize, 10) || 5000,
                circuitBreakerThreshold: parseInt(cfg.opaCbThreshold, 10) || 5,
                circuitBreakerTimeout: parseInt(cfg.opaCbTimeout, 10) || 30000,
                logger: cfg.getLogger ? cfg.getLogger() : undefined,
                fetchFn: node._opaFetchWrapper
            };
        }

        /**
         * Get (or lazily create) the OpaClient for a resolved policy path. One
         * client per distinct path (D3) — the decision cache key contains no path.
         * More than 16 distinct paths is a sizing smell and earns a warn.
         * @param {string} policyPath
         * @returns {OpaClient|null} null when OPA config is invalid/disabled
         */
        function getOrCreateOpaClient(policyPath) {
            if (node._opaConfigInvalid || !node.configNode?.opaEnabled) {
                return null;
            }
            if (node.opaClientsByPath.has(policyPath)) {
                return node.opaClientsByPath.get(policyPath);
            }
            const client = new OpaClient(opaClientOptions(policyPath));
            client.on("circuitOpen", () => {
                node.warn(`OPA circuit breaker opened for policy ${policyPath} — policy calls fail fast`);
                if (node.metricsCollector) node.metricsCollector.setOpaCircuitState(client.circuitState);
            });
            client.on("circuitClosed", () => {
                node.log(`OPA circuit breaker closed for policy ${policyPath} — policy calls restored`);
                if (node.metricsCollector) node.metricsCollector.setOpaCircuitState(client.circuitState);
            });
            client.on("circuitHalfOpen", () => {
                if (node.metricsCollector) node.metricsCollector.setOpaCircuitState(client.circuitState);
            });
            // Defensive: OpaClient.isAllowed() emits "error", and an unhandled
            // "error" on an EventEmitter throws. We never call isAllowed(), but a
            // no-op listener guarantees a stray path cannot crash the process.
            client.on("error", () => { /* isAllowed() is deprecated and never wired */ });
            node.opaClientsByPath.set(policyPath, client);
            if (node.opaClientsByPath.size > 16) {
                node.warn(`This server now uses ${node.opaClientsByPath.size} distinct OPA policy paths — each is an independent cache and traffic stream to OPA. Consider consolidating.`);
            }
            return client;
        }

        /**
         * Validate the OPA configuration and construct the primary client — a
         * line-for-line analogue of initializeKeycloakClient (D3/D7). On any hard
         * validation failure it forces mode OFF with a red status and a node.error
         * and NEVER falls back to the built-in default policy path (D4).
         */
        function initializeOpaClient() {
            node._opaConfigInvalid = false;
            node.opaClientsByPath = new Map();

            // A previously-wired config node that is now missing (getNode -> null)
            // must not silently start unprotected (decision-001 "Lifecycle").
            if (node.configNodeId && !node.configNode) {
                node._opaConfigInvalid = true;
                node.error("apigw-server: config node is missing or unwired — refusing to enforce OPA policy.");
                return;
            }
            if (!node.configNode || !node.configNode.opaEnabled) {
                return;
            }

            const cfg = node.configNode;
            const opaUrl = (cfg.opaUrl || "").trim();
            const policyPath = (cfg.opaPolicyPath || "").trim();

            // An unset URL leaves OPA unconfigured — disabled, not pointing at
            // localhost (task-076 AC#5). Soft-disable with a warn; endpoints then
            // resolve to off. A NON-blank but malformed URL is a real error below.
            if (!opaUrl) {
                node._opaConfigInvalid = true;
                node.warn("OPA is enabled but the OPA URL is not set — policy enforcement is disabled until it is configured.");
                return;
            }

            // Hard validation — the first production caller of validateOpaConfig.
            const validation = validateOpaConfig({
                opaUrl,
                timeout: cfg.opaTimeout,
                retryAttempts: cfg.opaRetryAttempts,
                cacheTtl: cfg.opaCacheTTL,
                cacheMaxSize: cfg.opaCacheMaxSize,
                circuitBreakerThreshold: cfg.opaCbThreshold
            });
            let urlOk = false;
            try {
                urlOk = !!new URL(opaUrl);
            } catch (e) {
                urlOk = false;
            }
            if (!validation.valid || !urlOk) {
                node._opaConfigInvalid = true;
                const why = !urlOk ? `opaUrl is not a valid URL ("${opaUrl}")` : validation.errors.join("; ");
                node.error(`OPA configuration is invalid — enforcement disabled (mode forced off): ${why}`);
                node.status({ fill: "red", shape: "dot", text: "OPA config invalid" });
                return;
            }

            // Soft checks (D1/D7): warn but do not block — http:// and a missing
            // token are valid for the e2e harness / local development.
            if (opaUrl.toLowerCase().indexOf("https://") !== 0) {
                node.warn(`OPA URL is not https:// ("${opaUrl}") — policy input carries verified JWT claims; use TLS in production.`);
            }
            if (!cfg.credentials?.opaToken) {
                node.warn("OPA token is not set — required to call an OPA started with token authentication (D7).");
            }

            // Build the bearer wrapper now so endpoint-only policy paths (blank
            // config path) still get an authenticated client at request time.
            node._opaFetchWrapper = buildOpaFetchWrapper();

            // Primary client only when the config path is non-blank (D5).
            if (!policyPath) {
                return;
            }
            const primary = getOrCreateOpaClient(policyPath);

            // Re-point the health check at the LIVE client: its details then carry
            // circuitState and, crucially, it authenticates with the gateway token
            // via the same fetch wrapper (D7). The unauthenticated config-node
            // createOpaHealthCheck would otherwise report a token-protected OPA as
            // unhealthy while decisions succeed.
            if (primary && node.configNode.healthCheckManager) {
                node.configNode.healthCheckManager.registerCheck("opa", () => primary.getHealthStatus());
            }
        }

        /**
         * Resolve the effective OPA settings for an endpoint: config defaults
         * overlaid by per-endpoint overrides, tighten-only (decision-001 D6 and
         * the per-endpoint precedence table). An endpoint may select a mode or
         * point at a stricter policy; it may NOT set fail-open or reconfigure the
         * connection.
         * @param {Object} endpointNode
         * @returns {{active:boolean, mode:string, policyPath?:string}}
         */
        function resolveOpaSettings(endpointNode) {
            const cfg = node.configNode;
            if (!cfg || !cfg.opaEnabled || node._opaConfigInvalid) {
                return { active: false, mode: "off" };
            }
            const epMode = endpointNode.opaMode || "inherit";
            const mode = epMode === "inherit" ? (cfg.opaMode || "enforce") : epMode;

            const epPath = (endpointNode.opaPolicyPath || "").trim();
            const policyPath = epPath || (cfg.opaPolicyPath || "").trim();

            if (mode === "off" || !policyPath) {
                return { active: false, mode: "off", policyPath };
            }

            return {
                active: true,
                mode, // enforce | monitor
                policyPath,
                failOpen: cfg.opaFailOpen === true,   // config-only; endpoints cannot loosen
                deadline: parseInt(cfg.opaDeadline, 10) || 3000,
                tokenMode: cfg.opaTokenMode || "full",
                tokenClaims: (cfg.opaTokenClaims || "").split(",").map(s => s.trim()).filter(Boolean),
                includeAuditFields: cfg.opaIncludeAuditFields === true,
                includeBody: endpointNode.opaIncludeBody === true,
                mappings: parseOpaMappings(endpointNode.opaInputMappings || "")
            };
        }

        /**
         * Assemble the buildOpaInput() context from the request and endpoint.
         * Uses request.auth.payload (VERIFIED claims) as the token — never the
         * raw caller token string (request.auth.token).
         */
        function opaInputContext(request, endpointNode, settings) {
            const auth = request.auth || { authenticated: false };
            return {
                method: request.method,
                path: (request.url || "").split("?")[0],
                route: request.routeOptions?.url,
                params: request.params || {},
                query: request.query || {},
                headers: request.headers || {},
                body: request.body,
                ip: request.ip,
                auth: { authenticated: auth.authenticated === true, token: auth.payload },
                endpoint: {
                    requiredScopes: endpointNode.requiredScopes || [],
                    operator: endpointNode.scopeOperator || "AND"
                },
                tokenMode: settings.tokenMode,
                tokenClaims: settings.tokenClaims,
                mappings: settings.mappings,
                includeBody: settings.includeBody,
                includeAuditFields: settings.includeAuditFields,
                requestId: request.id,
                sourceIp: request.ip
            };
        }

        function extractOpaReason(result) {
            if (!result || typeof result !== "object") return null;
            return result.reason || result.decision_reason || null;
        }

        /**
         * Emit the flat, greppable opa_policy_check structured log (task-081).
         * decisionId is a top-level field, present on a fresh decision and absent
         * on a cache hit; the input document is NEVER logged.
         */
        function logOpaCheck(request, opa) {
            const logger = node.configNode && node.configNode.getLogger && node.configNode.getLogger();
            if (!logger) return;
            const rec = {
                event: "opa_policy_check",
                allowed: opa.allowed,
                enforced: opa.mode === "enforce",
                mode: opa.mode,
                policyPath: opa.policyPath,
                reason: opa.reason,
                cached: opa.cached,
                durationMs: opa.durationMs,
                method: request.method,
                path: (request.url || "").split("?")[0],
                route: request.routeOptions && request.routeOptions.url,
                sub: request.auth && request.auth.sub
            };
            if (opa.decisionId !== undefined) rec.decisionId = opa.decisionId;
            logger.info(rec, opa.allowed ? "OPA allow" : "OPA deny/non-decision");
        }

        function meterOpa(policyPath, opa) {
            const m = node.metricsCollector;
            if (!m) return;
            if (opa.error) {
                m.recordOpaError({ policy: policyPath, code: opa.error.code, duration: opa.durationMs });
                return;
            }
            m.recordOpaEvaluation({ duration: opa.durationMs, allowed: opa.allowed, policy: policyPath, reason: opa.reason });
            m.recordOpaCache(opa.cached === true);
        }

        /**
         * Create the OPA policy-enforcement preHandler for an endpoint. Runs
         * after the auth middleware, so request.auth carries verified claims.
         * A denial or non-decision replies directly and the route handler never
         * runs; an allow (or monitor / fail-open) attaches request.opa and
         * proceeds. (decision-001 D2/D4/D5/D6)
         * @param {Object} endpointNode
         * @returns {Function}
         */
        function createOpaMiddleware(endpointNode) {
            return async function(request, reply) {
                const settings = resolveOpaSettings(endpointNode);
                if (!settings.active) {
                    return; // OPA off for this endpoint; requiredScopes (if any) still applies
                }
                const policyPath = settings.policyPath;

                const finish = (opa) => {
                    request.opa = opa;
                    logOpaCheck(request, opa);
                    meterOpa(policyPath, opa);
                };

                // 503 fail-closed (or 200 fail-open + warn / monitor pass-through)
                // for anything that is not a valid decision.
                const failClosed = (opa) => {
                    finish(opa);
                    if (settings.mode === "monitor") return;          // monitor never blocks
                    if (settings.failOpen) {
                        node.warn(`OPA fail-open: ${opa.reason} for ${request.method} ${request.url} — allowing request (opaFailOpen).`);
                        return;
                    }
                    reply.code(503).send({
                        statusCode: 503,
                        error: "Service Unavailable",
                        message: "Authorization service unavailable",
                        details: { reason: opa.reason, policyPath: opa.policyPath }
                    });
                };

                const client = getOrCreateOpaClient(policyPath);
                if (!client) {
                    return failClosed({
                        allowed: false, reason: "CONFIG_INVALID", policyPath, mode: settings.mode,
                        cached: false, durationMs: 0, decisionId: undefined, result: undefined,
                        failOpen: settings.failOpen, error: { code: "CONFIG_INVALID", message: "OPA client unavailable" }
                    });
                }

                let input;
                try {
                    input = buildOpaInput(opaInputContext(request, endpointNode, settings));
                } catch (err) {
                    // A forbidden/invalid mapping (closed whitelist) is a config fault.
                    return failClosed({
                        allowed: false, reason: "CONFIG_INVALID", policyPath, mode: settings.mode,
                        cached: false, durationMs: 0, decisionId: undefined, result: undefined,
                        failOpen: settings.failOpen, error: { code: "CONFIG_INVALID", message: err.message }
                    });
                }

                const start = Date.now();
                let decision = null;
                let evalError = null;
                let timer = null;
                try {
                    decision = await Promise.race([
                        client.evaluate(input),
                        new Promise((_resolve, reject) => {
                            timer = setTimeout(() => {
                                const e = new Error("OPA evaluation deadline exceeded");
                                e.code = "DEADLINE";
                                reject(e);
                            }, settings.deadline);
                        })
                    ]);
                } catch (err) {
                    evalError = err;
                } finally {
                    if (timer) clearTimeout(timer);
                }
                const durationMs = Date.now() - start;

                if (evalError) {
                    const code = classifyOpaError(evalError);
                    return failClosed({
                        allowed: false, reason: code, policyPath, mode: settings.mode,
                        cached: false, durationMs, decisionId: undefined, result: undefined,
                        failOpen: settings.failOpen, error: { code, message: evalError.message }
                    });
                }

                // Undefined-document trap: HTTP 200 {} (or an object without
                // allow/allowed) is a CONFIG fault, not a deny.
                if (isUndefinedDecision(decision.result)) {
                    const dedupKey = `undef:${policyPath}`;
                    if (!node._opaErrorDedup.has(dedupKey)) {
                        node._opaErrorDedup.add(dedupKey);
                        node.error(`OPA policy path "${policyPath}" returned an undefined document (HTTP 200 {}). It does not resolve to a decision — this is a configuration error, not a denial.`);
                    }
                    if (typeof client.clearCache === "function") client.clearCache();
                    return failClosed({
                        allowed: false, reason: "POLICY_UNDEFINED", policyPath, mode: settings.mode,
                        cached: false, durationMs, decisionId: decision.decision_id, result: decision.result,
                        failOpen: settings.failOpen, error: { code: "POLICY_UNDEFINED", message: "policy path returned an undefined document" }
                    });
                }

                const allowed = decision.allowed === true;
                const reason = extractOpaReason(decision.result) || (allowed ? "allow" : "policy_denied");
                const opa = {
                    allowed,
                    reason,
                    policyPath,
                    mode: settings.mode,
                    cached: decision.cached === true,
                    durationMs,
                    decisionId: decision.decision_id,
                    result: decision.result,
                    failOpen: settings.failOpen,
                    error: null
                };

                if (allowed) {
                    finish(opa);
                    return; // proceed to the route handler
                }

                // A genuine policy denial.
                finish(opa);
                if (settings.mode === "monitor") {
                    node.warn(`OPA monitor: ${request.method} ${request.url} would be DENIED (reason=${reason}) but monitor mode does not enforce.`);
                    return;
                }
                // enforce: 401 only when the gateway's own state says unauthenticated
                // AND the policy reason is an auth reason — never a policy string alone.
                const authReason = reason === "missing_token" || reason === "token_expired";
                const unauthenticated = !(request.auth && request.auth.authenticated);
                const status = (authReason && unauthenticated) ? 401 : 403;
                reply.code(status).send({
                    statusCode: status,
                    error: status === 401 ? "Unauthorized" : "Forbidden",
                    message: status === 401 ? "Authentication required" : "Access denied by policy",
                    details: { reason, policyPath, decisionId: decision.decision_id }
                });
            };
        }

        /**
         * Get the full path for an endpoint including base path from config
         * @param {string} endpointPath - The endpoint's path
         * @returns {string} Full path with base path prefix
         */
        function getFullPath(endpointPath) {
            if (node.configNode) {
                const basePath = node.configNode.getFullBasePath();
                return combinePaths(basePath, endpointPath);
            }
            return normalizePath(endpointPath);
        }

        /**
         * Check for route conflicts with existing routes
         * @param {string} method - HTTP method
         * @param {string} path - Route path
         * @param {string} endpointId - ID of the endpoint being registered
         * @returns {{conflict: boolean, existingEndpointId?: string}}
         */
        function checkRouteConflict(method, path, endpointId) {
            const routeKey = `${method.toUpperCase()}:${path}`;

            // Check exact match
            if (node.registeredRoutes.has(routeKey)) {
                const existingId = node.registeredRoutes.get(routeKey);
                if (existingId !== endpointId) {
                    return { conflict: true, existingEndpointId: existingId };
                }
            }

            // Check for conflicting patterns (e.g., /users/:id vs /users/:userId).
            // Route keys are `METHOD:path` and the path itself contains ':param'
            // segments, so split only on the FIRST colon to keep the path intact.
            for (const [key, existingId] of node.registeredRoutes) {
                if (existingId === endpointId) continue;

                const sep = key.indexOf(":");
                const existingMethod = key.slice(0, sep);
                const existingPath = key.slice(sep + 1);
                if (existingMethod === method.toUpperCase() && pathsConflict(existingPath, path)) {
                    return { conflict: true, existingEndpointId: existingId };
                }
            }

            return { conflict: false };
        }

        /**
         * Collect scopes and roles from a validated token payload: the `scope`
         * claim, realm_access.roles, a custom `roles` claim, and client roles
         * from resource_access (as "client:role").
         * @param {Object} payload - Verified JWT payload
         * @returns {Array<string>}
         */
        function collectTokenScopes(payload) {
            const scopes = payload.scope ? payload.scope.split(" ") : [];
            if (payload.realm_access?.roles) {
                scopes.push(...payload.realm_access.roles);
            }
            if (Array.isArray(payload.roles)) {
                scopes.push(...payload.roles);
            }
            if (payload.resource_access) {
                for (const [resource, access] of Object.entries(payload.resource_access)) {
                    if (access.roles) {
                        scopes.push(...access.roles.map(r => `${resource}:${r}`));
                    }
                }
            }
            return scopes;
        }

        /**
         * Create authentication middleware for an endpoint
         * @param {Object} endpointNode - The api-endpoint node
         * @returns {Function} Fastify preHandler hook
         */
        function createAuthMiddleware(endpointNode) {
            return async function(request, reply) {
                // Skip auth only if no scopes required, OAuth2 is off, AND OPA is
                // not active for this endpoint. On an OPA-only gateway (OPA
                // replaces scope checks, no requiredScopes) the token must still
                // be read so OPA sees a verified — not anonymous — input (D2).
                const requiresAuth = endpointNode.requiredScopes && endpointNode.requiredScopes.length > 0;
                const opaActive = resolveOpaSettings(endpointNode).active;
                // When OPA is active it is the single authority (D6): the auth
                // step only POPULATES request.auth and never rejects — a missing
                // or invalid token yields an anonymous input and OPA decides
                // (returning 401/403 via the policy). Only enforce token
                // presence here on non-OPA endpoints that require scopes.
                const enforceAuthHere = requiresAuth && !opaActive;
                if (!requiresAuth && !node.configNode?.oauth2Enabled && !opaActive) {
                    request.auth = { authenticated: false };
                    return;
                }

                // Extract Bearer token from Authorization header
                const authHeader = request.headers.authorization;
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    if (enforceAuthHere) {
                        reply.code(401).send({
                            statusCode: 401,
                            error: "Unauthorized",
                            message: "Missing or invalid Authorization header"
                        });
                        return;
                    }
                    request.auth = { authenticated: false };
                    return;
                }

                const token = authHeader.substring(7);

                // Validate token with Keycloak
                if (!node.keycloakClient) {
                    if (enforceAuthHere) {
                        reply.code(503).send({
                            statusCode: 503,
                            error: "Service Unavailable",
                            message: "OAuth2 authentication not configured"
                        });
                        return;
                    }
                    request.auth = { authenticated: false };
                    return;
                }

                const validationResult = await node.keycloakClient.validateToken(token);

                if (!validationResult.valid) {
                    if (enforceAuthHere) {
                        reply.code(401).send({
                            statusCode: 401,
                            error: "Unauthorized",
                            message: validationResult.error || "Invalid token"
                        });
                        return;
                    }
                    request.auth = { authenticated: false };
                    return;
                }

                // Extract user info and scopes
                const payload = validationResult.payload;
                const scopes = collectTokenScopes(payload);

                // Determine roles array for auth context
                const roles = payload.realm_access?.roles || payload.roles || [];

                request.auth = {
                    authenticated: true,
                    sub: payload.sub,
                    preferredUsername: payload.preferred_username,
                    email: payload.email,
                    scopes: scopes,
                    roles: roles,
                    token: token,
                    payload: payload
                };

                // Record metrics for token validation
                if (node.metricsCollector) {
                    node.metricsCollector.recordKeycloakValidation({ success: true, duration: 0 });
                }
            };
        }

        /**
         * Create the route handler that forwards requests to Node-RED
         * @param {Object} endpointNode - The api-endpoint node
         * @returns {Function} Fastify route handler
         */
        function createRouteHandler(endpointNode) {
            return async function(request, reply) {
                // Build message to send to Node-RED flow
                const msg = {
                    _msgid: generateRequestId(),
                    req: {
                        method: request.method,
                        url: request.url,
                        path: request.url.split("?")[0],
                        route: request.routeOptions?.url,
                        query: request.query || {},
                        params: request.params || {},
                        headers: request.headers,
                        body: request.body,
                        ip: request.ip,
                        auth: request.auth || { authenticated: false }
                    },
                    res: {
                        // Provide response helper methods
                        _reply: reply,
                        _responded: false,
                        status: function(code) {
                            this._statusCode = code;
                            return this;
                        },
                        set: function(name, value) {
                            if (!this._headers) this._headers = {};
                            this._headers[name] = value;
                            return this;
                        },
                        json: function(data) {
                            if (this._responded) return;
                            this._responded = true;
                            if (this._headers) {
                                for (const [name, value] of Object.entries(this._headers)) {
                                    this._reply.header(name, value);
                                }
                            }
                            this._reply.code(this._statusCode || 200).send(data);
                        },
                        send: function(data) {
                            if (this._responded) return;
                            this._responded = true;
                            if (this._headers) {
                                for (const [name, value] of Object.entries(this._headers)) {
                                    this._reply.header(name, value);
                                }
                            }
                            this._reply.code(this._statusCode || 200).send(data);
                        },
                        end: function() {
                            if (this._responded) return;
                            this._responded = true;
                            this._reply.code(this._statusCode || 204).send();
                        }
                    },
                    payload: request.body
                };

                // Carry the OPA decision (if any) onto the message so downstream
                // (and the endpoint's single-authority skip) can see it (D6).
                if (request.opa) {
                    msg.opa = request.opa;
                }

                // Create a promise that will be resolved when the response is sent
                return new Promise((resolve, _reject) => {
                    // Set timeout for response
                    const timeout = setTimeout(() => {
                        if (!msg.res._responded) {
                            msg.res._responded = true;
                            reply.code(504).send({
                                statusCode: 504,
                                error: "Gateway Timeout",
                                message: "Request timed out waiting for response"
                            });
                            resolve();
                        }
                    }, 30000);  // 30 second timeout

                    // Override send methods to resolve the promise
                    const originalJson = msg.res.json.bind(msg.res);
                    const originalSend = msg.res.send.bind(msg.res);
                    const originalEnd = msg.res.end.bind(msg.res);

                    msg.res.json = function(data) {
                        clearTimeout(timeout);
                        originalJson(data);
                        resolve();
                    };
                    msg.res.send = function(data) {
                        clearTimeout(timeout);
                        originalSend(data);
                        resolve();
                    };
                    msg.res.end = function() {
                        clearTimeout(timeout);
                        originalEnd();
                        resolve();
                    };

                    // Send message through the endpoint node
                    // The endpoint node will process validation, authorization, etc.
                    // and then forward to its output
                    try {
                        endpointNode.receive(msg);
                    } catch (err) {
                        clearTimeout(timeout);
                        if (!msg.res._responded) {
                            msg.res._responded = true;
                            reply.code(500).send({
                                statusCode: 500,
                                error: "Internal Server Error",
                                message: err.message
                            });
                        }
                        resolve();
                    }
                });
            };
        }

        /**
         * Register a single Fastify route for an endpoint
         * @param {Object} endpointNode - The api-endpoint node
         * @param {boolean} isRestart - True if this is being called during a server restart
         * @returns {boolean} True if route was registered successfully
         */
        function registerFastifyRoute(endpointNode, isRestart = false) {
            if (!node.fastify || !node.serverStarted) {
                // Queue for later registration
                if (!node.pendingEndpoints.includes(endpointNode)) {
                    node.pendingEndpoints.push(endpointNode);
                }
                return false;
            }

            const fullPath = getFullPath(endpointNode.path);
            const method = endpointNode.method.toLowerCase();

            // Check for conflicts
            const conflict = checkRouteConflict(endpointNode.method, fullPath, endpointNode.id);
            if (conflict.conflict) {
                node.warn(`Route conflict: ${endpointNode.method} ${fullPath} conflicts with endpoint ${conflict.existingEndpointId}`);
                return false;
            }

            // Check if route is already registered (skip if already tracked)
            const routeKey = `${endpointNode.method.toUpperCase()}:${fullPath}`;
            if (node.registeredRoutes.has(routeKey)) {
                // Route already registered, no action needed
                return true;
            }

            try {
                // Convert Express-style params (:id) to Fastify style (:id is the same, but we need to handle it)
                const fastifyPath = fullPath;

                // Build route options
                const routeOptions = {
                    method: method.toUpperCase(),
                    url: fastifyPath,
                    handler: createRouteHandler(endpointNode)
                };

                // Build the preHandler chain as an array — auth first, then OPA
                // (decision-001 D2). The attach condition widens for OPA-only
                // endpoints so they still get the hook. Never a second assignment
                // to routeOptions.preHandler.
                const opaSettings = resolveOpaSettings(endpointNode);
                const needsAuth = node.keycloakClient ||
                    (endpointNode.requiredScopes && endpointNode.requiredScopes.length > 0) ||
                    opaSettings.active;
                const preHandlers = [];
                if (needsAuth) {
                    preHandlers.push(createAuthMiddleware(endpointNode));
                }
                if (opaSettings.active) {
                    preHandlers.push(createOpaMiddleware(endpointNode));
                }
                if (preHandlers.length > 0) {
                    routeOptions.preHandler = preHandlers;
                }

                // Register the route
                node.fastify.route(routeOptions);

                // Track registered route
                node.registeredRoutes.set(routeKey, endpointNode.id);

                node.log(`Registered Fastify route: ${endpointNode.method} ${fullPath}`);
                return true;
            } catch (err) {
                // Fastify throws when a route is added after listen(). In Fastify 5
                // this is FST_ERR_INSTANCE_ALREADY_LISTENING ("Fastify instance is
                // already listening. Cannot add route!"); older/other messages used
                // the word "after". Match the code first, then fall back to message
                // text so the server is restarted to pick up the new route.
                const alreadyListening =
                    err.code === "FST_ERR_INSTANCE_ALREADY_LISTENING" ||
                    (err.message && /already listening|after/i.test(err.message));
                if (!isRestart && alreadyListening) {
                    node.log(`Route registration failed (server already listening), scheduling restart: ${endpointNode.method} ${fullPath}`);
                    scheduleRestart(`new endpoint added: ${endpointNode.method} ${fullPath}`);
                    return false;
                }
                node.error(`Failed to register route ${endpointNode.method} ${fullPath}: ${err.message}`);
                return false;
            }
        }

        /**
         * Register all pending endpoints
         */
        function registerPendingEndpoints() {
            const pending = node.pendingEndpoints.slice();
            node.pendingEndpoints = [];

            for (const endpointNode of pending) {
                registerFastifyRoute(endpointNode);
            }
        }

        /**
         * Schedule a server restart (debounced to handle multiple endpoint changes)
         * @param {string} reason - Reason for the restart (for logging)
         */
        function scheduleRestart(reason) {
            if (node.restartPending) {
                // Restart already scheduled, no need to schedule another
                return;
            }

            node.restartPending = true;

            // Clear any existing timer
            if (node.restartTimer) {
                clearTimeout(node.restartTimer);
            }

            // Debounce restart by 100ms to batch multiple endpoint registrations
            node.restartTimer = setTimeout(async () => {
                node.restartTimer = null;
                node.restartPending = false;

                node.log(`Restarting Fastify server: ${reason}`);
                await restartServer();
            }, 100);
        }

        /**
         * Restart the Fastify server to register new routes
         * Fastify 5.x doesn't allow adding routes after listen(), so we need to restart
         */
        async function restartServer() {
            if (!node.serverStarted || node.closing) {
                return;
            }

            try {
                // Store current endpoints before stopping
                const currentEndpoints = Array.from(node.endpoints.values());

                node.log(`Restarting server with ${currentEndpoints.length} endpoints...`);

                // Close the current server
                if (node.fastify) {
                    await node.fastify.close();
                    node.fastify = null;
                }

                // Clear registered routes (will be re-registered)
                node.registeredRoutes.clear();

                // Mark server as not started so startServer() will proceed
                node.serverStarted = false;

                // If the node was closed while we awaited fastify.close(), do NOT
                // re-listen: the node is being destroyed and binding the port
                // again would leak a zombie listener (EADDRINUSE on next deploy).
                if (node.closing) {
                    return;
                }

                // Queue all current endpoints for re-registration
                node.pendingEndpoints = currentEndpoints.slice();

                // Start the server again (this will register all pending endpoints)
                await startServer();

                node.log("Server restart complete");
            } catch (err) {
                node.error(`Failed to restart server: ${err.message}`);
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "restart failed"
                });
            }
        }

        /**
         * Initialize and start the Fastify server
         */
        async function startServer() {
            if (node.serverStarted || node.closing) {
                return;
            }

            try {
                // Dynamically require fastify
                let fastify;
                try {
                    fastify = require("fastify");
                } catch (err) {
                    node.warn("Fastify not installed. OpenAPI endpoints will not be available. Install with: npm install fastify");
                    return;
                }

                // Get logger from config node if available
                const logger = node.configNode?.getLogger() || null;

                // Build Fastify options
                const fastifyOptions = {
                    // Use routerOptions for Fastify 6 compatibility
                    routerOptions: {
                        ignoreTrailingSlash: true
                    },
                    requestIdHeader: "x-request-id",
                    bodyLimit: node.bodyLimit,
                    genReqId: (req) => {
                        // Use existing request ID or generate new one
                        return req.headers["x-request-id"] || generateRequestId();
                    }
                };

                // Add TLS/HTTPS support if enabled in config
                let tlsEnabled = false;
                if (node.configNode?.tlsEnabled && node.configNode?.tlsCertPath && node.configNode?.tlsKeyPath) {
                    try {
                        fastifyOptions.https = {
                            key: fs.readFileSync(node.configNode.tlsKeyPath),
                            cert: fs.readFileSync(node.configNode.tlsCertPath)
                        };
                        // Add CA certificate if provided (for client certificate validation)
                        if (node.configNode.tlsCaPath) {
                            fastifyOptions.https.ca = fs.readFileSync(node.configNode.tlsCaPath);
                        }
                        // Set minimum TLS version if configured
                        if (node.configNode.tlsMinVersion) {
                            fastifyOptions.https.minVersion = node.configNode.tlsMinVersion;
                        }
                        // Configure certificate rejection based on config
                        if (node.configNode.tlsRejectUnauthorized === false) {
                            fastifyOptions.https.rejectUnauthorized = false;
                        }
                        tlsEnabled = true;
                        node.log(`TLS enabled with certificate from ${node.configNode.tlsCertPath}`);
                    } catch (err) {
                        node.error(`Failed to load TLS certificates: ${err.message}`);
                        node.status({
                            fill: "red",
                            shape: "ring",
                            text: "TLS cert error"
                        });
                        return;
                    }
                }

                // Configure logger for Fastify
                // Fastify 5.x only accepts a boolean or Pino configuration object (not an instance)
                // We disable Fastify's built-in logging and handle it ourselves in hooks
                fastifyOptions.logger = false;

                // Create Fastify instance
                node.fastify = fastify(fastifyOptions);

                // Optional raw body parsers (e.g. image uploads) -> msg.req.body is a Buffer
                const binaryMatchers = registerBinaryParsers(node.fastify, {
                    bodyLimit: node.bodyLimit,
                    binaryBodyEnabled: node.binaryBodyEnabled,
                    binaryContentTypes: node.binaryContentTypes
                });
                if (binaryMatchers.length > 0) {
                    node.log(`Raw body parsing enabled for ${node.binaryContentTypes.join(", ")} (bodyLimit ${node.bodyLimit} bytes)`);
                }

                // Add request/response timing hooks for logging and metrics
                // Always add hooks - metrics may be enabled even without logging
                node.fastify.addHook("onRequest", async (request) => {
                    request.startTime = Date.now();
                    request.timer = createTimer();

                    // Track active requests for metrics
                    if (node.metricsCollector) {
                        node.metricsCollector.incrementActiveRequests();
                    }
                });

                node.fastify.addHook("onResponse", async (request, reply) => {
                    const duration = request.timer ? request.timer.elapsed() : (Date.now() - request.startTime);

                    // Log request if logger is enabled
                    if (logger) {
                        logger.info({
                            event: "http_request",
                            requestId: request.id,
                            method: request.method,
                            url: request.url,
                            statusCode: reply.statusCode,
                            duration: duration,
                            durationMs: `${duration}ms`,
                            userAgent: request.headers["user-agent"],
                            remoteAddress: request.ip
                        }, `${request.method} ${request.url} ${reply.statusCode} - ${duration}ms`);
                    }

                    // Record metrics
                    if (node.metricsCollector) {
                        // Extract path without query string for metrics
                        const path = request.url.split("?")[0];
                        node.metricsCollector.recordHttpRequest({
                            method: request.method,
                            path: path,
                            statusCode: reply.statusCode,
                            duration: duration
                        });
                        node.metricsCollector.decrementActiveRequests();
                    }
                });

                node.fastify.addHook("onError", async (request, reply, error) => {
                    if (logger) {
                        logger.error({
                            event: "http_error",
                            requestId: request.id,
                            method: request.method,
                            url: request.url,
                            error: error.message,
                            stack: error.stack,
                            code: error.code
                        }, `Request error: ${error.message}`);
                    }
                });

                // Register OpenAPI spec endpoint
                if (node.openapiEnabled) {
                    // JSON endpoint
                    node.fastify.get(node.openapiPath, async (request, reply) => {
                        const spec = node.openapiGenerator.generate();

                        // Add server URL based on request. Use request.host
                        // (includes the port); request.hostname strips it in
                        // Fastify 5, which would advertise a port-less URL.
                        if (!spec.servers || spec.servers.length === 0) {
                            const protocol = request.protocol || "http";
                            const host = request.host || `${node.host}:${node.port}`;
                            spec.servers = [{
                                url: `${protocol}://${host}`,
                                description: "Current server"
                            }];
                        }

                        reply.type("application/json");
                        return spec;
                    });

                    // YAML endpoint
                    const yamlPath = node.openapiPath.replace(/\.json$/, ".yaml");
                    if (yamlPath !== node.openapiPath) {
                        node.fastify.get(yamlPath, async (request, reply) => {
                            reply.type("text/yaml");
                            return node.openapiGenerator.toYAML();
                        });
                    }
                }

                // Register Swagger UI if enabled
                if (node.swaggerUiEnabled) {
                    try {
                        // @fastify/swagger-ui requires @fastify/swagger to be registered first
                        const swagger = require("@fastify/swagger");
                        const swaggerUi = require("@fastify/swagger-ui");

                        // Register @fastify/swagger with our custom specification
                        await node.fastify.register(swagger, {
                            mode: "dynamic",
                            openapi: {
                                info: {
                                    title: node.configNode?.openapiTitle || "API Gateway",
                                    description: node.configNode?.openapiDescription || "",
                                    version: node.configNode?.apiVersion || "1.0.0"
                                }
                            }
                        });

                        // Register Swagger UI
                        await node.fastify.register(swaggerUi, {
                            routePrefix: node.swaggerUiPath,
                            // Use our custom OpenAPI spec endpoint instead of the auto-generated one
                            transformSpecificationClone: true,
                            transformSpecification: () => node.getOpenApiSpec(),
                            uiConfig: {
                                docExpansion: "list",
                                deepLinking: true,
                                displayRequestDuration: true,
                                filter: true
                            },
                            // Disable CSP to allow Swagger UI scripts to run properly
                            staticCSP: false
                        });
                    } catch (err) {
                        if (err.code === "MODULE_NOT_FOUND") {
                            node.warn("Swagger UI not available. Install with: npm install @fastify/swagger @fastify/swagger-ui");
                        } else {
                            node.warn(`Swagger UI setup failed: ${err.message}`);
                        }
                    }
                }

                // Register Prometheus metrics endpoint if enabled
                if (node.metricsEnabled) {
                    // Initialize metrics collector with server context
                    node.metricsCollector = getMetricsCollector({
                        prefix: "api_gateway_",
                        defaultLabels: {
                            server: `${node.host}:${node.port}`
                        }
                    });

                    const access = node.metricsAccess;
                    for (const err of access.errors) {
                        node.error(`${err} - ${node.metricsPath} will answer 503`);
                    }
                    const metricsGuard = createMetricsGuard(access, {
                        validateToken: async (token) => {
                            if (!node.keycloakClient) return null;
                            const result = await node.keycloakClient.validateToken(token);
                            if (!result.valid) return { valid: false, error: result.error };
                            return { valid: true, scopes: collectTokenScopes(result.payload) };
                        }
                    });

                    node.fastify.get(node.metricsPath, { preHandler: metricsGuard }, async (request, reply) => {
                        try {
                            // Pull the live mssql pool state at scrape time, so
                            // the gauge shows the real tarn wait queue.
                            const poolStats = node.configNode && typeof node.configNode.getPoolStatistics === "function"
                                ? node.configNode.getPoolStatistics()
                                : null;
                            if (poolStats) {
                                node.metricsCollector.updateConnectionPool("database", {
                                    active: poolStats.borrowed,
                                    idle: poolStats.available,
                                    waiting: poolStats.pending
                                });
                            }
                            const metrics = await node.metricsCollector.getMetrics();
                            reply.type(node.metricsCollector.getContentType());
                            return metrics;
                        } catch (err) {
                            reply.code(500).send({ error: "Failed to collect metrics" });
                        }
                    });
                }

                // Register any pending endpoints BEFORE starting the server
                // Fastify 5.x doesn't allow adding routes after listen()
                node.serverStarted = true;  // Mark as started so registerFastifyRoute doesn't queue
                registerPendingEndpoints();

                // Start the server
                await node.fastify.listen({ port: node.port, host: node.host });
                const protocol = tlsEnabled ? "https" : "http";
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `${protocol}://${node.host}:${node.port}`
                });

                node.log(`API Server started on ${protocol}://${node.host}:${node.port}`);
                if (node.openapiEnabled) {
                    node.log(`OpenAPI spec available at ${node.openapiPath}`);
                }
                if (node.swaggerUiEnabled) {
                    node.log(`Swagger UI available at ${node.swaggerUiPath}`);
                }
                if (node.metricsEnabled) {
                    const a = node.metricsAccess;
                    const ipNote = a.allowedIps.length > 0 ? `, allowed from ${a.allowedIps.join(", ")}` : "";
                    const authNote = a.auth === "none" ? "public, no authentication" : `auth: ${a.auth}`;
                    node.log(`Prometheus metrics available at ${node.metricsPath} (${authNote}${ipNote})`);
                }

            } catch (err) {
                node.error(`Failed to start server: ${err.message}`);
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "failed to start"
                });
                // Roll back the "started" state so a later registerEndpoint()
                // re-queues its route instead of registering it into a Fastify
                // instance that never began listening (which would paint a false
                // green status). Any routes already added to this dead instance
                // are dropped with it.
                node.serverStarted = false;
                try {
                    if (node.fastify) await node.fastify.close();
                } catch (closeErr) {
                    node.debug?.(`Error closing failed server instance: ${closeErr.message}`);
                }
                node.fastify = null;
                node.registeredRoutes.clear();
            }
        }

        /**
         * Stop the Fastify server
         */
        async function stopServer() {
            if (node.fastify && node.serverStarted) {
                try {
                    await node.fastify.close();
                    node.serverStarted = false;
                    node.fastify = null;
                    node.registeredRoutes.clear();
                    node.log("API Server stopped");
                } catch (err) {
                    node.error(`Error stopping server: ${err.message}`);
                }
            }

            // Shutdown Keycloak client
            if (node.keycloakClient) {
                node.keycloakClient.shutdown();
                node.keycloakClient = null;
            }

            // Shutdown every OPA client (clears sweep timers, caches, breakers
            // and listeners). restartServer() only calls fastify.close(), so the
            // warm caches deliberately survive a debounced restart (D3).
            if (node.opaClientsByPath) {
                for (const client of node.opaClientsByPath.values()) {
                    try {
                        client.shutdown();
                    } catch (e) {
                        // best-effort teardown
                    }
                }
                node.opaClientsByPath.clear();
            }
        }

        /**
         * Register an endpoint with this server
         * @param {Object} endpointNode - The api-endpoint node
         */
        node.registerEndpoint = function(endpointNode) {
            if (!endpointNode || !endpointNode.id) {
                return;
            }

            node.endpoints.set(endpointNode.id, endpointNode);

            // Register with OpenAPI generator
            if (node.openapiGenerator) {
                node.openapiGenerator.registerEndpoint(endpointNode);
            }

            // Register Fastify route (will queue if server not yet started)
            registerFastifyRoute(endpointNode);

            node.log(`Registered endpoint: ${endpointNode.method || "GET"} ${endpointNode.path || "/"}`);
            updateStatus();
        };

        /**
         * Unregister an endpoint from this server
         * @param {Object} endpointNode - The api-endpoint node
         */
        node.unregisterEndpoint = function(endpointNode) {
            if (!endpointNode || !endpointNode.id) {
                return;
            }

            node.endpoints.delete(endpointNode.id);

            // Unregister from OpenAPI generator
            if (node.openapiGenerator) {
                node.openapiGenerator.unregisterEndpoint(endpointNode.id);
            }

            // Remove from registered routes tracking
            // Note: Fastify doesn't support removing routes at runtime, but we track
            // for conflict detection. Routes are effectively removed on server restart.
            const fullPath = getFullPath(endpointNode.path);
            const routeKey = `${endpointNode.method.toUpperCase()}:${fullPath}`;
            node.registeredRoutes.delete(routeKey);

            // Remove from pending endpoints if present
            const pendingIndex = node.pendingEndpoints.indexOf(endpointNode);
            if (pendingIndex !== -1) {
                node.pendingEndpoints.splice(pendingIndex, 1);
            }

            node.log(`Unregistered endpoint: ${endpointNode.method || "GET"} ${endpointNode.path || "/"}`);
            updateStatus();
        };

        /**
         * Get the OpenAPI specification
         * @returns {Object} OpenAPI spec object
         */
        node.getOpenApiSpec = function() {
            if (!node.openapiGenerator) {
                return null;
            }
            return node.openapiGenerator.generate();
        };

        /**
         * Get the OpenAPI specification as JSON string
         * @returns {string} JSON string
         */
        node.getOpenApiJSON = function() {
            if (!node.openapiGenerator) {
                return "{}";
            }
            return node.openapiGenerator.toJSON();
        };

        /**
         * Get the OpenAPI specification as YAML string
         * @returns {string} YAML string
         */
        node.getOpenApiYAML = function() {
            if (!node.openapiGenerator) {
                return "";
            }
            return node.openapiGenerator.toYAML();
        };

        /**
         * Get registered endpoint count
         * @returns {number} Number of registered endpoints
         */
        node.getEndpointCount = function() {
            return node.endpoints.size;
        };

        /**
         * Get all registered endpoints info
         * @returns {Array} Array of endpoint info objects
         */
        node.getEndpointsInfo = function() {
            return Array.from(node.endpoints.values()).map(ep => {
                if (typeof ep.getEndpointInfo === "function") {
                    return ep.getEndpointInfo();
                }
                return {
                    id: ep.id,
                    name: ep.name,
                    path: ep.path,
                    method: ep.method
                };
            });
        };

        /**
         * Get the metrics collector instance
         * @returns {MetricsCollector|null} Metrics collector or null if disabled
         */
        node.getMetricsCollector = function() {
            return node.metricsCollector;
        };

        /**
         * Update node status based on current state
         */
        function updateStatus() {
            const endpointCount = node.endpoints.size;
            const protocol = (node.configNode?.tlsEnabled && node.configNode?.tlsCertPath && node.configNode?.tlsKeyPath) ? "https" : "http";
            if (node.serverStarted) {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `${protocol}://${node.host}:${node.port} (${endpointCount} endpoints)`
                });
            } else {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: `${endpointCount} endpoints registered`
                });
            }
        }

        // Initialize OpenAPI generator
        initializeOpenApiGenerator();

        // Initialize Keycloak client for OAuth2 authentication
        initializeKeycloakClient();

        // Initialize OPA policy enforcement (validates config, builds the
        // primary client, re-points the health check at the live client).
        initializeOpaClient();

        // Start server if we have fastify dependencies
        // Use setImmediate to allow endpoints to register first
        setImmediate(() => {
            startServer().catch(err => {
                node.error(`Server startup error: ${err.message}`);
            });
        });

        // Handle input messages (pass through for now)
        node.on("input", function(msg, send, done) {
            // Node-RED 1.0+ compatibility
            send = send || function() { node.send.apply(node, arguments); };

            try {
                // Add server info to message
                msg.server = {
                    host: node.host,
                    port: node.port,
                    endpointCount: node.endpoints.size,
                    openapiEnabled: node.openapiEnabled,
                    openapiPath: node.openapiPath,
                    swaggerUiEnabled: node.swaggerUiEnabled,
                    swaggerUiPath: node.swaggerUiPath,
                    metricsEnabled: node.metricsEnabled,
                    metricsPath: node.metricsPath
                };

                send(msg);
                if (done) {
                    done();
                }
            } catch (err) {
                if (done) {
                    done(err);
                } else {
                    node.error(err, msg);
                }
            }
        });

        node.on("close", async function(removed, done) {
            // Signal any in-flight debounced restart to abort before it re-listens.
            node.closing = true;

            // Clear any pending restart timer
            if (node.restartTimer) {
                clearTimeout(node.restartTimer);
                node.restartTimer = null;
            }
            node.restartPending = false;

            // Stop the server (this also clears registered routes and Keycloak client)
            await stopServer();

            // Clear registered endpoints
            node.endpoints.clear();

            // Clear pending endpoints
            node.pendingEndpoints = [];

            // Clear OpenAPI generator
            if (node.openapiGenerator) {
                node.openapiGenerator.clearEndpoints();
                node.openapiGenerator = null;
            }

            if (done) {
                done();
            }
        });
    }

    RED.nodes.registerType("apigw-server", ApiServerNode, {
        credentials: {
            metricsToken: { type: "password" },
            metricsUsername: { type: "text" },
            metricsPassword: { type: "password" }
        }
    });

    // HTTP Admin endpoint for OpenAPI import
    RED.httpAdmin.post("/api-gateway/import-openapi", RED.auth.needsPermission("flows.write"), function(req, res) {
        const parser = new OpenApiParser({ detectCrud: true });

        try {
            let content = req.body.content || "";

            // Handle both raw text and form data
            if (typeof content !== "string") {
                content = JSON.stringify(content);
            }

            if (!content || content.trim() === "") {
                return res.status(400).json({
                    success: false,
                    error: "No OpenAPI content provided"
                });
            }

            // Parse the OpenAPI spec
            const result = parser.parse(content);

            // Apply filters if provided
            let endpoints = result.endpoints;

            if (req.body.filters) {
                endpoints = parser.getFilteredEndpoints(req.body.filters);
            }

            // Return parsed result
            res.json({
                success: true,
                apiInfo: result.apiInfo,
                servers: result.servers,
                securitySchemes: result.securitySchemes,
                tags: result.tags,
                endpoints: endpoints,
                summary: {
                    ...result.summary,
                    filteredCount: endpoints.length
                }
            });

        } catch (err) {
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });

    // HTTP Admin endpoint to get supported filters/tags from a parsed spec
    RED.httpAdmin.post("/api-gateway/preview-openapi", RED.auth.needsPermission("flows.read"), function(req, res) {
        const parser = new OpenApiParser({ detectCrud: true });

        try {
            let content = req.body.content || "";

            if (typeof content !== "string") {
                content = JSON.stringify(content);
            }

            if (!content || content.trim() === "") {
                return res.status(400).json({
                    success: false,
                    error: "No OpenAPI content provided"
                });
            }

            // Parse to get preview information
            const result = parser.parse(content);

            // Return preview with tags, methods, and summary for filtering UI
            res.json({
                success: true,
                apiInfo: result.apiInfo,
                tags: result.tags,
                summary: result.summary,
                // Include unique paths for partial import selection
                paths: [...new Set(result.endpoints.map(e => e._metadata?.originalPath || e.path))]
            });

        } catch (err) {
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });

    // OPA test route (decision-001, task-082). Reports three things an operator
    // needs BEFORE deploying a policy: reachability (GET /health), whether the
    // configured policy path is actually DEFINED (via a real evaluate(), which
    // catches the configured-but-nonexistent policy that the health check reports
    // healthy), and a sample decision with the exact production input document.
    //
    // SSRF-safe: opaUrl and the policy path come from the STORED config node, and
    // the gateway token is read server-side via getCredentials — never from the
    // request body. A throwaway client (no cache, no retry, no breaker) means a
    // test can neither pollute the live cache nor trip the live breaker.
    RED.httpAdmin.post("/api-gateway/test-opa", RED.auth.needsPermission("flows.read"), async function(req, res) {
        try {
            const configId = req.body && req.body.config;
            if (!configId) {
                return res.status(400).json({ success: false, error: "No config node id provided" });
            }
            const configNode = RED.nodes.getNode(configId);
            if (!configNode) {
                return res.status(400).json({ success: false, error: "Config node not found — deploy the flow before testing." });
            }
            if (!configNode.opaEnabled) {
                return res.status(400).json({ success: false, error: "OPA is not enabled on this config node." });
            }

            // opaUrl and policy path from the STORED config only (no SSRF).
            const opaUrl = (configNode.opaUrl || "").trim();
            const policyPath = (configNode.opaPolicyPath || "").trim();
            if (!opaUrl) {
                return res.status(400).json({ success: false, error: "OPA URL is not configured on this config node." });
            }
            if (!policyPath) {
                return res.status(400).json({ success: false, error: "Policy Path is blank — policy evaluation is disabled." });
            }

            // Token read server-side; handle the __PWRD__ unchanged-password sentinel.
            const creds = RED.nodes.getCredentials(configId) || {};
            let opaToken = creds.opaToken;
            if (opaToken === "__PWRD__") {
                opaToken = undefined;
            }

            const fetchFn = (url, options = {}) => {
                const headers = Object.assign({}, options.headers);
                if (opaToken) {
                    headers["Authorization"] = `Bearer ${opaToken}`;
                }
                return globalThis.fetch(url, Object.assign({}, options, { headers }));
            };

            // Throwaway client — cannot touch the live cache or breaker.
            const client = new OpaClient({
                opaUrl,
                policyPath,
                timeout: parseInt(configNode.opaTimeout, 10) || 2000,
                cacheEnabled: false,
                retryAttempts: 0,
                circuitBreakerEnabled: false,
                fetchFn
            });

            const result = { success: true, reachable: false, policyDefined: false };
            try {
                const health = await client.getHealthStatus();
                result.reachable = health.healthy === true;
                result.healthMessage = health.message;

                // The exact production input document, from the shared builder.
                const sample = (req.body && req.body.sample) || {};
                const input = buildOpaInput({
                    method: sample.method || "GET",
                    path: sample.path || "/api/v1/sample",
                    route: sample.route || sample.path || "/api/v1/sample",
                    params: sample.params || {},
                    query: sample.query || {},
                    headers: sample.headers || {},
                    auth: sample.token ? { authenticated: true, token: sample.token } : { authenticated: false },
                    endpoint: {
                        requiredScopes: sample.requiredScopes || [],
                        operator: sample.operator || "AND"
                    },
                    tokenMode: configNode.opaTokenMode || "full",
                    tokenClaims: (configNode.opaTokenClaims || "").split(",").map(s => s.trim()).filter(Boolean),
                    includeAuditFields: configNode.opaIncludeAuditFields === true
                });
                result.input = input;

                // A REAL evaluate() — an undefined document (HTTP 200 {}) here is
                // the configured-but-nonexistent policy the health check misses.
                const decision = await client.evaluate(input);
                result.policyDefined = !isUndefinedDecision(decision.result);
                result.allowed = decision.allowed;
                result.reason = extractReasonFromResult(decision.result) || (decision.allowed ? "allow" : "policy_denied");
                if (decision.decision_id !== undefined) {
                    result.decisionId = decision.decision_id;
                }
            } catch (evalErr) {
                result.evalError = evalErr.message;
                result.errorCode = classifyOpaError(evalErr);
            } finally {
                client.shutdown();
            }

            res.json(result);
        } catch (err) {
            res.status(400).json({ success: false, error: err.message });
        }
    });
};

// Shared with the request-path builder — reason extraction from an OPA result.
function extractReasonFromResult(result) {
    if (!result || typeof result !== "object") return null;
    return result.reason || result.decision_reason || null;
}
