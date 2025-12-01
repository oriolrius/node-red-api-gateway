# SQL Server Performance Tuning

Best practices for optimizing mssql performance in Node.js applications.

## Connection Pool Optimization

### Pool Sizing

```javascript
// Calculate optimal pool size:
// pool_size = (core_count * 2) + effective_spindle_count
// For SSDs, use core_count * 2-4

const config = {
  // ... connection settings
  pool: {
    // For a 4-core server with SSD
    max: 16,                       // Maximum connections
    min: 4,                        // Pre-create some connections
    idleTimeoutMillis: 30000,      // Close idle connections after 30s
    acquireTimeoutMillis: 15000,   // Wait time for connection
  },
};
```

### Connection Reuse

```javascript
// GOOD: Singleton pool
let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

// Use throughout application
async function queryUsers() {
  const pool = await getPool();
  return pool.request().query('SELECT * FROM Users');
}

// BAD: Creating new connections
async function queryUsersBad() {
  const pool = await sql.connect(config);  // New connection each time!
  const result = await pool.request().query('SELECT * FROM Users');
  await pool.close();
  return result;
}
```

### Pool Monitoring

```javascript
const pool = await sql.connect(config);

// Log pool statistics periodically
setInterval(() => {
  const stats = {
    available: pool.pool.available,
    pending: pool.pool.pending,
    borrowed: pool.pool.borrowed,
    max: pool.pool.max,
    min: pool.pool.min,
  };
  console.log('Pool stats:', stats);

  // Alert if pool is exhausted
  if (stats.available === 0 && stats.pending > 0) {
    console.warn('Connection pool exhausted!');
  }
}, 60000);
```

## Query Optimization

### Use Parameterized Queries

```javascript
// GOOD: Parameterized (allows query plan caching)
const request = pool.request();
request.input('userId', sql.Int, userId);
await request.query('SELECT * FROM Users WHERE id = @userId');

// BAD: String concatenation (no plan reuse, SQL injection risk)
await pool.request().query(`SELECT * FROM Users WHERE id = ${userId}`);
```

### Prepared Statements for Repeated Queries

```javascript
// For queries executed many times with different parameters
const ps = new sql.PreparedStatement(pool);
ps.input('id', sql.Int);

await ps.prepare('SELECT * FROM Products WHERE category_id = @id');

// Execute multiple times - reuses execution plan
for (const categoryId of categoryIds) {
  const result = await ps.execute({ id: categoryId });
  // Process results
}

await ps.unprepare();
```

### Batch Multiple Operations

```javascript
// GOOD: Single round-trip for multiple operations
const result = await pool.request().query(`
  SELECT COUNT(*) as userCount FROM Users;
  SELECT COUNT(*) as orderCount FROM Orders;
  SELECT COUNT(*) as productCount FROM Products;
`);
const [users, orders, products] = result.recordsets;

// BAD: Multiple round-trips
const users = await pool.request().query('SELECT COUNT(*) FROM Users');
const orders = await pool.request().query('SELECT COUNT(*) FROM Orders');
const products = await pool.request().query('SELECT COUNT(*) FROM Products');
```

### Limit Result Sets

```javascript
// GOOD: Fetch only needed columns and rows
const request = pool.request();
request.input('limit', sql.Int, 100);
request.input('offset', sql.Int, page * 100);
await request.query(`
  SELECT id, name, email
  FROM Users
  ORDER BY created_at DESC
  OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
`);

// BAD: Fetch everything
await pool.request().query('SELECT * FROM Users');
```

### Use Appropriate Indexes

```javascript
// For frequently filtered columns
// CREATE INDEX IX_Users_Email ON Users(email);
// CREATE INDEX IX_Orders_UserId_Date ON Orders(user_id, order_date);

// Query using indexed columns
await request.query(`
  SELECT * FROM Orders
  WHERE user_id = @userId
  AND order_date >= @startDate
  ORDER BY order_date DESC
`);

// Check if index is being used
await pool.request().query(`
  SET SHOWPLAN_TEXT ON;
  GO
  SELECT * FROM Orders WHERE user_id = 123;
  GO
  SET SHOWPLAN_TEXT OFF;
