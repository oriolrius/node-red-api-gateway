const should = require("should");
const sinon = require("sinon");
const crypto = require("crypto");
const {
    CircuitState,
    KeycloakClient,
    DEFAULT_KEYCLOAK_CONFIG,
    validateKeycloakConfig,
    decodeJwt,
    jwkToPem
} = require("../../lib/keycloak-client");

// Test key pair generation for JWT signing
function generateTestKeyPair() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    return { privateKey, publicKey };
}

// Convert PEM public key to JWK format
function pemToJwk(pem, kid = "test-key-1") {
    const keyObj = crypto.createPublicKey(pem);
    const jwk = keyObj.export({ format: "jwk" });
    return {
        ...jwk,
        kid,
        use: "sig",
        alg: "RS256"
    };
}

// Create a signed JWT for testing
function createTestJwt(payload, privateKey, kid = "test-key-1", alg = "RS256") {
    const header = { alg, typ: "JWT", kid };

    const base64urlEncode = (obj) => {
        const json = JSON.stringify(obj);
        return Buffer.from(json)
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "");
    };

    const headerB64 = base64urlEncode(header);
    const payloadB64 = base64urlEncode(payload);
    const signedContent = `${headerB64}.${payloadB64}`;

    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signedContent);
    const signature = sign.sign(privateKey);
    const signatureB64 = signature
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

    return `${signedContent}.${signatureB64}`;
}

describe("CircuitState", function() {
    it("should have correct state values", function() {
        CircuitState.CLOSED.should.equal("closed");
        CircuitState.OPEN.should.equal("open");
        CircuitState.HALF_OPEN.should.equal("half_open");
    });
});

describe("DEFAULT_KEYCLOAK_CONFIG", function() {
    it("should have expected default values", function() {
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("keycloakUrl", "http://localhost:8080");
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("realm", "master");
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("timeout", 5000);
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("jwksRefreshInterval", 3600000);
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("jwksCacheEnabled", true);
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("validateIssuer", true);
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("validateAudience", false);
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("clockTolerance", 0);
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("retryAttempts", 3);
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("circuitBreakerEnabled", true);
        DEFAULT_KEYCLOAK_CONFIG.should.have.property("circuitBreakerThreshold", 5);
        DEFAULT_KEYCLOAK_CONFIG.algorithms.should.deepEqual(["RS256", "RS384", "RS512"]);
    });
});

describe("validateKeycloakConfig", function() {
    it("should validate correct config", function() {
        const result = validateKeycloakConfig({
            keycloakUrl: "http://localhost:8080",
            realm: "myrealm",
            timeout: 5000
        });
        result.valid.should.be.true();
        result.errors.should.be.empty();
    });

    it("should reject invalid keycloakUrl", function() {
        const result = validateKeycloakConfig({ keycloakUrl: 123 });
        result.valid.should.be.false();
        result.errors.should.containEql("Keycloak URL must be a string");
    });

    it("should reject invalid realm", function() {
        const result = validateKeycloakConfig({ realm: 123 });
        result.valid.should.be.false();
        result.errors.should.containEql("Realm must be a string");
    });

    it("should reject invalid timeout", function() {
        const result = validateKeycloakConfig({ timeout: -1 });
        result.valid.should.be.false();
        result.errors.should.containEql("Timeout must be a non-negative integer");
    });

    it("should reject invalid retryAttempts", function() {
        const result = validateKeycloakConfig({ retryAttempts: -5 });
        result.valid.should.be.false();
        result.errors.should.containEql("Retry attempts must be a non-negative integer");
    });

    it("should reject invalid jwksRefreshInterval", function() {
        const result = validateKeycloakConfig({ jwksRefreshInterval: 500 });
        result.valid.should.be.false();
        result.errors.should.containEql("JWKS refresh interval must be at least 1000ms");
    });

    it("should reject invalid clockTolerance", function() {
        const result = validateKeycloakConfig({ clockTolerance: -10 });
        result.valid.should.be.false();
        result.errors.should.containEql("Clock tolerance must be a non-negative integer");
    });

    it("should reject invalid algorithms array", function() {
        const result = validateKeycloakConfig({ algorithms: "RS256" });
        result.valid.should.be.false();
        result.errors.should.containEql("Algorithms must be an array");
    });

    it("should reject invalid algorithm values", function() {
        const result = validateKeycloakConfig({ algorithms: ["RS256", "INVALID"] });
        result.valid.should.be.false();
        result.errors.some(e => e.includes("Invalid algorithm")).should.be.true();
    });

    it("should accept valid algorithms", function() {
        const result = validateKeycloakConfig({
            algorithms: ["RS256", "RS384", "RS512", "PS256"]
        });
        result.valid.should.be.true();
    });

    it("should reject invalid circuitBreakerThreshold", function() {
        const result = validateKeycloakConfig({ circuitBreakerThreshold: 0 });
        result.valid.should.be.false();
        result.errors.should.containEql("Circuit breaker threshold must be a positive integer");
    });
});

