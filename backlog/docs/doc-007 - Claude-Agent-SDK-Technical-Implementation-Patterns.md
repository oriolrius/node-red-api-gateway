---
id: doc-007
title: Claude Agent SDK Technical Implementation Patterns
type: other
created_date: '2025-12-10 17:53'
---
# Claude Agent SDK Technical Implementation Patterns

## Overview

This document provides detailed technical patterns for implementing Claude Agent SDK integration in the Node-RED API Gateway project. It serves as a reference for developers implementing tasks 061-066.

---

## Installation and Setup

### Dependencies

```bash
npm install @anthropic-ai/claude-agent-sdk zod
```

**package.json additions:**
```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

### Authentication Configuration

```javascript
// Environment-based (recommended for development)
process.env.ANTHROPIC_API_KEY = 'sk-ant-...';

// Node-RED credentials (recommended for production)
// Stored encrypted in flows_cred.json
this.credentials.claudeApiKey
```

---

## Core Query Patterns

### Basic Streaming Query

```javascript
const { query } = require('@anthropic-ai/claude-agent-sdk');

async function analyzeWithClaude(prompt) {
  const responses = [];
  
  for await (const message of query({ prompt })) {
    switch (message.type) {
      case 'assistantPartial':
        // Real-time streaming chunk
        process.stdout.write(message.message.content);
        break;
        
      case 'assistant':
        // Complete response
        responses.push(message.message.content);
        break;
        
      case 'result':
        // Final status
        if (message.subtype === 'error') {
          throw new Error(message.message);
        }
        return {
          content: responses.join(''),
          duration: message.duration_ms,
          success: message.subtype === 'success'
        };
    }
  }
}
```

### Query with Model Selection

```javascript
async function queryWithModel(prompt, modelType = 'sonnet') {
  const models = {
    opus: 'claude-opus-4-20250514',
    sonnet: 'claude-sonnet-4-5-20250514',
    haiku: 'claude-haiku'
  };
  
  for await (const message of query({
    prompt,
    options: {
      model: models[modelType],
      includePartialMessages: true
    }
  })) {
    // Handle messages...
  }
}
```

---

## Custom Tool Patterns

### Database Query Tool

```javascript
const { tool } = require('@anthropic-ai/claude-agent-sdk');
const { z } = require('zod');

