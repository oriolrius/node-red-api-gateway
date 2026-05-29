#!/usr/bin/env node
'use strict';

/**
 * Audit saved endpoint schemas against Ajv 2020-12.
 *
 * For each Node-RED flow JSON file passed on argv, walk every node of
 * type `apigw-endpoint` and try to compile `bodySchema`, `querySchema`,
 * `paramsSchema`, and each entry of `responseSchemas` under the JSON
 * Schema 2020-12 dialect (the one OpenAPI 3.1 references).
 *
 * Reports any schema that fails to compile so they can be migrated by
 * hand before the 0.8.0 release ships. See backlog/drafts/oas31-migration.md
 * (the "Highest risk — saved schemas under Ajv 2020" mitigation).
 *
 * Usage:
 *   node scripts/audit-saved-schemas.js path/to/flows.json [more.json ...]
 *
 * Exit code 0 if all schemas compile, 1 otherwise.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

function makeAjv() {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv;
}

function tryCompile(ajv, raw, label, failures) {
    if (raw === undefined || raw === null || raw === '') {
        return;
    }
    let parsed;
    try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {
        failures.push({ label, error: `invalid JSON: ${err.message}` });
        return;
    }
    if (parsed === null || typeof parsed !== 'object') {
        return;
    }
    try {
        ajv.compile(parsed);
    } catch (err) {
        failures.push({ label, error: err.message });
    }
}

function auditFile(filePath) {
    const ajv = makeAjv();
    let nodes;
    try {
        nodes = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error(`✘ ${filePath}: could not read/parse file (${err.message})`);
        return 1;
    }
    if (!Array.isArray(nodes)) {
        console.error(`✘ ${filePath}: top-level JSON is not an array (Node-RED flow export expected)`);
        return 1;
    }

    const failures = [];
    let endpointCount = 0;

    for (const node of nodes) {
        if (!node || node.type !== 'apigw-endpoint') continue;
        endpointCount += 1;
        const id = node.id || '<no-id>';
        const route = `${node.method || '?'} ${node.path || '?'}`;
        tryCompile(ajv, node.bodySchema, `${id} (${route}) bodySchema`, failures);
        tryCompile(ajv, node.querySchema, `${id} (${route}) querySchema`, failures);
        tryCompile(ajv, node.paramsSchema, `${id} (${route}) paramsSchema`, failures);

        if (node.responseSchemas) {
            let respMap;
            try {
                respMap = typeof node.responseSchemas === 'string'
                    ? JSON.parse(node.responseSchemas)
                    : node.responseSchemas;
            } catch (err) {
                failures.push({ label: `${id} (${route}) responseSchemas`, error: `invalid JSON: ${err.message}` });
                continue;
            }
            if (respMap && typeof respMap === 'object') {
                for (const [status, schema] of Object.entries(respMap)) {
                    tryCompile(ajv, schema, `${id} (${route}) responseSchemas[${status}]`, failures);
                }
            }
        }
    }

    if (failures.length === 0) {
        console.log(`✓ ${filePath}: ${endpointCount} apigw-endpoint nodes — all schemas compile under Ajv 2020-12`);
        return 0;
    }

    console.error(`✘ ${filePath}: ${failures.length} schema(s) failed Ajv 2020-12 compile (${endpointCount} endpoint nodes scanned)`);
    for (const { label, error } of failures) {
        console.error(`  - ${label}: ${error}`);
    }
    return 1;
}

function main() {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.error('Usage: node scripts/audit-saved-schemas.js <flow.json> [<flow.json> ...]');
        process.exit(2);
    }
    let exitCode = 0;
    for (const file of files) {
        const code = auditFile(path.resolve(file));
        if (code !== 0) exitCode = code;
    }
    process.exit(exitCode);
}

main();
