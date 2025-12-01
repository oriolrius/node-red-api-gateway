---
name: mssql
description: Comprehensive guide for Microsoft SQL Server connectivity using the mssql Node.js library. This skill should be used when connecting to SQL Server databases, configuring connection pools, executing queries (simple, parameterized, stored procedures), handling transactions, performing bulk operations, streaming large result sets, or integrating SQL Server with Node-RED nodes.
---

# Microsoft SQL Server (mssql)

## Overview

The `mssql` package is a Microsoft SQL Server client for Node.js that provides both callback and Promise-based APIs. It supports connection pooling, parameterized queries, stored procedures, transactions, bulk operations, and streaming. This skill covers patterns for building robust SQL Server integrations with emphasis on Node-RED node development.

## Quick Reference

| Task | Pattern |
|------|---------|
| Create pool | `new sql.ConnectionPool(config)` |
| Connect | `await pool.connect()` |
| Simple query | `await pool.request().query('SELECT ...')` |
| Parameterized query | `request.input('name', sql.VarChar, value).query('SELECT ... WHERE name = @name')` |
| Stored procedure | `await request.execute('sp_name')` |
| Transaction | `const tx = new sql.Transaction(pool)` |
| Bulk insert | `const table = new sql.Table('name')` |
| Stream results | `request.stream = true` |
| Close pool | `await pool.close()` |

## Connection Configuration

### Basic Connection

```javascript
const sql = require('mssql');

const config = {
  user: 'username',
  password: 'password',
  server: 'localhost',
  database: 'mydb',
  options: {
    encrypt: true,              // Required for Azure
    trustServerCertificate: true, // For local dev with self-signed certs
  },
};

// Create and connect pool
const pool = new sql.ConnectionPool(config);
await pool.connect();

// Execute query
const result = await pool.request().query('SELECT * FROM Users');
console.log(result.recordset);

// Close when done
await pool.close();
```

### Connection Configuration Options

```javascript
const config = {
  // Required
  user: 'username',
  password: 'password',
  server: 'localhost',           // Can be IP or hostname
  database: 'mydb',

  // Port (default: 1433)
  port: 1433,

  // Connection pool settings
  pool: {
    max: 10,                     // Maximum pool size
    min: 0,                      // Minimum pool size
    idleTimeoutMillis: 30000,    // Close idle connections after 30s
    acquireTimeoutMillis: 15000, // Timeout for acquiring connection
  },

  // TLS/SSL options
  options: {
    encrypt: true,               // Use encryption (required for Azure SQL)
    trustServerCertificate: false, // Change to true for local dev
    enableArithAbort: true,      // Recommended for SQL Server 2019+

    // Connection behavior
    connectTimeout: 15000,       // Connection timeout in ms
    requestTimeout: 15000,       // Request timeout in ms
    cancelTimeout: 5000,         // Cancellation timeout

    // TLS options
    cryptoCredentialsDetails: {
      minVersion: 'TLSv1.2',
    },
  },

  // Named instance (alternative to port)
  // server: 'localhost\\SQLEXPRESS',

  // Domain authentication (Windows)
  // domain: 'MYDOMAIN',
};
```

### Authentication Methods

#### SQL Server Authentication

```javascript
const config = {
  user: 'sa',
  password: 'YourPassword123!',
  server: 'localhost',
  database: 'mydb',
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};
```

#### Windows Authentication (NTLM)

```javascript
const config = {
  server: 'localhost',
  database: 'mydb',
  domain: 'MYDOMAIN',
  user: 'domainuser',
  password: 'password',
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

// Or use integrated security (current Windows user)
const config = {
  server: 'localhost',
  database: 'mydb',
  options: {
    trustedConnection: true,
    encrypt: true,
  },
};
```

#### Azure Active Directory Authentication

```javascript
// Azure AD with password
const config = {
  server: 'your-server.database.windows.net',
  database: 'mydb',
  user: 'user@yourdomain.com',
  password: 'password',
  options: {
    encrypt: true,
  },
  authentication: {
    type: 'azure-active-directory-password',
  },
};

// Azure AD with access token
const config = {
  server: 'your-server.database.windows.net',
  database: 'mydb',
  options: {
    encrypt: true,
  },
  authentication: {
    type: 'azure-active-directory-access-token',
    options: {
      token: 'your-access-token',
    },
  },
};

// Azure AD with managed identity (for Azure VMs/App Service)
const config = {
  server: 'your-server.database.windows.net',
  database: 'mydb',
  options: {
    encrypt: true,
  },
  authentication: {
    type: 'azure-active-directory-msi-vm',
    // or 'azure-active-directory-msi-app-service'
  },
};
```

### Connection Pooling

```javascript
const sql = require('mssql');

// Global pool (singleton pattern)
let pool = null;

async function getPool() {
  if (!pool) {
    pool = new sql.ConnectionPool(config);
    pool.on('error', (err) => {
      console.error('Pool error:', err);
      pool = null; // Reset pool on error
    });
    await pool.connect();
  }
  return pool;
}

// Usage
async function queryUsers() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Users');
  return result.recordset;
}

// Cleanup on shutdown
async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}
```

