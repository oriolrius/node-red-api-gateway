"use strict";

const EventEmitter = require("events");
const crypto = require("crypto");

/**
 * Circuit breaker states
 */
const CircuitState = {
    CLOSED: "closed",      // Normal operation, requests go through
    OPEN: "open",          // Circuit is open, requests fail fast
    HALF_OPEN: "half_open" // Testing if service is recovered
};

/**
 * Default Keycloak client configuration
 */
const DEFAULT_KEYCLOAK_CONFIG = {
    // Connection
    keycloakUrl: "http://localhost:8080",
    realm: "master",
    clientId: null,
    clientSecret: null,
    timeout: 5000,

    // JWKS settings
    jwksRefreshInterval: 3600000,  // 1 hour
    jwksCacheEnabled: true,
    jwksMinRefreshInterval: 30000, // Minimum 30 seconds between refreshes

    // JWT validation settings
    validateIssuer: true,
    validateAudience: false,
    audience: null,
    clockTolerance: 0,
    algorithms: ["RS256", "RS384", "RS512"],

    // Retry settings
    retryAttempts: 3,
    initialBackoff: 1000,
    maxBackoff: 10000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,

    // Circuit breaker settings
    circuitBreakerEnabled: true,
    circuitBreakerThreshold: 5,     // Failures before opening
    circuitBreakerTimeout: 60000,   // Time before half-open
    circuitBreakerSuccessThreshold: 2  // Successes to close from half-open
};

/**
 * Validates Keycloak client configuration
 * @param {Object} config - Configuration to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateKeycloakConfig(config) {
    const errors = [];

    if (config.keycloakUrl && typeof config.keycloakUrl !== "string") {
        errors.push("Keycloak URL must be a string");
    }

    if (config.realm && typeof config.realm !== "string") {
        errors.push("Realm must be a string");
    }

    if (config.timeout !== undefined) {
        const timeout = parseInt(config.timeout, 10);
        if (isNaN(timeout) || timeout < 0) {
            errors.push("Timeout must be a non-negative integer");
        }
    }

    if (config.retryAttempts !== undefined) {
        const attempts = parseInt(config.retryAttempts, 10);
        if (isNaN(attempts) || attempts < 0) {
            errors.push("Retry attempts must be a non-negative integer");
        }
    }

    if (config.jwksRefreshInterval !== undefined) {
        const interval = parseInt(config.jwksRefreshInterval, 10);
        if (isNaN(interval) || interval < 1000) {
            errors.push("JWKS refresh interval must be at least 1000ms");
        }
    }

    if (config.clockTolerance !== undefined) {
        const tolerance = parseInt(config.clockTolerance, 10);
        if (isNaN(tolerance) || tolerance < 0) {
            errors.push("Clock tolerance must be a non-negative integer");
        }
    }

    if (config.algorithms !== undefined) {
        if (!Array.isArray(config.algorithms)) {
            errors.push("Algorithms must be an array");
        } else {
            const validAlgorithms = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"];
            for (const alg of config.algorithms) {
                if (!validAlgorithms.includes(alg)) {
                    errors.push(`Invalid algorithm: ${alg}. Must be one of: ${validAlgorithms.join(", ")}`);
                }
            }
        }
    }

    if (config.circuitBreakerThreshold !== undefined) {
        const threshold = parseInt(config.circuitBreakerThreshold, 10);
        if (isNaN(threshold) || threshold < 1) {
            errors.push("Circuit breaker threshold must be a positive integer");
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Base64url decode
 * @param {string} str - Base64url encoded string
 * @returns {Buffer} Decoded buffer
 */
function base64urlDecode(str) {
    // Replace URL-safe characters with standard base64 characters
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    while (base64.length % 4) {
        base64 += "=";
    }
    return Buffer.from(base64, "base64");
}

/**
 * Decode JWT without verification (for header/payload extraction)
 * @param {string} token - JWT token
 * @returns {{header: Object, payload: Object, signature: Buffer, signedContent: string}}
 */