const queryDatabaseTool = tool(
  'QueryDatabase',
  'Execute a read-only SQL query against the connected database',
  z.object({
    query: z.string().describe('SQL SELECT query to execute'),
    maxRows: z.number().default(100).describe('Maximum rows to return')
  }),
  async (args, context) => {
    // Validate read-only
    if (!args.query.trim().toUpperCase().startsWith('SELECT')) {
      return {
        content: [{ type: 'text', text: 'Error: Only SELECT queries allowed' }],
        isError: true
      };
    }
    
    try {
      const pool = context.dbPool;
      const result = await pool.request().query(
        `SELECT TOP ${args.maxRows} * FROM (${args.query}) AS subquery`
      );
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.recordset, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Database error: ${error.message}` }],
        isError: true
      };
    }
  }
);
```

### Schema Validation Tool

```javascript
const validateSchemaToolTool = tool(
  'ValidateSchema',
  'Validate JSON against a JSON Schema',
  z.object({
    data: z.any().describe('JSON data to validate'),
    schema: z.any().describe('JSON Schema to validate against')
  }),
  async (args) => {
    const Ajv = require('ajv');
    const ajv = new Ajv({ allErrors: true });
    
    const validate = ajv.compile(args.schema);
    const valid = validate(args.data);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid,
          errors: validate.errors || []
        }, null, 2)
      }]
    };
  }
);
```

### OPA Policy Validation Tool

```javascript
const validateRegoTool = tool(
  'ValidateRego',
  'Validate Rego policy syntax using OPA compile endpoint',
  z.object({
    policy: z.string().describe('Rego policy code to validate'),
    packageName: z.string().default('api.gateway').describe('Expected package name')
  }),
  async (args, context) => {
    const opaClient = context.opaClient;
    
    try {
      // Use OPA's compile endpoint for syntax validation
      const response = await fetch(`${opaClient.baseUrl}/v1/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'data.' + args.packageName.replace(/\./g, '.'),
          input: {},
          unknowns: ['input']
        })
      });
      
      if (response.ok) {
        return {
          content: [{ type: 'text', text: 'Policy syntax is valid' }]
        };
      } else {
        const error = await response.json();
        return {
          content: [{ type: 'text', text: `Syntax error: ${JSON.stringify(error)}` }],
          isError: true
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Validation failed: ${error.message}` }],
        isError: true
      };
    }
  }
);
```

---

## Module Implementation Patterns

### AI Schema Assistant Class

```javascript
// lib/ai-schema-assistant.js
'use strict';

const { query, tool } = require('@anthropic-ai/claude-agent-sdk');
const { z } = require('zod');
const { EventEmitter } = require('events');

class ClaudeSchemaAssistant extends EventEmitter {
  constructor(options = {}) {
    super();
    this.model = options.model || 'claude-sonnet-4-5-20250514';
    this.streaming = options.streaming !== false;
    this.customTools = this._createTools(options);
  }
  
  _createTools(options) {
    const tools = [];
    
    if (options.dbPool) {
      tools.push(this._createDatabaseTool(options.dbPool));
    }
    
    return tools;
  }
  
  _createDatabaseTool(pool) {
    return tool(
      'IntrospectTable',
      'Get column information for a database table',
      z.object({
        schema: z.string().default('dbo'),
        table: z.string()
      }),
      async (args) => {
        const result = await pool.request()
          .input('schema', args.schema)
          .input('table', args.table)
          .query(`
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
          `);
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result.recordset) }]
        };
      }
    );
  }
  
  /**
   * Analyze a database schema and return insights
   * @param {Object} schemaJson - Schema from SchemaIntrospector
   * @returns {AsyncGenerator} Streaming analysis results
   */
  async *analyzeSchema(schemaJson) {
    const prompt = `
Analyze this database schema and provide insights:

${JSON.stringify(schemaJson, null, 2)}

Identify:
1. Table relationships and foreign key patterns
2. Naming convention issues or inconsistencies
3. Missing indexes that would improve query performance
4. Business logic patterns (soft deletes, audit trails, status fields)
5. Potential data integrity issues
6. Suggested improvements

Format your response as structured Markdown.
    `.trim();
    
    for await (const message of query({
      prompt,
      options: {
        model: this.model,
        includePartialMessages: this.streaming,
        customTools: this.customTools,
        allowedTools: ['IntrospectTable']
      }
    })) {
      if (message.type === 'assistantPartial' && this.streaming) {
        this.emit('chunk', message.message.content);
        yield { type: 'chunk', content: message.message.content };
      }
      
      if (message.type === 'assistant') {
        yield { type: 'complete', content: message.message.content };
      }
      
      if (message.type === 'result') {
        yield { 
          type: 'result', 
          success: message.subtype === 'success',
          duration: message.duration_ms
        };
      }
    }
  }
  
  /**
   * Enhance an OpenAPI spec with meaningful descriptions
   * @param {Object} openApiSpec - Base OpenAPI specification
   * @param {Object} schemaJson - Database schema for context
   * @returns {AsyncGenerator} Enhanced OpenAPI spec
   */
  async *enhanceOpenApiSpec(openApiSpec, schemaJson) {
    const prompt = `
I have an auto-generated OpenAPI 3.0 specification and the source database schema.
Enhance the OpenAPI spec with:

1. Meaningful operation summaries and descriptions
2. Parameter descriptions based on column purposes
3. Example values that make sense for each field
4. Error response descriptions
5. Security considerations where applicable

Database Schema:
${JSON.stringify(schemaJson, null, 2)}

Current OpenAPI Spec:
${JSON.stringify(openApiSpec, null, 2)}

Return the enhanced OpenAPI specification as valid JSON.
    `.trim();
    
    let fullResponse = '';
    
    for await (const message of query({
      prompt,
      options: {
        model: this.model,
        includePartialMessages: this.streaming
      }
    })) {
      if (message.type === 'assistantPartial') {
        this.emit('chunk', message.message.content);
        yield { type: 'chunk', content: message.message.content };
      }
      
      if (message.type === 'assistant') {
        fullResponse = message.message.content;
      }
      
      if (message.type === 'result' && message.subtype === 'success') {
        // Extract JSON from response
        const jsonMatch = fullResponse.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          try {
            const enhanced = JSON.parse(jsonMatch[1]);
            yield { type: 'complete', spec: enhanced };
          } catch (e) {
            yield { type: 'error', message: 'Failed to parse enhanced spec' };
          }
        } else {
          yield { type: 'complete', content: fullResponse };
        }
      }
    }
  }
  
  /**
   * Suggest JSON Schema validations based on column analysis
   * @param {Object} tableSchema - Single table schema
   * @returns {Object} Suggested validations
   */
  async suggestValidations(tableSchema) {
    const prompt = `
Analyze this table schema and suggest appropriate JSON Schema validations:

${JSON.stringify(tableSchema, null, 2)}

For each column, suggest:
- pattern (regex) for strings that appear to have formats (email, phone, etc.)
- enum values if the column appears to be a status/type field
- minimum/maximum for numeric fields
- minLength/maxLength for strings
- format (date, date-time, email, uri, uuid) where applicable

Return a JSON object mapping column names to their suggested JSON Schema properties.
    `.trim();
    
    let response = '';
    
    for await (const message of query({ prompt, options: { model: this.model } })) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }
    }
    
    // Extract JSON
    const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    return {};
  }
  
  /**
   * Infer business rules from schema patterns
   * @param {Object} schemaJson - Full schema
   * @returns {Object} Inferred business rules
   */
  async inferBusinessRules(schemaJson) {
    const prompt = `
Analyze this database schema and identify business rules/patterns:

${JSON.stringify(schemaJson, null, 2)}

Look for:
1. Soft delete patterns (is_deleted, deleted_at columns)
2. Audit columns (created_at, updated_at, created_by, updated_by)
3. Status/state machine patterns (status, state columns)
4. Versioning patterns (version, revision columns)
5. Multi-tenancy (tenant_id, organization_id)
6. Hierarchical data (parent_id, path columns)
7. Temporal data (valid_from, valid_to)

Return a JSON object with:
{
  "patterns": [{ "type": "...", "tables": [...], "columns": [...], "description": "..." }],
  "recommendations": ["..."]
}
    `.trim();
    
    let response = '';
    
    for await (const message of query({ prompt, options: { model: this.model } })) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }
    }
    
    const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    return { patterns: [], recommendations: [] };
  }
}

module.exports = { ClaudeSchemaAssistant };
```

### AI Policy Generator Class

```javascript
// lib/ai-policy-generator.js
'use strict';

const { query, tool } = require('@anthropic-ai/claude-agent-sdk');
const { z } = require('zod');
const { EventEmitter } = require('events');

const POLICY_TEMPLATES = {
  rbac: `
package api.gateway

import future.keywords.if
import future.keywords.in

default allow := false

# Role-based access control template
allow if {
    required_role := role_requirements[input.method][input.path]
    required_role in input.user.roles
}
  `,
  abac: `
package api.gateway

import future.keywords.if

default allow := false

# Attribute-based access control template
allow if {
    user_attributes_match
    resource_attributes_match
    action_permitted
}
  `,
  'resource-ownership': `
package api.gateway

import future.keywords.if

default allow := false

# Resource ownership template
allow if {
    input.user.id == input.resource.owner_id
}
  `
};

class AIPolicyGenerator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.model = options.model || 'claude-sonnet-4-5-20250514';
    this.opaClient = options.opaClient;
    this.streaming = options.streaming !== false;
  }
  
  /**
   * Generate OPA policy from natural language requirements
   * @param {string} requirements - Natural language policy requirements
   * @param {string} policyType - One of: rbac, abac, resource-ownership, time-based, audit
   * @returns {AsyncGenerator} Generated policy
   */
  async *generatePolicy(requirements, policyType = 'rbac') {
    const template = POLICY_TEMPLATES[policyType] || '';
    
    const prompt = `
Generate an OPA Rego policy based on these requirements:

${requirements}

${template ? `Use this template as a starting point:\n\`\`\`rego\n${template}\n\`\`\`` : ''}

Requirements:
1. Package name must be: api.gateway
2. Main rule must be named: allow
3. Input structure: { user: { id, roles, scopes }, method, path, body, resource }
4. Use future.keywords imports for modern Rego syntax
5. Include comments explaining each rule
6. Follow OPA best practices

Return only the Rego policy code wrapped in \`\`\`rego ... \`\`\` tags.
    `.trim();
    
    let fullResponse = '';
    
    for await (const message of query({
      prompt,
      options: {
        model: this.model,
        includePartialMessages: this.streaming
      }
    })) {
      if (message.type === 'assistantPartial') {
        this.emit('chunk', message.message.content);
        yield { type: 'chunk', content: message.message.content };
      }
      
      if (message.type === 'assistant') {
        fullResponse = message.message.content;
      }
      
      if (message.type === 'result' && message.subtype === 'success') {
        const regoMatch = fullResponse.match(/```rego\n?([\s\S]*?)\n?```/);
        if (regoMatch) {
          yield { type: 'complete', policy: regoMatch[1].trim() };
        } else {
          yield { type: 'complete', content: fullResponse };
        }
      }
    }
  }
  
  /**
   * Analyze existing policy for issues
   * @param {string} regoCode - Rego policy code
   * @returns {Object} Analysis results
   */
  async analyzePolicy(regoCode) {
    const prompt = `
Analyze this OPA Rego policy for security issues and optimization opportunities:

\`\`\`rego
${regoCode}
\`\`\`

Check for:
1. Security vulnerabilities (overly permissive rules, missing deny rules)
2. Logic errors or contradictions
3. Performance issues (inefficient iterations, missing indexing hints)
4. Best practice violations
5. Missing edge cases
6. Incomplete input validation

Return a JSON object:
{
  "securityIssues": [{ "severity": "high|medium|low", "description": "...", "line": N, "suggestion": "..." }],
  "optimizations": [{ "description": "...", "suggestion": "..." }],
  "bestPractices": [{ "description": "...", "suggestion": "..." }],
  "overallScore": 1-10,
  "summary": "..."
}
    `.trim();
    
    let response = '';
    
    for await (const message of query({ prompt, options: { model: this.model } })) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }
    }
    
    const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    return { securityIssues: [], optimizations: [], summary: response };
  }
  
  /**
   * Explain what a policy does in plain language
   * @param {string} regoCode - Rego policy code
   * @param {Object} inputExample - Example input for evaluation
   * @returns {string} Plain language explanation
   */
  async explainPolicy(regoCode, inputExample = null) {
    const prompt = `
Explain this OPA Rego policy in plain language that a non-technical person can understand:

\`\`\`rego
${regoCode}
\`\`\`

${inputExample ? `Also explain what would happen with this input:\n${JSON.stringify(inputExample, null, 2)}` : ''}

Structure your explanation:
1. Overview: What does this policy control?
2. Rules: Explain each rule in simple terms
3. Access Patterns: Who can access what?
4. Examples: Give 2-3 concrete examples of allowed/denied scenarios
    `.trim();
    
    let response = '';
    
    for await (const message of query({ prompt, options: { model: this.model } })) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }
    }
    
    return response;
  }
  
  /**
   * Generate test cases for a policy
   * @param {string} regoCode - Rego policy code
   * @returns {string} Rego test code
   */
  async suggestTestCases(regoCode) {
    const prompt = `
Generate comprehensive OPA test cases for this policy:

\`\`\`rego
${regoCode}
\`\`\`

Generate test rules that:
1. Test each allow condition with valid input
2. Test each deny/negative condition
3. Test edge cases and boundary conditions
4. Test invalid/malformed input handling
5. Use descriptive test names (test_<scenario>)

Return only the Rego test code (test_* rules) wrapped in \`\`\`rego ... \`\`\` tags.
    `.trim();
    
    let response = '';
    
    for await (const message of query({ prompt, options: { model: this.model } })) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }
    }
    
    const regoMatch = response.match(/```rego\n?([\s\S]*?)\n?```/);
    return regoMatch ? regoMatch[1].trim() : response;
  }
  
  /**
   * Validate Rego syntax using OPA
   * @param {string} regoCode - Rego policy code
   * @returns {Object} Validation result
   */
  async validateSyntax(regoCode) {
    if (!this.opaClient) {
      throw new Error('OPA client required for syntax validation');
    }
    
    try {
      // Create a temporary policy and try to compile it
      const response = await fetch(`${this.opaClient.baseUrl}/v1/policies/temp_validate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: regoCode
      });
      
      if (response.ok) {
        // Clean up temp policy
        await fetch(`${this.opaClient.baseUrl}/v1/policies/temp_validate`, {
          method: 'DELETE'
        });
        
        return { valid: true };
      } else {
        const error = await response.json();
        return {
          valid: false,
          errors: error.errors || [error.message]
        };
      }
    } catch (error) {
      return {
        valid: false,
        errors: [error.message]
      };
    }
  }
}

module.exports = { AIPolicyGenerator };
```

---

## Node-RED Node Patterns

### AI Configuration Node

```javascript
// nodes/ai-config.js
module.exports = function(RED) {
  function AIConfigNode(config) {
    RED.nodes.createNode(this, config);
    
    this.model = config.model || 'claude-sonnet-4-5-20250514';
    this.streaming = config.streaming !== false;
    this.timeout = parseInt(config.timeout) || 60000;
    
    // API key from credentials
    this.apiKey = this.credentials.apiKey;
    
    // Set environment variable for SDK
    if (this.apiKey) {
      process.env.ANTHROPIC_API_KEY = this.apiKey;
    }
  }
  
  RED.nodes.registerType('ai-config', AIConfigNode, {
    credentials: {
      apiKey: { type: 'password' }
    }
  });
};
```

### AI Schema Analyzer Node

```javascript
// nodes/ai-schema-analyzer.js
module.exports = function(RED) {
  const { ClaudeSchemaAssistant } = require('../lib/ai-schema-assistant');
  
  function AISchemaAnalyzerNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    
    // Get config nodes
    this.aiConfig = RED.nodes.getNode(config.aiConfig);
    this.dbConfig = RED.nodes.getNode(config.dbConfig);
    
    if (!this.aiConfig) {
      node.error('AI configuration required');
      node.status({ fill: 'red', shape: 'ring', text: 'no AI config' });
      return;
    }
    
    node.on('input', async (msg, send, done) => {
      const schemaJson = msg.payload || msg.schema;
      
      if (!schemaJson) {
        node.status({ fill: 'red', shape: 'ring', text: 'no schema' });
        done(new Error('No schema provided in msg.payload or msg.schema'));
        return;
      }
      
      node.status({ fill: 'blue', shape: 'dot', text: 'analyzing...' });
      
      try {
        const assistant = new ClaudeSchemaAssistant({
          model: this.aiConfig.model,
          streaming: this.aiConfig.streaming
        });
        
        let chunks = [];
        
        for await (const result of assistant.analyzeSchema(schemaJson)) {
          switch (result.type) {
            case 'chunk':
              chunks.push(result.content);
              // Send partial updates
              send([{ payload: result.content, partial: true }, null]);
              node.status({ fill: 'blue', shape: 'dot', text: 'streaming...' });
              break;
              
            case 'complete':
              msg.payload = result.content;
              msg.analysis = result.content;
              send([null, msg]);
              break;
              
            case 'result':
              node.status({
                fill: result.success ? 'green' : 'red',
                shape: 'dot',
                text: result.success ? `done (${result.duration}ms)` : 'error'
              });
              break;
          }
        }
        
        done();
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: error.message });
        done(error);
      }
    });
  }
  
  RED.nodes.registerType('ai-schema-analyzer', AISchemaAnalyzerNode);
};
```

---

## Error Handling Patterns

### Retry with Exponential Backoff

```javascript
async function queryWithRetry(prompt, options = {}, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const results = [];
      
      for await (const message of query({ prompt, options })) {
        if (message.type === 'result') {
          if (message.subtype === 'error') {
            throw new Error(message.message);
          }
          return results;
        }
        results.push(message);
      }
      
      return results;
    } catch (error) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error.message.includes('invalid_api_key')) {
        throw error;
      }
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}
```

### Timeout Handling

```javascript
async function queryWithTimeout(prompt, options = {}, timeoutMs = 60000) {
  const queryInstance = query({ prompt, options });
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      queryInstance.interrupt();
      reject(new Error(`Query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  const results = [];
  
  try {
    for await (const message of queryInstance) {
      results.push(message);
      
      if (message.type === 'result') {
        return results;
      }
    }
  } catch (error) {
    if (error.message.includes('interrupted')) {
      throw new Error(`Query timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
  
  return results;
}
```

---

## Testing Patterns

### Mocking Claude Responses

```javascript
const sinon = require('sinon');

function createMockQuery(responses) {
  return async function* mockQuery({ prompt }) {
    for (const response of responses) {
      yield response;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    yield {
      type: 'result',
      subtype: 'success',
      duration_ms: 100
    };
  };
}

// Usage in tests
describe('ClaudeSchemaAssistant', () => {
  let queryStub;
  
  beforeEach(() => {
    queryStub = sinon.stub();
  });
  
  it('should analyze schema', async () => {
    const mockResponses = [
      { type: 'assistant', message: { content: '## Analysis\n...' } }
    ];
    
    queryStub.returns(createMockQuery(mockResponses)());
    
    const assistant = new ClaudeSchemaAssistant({ query: queryStub });
    const results = [];
    
    for await (const result of assistant.analyzeSchema({ tables: [] })) {
      results.push(result);
    }
    
    expect(results).to.have.length(2);
    expect(results[0].type).to.equal('complete');
  });
});
```

---

## Performance Considerations

### Caching AI Responses

```javascript
const crypto = require('crypto');

class CachedSchemaAssistant extends ClaudeSchemaAssistant {
  constructor(options) {
    super(options);
    this.cache = new Map();
    this.cacheTTL = options.cacheTTL || 3600000; // 1 hour
  }
  
  _getCacheKey(method, input) {
    const hash = crypto.createHash('md5')
      .update(method + JSON.stringify(input))
      .digest('hex');
    return `${method}:${hash}`;
  }
  
  async *analyzeSchema(schemaJson) {
    const cacheKey = this._getCacheKey('analyzeSchema', schemaJson);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      yield { type: 'complete', content: cached.content, fromCache: true };
      yield { type: 'result', success: true, duration: 0 };
      return;
    }
    
    let result;
    for await (const msg of super.analyzeSchema(schemaJson)) {
      if (msg.type === 'complete') {
        result = msg.content;
      }
      yield msg;
    }
    
    if (result) {
      this.cache.set(cacheKey, { content: result, timestamp: Date.now() });
    }
  }
}
```

---

## Related Documentation

- **doc-006**: Claude Agent SDK Integration Strategy and Benefits
- **Skill**: `.claude/skills/claude-agent-sdk/SKILL.md`
- **Tasks**: task-061 through task-066

---

## References

- [Claude Agent SDK TypeScript Reference](https://docs.anthropic.com/en/docs/claude-code/sdk)
- [Zod Schema Validation](https://zod.dev/)
- [OPA Rego Language Reference](https://www.openpolicyagent.org/docs/latest/policy-reference/)