### Connection Events

```javascript
const pool = new sql.ConnectionPool(config);

// Pool events
pool.on('connect', () => {
  console.log('Pool connected');
});

pool.on('close', () => {
  console.log('Pool closed');
});

pool.on('error', (err) => {
  console.error('Pool error:', err);
});

// Connection acquire/release
pool.on('acquire', (connection) => {
  console.log('Connection acquired');
});

pool.on('release', (connection) => {
  console.log('Connection released');
});

await pool.connect();
```

## Query Execution

### Simple Queries

```javascript
const pool = await sql.connect(config);

// SELECT query
const result = await pool.request().query('SELECT * FROM Users WHERE active = 1');

// Result structure
console.log(result.recordset);     // Array of rows
console.log(result.recordsets);    // Array of recordsets (for multiple result sets)
console.log(result.rowsAffected);  // Array of affected row counts
console.log(result.output);        // Output parameters (stored procedures)

// INSERT/UPDATE/DELETE
const insertResult = await pool.request().query(`
  INSERT INTO Users (name, email) VALUES ('John', 'john@example.com')
`);
console.log(insertResult.rowsAffected[0]); // Number of rows inserted
```

### Parameterized Queries (Preventing SQL Injection)

```javascript
const pool = await sql.connect(config);
const request = pool.request();

// Add input parameters with explicit types
request.input('name', sql.VarChar(100), 'John');
request.input('email', sql.VarChar(255), 'john@example.com');
request.input('age', sql.Int, 30);
request.input('active', sql.Bit, true);
request.input('created', sql.DateTime, new Date());

const result = await request.query(`
  INSERT INTO Users (name, email, age, active, created_at)
  VALUES (@name, @email, @age, @active, @created)
`);

// SELECT with parameters
const searchRequest = pool.request();
searchRequest.input('searchTerm', sql.VarChar(100), '%john%');
const searchResult = await searchRequest.query(`
  SELECT * FROM Users WHERE name LIKE @searchTerm
`);
```

### Prepared Statements

```javascript
const pool = await sql.connect(config);

// Create prepared statement
const ps = new sql.PreparedStatement(pool);
ps.input('userId', sql.Int);

await ps.prepare('SELECT * FROM Users WHERE id = @userId');

// Execute multiple times
const result1 = await ps.execute({ userId: 1 });
const result2 = await ps.execute({ userId: 2 });
const result3 = await ps.execute({ userId: 3 });

// Unprepare when done
await ps.unprepare();
```

### Stored Procedures

```javascript
const pool = await sql.connect(config);
const request = pool.request();

// Input parameters
request.input('userId', sql.Int, 123);
request.input('newEmail', sql.VarChar(255), 'new@example.com');

// Output parameters
request.output('success', sql.Bit);
request.output('message', sql.VarChar(500));

// Execute stored procedure
const result = await request.execute('UpdateUserEmail');

// Access results
console.log(result.recordset);           // Result rows
console.log(result.output.success);      // Output parameter value
console.log(result.output.message);      // Output parameter value
console.log(result.returnValue);         // RETURN value from procedure
```

### Multiple Result Sets

```javascript
const pool = await sql.connect(config);

// Query returning multiple result sets
const result = await pool.request().query(`
  SELECT * FROM Users;
  SELECT * FROM Orders;
  SELECT COUNT(*) as total FROM Products;
`);

// Access each result set
const users = result.recordsets[0];
const orders = result.recordsets[1];
const productCount = result.recordsets[2][0].total;

// Or with stored procedure
const spResult = await pool.request().execute('GetDashboardData');
const [summary, recentActivity, alerts] = spResult.recordsets;
```

## Transaction Handling

### Basic Transaction

```javascript
const pool = await sql.connect(config);
const transaction = new sql.Transaction(pool);

try {
  await transaction.begin();

  const request = new sql.Request(transaction);

  // First operation
  request.input('name', sql.VarChar(100), 'John');
  await request.query('INSERT INTO Users (name) VALUES (@name)');

  // Second operation
  const request2 = new sql.Request(transaction);
  request2.input('userId', sql.Int, 1);
  request2.input('amount', sql.Decimal(10, 2), 100.00);
  await request2.query('INSERT INTO Balances (user_id, amount) VALUES (@userId, @amount)');

  await transaction.commit();
  console.log('Transaction committed');
} catch (err) {
  await transaction.rollback();
  console.error('Transaction rolled back:', err);
  throw err;
}
```

### Transaction Isolation Levels

```javascript
const transaction = new sql.Transaction(pool);

// Set isolation level before beginning
await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

// Available isolation levels:
// sql.ISOLATION_LEVEL.READ_UNCOMMITTED
// sql.ISOLATION_LEVEL.READ_COMMITTED (default)
// sql.ISOLATION_LEVEL.REPEATABLE_READ
// sql.ISOLATION_LEVEL.SERIALIZABLE
// sql.ISOLATION_LEVEL.SNAPSHOT

// Execute queries...

await transaction.commit();
```