function decodeJwt(token) {
    if (!token || typeof token !== "string") {
        throw new Error("Token must be a non-empty string");
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid JWT format: expected 3 parts");
    }

    try {
        const header = JSON.parse(base64urlDecode(parts[0]).toString("utf8"));
        const payload = JSON.parse(base64urlDecode(parts[1]).toString("utf8"));
        const signature = base64urlDecode(parts[2]);
        const signedContent = parts[0] + "." + parts[1];

        return { header, payload, signature, signedContent };
    } catch (err) {
        throw new Error("Invalid JWT encoding: " + err.message);
    }
}

/**
 * Convert JWK to PEM format for RSA keys
 * @param {Object} jwk - JWK object
 * @returns {string} PEM formatted public key
 */
function jwkToPem(jwk) {
    if (jwk.kty !== "RSA") {
        throw new Error(`Unsupported key type: ${jwk.kty}. Only RSA keys are supported.`);
    }

    const n = base64urlDecode(jwk.n);
    const e = base64urlDecode(jwk.e);

    // Build the RSA public key in DER format
    const derKey = buildRsaPublicKeyDer(n, e);

    // Wrap in PEM format
    const base64Der = derKey.toString("base64");
    const lines = [];
    lines.push("-----BEGIN PUBLIC KEY-----");
    for (let i = 0; i < base64Der.length; i += 64) {
        lines.push(base64Der.substring(i, i + 64));
    }
    lines.push("-----END PUBLIC KEY-----");

    return lines.join("\n");
}

/**
 * Build RSA public key in DER format
 * @param {Buffer} n - Modulus
 * @param {Buffer} e - Exponent
 * @returns {Buffer} DER encoded public key
 */
function buildRsaPublicKeyDer(n, e) {
    // Add leading zero if high bit is set (to ensure positive integer)
    const nPadded = n[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), n]) : n;
    const ePadded = e[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), e]) : e;

    // Build INTEGER for n
    const nInt = Buffer.concat([
        Buffer.from([0x02]), // INTEGER tag
        encodeLength(nPadded.length),
        nPadded
    ]);

    // Build INTEGER for e
    const eInt = Buffer.concat([
        Buffer.from([0x02]), // INTEGER tag
        encodeLength(ePadded.length),
        ePadded
    ]);

    // Build SEQUENCE for RSAPublicKey
    const rsaPublicKey = Buffer.concat([
        Buffer.from([0x30]), // SEQUENCE tag
        encodeLength(nInt.length + eInt.length),
        nInt,
        eInt
    ]);

    // Build BIT STRING wrapping the RSAPublicKey
    const bitString = Buffer.concat([
        Buffer.from([0x03]), // BIT STRING tag
        encodeLength(rsaPublicKey.length + 1),
        Buffer.from([0x00]), // No unused bits
        rsaPublicKey
    ]);

    // RSA OID: 1.2.840.113549.1.1.1
    const rsaOid = Buffer.from([
        0x06, 0x09, // OID tag + length
        0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01
    ]);

    // NULL parameters
    const nullParams = Buffer.from([0x05, 0x00]);

    // Algorithm identifier SEQUENCE
    const algorithmSeq = Buffer.concat([
        Buffer.from([0x30]), // SEQUENCE tag
        encodeLength(rsaOid.length + nullParams.length),
        rsaOid,
        nullParams
    ]);

    // Final SubjectPublicKeyInfo SEQUENCE
    const spki = Buffer.concat([
        Buffer.from([0x30]), // SEQUENCE tag
        encodeLength(algorithmSeq.length + bitString.length),
        algorithmSeq,
        bitString
    ]);

    return spki;
}

/**
 * Encode DER length
 * @param {number} length - Length to encode
 * @returns {Buffer} Encoded length
 */
function encodeLength(length) {
    if (length < 128) {
        return Buffer.from([length]);
    } else if (length < 256) {
        return Buffer.from([0x81, length]);
    } else if (length < 65536) {
        return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
    } else {
        throw new Error("Length too large to encode");
    }
}

/**
 * Get signature algorithm from JWT algorithm
 * @param {string} alg - JWT algorithm (RS256, RS384, RS512)
 * @returns {string} Node.js crypto algorithm name
 */
