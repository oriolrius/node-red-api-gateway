/**
 * Node-RED Settings for E2E Testing
 *
 * Minimal configuration optimized for automated testing.
 * See https://nodered.org/docs/user-guide/runtime/configuration
 */
module.exports = {
    // Flow file configuration
    flowFile: 'flows.json',
    flowFilePretty: true,

    // Disable authentication for testing
    adminAuth: null,

    // CORS configuration for API testing
    httpAdminCors: {
        origin: "*",
        methods: "GET,PUT,POST,DELETE"
    },
    httpNodeCors: {
        origin: "*",
        methods: "GET,PUT,POST,DELETE"
    },

    // Disable telemetry consent popup and update notifications
    telemetry: {
        enabled: false,
        updateNotification: false
    },

    // Editor configuration - disable projects and tours
    editorTheme: {
        tours: false,
        projects: {
            enabled: false
        }
    },

    // Minimal logging for cleaner test output
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },

    // Function node configuration
    functionGlobalContext: {},
    functionExternalModules: false,

    // Disable credential encryption for testing simplicity
    credentialSecret: false
};