### Savepoints

```javascript
const pool = await sql.connect(config);
const transaction = new sql.Transaction(pool);

try {
  await transaction.begin();

  // First operation
  const request1 = new sql.Request(transaction);
  await request1.query('INSERT INTO AuditLog (action) VALUES (\'started\')');

  // Create savepoint
  await new sql.Request(transaction).query('SAVE TRANSACTION SavePoint1');

  try {
    // Risky operation
    const request2 = new sql.Request(transaction);
    await request2.query('UPDATE Inventory SET quantity = quantity - 1 WHERE id = 1');

    // Check condition
    const check = await new sql.Request(transaction).query(
      'SELECT quantity FROM Inventory WHERE id = 1'
    );
    if (check.recordset[0].quantity < 0) {
      throw new Error('Insufficient inventory');
    }
  } catch (innerErr) {
    // Rollback to savepoint (keeps earlier operations)
    await new sql.Request(transaction).query('ROLLBACK TRANSACTION SavePoint1');
    console.log('Rolled back to savepoint:', innerErr.message);
  }

  // Continue with other operations...
  await transaction.commit();
} catch (err) {
  await transaction.rollback();
  throw err;
}
```

### Transaction Events

```javascript
const transaction = new sql.Transaction(pool);

transaction.on('begin', () => {
  console.log('Transaction begun');
});

transaction.on('commit', () => {
  console.log('Transaction committed');
});

transaction.on('rollback', (aborted) => {
  console.log('Transaction rolled back', aborted ? '(aborted)' : '');
});
```

## Bulk Operations

### Bulk Insert

```javascript
const pool = await sql.connect(config);

// Create table definition
const table = new sql.Table('Users');
table.create = false; // Don't create table if not exists

// Define columns (must match table structure)
table.columns.add('name', sql.VarChar(100), { nullable: false });
table.columns.add('email', sql.VarChar(255), { nullable: false });
table.columns.add('age', sql.Int, { nullable: true });
table.columns.add('created_at', sql.DateTime, { nullable: false });

// Add rows
const users = [
  { name: 'John', email: 'john@example.com', age: 30 },
  { name: 'Jane', email: 'jane@example.com', age: 25 },
  { name: 'Bob', email: 'bob@example.com', age: null },
];

users.forEach((user) => {
  table.rows.add(user.name, user.email, user.age, new Date());
});

// Execute bulk insert
const request = pool.request();
const result = await request.bulk(table);
console.log(`Inserted ${result.rowsAffected} rows`);
```

### Bulk Insert with Options

```javascript
const table = new sql.Table('Products');

// Column options
table.columns.add('id', sql.Int, { nullable: false, primary: true });
table.columns.add('name', sql.VarChar(200), { nullable: false });
table.columns.add('price', sql.Decimal(10, 2), { nullable: false });
table.columns.add('category_id', sql.Int, { nullable: true });

// Add data
products.forEach((p) => {
  table.rows.add(p.id, p.name, p.price, p.categoryId);
});

// Bulk insert options
const request = pool.request();
request.bulk(table, {
  keepNulls: true,           // Keep NULL values (default: false)
  checkConstraints: true,    // Check constraints (default: false)
  tableLock: true,           // Use table lock for performance
  fireTriggers: false,       // Don't fire triggers (default: false)
});
```

### Bulk Insert with Transaction

```javascript
const transaction = new sql.Transaction(pool);
await transaction.begin();

try {
  const table = new sql.Table('Orders');
  table.columns.add('product_id', sql.Int, { nullable: false });
  table.columns.add('quantity', sql.Int, { nullable: false });

  orderItems.forEach((item) => {
    table.rows.add(item.productId, item.quantity);
  });

  const request = new sql.Request(transaction);
  await request.bulk(table);

  await transaction.commit();
} catch (err) {
  await transaction.rollback();
  throw err;
}
```

## Streaming Large Result Sets

### Basic Streaming

```javascript
const pool = await sql.connect(config);
const request = pool.request();

// Enable streaming
request.stream = true;

// Event handlers
request.on('recordset', (columns) => {
  console.log('Columns:', Object.keys(columns));
});

request.on('row', (row) => {
  // Process each row as it arrives
  console.log('Row:', row);
});

request.on('rowsaffected', (count) => {
  console.log('Rows affected:', count);
});

request.on('error', (err) => {
  console.error('Stream error:', err);
});

request.on('done', (result) => {
  console.log('Stream complete');
});

// Execute query
request.query('SELECT * FROM LargeTable');
```

### Streaming with Backpressure