describe("decodeJwt", function() {
    it("should decode a valid JWT", function() {
        const { privateKey } = generateTestKeyPair();
        const payload = { sub: "user123", exp: Math.floor(Date.now() / 1000) + 3600 };
        const token = createTestJwt(payload, privateKey);

        const decoded = decodeJwt(token);
        decoded.should.have.property("header");
        decoded.should.have.property("payload");
        decoded.should.have.property("signature");
        decoded.should.have.property("signedContent");
        decoded.header.should.have.property("alg", "RS256");
        decoded.header.should.have.property("typ", "JWT");
        decoded.payload.should.have.property("sub", "user123");
    });

    it("should reject non-string token", function() {
        (() => decodeJwt(null)).should.throw("Token must be a non-empty string");
        (() => decodeJwt(123)).should.throw("Token must be a non-empty string");
        (() => decodeJwt("")).should.throw("Token must be a non-empty string");
    });

    it("should reject token with wrong number of parts", function() {
        (() => decodeJwt("a.b")).should.throw("Invalid JWT format: expected 3 parts");
        (() => decodeJwt("a.b.c.d")).should.throw("Invalid JWT format: expected 3 parts");
    });

    it("should reject token with invalid encoding", function() {
        (() => decodeJwt("!!!.@@@.###")).should.throw(/Invalid JWT encoding/);
    });
});

describe("jwkToPem", function() {
    it("should convert JWK to PEM format", function() {
        const { publicKey } = generateTestKeyPair();
        const jwk = pemToJwk(publicKey);

        const pem = jwkToPem(jwk);
        pem.should.startWith("-----BEGIN PUBLIC KEY-----");
        pem.should.endWith("-----END PUBLIC KEY-----");
    });

    it("should reject non-RSA keys", function() {
        (() => jwkToPem({ kty: "EC" })).should.throw(/Unsupported key type: EC/);
    });

    it("should produce a key that verifies signatures", function() {
        const { privateKey, publicKey } = generateTestKeyPair();
        const jwk = pemToJwk(publicKey);
        const pem = jwkToPem(jwk);

        // Sign some data
        const sign = crypto.createSign("RSA-SHA256");
        sign.update("test data");
        const signature = sign.sign(privateKey);

        // Verify with converted PEM
        const verify = crypto.createVerify("RSA-SHA256");
        verify.update("test data");
        verify.verify(pem, signature).should.be.true();
    });
});