function getSignatureAlgorithm(alg) {
    const algorithms = {
        RS256: "RSA-SHA256",
        RS384: "RSA-SHA384",
        RS512: "RSA-SHA512",
        PS256: "RSA-SHA256",
        PS384: "RSA-SHA384",
        PS512: "RSA-SHA512"
    };

    const result = algorithms[alg];
    if (!result) {
        throw new Error(`Unsupported algorithm: ${alg}`);
    }
    return result;
}

/**
 * Keycloak/OAuth2 Client
 * Provides JWT validation, JWKS retrieval, token introspection, and health checks
 */
class KeycloakClient extends EventEmitter {
    /**
     * Create a new Keycloak Client
     * @param {Object} options - Configuration options
     * @param {string} [options.keycloakUrl='http://localhost:8080'] - Keycloak server URL
     * @param {string} [options.realm='master'] - Keycloak realm
     * @param {string} [options.clientId] - Client ID for introspection
     * @param {string} [options.clientSecret] - Client secret for introspection
     * @param {number} [options.timeout=5000] - Request timeout in ms
     * @param {number} [options.jwksRefreshInterval=3600000] - JWKS refresh interval in ms
     * @param {boolean} [options.jwksCacheEnabled=true] - Enable JWKS caching
     * @param {number} [options.jwksMinRefreshInterval=30000] - Minimum time between JWKS refreshes
     * @param {boolean} [options.validateIssuer=true] - Validate token issuer
     * @param {boolean} [options.validateAudience=false] - Validate token audience
     * @param {string} [options.audience] - Expected audience
     * @param {number} [options.clockTolerance=0] - Clock tolerance in seconds
     * @param {Array<string>} [options.algorithms=['RS256','RS384','RS512']] - Allowed algorithms
     * @param {number} [options.retryAttempts=3] - Number of retry attempts
     * @param {boolean} [options.circuitBreakerEnabled=true] - Enable circuit breaker
     * @param {Function} [options.fetchFn] - Custom fetch function (for testing)
     */
    constructor(options = {}) {
        super();
        this.config = { ...DEFAULT_KEYCLOAK_CONFIG, ...options };

        // HTTP client
        this._fetch = options.fetchFn || globalThis.fetch;

        // JWKS cache
        this._jwksCache = null;
        this._jwksCacheTime = null;
        this._jwksRefreshing = false;
        this._jwksRefreshPromise = null;

        // Key ID to PEM cache (derived from JWKS)
        this._keyCache = new Map();

        // Circuit breaker state
        this._circuitState = CircuitState.CLOSED;
        this._failureCount = 0;
        this._successCount = 0;
        this._lastFailureTime = null;
        this._circuitOpenTime = null;

        // Statistics
        this._stats = {
            totalValidations: 0,
            successfulValidations: 0,
            failedValidations: 0,
            jwksRefreshes: 0,
            jwksRefreshFailures: 0,
            introspections: 0,
            introspectionFailures: 0,
            cacheHits: 0,
            cacheMisses: 0,
            circuitBreakerTrips: 0
        };

        // Auto-refresh timer
        this._refreshTimer = null;
    }

    /**
     * Get current circuit breaker state
     * @returns {string} Circuit state
     */
    get circuitState() {
        return this._circuitState;
    }

    /**
     * Check if circuit breaker is open
     * @returns {boolean}
     */
    get isCircuitOpen() {
        return this._circuitState === CircuitState.OPEN;
    }

    /**
     * Get the OIDC well-known URL
     * @returns {string}
     */
    getWellKnownUrl() {
        return `${this.config.keycloakUrl.replace(/\/$/, "")}/realms/${this.config.realm}/.well-known/openid-configuration`;
    }

    /**
     * Get the JWKS URL
     * @returns {string}
     */
    getJwksUrl() {
        return `${this.config.keycloakUrl.replace(/\/$/, "")}/realms/${this.config.realm}/protocol/openid-connect/certs`;
    }

    /**
     * Get the token introspection URL
     * @returns {string}
     */
    getIntrospectionUrl() {
        return `${this.config.keycloakUrl.replace(/\/$/, "")}/realms/${this.config.realm}/protocol/openid-connect/token/introspect`;
    }

    /**
     * Get the expected issuer URL
     * @returns {string}
     */
    getExpectedIssuer() {
        return `${this.config.keycloakUrl.replace(/\/$/, "")}/realms/${this.config.realm}`;
    }