```javascript
const { Writable } = require('stream');
const pool = await sql.connect(config);

async function streamToFile(query, outputPath) {
  const fs = require('fs');
  const writeStream = fs.createWriteStream(outputPath);
  const request = pool.request();
  request.stream = true;

  return new Promise((resolve, reject) => {
    let paused = false;

    request.on('row', (row) => {
      const line = JSON.stringify(row) + '\n';
      const canContinue = writeStream.write(line);

      if (!canContinue && !paused) {
        paused = true;
        request.pause();

        writeStream.once('drain', () => {
          paused = false;
          request.resume();
        });
      }
    });

    request.on('error', (err) => {
      writeStream.end();
      reject(err);
    });

    request.on('done', () => {
      writeStream.end();
      resolve();
    });

    request.query(query);
  });
}
```

### Streaming to Transform Pipeline

```javascript
const { Transform, pipeline } = require('stream');
const pool = await sql.connect(config);

function createRowStream(query) {
  const request = pool.request();
  request.stream = true;

  const transform = new Transform({
    objectMode: true,
    transform(row, encoding, callback) {
      // Transform row data
      callback(null, {
        ...row,
        processed_at: new Date().toISOString(),
      });
    },
  });

  request.on('row', (row) => {
    if (!transform.write(row)) {
      request.pause();
      transform.once('drain', () => request.resume());
    }
  });

  request.on('error', (err) => transform.destroy(err));
  request.on('done', () => transform.end());

  request.query(query);

  return transform;
}

// Usage with pipeline
const rowStream = createRowStream('SELECT * FROM Events');
pipeline(
  rowStream,
  createJsonOutputStream(),
  fs.createWriteStream('output.json'),
  (err) => {
    if (err) console.error('Pipeline failed:', err);
    else console.log('Pipeline succeeded');
  }
);
```

## Error Handling

### Error Types

```javascript
const sql = require('mssql');

try {
  await pool.request().query('SELECT * FROM NonExistentTable');
} catch (err) {
  // Connection errors
  if (err instanceof sql.ConnectionError) {
    console.error('Connection failed:', err.message);
  }

  // Query/Request errors
  if (err instanceof sql.RequestError) {
    console.error('Query failed:', err.message);
    console.error('Error number:', err.number);
    console.error('State:', err.state);
    console.error('Class:', err.class); // Severity
    console.error('Line number:', err.lineNumber);
    console.error('Procedure:', err.procName);
  }

  // Transaction errors
  if (err instanceof sql.TransactionError) {
    console.error('Transaction failed:', err.message);
  }

  // Prepared statement errors
  if (err instanceof sql.PreparedStatementError) {
    console.error('Prepared statement failed:', err.message);
  }

  // Generic mssql error
  if (err instanceof sql.MSSQLError) {
    console.error('MSSQL error:', err.message);
    console.error('Code:', err.code);
  }
}
```

### Common Error Codes

| Error Number | Description | Handling |
|--------------|-------------|----------|
| 18456 | Login failed | Check credentials |
| 4060 | Cannot open database | Check database name |
| 53 | Network error | Check server/port |
| 547 | FK constraint violation | Check related records |
| 2601/2627 | Unique constraint | Handle duplicates |
| 1205 | Deadlock victim | Retry transaction |
| 8152 | String truncation | Check data length |

### Retry Logic

```javascript
async function executeWithRetry(fn, maxRetries = 3, delay = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Retry on transient errors
      const isRetryable =
        err.code === 'ESOCKET' ||           // Network error
        err.code === 'ECONNCLOSED' ||       // Connection closed
        err.number === 1205 ||              // Deadlock
        err.number === -2;                  // Timeout

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }

  throw lastError;
}

// Usage
const result = await executeWithRetry(async () => {
  return pool.request().query('SELECT * FROM Users');
});
```

### Error Handling Best Practices

```javascript
const sql = require('mssql');

class DatabaseService {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async connect() {
    try {
      this.pool = await sql.connect(this.config);
      this.pool.on('error', (err) => {
        console.error('Pool error:', err);
        this.pool = null;
      });
    } catch (err) {
      if (err.code === 'ESOCKET') {
        throw new Error(`Cannot connect to SQL Server at ${this.config.server}`);
      }
      if (err.number === 18456) {
        throw new Error('Invalid SQL Server credentials');
      }
      throw err;
    }
  }

  async query(sql, params = {}) {
    if (!this.pool) {
      await this.connect();
    }

    const request = this.pool.request();

    // Add parameters safely
    for (const [name, value] of Object.entries(params)) {
      request.input(name, value);
    }

    try {
      return await request.query(sql);
    } catch (err) {
      // Log for debugging but don't expose SQL details to caller
      console.error('Query error:', {
        message: err.message,
        number: err.number,
        state: err.state,
      });

      // Transform to user-friendly errors
      if (err.number === 547) {
        throw new Error('Operation failed due to related records');
      }
      if (err.number === 2627 || err.number === 2601) {
        throw new Error('Record already exists');
      }

      throw new Error('Database operation failed');
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }
}
```

## Data Type Mappings

### SQL Server to JavaScript Types