describe("KeycloakClient", function() {
    this.timeout(10000); // Increase timeout for key generation

    let client;
    let mockFetch;
    let testKeys;
    let clock;

    beforeEach(function() {
        mockFetch = sinon.stub();
        testKeys = generateTestKeyPair();

        client = new KeycloakClient({
            keycloakUrl: "http://localhost:8080",
            realm: "test-realm",
            fetchFn: mockFetch,
            retryAttempts: 2,
            initialBackoff: 100,
            maxBackoff: 1000,
            circuitBreakerThreshold: 3,
            validateIssuer: false // Disable for easier testing
        });
    });

    afterEach(function() {
        if (client) {
            client.shutdown();
        }
        if (clock) {
            clock.restore();
            clock = null;
        }
    });

    describe("initialization", function() {
        it("should use default config when no options provided", function() {
            const defaultClient = new KeycloakClient({ fetchFn: mockFetch });
            defaultClient.config.should.have.property("keycloakUrl", DEFAULT_KEYCLOAK_CONFIG.keycloakUrl);
            defaultClient.config.should.have.property("realm", DEFAULT_KEYCLOAK_CONFIG.realm);
            defaultClient.config.should.have.property("timeout", DEFAULT_KEYCLOAK_CONFIG.timeout);
            defaultClient.shutdown();
        });

        it("should allow custom config options", function() {
            client.config.should.have.property("keycloakUrl", "http://localhost:8080");
            client.config.should.have.property("realm", "test-realm");
            client.config.should.have.property("retryAttempts", 2);
        });

        it("should start with circuit breaker closed", function() {
            client.circuitState.should.equal(CircuitState.CLOSED);
            client.isCircuitOpen.should.be.false();
        });
    });

    describe("URL generation", function() {
        it("should generate correct JWKS URL", function() {
            client.getJwksUrl().should.equal(
                "http://localhost:8080/realms/test-realm/protocol/openid-connect/certs"
            );
        });

        it("should generate correct well-known URL", function() {
            client.getWellKnownUrl().should.equal(
                "http://localhost:8080/realms/test-realm/.well-known/openid-configuration"
            );
        });

        it("should generate correct introspection URL", function() {
            client.getIntrospectionUrl().should.equal(
                "http://localhost:8080/realms/test-realm/protocol/openid-connect/token/introspect"
            );
        });

        it("should generate correct expected issuer", function() {
            client.getExpectedIssuer().should.equal(
                "http://localhost:8080/realms/test-realm"
            );
        });

        it("should handle trailing slash in keycloakUrl", function() {
            const trailingClient = new KeycloakClient({
                fetchFn: mockFetch,
                keycloakUrl: "http://localhost:8080/",
                realm: "test"
            });

            trailingClient.getJwksUrl().should.equal(
                "http://localhost:8080/realms/test/protocol/openid-connect/certs"
            );
            trailingClient.shutdown();
        });
    });

    describe("getPublicKeys", function() {
        it("should fetch JWKS from Keycloak", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            const jwks = await client.getPublicKeys();

            jwks.should.have.property("keys");
            jwks.keys.should.have.length(1);
            jwks.keys[0].should.have.property("kid", "test-key-1");
            mockFetch.calledOnce.should.be.true();
        });

        it("should cache JWKS", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            await client.getPublicKeys();
            await client.getPublicKeys();

            // Only one fetch call due to caching
            mockFetch.calledOnce.should.be.true();
        });

        it("should force refresh when requested", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            await client.getPublicKeys();
            await client.getPublicKeys(true);

            mockFetch.calledTwice.should.be.true();
        });

        it("should emit jwksRefreshed event", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            let event = null;
            client.on("jwksRefreshed", e => { event = e; });

            await client.getPublicKeys();

            event.should.not.be.null();
            event.should.have.property("keyCount", 1);
            event.keyIds.should.containEql("test-key-1");
        });

        it("should throw on invalid JWKS format", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ invalid: "format" })
            });

            try {
                await client.getPublicKeys();
                should.fail("Expected error");
            } catch (err) {
                err.message.should.containEql("Invalid JWKS format");
            }
        });

        it("should emit error event on fetch failure", async function() {
            mockFetch.rejects(new Error("Network error"));

            let errorEvent = null;
            client.on("jwksRefreshError", e => { errorEvent = e; });

            try {
                await client.getPublicKeys();
            } catch (err) {
                // Expected
            }

            errorEvent.should.not.be.null();
            errorEvent.should.have.property("error", "Network error");
        });

        it("should update key cache from JWKS", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            await client.getPublicKeys();

            const key = await client.getKey("test-key-1");
            key.should.not.be.null();
            key.should.have.property("pem");
            key.should.have.property("alg", "RS256");
        });
    });

    describe("getKey", function() {
        it("should return key from cache", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            await client.getPublicKeys();
            const key = await client.getKey("test-key-1");

            key.should.have.property("pem");
            mockFetch.calledOnce.should.be.true(); // No additional fetch
        });

        it("should refresh JWKS if key not found", async function() {
            const jwk1 = pemToJwk(testKeys.publicKey, "key-1");
            const jwk2 = pemToJwk(testKeys.publicKey, "key-2");

            mockFetch
                .onFirstCall().resolves({
                    ok: true,
                    json: async () => ({ keys: [jwk1] })
                })
                .onSecondCall().resolves({
                    ok: true,
                    json: async () => ({ keys: [jwk1, jwk2] })
                });

            await client.getPublicKeys();
            const key = await client.getKey("key-2");

            key.should.not.be.null();
            key.should.have.property("pem");
        });

        it("should return null for unknown key after refresh", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            const key = await client.getKey("unknown-key");

            should(key).be.null();
        });
    });

    describe("validateToken", function() {
        let validPayload;
        let validToken;

        beforeEach(async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            validPayload = {
                sub: "user123",
                exp: Math.floor(Date.now() / 1000) + 3600,
                iat: Math.floor(Date.now() / 1000) - 60,
                iss: "http://localhost:8080/realms/test-realm"
            };
            validToken = createTestJwt(validPayload, testKeys.privateKey);
        });

        it("should validate a valid token", async function() {
            const result = await client.validateToken(validToken);

            result.valid.should.be.true();
            result.should.have.property("payload");
            result.payload.should.have.property("sub", "user123");
        });

        it("should reject token with invalid signature", async function() {
            // Create a token signed with a different key
            const otherKeys = generateTestKeyPair();
            const badToken = createTestJwt(validPayload, otherKeys.privateKey);

            const result = await client.validateToken(badToken);

            result.valid.should.be.false();
            result.error.should.equal("Invalid signature");
        });

        it("should reject expired token", async function() {
            const expiredPayload = {
                ...validPayload,
                exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
            };
            const expiredToken = createTestJwt(expiredPayload, testKeys.privateKey);

            const result = await client.validateToken(expiredToken);

            result.valid.should.be.false();
            result.error.should.equal("Token expired");
        });

        it("should reject token not yet valid", async function() {
            const notYetPayload = {
                ...validPayload,
                nbf: Math.floor(Date.now() / 1000) + 3600 // Valid in 1 hour
            };
            const notYetToken = createTestJwt(notYetPayload, testKeys.privateKey);

            const result = await client.validateToken(notYetToken);

            result.valid.should.be.false();
            result.error.should.equal("Token not yet valid");
        });

        it("should allow token within clock tolerance", async function() {
            const tolerantClient = new KeycloakClient({
                fetchFn: mockFetch,
                clockTolerance: 60, // 60 seconds tolerance
                validateIssuer: false
            });

            const slightlyExpiredPayload = {
                ...validPayload,
                exp: Math.floor(Date.now() / 1000) - 30 // Expired 30 seconds ago
            };
            const token = createTestJwt(slightlyExpiredPayload, testKeys.privateKey);

            const result = await tolerantClient.validateToken(token);

            result.valid.should.be.true();
            tolerantClient.shutdown();
        });

        it("should reject token with disallowed algorithm", async function() {
            const restrictedClient = new KeycloakClient({
                fetchFn: mockFetch,
                algorithms: ["RS384"], // Only RS384 allowed
                validateIssuer: false
            });

            // Token is signed with RS256
            const result = await restrictedClient.validateToken(validToken);

            result.valid.should.be.false();
            result.error.should.containEql("Algorithm RS256 not allowed");
            restrictedClient.shutdown();
        });

        it("should reject token without kid", async function() {
            // Create token without kid in header
            const header = { alg: "RS256", typ: "JWT" }; // No kid
            const base64urlEncode = (obj) => {
                const json = JSON.stringify(obj);
                return Buffer.from(json)
                    .toString("base64")
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=/g, "");
            };

            const headerB64 = base64urlEncode(header);
            const payloadB64 = base64urlEncode(validPayload);
            const signedContent = `${headerB64}.${payloadB64}`;

            const sign = crypto.createSign("RSA-SHA256");
            sign.update(signedContent);
            const signature = sign.sign(testKeys.privateKey);
            const signatureB64 = signature
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=/g, "");

            const noKidToken = `${signedContent}.${signatureB64}`;

            const result = await client.validateToken(noKidToken);

            result.valid.should.be.false();
            result.error.should.containEql("Token missing key ID");
        });

        it("should reject token with unknown key ID", async function() {
            const unknownKidToken = createTestJwt(validPayload, testKeys.privateKey, "unknown-kid");

            const result = await client.validateToken(unknownKidToken);

            result.valid.should.be.false();
            result.error.should.containEql("Key not found");
        });

        it("should validate issuer when enabled", async function() {
            const issuerClient = new KeycloakClient({
                fetchFn: mockFetch,
                keycloakUrl: "http://localhost:8080",
                realm: "test-realm",
                validateIssuer: true
            });

            const wrongIssuerPayload = {
                ...validPayload,
                iss: "http://wrong-issuer.com"
            };
            const wrongIssuerToken = createTestJwt(wrongIssuerPayload, testKeys.privateKey);

            const result = await issuerClient.validateToken(wrongIssuerToken);

            result.valid.should.be.false();
            result.error.should.containEql("Invalid issuer");
            issuerClient.shutdown();
        });

        it("should validate audience when enabled", async function() {
            const audienceClient = new KeycloakClient({
                fetchFn: mockFetch,
                validateIssuer: false,
                validateAudience: true,
                audience: "my-client"
            });

            const wrongAudiencePayload = {
                ...validPayload,
                aud: "other-client"
            };
            const wrongAudienceToken = createTestJwt(wrongAudiencePayload, testKeys.privateKey);

            const result = await audienceClient.validateToken(wrongAudienceToken);

            result.valid.should.be.false();
            result.error.should.containEql("Invalid audience");
            audienceClient.shutdown();
        });

        it("should accept token with valid audience", async function() {
            const audienceClient = new KeycloakClient({
                fetchFn: mockFetch,
                validateIssuer: false,
                validateAudience: true,
                audience: "my-client"
            });

            const correctAudiencePayload = {
                ...validPayload,
                aud: ["my-client", "other-client"]
            };
            const correctAudienceToken = createTestJwt(correctAudiencePayload, testKeys.privateKey);

            const result = await audienceClient.validateToken(correctAudienceToken);

            result.valid.should.be.true();
            audienceClient.shutdown();
        });

        it("should update statistics on validation", async function() {
            await client.validateToken(validToken);

            const stats = client.getStatistics();
            stats.cumulative.totalValidations.should.equal(1);
            stats.cumulative.successfulValidations.should.equal(1);
        });
    });

    describe("extractUserInfo", function() {
        it("should extract standard claims", function() {
            const payload = {
                sub: "user123",
                preferred_username: "testuser",
                email: "test@example.com",
                email_verified: true,
                name: "Test User",
                given_name: "Test",
                family_name: "User",
                exp: Math.floor(Date.now() / 1000) + 3600,
                iat: Math.floor(Date.now() / 1000)
            };
            const token = createTestJwt(payload, testKeys.privateKey);

            const { user } = client.extractUserInfo(token);

            user.should.have.property("sub", "user123");
            user.should.have.property("preferredUsername", "testuser");
            user.should.have.property("email", "test@example.com");
            user.should.have.property("emailVerified", true);
            user.should.have.property("name", "Test User");
            user.should.have.property("givenName", "Test");
            user.should.have.property("familyName", "User");
        });

        it("should extract realm roles", function() {
            const payload = {
                sub: "user123",
                realm_access: {
                    roles: ["admin", "user"]
                }
            };
            const token = createTestJwt(payload, testKeys.privateKey);

            const { user } = client.extractUserInfo(token);

            user.roles.should.containEql("admin");
            user.roles.should.containEql("user");
        });

        it("should extract resource roles", function() {
            const payload = {
                sub: "user123",
                resource_access: {
                    "my-app": {
                        roles: ["read", "write"]
                    },
                    "other-app": {
                        roles: ["view"]
                    }
                }
            };
            const token = createTestJwt(payload, testKeys.privateKey);

            const { user } = client.extractUserInfo(token);

            user.roles.should.containEql("my-app:read");
            user.roles.should.containEql("my-app:write");
            user.roles.should.containEql("other-app:view");
        });

        it("should extract groups", function() {
            const payload = {
                sub: "user123",
                groups: ["/admin", "/developers"]
            };
            const token = createTestJwt(payload, testKeys.privateKey);

            const { user } = client.extractUserInfo(token);

            user.groups.should.containEql("/admin");
            user.groups.should.containEql("/developers");
        });

        it("should extract scope", function() {
            const payload = {
                sub: "user123",
                scope: "openid profile email"
            };
            const token = createTestJwt(payload, testKeys.privateKey);

            const { user } = client.extractUserInfo(token);

            user.scope.should.containEql("openid");
            user.scope.should.containEql("profile");
            user.scope.should.containEql("email");
        });

        it("should extract custom claims", function() {
            const payload = {
                sub: "user123",
                custom_field: "custom value",
                department: "engineering"
            };
            const token = createTestJwt(payload, testKeys.privateKey);

            const { user } = client.extractUserInfo(token);

            user.customClaims.should.have.property("custom_field", "custom value");
            user.customClaims.should.have.property("department", "engineering");
        });

        it("should handle invalid token", function() {
            const { user, error } = client.extractUserInfo("invalid-token");

            should(user).be.null();
            error.should.not.be.empty();
        });

        it("should convert timestamps to Date objects", function() {
            const now = Math.floor(Date.now() / 1000);
            const payload = {
                sub: "user123",
                iat: now,
                exp: now + 3600
            };
            const token = createTestJwt(payload, testKeys.privateKey);

            const { user } = client.extractUserInfo(token);

            user.issuedAt.should.be.instanceOf(Date);
            user.expiresAt.should.be.instanceOf(Date);
        });
    });

    describe("introspectToken", function() {
        let introspectionClient;

        beforeEach(function() {
            introspectionClient = new KeycloakClient({
                fetchFn: mockFetch,
                keycloakUrl: "http://localhost:8080",
                realm: "test-realm",
                clientId: "test-client",
                clientSecret: "test-secret",
                circuitBreakerEnabled: false
            });
        });

        afterEach(function() {
            if (introspectionClient) {
                introspectionClient.shutdown();
            }
        });

        it("should introspect active token", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({
                    active: true,
                    sub: "user123",
                    username: "testuser"
                })
            });

            const result = await introspectionClient.introspectToken("test-token");

            result.active.should.be.true();
            result.payload.should.have.property("sub", "user123");
        });

        it("should introspect inactive token", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ active: false })
            });

            const result = await introspectionClient.introspectToken("expired-token");

            result.active.should.be.false();
            should(result.payload).be.undefined();
        });

        it("should send correct credentials", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ active: true })
            });

            await introspectionClient.introspectToken("test-token");

            const call = mockFetch.firstCall;
            const authHeader = call.args[1].headers.Authorization;
            const expectedAuth = "Basic " + Buffer.from("test-client:test-secret").toString("base64");
            authHeader.should.equal(expectedAuth);
        });

        it("should send token in body", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ active: true })
            });

            await introspectionClient.introspectToken("my-token");

            const call = mockFetch.firstCall;
            call.args[1].body.should.equal("token=my-token");
        });

        it("should require client credentials", async function() {
            const noCredClient = new KeycloakClient({
                fetchFn: mockFetch
            });

            const result = await noCredClient.introspectToken("test-token");

            result.active.should.be.false();
            result.error.should.containEql("Client ID and secret required");
            noCredClient.shutdown();
        });

        it("should handle introspection error", async function() {
            mockFetch.resolves({
                ok: false,
                status: 401
            });

            const result = await introspectionClient.introspectToken("test-token");

            result.active.should.be.false();
            result.error.should.containEql("401");
        });

        it("should update statistics", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ active: true })
            });

            await introspectionClient.introspectToken("test-token");

            const stats = introspectionClient.getStatistics();
            stats.cumulative.introspections.should.equal(1);
        });
    });

    describe("getHealthStatus", function() {
        it("should return healthy when Keycloak responds", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({
                    issuer: "http://localhost:8080/realms/test-realm",
                    authorization_endpoint: "..."
                })
            });

            const health = await client.getHealthStatus();

            health.healthy.should.be.true();
            health.message.should.equal("Keycloak server is healthy");
            health.details.should.have.property("url", "http://localhost:8080");
            health.details.should.have.property("realm", "test-realm");
        });

        it("should return unhealthy on error response", async function() {
            mockFetch.resolves({
                ok: false,
                status: 503
            });

            const health = await client.getHealthStatus();

            health.healthy.should.be.false();
            health.message.should.containEql("503");
        });

        it("should return unhealthy on network error", async function() {
            mockFetch.rejects(new Error("Connection refused"));

            const health = await client.getHealthStatus();

            health.healthy.should.be.false();
            health.message.should.equal("Connection refused");
        });

        it("should return unhealthy on timeout", async function() {
            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            mockFetch.rejects(abortError);

            const health = await client.getHealthStatus();

            health.healthy.should.be.false();
            health.message.should.equal("Keycloak health check timeout");
        });

        it("should include circuit state in details", async function() {
            client._circuitState = CircuitState.OPEN;

            mockFetch.resolves({
                ok: true,
                json: async () => ({ issuer: "..." })
            });

            const health = await client.getHealthStatus();
            health.details.should.have.property("circuitState", CircuitState.OPEN);
        });

        it("should include cache status in details", async function() {
            // Populate cache first
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });
            await client.getPublicKeys();

            mockFetch.resolves({
                ok: true,
                json: async () => ({ issuer: "..." })
            });

            const health = await client.getHealthStatus();
            health.details.should.have.property("jwksCached", true);
            health.details.should.have.property("cachedKeyCount", 1);
        });
    });

    describe("circuit breaker", function() {
        it("should open after threshold failures", async function() {
            mockFetch.rejects(new Error("Service down"));

            for (let i = 0; i < 3; i++) {
                try {
                    await client.getPublicKeys(true);
                } catch (err) {
                    // Expected
                }
            }

            client.circuitState.should.equal(CircuitState.OPEN);
            client.isCircuitOpen.should.be.true();
        });

        it("should emit circuitOpen event", async function() {
            mockFetch.rejects(new Error("Service down"));

            let openEvent = null;
            client.on("circuitOpen", event => { openEvent = event; });

            for (let i = 0; i < 3; i++) {
                try {
                    await client.getPublicKeys(true);
                } catch (err) {
                    // Expected
                }
            }

            openEvent.should.not.be.null();
            openEvent.should.have.property("currentState", CircuitState.OPEN);
        });

        it("should fail fast when circuit is open", async function() {
            client._circuitState = CircuitState.OPEN;
            client._circuitOpenTime = Date.now();

            try {
                await client.getPublicKeys(true);
                should.fail("Expected error");
            } catch (err) {
                err.code.should.equal("CIRCUIT_OPEN");
            }

            mockFetch.called.should.be.false();
        });

        it("should allow manual reset", function() {
            client._circuitState = CircuitState.OPEN;
            client._failureCount = 10;

            let resetEvent = null;
            client.on("circuitReset", event => { resetEvent = event; });

            client.resetCircuitBreaker();

            client.circuitState.should.equal(CircuitState.CLOSED);
            client._failureCount.should.equal(0);
            resetEvent.should.not.be.null();
        });
    });

    describe("retry logic", function() {
        it("should retry on failure", async function() {
            const jwk = pemToJwk(testKeys.publicKey);

            mockFetch
                .onFirstCall().rejects(new Error("Temporary failure"))
                .onSecondCall().resolves({
                    ok: true,
                    json: async () => ({ keys: [jwk] })
                });

            const jwks = await client.getPublicKeys(true);

            jwks.keys.should.have.length(1);
            mockFetch.calledTwice.should.be.true();
        });

        it("should emit retry events", async function() {
            const jwk = pemToJwk(testKeys.publicKey);

            mockFetch
                .onFirstCall().rejects(new Error("Temporary failure"))
                .onSecondCall().resolves({
                    ok: true,
                    json: async () => ({ keys: [jwk] })
                });

            let retryEvent = null;
            client.on("retry", event => { retryEvent = event; });

            await client.getPublicKeys(true);

            retryEvent.should.not.be.null();
            retryEvent.should.have.property("attempt", 1);
            retryEvent.should.have.property("maxAttempts", 2);
        });

        it("should fail after max retries", async function() {
            mockFetch.rejects(new Error("Persistent failure"));

            try {
                await client.getPublicKeys(true);
                should.fail("Expected error");
            } catch (err) {
                err.message.should.equal("Persistent failure");
            }

            // Initial + 2 retries = 3 calls
            mockFetch.callCount.should.equal(3);
        });
    });

    describe("auto refresh", function() {
        it("should start auto refresh", function(done) {
            let started = false;
            client.on("autoRefreshStarted", () => { started = true; });

            client.startAutoRefresh(100);

            started.should.be.true();
            client._refreshTimer.should.not.be.null();
            done();
        });

        it("should stop auto refresh", function() {
            client.startAutoRefresh(100);
            client._refreshTimer.should.not.be.null();

            let stopped = false;
            client.on("autoRefreshStopped", () => { stopped = true; });

            client.stopAutoRefresh();

            stopped.should.be.true();
            should(client._refreshTimer).be.null();
        });

        it("should stop previous timer when starting new one", function() {
            client.startAutoRefresh(100);
            const firstTimer = client._refreshTimer;

            client.startAutoRefresh(200);
            const secondTimer = client._refreshTimer;

            firstTimer.should.not.equal(secondTimer);
        });
    });

    describe("getStatistics", function() {
        it("should return comprehensive statistics", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            await client.getPublicKeys();
            await client.getPublicKeys(); // Cache hit

            const stats = client.getStatistics();

            stats.should.have.property("config");
            stats.config.should.have.property("keycloakUrl");
            stats.config.should.have.property("realm");
            stats.config.should.have.property("algorithms");

            stats.should.have.property("current");
            stats.current.should.have.property("jwksCached", true);
            stats.current.should.have.property("cachedKeyCount");
            stats.current.should.have.property("circuitState");

            stats.should.have.property("cumulative");
            stats.cumulative.should.have.property("jwksRefreshes", 1);
            stats.cumulative.should.have.property("cacheHits", 1);
        });
    });

    describe("clearCache", function() {
        it("should clear all caches", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            await client.getPublicKeys();
            client._jwksCache.should.not.be.null();
            client._keyCache.size.should.equal(1);

            let cleared = false;
            client.on("cacheCleared", () => { cleared = true; });

            client.clearCache();

            should(client._jwksCache).be.null();
            client._keyCache.size.should.equal(0);
            cleared.should.be.true();
        });
    });

    describe("shutdown", function() {
        it("should clear all state on shutdown", async function() {
            const jwk = pemToJwk(testKeys.publicKey);
            mockFetch.resolves({
                ok: true,
                json: async () => ({ keys: [jwk] })
            });

            await client.getPublicKeys();
            client.startAutoRefresh(1000);
            client._circuitState = CircuitState.OPEN;

            client.shutdown();

            should(client._jwksCache).be.null();
            client._keyCache.size.should.equal(0);
            should(client._refreshTimer).be.null();
            client._circuitState.should.equal(CircuitState.CLOSED);
        });

        it("should emit shutdown event", function(done) {
            client.on("shutdown", () => done());
            client.shutdown();
        });
    });

    describe("timeout handling", function() {
        it("should handle request timeout", async function() {
            const timeoutClient = new KeycloakClient({
                fetchFn: mockFetch,
                timeout: 100,
                retryAttempts: 0,
                circuitBreakerEnabled: false
            });

            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            mockFetch.rejects(abortError);

            try {
                await timeoutClient.getPublicKeys(true);
                should.fail("Expected error");
            } catch (err) {
                err.code.should.equal("TIMEOUT");
                err.message.should.equal("Request timeout");
            }

            timeoutClient.shutdown();
        });
    });
});