`);
```

## Streaming for Large Results

### When to Stream

```javascript
// Use streaming when:
// - Result set > 10,000 rows
// - Memory is constrained
// - Processing can be done row by row

// Standard query (loads all into memory)
const result = await pool.request().query('SELECT * FROM BigTable');
// All rows in result.recordset (high memory)

// Streaming (processes row by row)
const request = pool.request();
request.stream = true;

request.on('row', (row) => {
  // Process one row at a time
  processRow(row);
});

request.query('SELECT * FROM BigTable');
```

### Streaming with Backpressure

```javascript
const { Writable } = require('stream');

async function exportLargeTable(outputPath) {
  const fs = require('fs');
  const request = pool.request();
  request.stream = true;

  const writeStream = fs.createWriteStream(outputPath);
  let rowCount = 0;

  return new Promise((resolve, reject) => {
    request.on('row', (row) => {
      rowCount++;
      const canContinue = writeStream.write(JSON.stringify(row) + '\n');

      // Backpressure: pause if write buffer is full
      if (!canContinue) {
        request.pause();
        writeStream.once('drain', () => request.resume());
      }
    });

    request.on('error', (err) => {
      writeStream.end();
      reject(err);
    });

    request.on('done', () => {
      writeStream.end();
      console.log(`Exported ${rowCount} rows`);
      resolve(rowCount);
    });

    request.query('SELECT * FROM BigTable');
  });
}
```

## Bulk Operations

### Bulk Insert Performance

```javascript
// GOOD: Bulk insert for large datasets
const table = new sql.Table('Products');
table.columns.add('name', sql.VarChar(100), { nullable: false });
table.columns.add('price', sql.Decimal(10, 2), { nullable: false });

// Add all rows
largeDataset.forEach((item) => {
  table.rows.add(item.name, item.price);
});

// Single bulk operation
await pool.request().bulk(table);

// BAD: Individual inserts
for (const item of largeDataset) {
  await pool.request()
    .input('name', sql.VarChar(100), item.name)
    .input('price', sql.Decimal(10, 2), item.price)
    .query('INSERT INTO Products (name, price) VALUES (@name, @price)');
}
```

### Bulk Insert Options

```javascript
const table = new sql.Table('LargeTable');
// ... define columns and add rows

const request = pool.request();

// Performance options
await request.bulk(table, {
  tableLock: true,           // Acquire table lock (faster for large inserts)
  checkConstraints: false,   // Skip constraint checks (ensure data is valid)
  fireTriggers: false,       // Skip triggers (if safe)
  keepNulls: false,          // Use defaults for null values
});
```

### Batch Large Bulk Operations

```javascript
// For very large datasets, batch into chunks
async function bulkInsertBatched(data, batchSize = 10000) {
  let processed = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    const table = new sql.Table('Products');
    table.columns.add('name', sql.VarChar(100), { nullable: false });
    table.columns.add('price', sql.Decimal(10, 2), { nullable: false });

    batch.forEach((item) => {
      table.rows.add(item.name, item.price);
    });

    await pool.request().bulk(table);
    processed += batch.length;
    console.log(`Processed ${processed}/${data.length} rows`);
  }
}
```

## Transaction Optimization

### Minimize Transaction Duration

```javascript
// GOOD: Short transaction
const transaction = new sql.Transaction(pool);
await transaction.begin();

try {
  // Do only database operations inside transaction
  await new sql.Request(transaction).query('UPDATE ...');
  await new sql.Request(transaction).query('INSERT ...');
  await transaction.commit();
} catch (err) {
  await transaction.rollback();
  throw err;
}

// BAD: Long-running transaction
const transaction = new sql.Transaction(pool);
await transaction.begin();

try {
  await new sql.Request(transaction).query('UPDATE ...');
  await callExternalAPI();  // Don't do this inside transaction!
  await processFiles();      // Don't do this inside transaction!
  await new sql.Request(transaction).query('INSERT ...');
  await transaction.commit();
} catch (err) {
  await transaction.rollback();
  throw err;
}
```

### Choose Appropriate Isolation Level