| SQL Server Type | mssql Constant | JavaScript Type |
|-----------------|----------------|-----------------|
| `INT` | `sql.Int` | `number` |
| `BIGINT` | `sql.BigInt` | `string` (precision loss) |
| `SMALLINT` | `sql.SmallInt` | `number` |
| `TINYINT` | `sql.TinyInt` | `number` |
| `BIT` | `sql.Bit` | `boolean` |
| `DECIMAL(p,s)` | `sql.Decimal(p, s)` | `number` |
| `NUMERIC(p,s)` | `sql.Numeric(p, s)` | `number` |
| `FLOAT` | `sql.Float` | `number` |
| `REAL` | `sql.Real` | `number` |
| `MONEY` | `sql.Money` | `number` |
| `SMALLMONEY` | `sql.SmallMoney` | `number` |
| `VARCHAR(n)` | `sql.VarChar(n)` | `string` |
| `NVARCHAR(n)` | `sql.NVarChar(n)` | `string` |
| `CHAR(n)` | `sql.Char(n)` | `string` |
| `NCHAR(n)` | `sql.NChar(n)` | `string` |
| `TEXT` | `sql.Text` | `string` |
| `NTEXT` | `sql.NText` | `string` |
| `VARCHAR(MAX)` | `sql.VarChar(sql.MAX)` | `string` |
| `NVARCHAR(MAX)` | `sql.NVarChar(sql.MAX)` | `string` |
| `DATETIME` | `sql.DateTime` | `Date` |
| `DATETIME2` | `sql.DateTime2` | `Date` |
| `DATETIMEOFFSET` | `sql.DateTimeOffset` | `Date` |
| `DATE` | `sql.Date` | `Date` |
| `TIME` | `sql.Time` | `Date` |
| `SMALLDATETIME` | `sql.SmallDateTime` | `Date` |
| `BINARY(n)` | `sql.Binary(n)` | `Buffer` |
| `VARBINARY(n)` | `sql.VarBinary(n)` | `Buffer` |
| `VARBINARY(MAX)` | `sql.VarBinary(sql.MAX)` | `Buffer` |
| `IMAGE` | `sql.Image` | `Buffer` |
| `UNIQUEIDENTIFIER` | `sql.UniqueIdentifier` | `string` |
| `XML` | `sql.Xml` | `string` |
| `GEOGRAPHY` | `sql.Geography` | `object` (GeoJSON) |
| `GEOMETRY` | `sql.Geometry` | `object` |

### Type Usage Examples

```javascript
const sql = require('mssql');
const request = pool.request();

// Strings
request.input('name', sql.VarChar(100), 'John');
request.input('description', sql.NVarChar(sql.MAX), 'Long text with unicode: 日本語');

// Numbers
request.input('count', sql.Int, 42);
request.input('price', sql.Decimal(10, 2), 99.99);
request.input('percentage', sql.Float, 0.15);

// Boolean
request.input('active', sql.Bit, true);

// Dates
request.input('created', sql.DateTime2, new Date());
request.input('dateOnly', sql.Date, new Date('2024-01-15'));

// Binary
request.input('fileData', sql.VarBinary(sql.MAX), Buffer.from('binary data'));

// GUID
request.input('guid', sql.UniqueIdentifier, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

// Table-valued parameter (TVP)
const tvp = new sql.Table();
tvp.columns.add('id', sql.Int);
tvp.columns.add('name', sql.VarChar(100));
tvp.rows.add(1, 'First');
tvp.rows.add(2, 'Second');
request.input('items', tvp);
```

## Node-RED Integration

### Connection Configuration Node

```javascript
// mssql-config.js
module.exports = function (RED) {
  const sql = require('mssql');

  function MssqlConfigNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Build connection config from node settings and credentials
    this.connectionConfig = {
      server: config.server,
      port: parseInt(config.port) || 1433,
      database: config.database,
      user: this.credentials.username,
      password: this.credentials.password,
      options: {
        encrypt: config.encrypt,
        trustServerCertificate: config.trustServerCertificate,
        connectTimeout: parseInt(config.connectTimeout) || 15000,
        requestTimeout: parseInt(config.requestTimeout) || 15000,
      },
      pool: {
        max: parseInt(config.poolMax) || 10,
        min: parseInt(config.poolMin) || 0,
        idleTimeoutMillis: parseInt(config.poolIdleTimeout) || 30000,
      },
    };

    // Pool management
    this.pool = null;
    this.connecting = false;
    this.users = new Set();

    // Get or create connection pool
    this.getPool = async function () {
      if (this.pool && this.pool.connected) {
        return this.pool;
      }

      if (this.connecting) {
        // Wait for existing connection attempt
        await new Promise((resolve) => {
          const check = setInterval(() => {
            if (!this.connecting) {
              clearInterval(check);
              resolve();
            }
          }, 100);
        });
        return this.pool;
      }

      this.connecting = true;

      try {
        this.pool = new sql.ConnectionPool(this.connectionConfig);

        this.pool.on('error', (err) => {
          node.error(`Pool error: ${err.message}`);
          this.pool = null;
        });

        await this.pool.connect();
        node.log(`Connected to ${config.server}/${config.database}`);
        return this.pool;
      } catch (err) {
        this.pool = null;
        throw err;
      } finally {
        this.connecting = false;
      }
    };

    // Register using node
    this.register = function (queryNode) {
      this.users.add(queryNode.id);
    };

    // Deregister node
    this.deregister = async function (queryNode, done) {
      this.users.delete(queryNode.id);

      if (this.users.size === 0 && this.pool) {
        try {
          await this.pool.close();
          this.pool = null;
          node.log('Pool closed (no active users)');
        } catch (err) {
          node.error(`Error closing pool: ${err.message}`);
        }
      }
      done();
    };

    // Cleanup on node removal
    this.on('close', async function (done) {
      if (this.pool) {
        try {
          await this.pool.close();
          this.pool = null;
        } catch (err) {
          node.error(`Error closing pool: ${err.message}`);
        }
      }
      done();
    });
  }

  RED.nodes.registerType('mssql-config', MssqlConfigNode, {
    credentials: {
      username: { type: 'text' },
      password: { type: 'password' },
    },
  });
};
```