    /**
     * Calculate backoff delay with jitter
     * @param {number} attempt - Current attempt number (0-based)
     * @returns {number} Delay in milliseconds
     * @private
     */
    _calculateBackoff(attempt) {
        const baseDelay = Math.min(
            this.config.initialBackoff * Math.pow(this.config.backoffMultiplier, attempt),
            this.config.maxBackoff
        );
        const jitter = baseDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
        return Math.round(baseDelay + jitter);
    }

    /**
     * Check circuit breaker state and update if needed
     * @returns {boolean} True if request should proceed
     * @private
     */
    _checkCircuitBreaker() {
        if (!this.config.circuitBreakerEnabled) {
            return true;
        }

        const now = Date.now();

        switch (this._circuitState) {
        case CircuitState.CLOSED:
            return true;

        case CircuitState.OPEN:
            // Check if timeout has passed
            if (this._circuitOpenTime &&
                    now - this._circuitOpenTime >= this.config.circuitBreakerTimeout) {
                this._circuitState = CircuitState.HALF_OPEN;
                this._successCount = 0;
                this.emit("circuitHalfOpen", {
                    previousState: CircuitState.OPEN,
                    currentState: CircuitState.HALF_OPEN
                });
                return true;
            }
            return false;

        case CircuitState.HALF_OPEN:
            return true;

        default:
            return true;
        }
    }

    /**
     * Record a successful request for circuit breaker
     * @private
     */
    _recordSuccess() {
        if (!this.config.circuitBreakerEnabled) {
            return;
        }

        this._successCount++;
        this._failureCount = 0;

        if (this._circuitState === CircuitState.HALF_OPEN &&
            this._successCount >= this.config.circuitBreakerSuccessThreshold) {
            this._circuitState = CircuitState.CLOSED;
            this._circuitOpenTime = null;
            this.emit("circuitClosed", {
                previousState: CircuitState.HALF_OPEN,
                currentState: CircuitState.CLOSED
            });
        }
    }

    /**
     * Record a failed request for circuit breaker
     * @private
     */
    _recordFailure() {
        if (!this.config.circuitBreakerEnabled) {
            return;
        }

        this._failureCount++;
        this._successCount = 0;
        this._lastFailureTime = Date.now();

        // If in half-open, immediately open
        if (this._circuitState === CircuitState.HALF_OPEN) {
            this._openCircuit();
            return;
        }

        // Check if threshold reached
        if (this._circuitState === CircuitState.CLOSED &&
            this._failureCount >= this.config.circuitBreakerThreshold) {
            this._openCircuit();
        }
    }

    /**
     * Open the circuit breaker
     * @private
     */
    _openCircuit() {
        const previousState = this._circuitState;
        this._circuitState = CircuitState.OPEN;
        this._circuitOpenTime = Date.now();
        this._stats.circuitBreakerTrips++;

        this.emit("circuitOpen", {
            previousState,
            currentState: CircuitState.OPEN,
            failureCount: this._failureCount
        });
    }

    /**
     * Manually reset the circuit breaker
     */
    resetCircuitBreaker() {
        const previousState = this._circuitState;
        this._circuitState = CircuitState.CLOSED;
        this._failureCount = 0;
        this._successCount = 0;
        this._circuitOpenTime = null;

        this.emit("circuitReset", {
            previousState,
            currentState: CircuitState.CLOSED
        });
    }