```javascript
// For read-heavy workloads with occasional writes
await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

// For reports that need consistent snapshot
await transaction.begin(sql.ISOLATION_LEVEL.SNAPSHOT);

// Avoid SERIALIZABLE unless absolutely necessary
// It causes significant blocking
```

### Use NOLOCK for Read-Only Queries (with caution)

```javascript
// For dashboard/reporting queries where slight inconsistency is acceptable
await pool.request().query(`
  SELECT COUNT(*) as total
  FROM Orders WITH (NOLOCK)
  WHERE status = 'pending'
`);

// WARNING: NOLOCK can read uncommitted data
// Only use for non-critical aggregations/reports
```

## Timeout Configuration

```javascript
const config = {
  // Connection settings
  options: {
    connectTimeout: 15000,    // Initial connection timeout
    requestTimeout: 30000,    // Default query timeout
  },
};

// Per-request timeout for long-running queries
const request = pool.request();
request.timeout = 300000;  // 5 minutes for this specific query
await request.query('SELECT * FROM HugeAnalyticsTable');

// Keep timeouts reasonable
// - Most queries: 15-30 seconds
// - Reports: 60-120 seconds
// - Batch jobs: 5-10 minutes
```

## Monitoring and Profiling

### Query Execution Time

```javascript
async function timedQuery(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;

    if (duration > 1000) {
      console.warn(`Slow query "${name}": ${duration}ms`);
    }

    return result;
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`Query "${name}" failed after ${duration}ms:`, err);
    throw err;
  }
}

// Usage
const users = await timedQuery('getActiveUsers', () =>
  pool.request().query('SELECT * FROM Users WHERE active = 1')
);
```

### Pool Health Check

```javascript
class PoolHealthMonitor {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.checkInterval = options.checkInterval || 30000;
    this.slowQueryThreshold = options.slowQueryThreshold || 5000;
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => this.check(), this.checkInterval);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async check() {
    const start = Date.now();

    try {
      // Simple connectivity check
      await this.pool.request().query('SELECT 1');
      const duration = Date.now() - start;

      const stats = {
        healthy: true,
        responseTime: duration,
        poolAvailable: this.pool.pool.available,
        poolBorrowed: this.pool.pool.borrowed,
        poolPending: this.pool.pool.pending,
      };

      if (duration > this.slowQueryThreshold) {
        stats.warning = 'Slow response time';
      }

      if (stats.poolPending > 0) {
        stats.warning = 'Connections pending';
      }

      return stats;
    } catch (err) {
      return {
        healthy: false,
        error: err.message,
      };
    }
  }
}
```

### SQL Server Statistics

```javascript
// Get query statistics from SQL Server
async function getQueryStats() {
  const result = await pool.request().query(`
    SELECT TOP 10
      qs.total_elapsed_time / qs.execution_count as avg_elapsed_time,
      qs.execution_count,
      SUBSTRING(qt.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset
          WHEN -1 THEN DATALENGTH(qt.text)
          ELSE qs.statement_end_offset
        END - qs.statement_start_offset)/2)+1) as query_text
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
    ORDER BY qs.total_elapsed_time / qs.execution_count DESC
  `);

  return result.recordset;
}

// Get blocking information
async function getBlockingInfo() {
  const result = await pool.request().query(`
    SELECT
      blocking_session_id,
      session_id,
      wait_type,
      wait_time,
      wait_resource
    FROM sys.dm_exec_requests
    WHERE blocking_session_id > 0
  `);

  return result.recordset;
}
```

## Best Practices Summary

1. **Connection Pool**
   - Use a singleton pool
   - Size pool appropriately for workload
   - Monitor pool health

2. **Queries**
   - Always use parameterized queries
   - Use prepared statements for repeated queries
   - Limit result sets with pagination
   - Batch multiple independent queries

3. **Large Data**
   - Stream large result sets
   - Use bulk operations for inserts
   - Batch bulk operations for very large datasets

4. **Transactions**
   - Keep transactions short
   - Use appropriate isolation levels
   - Avoid external calls inside transactions

5. **Monitoring**
   - Log slow queries
   - Monitor pool statistics
   - Track query execution times