### Query Node

```javascript
// mssql-query.js
module.exports = function (RED) {
  const sql = require('mssql');

  function MssqlQueryNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get config node
    this.configNode = RED.nodes.getNode(config.mssqlConfig);

    if (!this.configNode) {
      node.error('No database configuration');
      node.status({ fill: 'red', shape: 'ring', text: 'no config' });
      return;
    }

    // Register with config node
    this.configNode.register(this);

    node.on('input', async function (msg, send, done) {
      // Use query from config or message
      const query = config.query || msg.query;

      if (!query) {
        node.status({ fill: 'red', shape: 'ring', text: 'no query' });
        done(new Error('No query specified'));
        return;
      }

      node.status({ fill: 'blue', shape: 'dot', text: 'querying' });

      try {
        const pool = await node.configNode.getPool();
        const request = pool.request();

        // Add parameters from msg.params
        if (msg.params && typeof msg.params === 'object') {
          for (const [name, param] of Object.entries(msg.params)) {
            if (typeof param === 'object' && param.type && 'value' in param) {
              // Typed parameter: { type: sql.Int, value: 123 }
              request.input(name, param.type, param.value);
            } else {
              // Auto-detect type
              request.input(name, param);
            }
          }
        }

        const result = await request.query(query);

        msg.payload = result.recordset || [];
        msg.recordsets = result.recordsets;
        msg.rowsAffected = result.rowsAffected;

        node.status({
          fill: 'green',
          shape: 'dot',
          text: `${result.recordset?.length || 0} rows`,
        });

        send(msg);
        done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: err.message });
        done(err);
      }
    });

    node.on('close', function (done) {
      node.configNode.deregister(node, done);
    });
  }

  RED.nodes.registerType('mssql-query', MssqlQueryNode);
};
```

### Stored Procedure Node

```javascript
// mssql-procedure.js
module.exports = function (RED) {
  const sql = require('mssql');

  function MssqlProcedureNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    this.configNode = RED.nodes.getNode(config.mssqlConfig);

    if (!this.configNode) {
      node.error('No database configuration');
      return;
    }

    this.configNode.register(this);

    node.on('input', async function (msg, send, done) {
      const procedure = config.procedure || msg.procedure;

      if (!procedure) {
        done(new Error('No procedure specified'));
        return;
      }

      node.status({ fill: 'blue', shape: 'dot', text: 'executing' });

      try {
        const pool = await node.configNode.getPool();
        const request = pool.request();

        // Input parameters
        if (msg.params) {
          for (const [name, param] of Object.entries(msg.params)) {
            if (typeof param === 'object' && param.type) {
              request.input(name, param.type, param.value);
            } else {
              request.input(name, param);
            }
          }
        }

        // Output parameters
        if (msg.outputParams) {
          for (const [name, param] of Object.entries(msg.outputParams)) {
            request.output(name, param.type, param.value);
          }
        }

        const result = await request.execute(procedure);

        msg.payload = result.recordset || [];
        msg.recordsets = result.recordsets;
        msg.output = result.output;
        msg.returnValue = result.returnValue;
        msg.rowsAffected = result.rowsAffected;

        node.status({ fill: 'green', shape: 'dot', text: 'done' });
        send(msg);
        done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: err.message });
        done(err);
      }
    });

    node.on('close', function (done) {
      node.configNode.deregister(node, done);
    });
  }

  RED.nodes.registerType('mssql-procedure', MssqlProcedureNode);
};
```

### Transaction Node Pattern

