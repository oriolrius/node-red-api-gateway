#!/usr/bin/env node

/**
 * Standalone Node-RED launcher for development-time manual testing.
 *
 * This allows developers to quickly spin up a real Node-RED instance
 * with their nodes installed without needing Docker or full E2E setup.
 *
 * Usage:
 *   node tests/launcher/launch.js
 *   PORT=1881 node tests/launcher/launch.js
 *
 * Features:
 *   - Creates a real Node-RED runtime (not the test helper)
 *   - Supports graceful shutdown with temporary directory cleanup
 *   - Minimal logging to keep output clean
 *   - Accessible in browser at configured port
 *   - Express app setup with Node-RED admin and node routes
 *   - Settings optimized for testing (CORS enabled, no auth, minimal logging)
 */

const http = require("http");
const express = require("express");
const RED = require("node-red");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Configuration
const HOST = process.env.HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT, 10) || 1880;
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// Create temporary directory for Node-RED user data
// Using /tmp ensures Node-RED won't walk up the tree and find packages in /home
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodered-test-"));

// Create node_modules directory
const nodeModulesDir = path.join(tempDir, "node_modules");
fs.mkdirSync(nodeModulesDir, { recursive: true });

// Helper function to symlink a package (handles scoped packages)
function symlinkPackage(packagePath, targetDir) {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(packagePath, "package.json"), "utf8"));
    const pkgName = pkgJson.name;
    const linkPath = path.join(targetDir, pkgName);
    const linkDir = path.dirname(linkPath);
    if (linkDir !== targetDir) {
        fs.mkdirSync(linkDir, { recursive: true });
    }
    fs.symlinkSync(packagePath, linkPath);
    return pkgName;
}

// Symlink our project's nodes
const packageName = symlinkPackage(PROJECT_ROOT, nodeModulesDir);
console.log(`Linked ${packageName} -> ${PROJECT_ROOT}`);

// Symlink @node-red/nodes to temp directory so coreNodesDir points here
// This prevents Node-RED from walking up and finding packages in /home
const nodeRedNodesPath = path.join(PROJECT_ROOT, "node_modules", "@node-red", "nodes");
const coreNodesSymlink = symlinkPackage(nodeRedNodesPath, nodeModulesDir);
console.log(`Linked ${coreNodesSymlink} -> ${nodeRedNodesPath}`);

// Copy test flows to temp directory for automatic provisioning
const testFlowsPath = path.join(__dirname, "flows.json");
if (fs.existsSync(testFlowsPath)) {
    fs.copyFileSync(testFlowsPath, path.join(tempDir, "flows.json"));
    console.log("Provisioned test flows from flows.json");
}

// Copy credentials file if it exists
const sourceCredsPath = path.join(__dirname, "flows_cred.json");
if (fs.existsSync(sourceCredsPath)) {
    fs.copyFileSync(sourceCredsPath, path.join(tempDir, "flows_cred.json"));
    console.log("Provisioned credentials from flows_cred.json");
}

// Express app setup
const app = express();
const server = http.createServer(app);

// Path to core nodes in our temp directory (symlinked from node_modules/@node-red/nodes)
const coreNodesDir = path.join(nodeModulesDir, "@node-red", "nodes");

// Node-RED settings optimized for testing
const settings = {
    httpAdminRoot: "/",
    httpNodeRoot: "/api",
    userDir: tempDir,
    flowFile: "flows.json",
    flowFilePretty: true,
    uiPort: PORT,

    // Fixed credential secret for persistent credentials across sessions
    credentialSecret: "node-red-api-gateway-dev-secret",

    // Point coreNodesDir to our temp location so Node-RED doesn't walk up to /home
    coreNodesDir: coreNodesDir,

    // Load our nodes from the symlinked project in temp userDir
    nodesDir: nodeModulesDir,

    // CORS for API testing
    httpAdminCors: {
        origin: "*",
        methods: "GET,PUT,POST,DELETE",
        credentials: true
    },
    httpNodeCors: {
        origin: "*",
        methods: "GET,PUT,POST,DELETE"
    },

    // Disable authentication for testing
    adminAuth: null,

    // Minimal logging
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },

    // Disable telemetry consent popup and update notifications
    telemetry: {
        enabled: false,
        updateNotification: false
    },

    // Editor configuration
    editorTheme: {
        tours: false,
        projects: {
            enabled: false
        }
    },

    // Function node configuration
    functionGlobalContext: {},
    functionExternalModules: false
};

// Initialize Node-RED
RED.init(server, settings);

// Serve the editor UI
app.use(settings.httpAdminRoot, RED.httpAdmin);

// Serve HTTP endpoints created by HTTP In nodes
app.use(settings.httpNodeRoot, RED.httpNode);

// Start the server
async function start() {
    return new Promise((resolve, reject) => {
        server.listen(PORT, HOST, async (err) => {
            if (err) {
                reject(err);
                return;
            }

            try {
                await RED.start();
                console.log(`Node-RED started at http://${HOST}:${PORT}`);
                console.log(`User directory: ${tempDir}`);
                console.log("Press Ctrl+C to stop");
                resolve();
            } catch (startErr) {
                reject(startErr);
            }
        });
    });
}

// Graceful shutdown
async function shutdown() {
    console.log("\nShutting down...");

    try {
        await RED.stop();
        console.log("Node-RED stopped");
    } catch (err) {
        console.error("Error stopping Node-RED:", err.message);
    }

    server.close(() => {
        console.log("HTTP server closed");

        // Sync flows.json back to source before cleanup
        const tempFlowsPath = path.join(tempDir, "flows.json");
        if (fs.existsSync(tempFlowsPath)) {
            try {
                fs.copyFileSync(tempFlowsPath, testFlowsPath);
                console.log("Flows synced back to source: " + testFlowsPath);
            } catch (err) {
                console.error("Error syncing flows back to source:", err.message);
            }
        }

        // Sync credentials file back to source (if exists)
        const tempCredsPath = path.join(tempDir, "flows_cred.json");
        const sourceCredsPath = path.join(__dirname, "flows_cred.json");
        if (fs.existsSync(tempCredsPath)) {
            try {
                fs.copyFileSync(tempCredsPath, sourceCredsPath);
                console.log("Credentials synced back to source: " + sourceCredsPath);
            } catch (err) {
                console.error("Error syncing credentials back to source:", err.message);
            }
        }

        // Clean up temporary directory
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log("Temporary directory cleaned up");
        } catch (err) {
            console.error("Error cleaning up temp directory:", err.message);
        }

        process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
        console.error("Forced shutdown after timeout");
        process.exit(1);
    }, 5000);
}

// Handle shutdown signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start the launcher
start().catch((err) => {
    console.error("Failed to start Node-RED:", err.message);
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
});