    /**
     * Make HTTP request with timeout
     * @param {string} url - Request URL
     * @param {Object} options - Fetch options
     * @returns {Promise<Response>} HTTP response
     * @private
     */
    async _makeRequest(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await this._fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            return response;
        } catch (err) {
            clearTimeout(timeoutId);

            if (err.name === "AbortError") {
                const error = new Error("Request timeout");
                error.code = "TIMEOUT";
                throw error;
            }

            throw err;
        }
    }

    /**
     * Fetch with retry logic
     * @param {string} url - Request URL
     * @param {Object} options - Fetch options
     * @returns {Promise<Response>} HTTP response
     * @private
     */
    async _fetchWithRetry(url, options = {}) {
        let lastError;

        for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
            // Check circuit breaker before each attempt
            if (!this._checkCircuitBreaker()) {
                const error = new Error("Circuit breaker is open");
                error.code = "CIRCUIT_OPEN";
                throw error;
            }

            try {
                const response = await this._makeRequest(url, options);

                if (!response.ok) {
                    const error = new Error(`HTTP error ${response.status}`);
                    error.statusCode = response.status;
                    throw error;
                }

                this._recordSuccess();
                return response;
            } catch (err) {
                lastError = err;

                // Don't retry on circuit breaker open
                if (err.code === "CIRCUIT_OPEN") {
                    throw err;
                }

                // Record failure for circuit breaker
                this._recordFailure();

                // Don't retry on last attempt
                if (attempt < this.config.retryAttempts) {
                    const delay = this._calculateBackoff(attempt);
                    this.emit("retry", {
                        attempt: attempt + 1,
                        maxAttempts: this.config.retryAttempts,
                        delay,
                        error: err.message
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    /**
     * Fetch JWKS from Keycloak
     * @param {boolean} [force=false] - Force refresh even if cached
     * @returns {Promise<Object>} JWKS object
     */
    async getPublicKeys(force = false) {
        const now = Date.now();

        // Return cached JWKS if valid and not forcing refresh
        if (!force && this.config.jwksCacheEnabled && this._jwksCache) {
            const cacheAge = now - this._jwksCacheTime;
            if (cacheAge < this.config.jwksRefreshInterval) {
                this._stats.cacheHits++;
                return this._jwksCache;
            }
        }

        // If already refreshing, wait for that to complete
        if (this._jwksRefreshing && this._jwksRefreshPromise) {
            return this._jwksRefreshPromise;
        }

        // Prevent refresh spam
        if (!force && this._jwksCacheTime) {
            const timeSinceLastRefresh = now - this._jwksCacheTime;
            if (timeSinceLastRefresh < this.config.jwksMinRefreshInterval) {
                if (this._jwksCache) {
                    return this._jwksCache;
                }
            }
        }

        this._stats.cacheMisses++;
        this._jwksRefreshing = true;

        this._jwksRefreshPromise = this._fetchJwks()
            .finally(() => {
                this._jwksRefreshing = false;
                this._jwksRefreshPromise = null;
            });

        return this._jwksRefreshPromise;
    }

    /**
     * Internal JWKS fetch
     * @returns {Promise<Object>} JWKS object
     * @private
     */
    async _fetchJwks() {
        const url = this.getJwksUrl();

        try {
            const response = await this._fetchWithRetry(url, {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                }
            });

            const jwks = await response.json();

            // Validate JWKS format
            if (!jwks.keys || !Array.isArray(jwks.keys)) {
                throw new Error("Invalid JWKS format: missing keys array");
            }

            // Update cache
            this._jwksCache = jwks;
            this._jwksCacheTime = Date.now();
            this._stats.jwksRefreshes++;

            // Update key cache
            this._keyCache.clear();
            for (const key of jwks.keys) {
                if (key.kid && key.kty === "RSA") {
                    try {
                        const pem = jwkToPem(key);
                        this._keyCache.set(key.kid, {
                            pem,
                            alg: key.alg,
                            use: key.use
                        });
                    } catch (err) {
                        this.emit("keyConversionError", { kid: key.kid, error: err.message });
                    }
                }
            }

            this.emit("jwksRefreshed", {
                keyCount: jwks.keys.length,
                keyIds: jwks.keys.map(k => k.kid).filter(Boolean)
            });

            return jwks;
        } catch (err) {
            this._stats.jwksRefreshFailures++;
            this.emit("jwksRefreshError", { error: err.message });
            throw err;
        }
    }

    /**
     * Get a specific key by ID
     * @param {string} kid - Key ID
     * @returns {Promise<{pem: string, alg: string, use: string}|null>}
     */
    async getKey(kid) {
        // Check key cache first
        if (this._keyCache.has(kid)) {
            return this._keyCache.get(kid);
        }

        // Try to refresh JWKS
        await this.getPublicKeys(false);

        // Check again after refresh
        if (this._keyCache.has(kid)) {
            return this._keyCache.get(kid);
        }

        // Force refresh as last resort (key rotation may have occurred)
        await this.getPublicKeys(true);

        return this._keyCache.get(kid) || null;
    }

    /**
     * Validate a JWT token
     * @param {string} token - JWT token to validate
     * @returns {Promise<{valid: boolean, payload?: Object, error?: string}>}
     */
    async validateToken(token) {
        this._stats.totalValidations++;

        try {
            // Decode token
            const { header, payload, signature, signedContent } = decodeJwt(token);

            // Validate algorithm
            if (!this.config.algorithms.includes(header.alg)) {
                return {
                    valid: false,
                    error: `Algorithm ${header.alg} not allowed`
                };
            }

            // Get signing key
            if (!header.kid) {
                return {
                    valid: false,
                    error: "Token missing key ID (kid)"
                };
            }

            const keyData = await this.getKey(header.kid);
            if (!keyData) {
                return {
                    valid: false,
                    error: `Key not found: ${header.kid}`
                };
            }

            // Verify signature
            const signatureValid = this._verifySignature(
                signedContent,
                signature,
                keyData.pem,
                header.alg
            );

            if (!signatureValid) {
                this._stats.failedValidations++;
                return {
                    valid: false,
                    error: "Invalid signature"
                };
            }

            // Validate claims
            const claimsResult = this._validateClaims(payload);
            if (!claimsResult.valid) {
                this._stats.failedValidations++;
                return claimsResult;
            }

            this._stats.successfulValidations++;
            return {
                valid: true,
                payload
            };
        } catch (err) {
            this._stats.failedValidations++;
            return {
                valid: false,
                error: err.message
            };
        }
    }

    /**
     * Verify JWT signature
     * @param {string} signedContent - The signed content (header.payload)
     * @param {Buffer} signature - The signature to verify
     * @param {string} pem - Public key in PEM format
     * @param {string} alg - JWT algorithm
     * @returns {boolean} True if signature is valid
     * @private
     */
    _verifySignature(signedContent, signature, pem, alg) {
        try {
            const algorithm = getSignatureAlgorithm(alg);
            const verifier = crypto.createVerify(algorithm);
            verifier.update(signedContent);

            // Handle PSS padding for PS* algorithms
            if (alg.startsWith("PS")) {
                return verifier.verify({
                    key: pem,
                    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
                }, signature);
            }

            return verifier.verify(pem, signature);
        } catch (err) {
            return false;
        }
    }

    /**
     * Validate JWT claims
     * @param {Object} payload - JWT payload
     * @returns {{valid: boolean, error?: string}}
     * @private
     */
    _validateClaims(payload) {
        const now = Math.floor(Date.now() / 1000);
        const tolerance = this.config.clockTolerance || 0;

        // Validate expiration
        if (payload.exp !== undefined) {
            if (now > payload.exp + tolerance) {
                return {
                    valid: false,
                    error: "Token expired"
                };
            }
        }

        // Validate not before
        if (payload.nbf !== undefined) {
            if (now < payload.nbf - tolerance) {
                return {
                    valid: false,
                    error: "Token not yet valid"
                };
            }
        }

        // Validate issued at (with tolerance)
        if (payload.iat !== undefined) {
            if (now < payload.iat - tolerance) {
                return {
                    valid: false,
                    error: "Token issued in the future"
                };
            }
        }

        // Validate issuer
        if (this.config.validateIssuer) {
            const expectedIssuer = this.getExpectedIssuer();
            if (payload.iss !== expectedIssuer) {
                return {
                    valid: false,
                    error: `Invalid issuer. Expected: ${expectedIssuer}, got: ${payload.iss}`
                };
            }
        }

        // Validate audience
        if (this.config.validateAudience && this.config.audience) {
            const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
            const expectedAudiences = Array.isArray(this.config.audience)
                ? this.config.audience
                : [this.config.audience];

            const hasValidAudience = expectedAudiences.some(exp => audiences.includes(exp));
            if (!hasValidAudience) {
                return {
                    valid: false,
                    error: `Invalid audience. Expected one of: ${expectedAudiences.join(", ")}`
                };
            }
        }

        return { valid: true };
    }

    /**
     * Extract user information from JWT
     * @param {string} token - JWT token
     * @returns {{user: Object|null, error?: string}}
     */
    extractUserInfo(token) {
        try {
            const { payload } = decodeJwt(token);

            const user = {
                sub: payload.sub,
                preferredUsername: payload.preferred_username,
                email: payload.email,
                emailVerified: payload.email_verified,
                name: payload.name,
                givenName: payload.given_name,
                familyName: payload.family_name,
                roles: this._extractRoles(payload),
                groups: payload.groups || [],
                scope: payload.scope ? payload.scope.split(" ") : [],
                clientId: payload.azp || payload.client_id,
                sessionState: payload.session_state,
                issuedAt: payload.iat ? new Date(payload.iat * 1000) : null,
                expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
                // Include any custom claims
                customClaims: this._extractCustomClaims(payload)
            };

            return { user };
        } catch (err) {
            return {
                user: null,
                error: err.message
            };
        }
    }

    /**
     * Extract roles from JWT payload
     * @param {Object} payload - JWT payload
     * @returns {Array<string>} List of roles
     * @private
     */
    _extractRoles(payload) {
        const roles = new Set();

        // Realm roles
        if (payload.realm_access?.roles) {
            for (const role of payload.realm_access.roles) {
                roles.add(role);
            }
        }

        // Resource roles (client-specific)
        if (payload.resource_access) {
            for (const [resource, access] of Object.entries(payload.resource_access)) {
                if (access.roles) {
                    for (const role of access.roles) {
                        roles.add(`${resource}:${role}`);
                    }
                }
            }
        }

        // Direct roles claim
        if (Array.isArray(payload.roles)) {
            for (const role of payload.roles) {
                roles.add(role);
            }
        }

        return Array.from(roles);
    }

    /**
     * Extract custom claims from JWT payload
     * @param {Object} payload - JWT payload
     * @returns {Object} Custom claims
     * @private
     */
    _extractCustomClaims(payload) {
        const standardClaims = new Set([
            "iss", "sub", "aud", "exp", "nbf", "iat", "jti",
            "preferred_username", "email", "email_verified",
            "name", "given_name", "family_name",
            "realm_access", "resource_access", "roles", "groups",
            "scope", "azp", "client_id", "session_state",
            "typ", "acr", "auth_time", "sid", "at_hash", "nonce"
        ]);

        const custom = {};
        for (const [key, value] of Object.entries(payload)) {
            if (!standardClaims.has(key)) {
                custom[key] = value;
            }
        }

        return custom;
    }

    /**
     * Introspect a token (for opaque tokens or additional validation)
     * @param {string} token - Token to introspect
     * @returns {Promise<{active: boolean, payload?: Object, error?: string}>}
     */
    async introspectToken(token) {
        this._stats.introspections++;

        if (!this.config.clientId || !this.config.clientSecret) {
            return {
                active: false,
                error: "Client ID and secret required for introspection"
            };
        }

        try {
            // Check circuit breaker
            if (!this._checkCircuitBreaker()) {
                const error = new Error("Circuit breaker is open");
                error.code = "CIRCUIT_OPEN";
                throw error;
            }

            const url = this.getIntrospectionUrl();
            const credentials = Buffer.from(
                `${this.config.clientId}:${this.config.clientSecret}`
            ).toString("base64");

            const response = await this._makeRequest(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": `Basic ${credentials}`
                },
                body: `token=${encodeURIComponent(token)}`
            });

            if (!response.ok) {
                this._recordFailure();
                this._stats.introspectionFailures++;
                return {
                    active: false,
                    error: `Introspection failed with status ${response.status}`
                };
            }

            this._recordSuccess();
            const result = await response.json();

            return {
                active: result.active === true,
                payload: result.active ? result : undefined
            };
        } catch (err) {
            this._stats.introspectionFailures++;
            return {
                active: false,
                error: err.message
            };
        }
    }

    /**
     * Check Keycloak server health
     * @returns {Promise<{healthy: boolean, message: string, details?: Object}>}
     */
    async getHealthStatus() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        // Try the realm's well-known endpoint
        const url = this.getWellKnownUrl();

        try {
            const response = await this._fetch(url, {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                const config = await response.json();
                return {
                    healthy: true,
                    message: "Keycloak server is healthy",
                    details: {
                        url: this.config.keycloakUrl,
                        realm: this.config.realm,
                        issuer: config.issuer,
                        circuitState: this._circuitState,
                        jwksCached: this._jwksCache !== null,
                        cachedKeyCount: this._keyCache.size
                    }
                };
            } else {
                return {
                    healthy: false,
                    message: `Keycloak returned status ${response.status}`,
                    details: {
                        statusCode: response.status,
                        circuitState: this._circuitState
                    }
                };
            }
        } catch (err) {
            clearTimeout(timeoutId);
            return {
                healthy: false,
                message: err.name === "AbortError" ? "Keycloak health check timeout" : err.message,
                details: {
                    url: this.config.keycloakUrl,
                    realm: this.config.realm,
                    error: err.message,
                    circuitState: this._circuitState
                }
            };
        }
    }

    /**
     * Start automatic JWKS refresh
     * @param {number} [interval] - Refresh interval in ms (defaults to config)
     */
    startAutoRefresh(interval) {
        this.stopAutoRefresh();

        const refreshInterval = interval || this.config.jwksRefreshInterval;
        this._refreshTimer = setInterval(async () => {
            try {
                await this.getPublicKeys(true);
            } catch (err) {
                this.emit("autoRefreshError", { error: err.message });
            }
        }, refreshInterval);

        if (this._refreshTimer.unref) {
            this._refreshTimer.unref();
        }

        this.emit("autoRefreshStarted", { interval: refreshInterval });
    }

    /**
     * Stop automatic JWKS refresh
     */
    stopAutoRefresh() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
            this.emit("autoRefreshStopped");
        }
    }

    /**
     * Get client statistics
     * @returns {Object} Statistics object
     */
    getStatistics() {
        return {
            config: {
                keycloakUrl: this.config.keycloakUrl,
                realm: this.config.realm,
                timeout: this.config.timeout,
                algorithms: this.config.algorithms,
                validateIssuer: this.config.validateIssuer,
                validateAudience: this.config.validateAudience,
                circuitBreakerEnabled: this.config.circuitBreakerEnabled
            },
            current: {
                jwksCached: this._jwksCache !== null,
                cachedKeyCount: this._keyCache.size,
                jwksCacheAge: this._jwksCacheTime
                    ? Math.floor((Date.now() - this._jwksCacheTime) / 1000)
                    : null,
                circuitState: this._circuitState,
                failureCount: this._failureCount,
                successCount: this._successCount,
                autoRefreshEnabled: this._refreshTimer !== null
            },
            cumulative: {
                totalValidations: this._stats.totalValidations,
                successfulValidations: this._stats.successfulValidations,
                failedValidations: this._stats.failedValidations,
                validationSuccessRate: this._stats.totalValidations > 0
                    ? ((this._stats.successfulValidations / this._stats.totalValidations) * 100).toFixed(2) + "%"
                    : "0%",
                jwksRefreshes: this._stats.jwksRefreshes,
                jwksRefreshFailures: this._stats.jwksRefreshFailures,
                introspections: this._stats.introspections,
                introspectionFailures: this._stats.introspectionFailures,
                cacheHits: this._stats.cacheHits,
                cacheMisses: this._stats.cacheMisses,
                circuitBreakerTrips: this._stats.circuitBreakerTrips
            }
        };
    }

    /**
     * Clear JWKS cache
     */
    clearCache() {
        this._jwksCache = null;
        this._jwksCacheTime = null;
        this._keyCache.clear();
        this.emit("cacheCleared");
    }

    /**
     * Gracefully shutdown the Keycloak client
     */
    shutdown() {
        this.stopAutoRefresh();

        this._jwksCache = null;
        this._jwksCacheTime = null;
        this._keyCache.clear();

        this._circuitState = CircuitState.CLOSED;
        this._failureCount = 0;
        this._successCount = 0;
        this._circuitOpenTime = null;

        this.emit("shutdown");
        this.removeAllListeners();
    }
}

module.exports = {
    CircuitState,
    KeycloakClient,
    DEFAULT_KEYCLOAK_CONFIG,
    validateKeycloakConfig,
    decodeJwt,
    jwkToPem
};