```javascript
// mssql-transaction.js
module.exports = function (RED) {
  const sql = require('mssql');

  function MssqlTransactionNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    this.configNode = RED.nodes.getNode(config.mssqlConfig);

    if (!this.configNode) {
      node.error('No database configuration');
      return;
    }

    this.configNode.register(this);

    node.on('input', async function (msg, send, done) {
      const action = msg.action || config.action || 'begin';

      try {
        const pool = await node.configNode.getPool();

        switch (action) {
          case 'begin': {
            const transaction = new sql.Transaction(pool);
            await transaction.begin();
            msg._transaction = transaction;
            msg._transactionId = Date.now().toString();
            node.status({ fill: 'yellow', shape: 'dot', text: 'transaction active' });
            break;
          }

          case 'commit': {
            if (!msg._transaction) {
              throw new Error('No active transaction');
            }
            await msg._transaction.commit();
            delete msg._transaction;
            delete msg._transactionId;
            node.status({ fill: 'green', shape: 'dot', text: 'committed' });
            break;
          }

          case 'rollback': {
            if (!msg._transaction) {
              throw new Error('No active transaction');
            }
            await msg._transaction.rollback();
            delete msg._transaction;
            delete msg._transactionId;
            node.status({ fill: 'yellow', shape: 'ring', text: 'rolled back' });
            break;
          }

          case 'query': {
            if (!msg._transaction) {
              throw new Error('No active transaction');
            }
            const request = new sql.Request(msg._transaction);

            if (msg.params) {
              for (const [name, param] of Object.entries(msg.params)) {
                if (typeof param === 'object' && param.type) {
                  request.input(name, param.type, param.value);
                } else {
                  request.input(name, param);
                }
              }
            }

            const result = await request.query(msg.query);
            msg.payload = result.recordset || [];
            msg.rowsAffected = result.rowsAffected;
            break;
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }

        send(msg);
        done();
      } catch (err) {
        // Auto-rollback on error if transaction exists
        if (msg._transaction) {
          try {
            await msg._transaction.rollback();
          } catch (rollbackErr) {
            node.error(`Rollback failed: ${rollbackErr.message}`);
          }
          delete msg._transaction;
          delete msg._transactionId;
        }

        node.status({ fill: 'red', shape: 'ring', text: err.message });
        done(err);
      }
    });

    node.on('close', function (done) {
      node.configNode.deregister(node, done);
    });
  }

  RED.nodes.registerType('mssql-transaction', MssqlTransactionNode);
};
```

## Testing Patterns

### Mocking the mssql Package

```javascript
const sinon = require('sinon');

// Create mock pool and request
function createMockPool() {
  const mockRequest = {
    input: sinon.stub().returnsThis(),
    output: sinon.stub().returnsThis(),
    query: sinon.stub(),
    execute: sinon.stub(),
    bulk: sinon.stub(),
  };

  const mockTransaction = {
    begin: sinon.stub().resolves(),
    commit: sinon.stub().resolves(),
    rollback: sinon.stub().resolves(),
  };

  const mockPool = {
    connect: sinon.stub().resolves(),
    close: sinon.stub().resolves(),
    request: sinon.stub().returns(mockRequest),
    connected: true,
    on: sinon.stub(),
  };

  return { mockPool, mockRequest, mockTransaction };
}

// Usage in tests
describe('DatabaseService', function () {
  let sql;
  let mockPool;
  let mockRequest;

  beforeEach(function () {
    const mocks = createMockPool();
    mockPool = mocks.mockPool;
    mockRequest = mocks.mockRequest;

    sql = {
      ConnectionPool: sinon.stub().returns(mockPool),
      Request: sinon.stub().returns(mockRequest),
      Int: 'int',
      VarChar: sinon.stub().returns('varchar'),
    };
  });

  it('should execute query with parameters', async function () {
    mockRequest.query.resolves({
      recordset: [{ id: 1, name: 'Test' }],
      rowsAffected: [1],
    });

    const service = new DatabaseService(sql, config);
    await service.connect();

    const result = await service.query('SELECT * FROM Users WHERE id = @id', {
      id: 1,
    });

    expect(mockRequest.input.calledWith('id', 1)).to.be.true;
    expect(result.recordset).to.have.length(1);
  });
});
```

### Testing Node-RED Nodes

```javascript
const helper = require('node-red-node-test-helper');
const mssqlConfigNode = require('../nodes/mssql-config');
const mssqlQueryNode = require('../nodes/mssql-query');
const sinon = require('sinon');

describe('MSSQL Query Node', function () {
  beforeEach(function (done) {
    helper.startServer(done);
  });

  afterEach(function (done) {
    helper.unload().then(() => helper.stopServer(done));
  });

  it('should query database and output results', async function () {
    // Mock the sql module
    const mockResult = {
      recordset: [{ id: 1, name: 'Test User' }],
      rowsAffected: [1],
    };

    const mockRequest = {
      input: sinon.stub().returnsThis(),
      query: sinon.stub().resolves(mockResult),
    };

    const mockPool = {
      connect: sinon.stub().resolves(),
      close: sinon.stub().resolves(),
      request: sinon.stub().returns(mockRequest),
      connected: true,
      on: sinon.stub(),
    };

    // Stub require for mssql
    const proxyquire = require('proxyquire');
    const mssqlStub = {
      ConnectionPool: sinon.stub().returns(mockPool),
    };

    const flow = [
      {
        id: 'config1',
        type: 'mssql-config',
        server: 'localhost',
        database: 'testdb',
      },
      {
        id: 'query1',
        type: 'mssql-query',
        mssqlConfig: 'config1',
        query: 'SELECT * FROM Users',
        wires: [['helper1']],
      },
      { id: 'helper1', type: 'helper' },
    ];

    await helper.load([mssqlConfigNode, mssqlQueryNode], flow, {
      config1: { username: 'user', password: 'pass' },
    });

    const queryNode = helper.getNode('query1');
    const helperNode = helper.getNode('helper1');

    const msgPromise = new Promise((resolve) => {
      helperNode.on('input', resolve);
    });

    queryNode.receive({ payload: {} });

    const msg = await msgPromise;
    expect(msg.payload).to.deep.equal([{ id: 1, name: 'Test User' }]);
  });
});
```

### Integration Testing

```javascript
const sql = require('mssql');

describe('Database Integration Tests', function () {
  // Requires TEST_MSSQL_SERVER environment variable
  const config = {
    server: process.env.TEST_MSSQL_SERVER || 'localhost',
    database: process.env.TEST_MSSQL_DATABASE || 'testdb',
    user: process.env.TEST_MSSQL_USER || 'sa',
    password: process.env.TEST_MSSQL_PASSWORD || 'YourPassword123!',
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };

  let pool;

  before(async function () {
    this.timeout(10000);
    pool = await sql.connect(config);

    // Setup test table
    await pool.request().query(`
      IF OBJECT_ID('TestUsers', 'U') IS NOT NULL DROP TABLE TestUsers;
      CREATE TABLE TestUsers (
        id INT PRIMARY KEY IDENTITY,
        name NVARCHAR(100) NOT NULL,
        email NVARCHAR(255) NOT NULL
      );
    `);
  });

  after(async function () {
    // Cleanup
    await pool.request().query('DROP TABLE IF EXISTS TestUsers');
    await pool.close();
  });

  beforeEach(async function () {
    // Clear table before each test
    await pool.request().query('DELETE FROM TestUsers');
  });

  it('should insert and retrieve records', async function () {
    const request = pool.request();
    request.input('name', sql.NVarChar(100), 'Test User');
    request.input('email', sql.NVarChar(255), 'test@example.com');

    await request.query(`
      INSERT INTO TestUsers (name, email) VALUES (@name, @email)
    `);

    const result = await pool.request().query('SELECT * FROM TestUsers');

    expect(result.recordset).to.have.length(1);
    expect(result.recordset[0].name).to.equal('Test User');
  });

  it('should handle transactions', async function () {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const request = new sql.Request(transaction);
      request.input('name', sql.NVarChar(100), 'Transaction User');
      request.input('email', sql.NVarChar(255), 'tx@example.com');

      await request.query(`
        INSERT INTO TestUsers (name, email) VALUES (@name, @email)
      `);

      // Rollback instead of commit
      await transaction.rollback();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    // Verify no records exist
    const result = await pool.request().query('SELECT * FROM TestUsers');
    expect(result.recordset).to.have.length(0);
  });
});
```

## Graceful Shutdown

```javascript
const sql = require('mssql');

class DatabaseManager {
  constructor(config) {
    this.config = config;
    this.pool = null;
    this.shuttingDown = false;
  }

  async connect() {
    this.pool = new sql.ConnectionPool(this.config);

    this.pool.on('error', (err) => {
      console.error('Pool error:', err);
      if (!this.shuttingDown) {
        this.reconnect();
      }
    });

    await this.pool.connect();
    console.log('Database connected');
  }

  async reconnect() {
    console.log('Attempting to reconnect...');
    try {
      await this.connect();
    } catch (err) {
      console.error('Reconnection failed:', err);
      setTimeout(() => this.reconnect(), 5000);
    }
  }

  async shutdown(timeout = 10000) {
    this.shuttingDown = true;
    console.log('Initiating database shutdown...');

    if (!this.pool) {
      return;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn('Shutdown timeout, forcing close');
        resolve();
      }, timeout);

      this.pool
        .close()
        .then(() => {
          clearTimeout(timer);
          console.log('Database connection closed gracefully');
          resolve();
        })
        .catch((err) => {
          clearTimeout(timer);
          console.error('Error during shutdown:', err);
          resolve();
        });
    });
  }
}

// Usage with process signals
const db = new DatabaseManager(config);

process.on('SIGTERM', async () => {
  console.log('SIGTERM received');
  await db.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received');
  await db.shutdown();
  process.exit(0);
});
```

## References

For detailed information on specific topics:

- `references/data-type-mappings.md` - Complete SQL Server to JavaScript type mappings with examples
- `references/connection-strings.md` - Connection string formats and authentication examples
- `references/error-codes.md` - SQL Server error codes and handling strategies
- `references/performance-tuning.md` - Query optimization and connection pool tuning

## External Documentation

- [mssql npm package](https://www.npmjs.com/package/mssql)
- [mssql GitHub repository](https://github.com/tediousjs/node-mssql)
- [tedious (underlying driver)](https://github.com/tediousjs/tedious)
- [SQL Server Data Types](https://docs.microsoft.com/en-us/sql/t-sql/data-types/data-types-transact-sql)
