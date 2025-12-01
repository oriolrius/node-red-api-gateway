# SQL Server Error Codes and Handling

Reference for common SQL Server error codes and appropriate handling strategies.

## Error Structure

mssql errors contain these properties:

```javascript
{
  message: 'Error message',           // Human-readable message
  code: 'EREQUEST',                   // mssql error code
  number: 547,                        // SQL Server error number
  state: 0,                           // SQL Server state
  class: 16,                          // Severity class (1-25)
  lineNumber: 5,                      // Line number in SQL
  serverName: 'SERVER',               // Server name
  procName: 'sp_MyProcedure',         // Stored procedure name (if applicable)
  originalError: { ... }              // Original error object
}
```

## mssql Package Error Codes

| Code | Error Class | Description |
|------|-------------|-------------|
| `EREQUEST` | `RequestError` | Query/request execution error |
| `ECANCEL` | `RequestError` | Request cancelled |
| `ETIMEOUT` | `RequestError` | Request timeout |
| `EARGS` | `RequestError` | Invalid argument |
| `EINJECT` | `RequestError` | SQL injection attempt detected |
| `ENOCONN` | `RequestError` | No connection available |
| `ECONNECT` | `ConnectionError` | Connection error |
| `ELOGIN` | `ConnectionError` | Login failed |
| `ESOCKET` | `ConnectionError` | Socket error |
| `ECONNCLOSED` | `ConnectionError` | Connection closed |
| `ENOTOPEN` | `ConnectionError` | Connection not open |
| `EINSTLOOKUP` | `ConnectionError` | Instance lookup failed |
| `ETRANS` | `TransactionError` | Transaction error |
| `ENOTBEGUN` | `TransactionError` | Transaction not begun |
| `EALREADYBEGUN` | `TransactionError` | Transaction already begun |
| `EABORT` | `TransactionError` | Transaction aborted |
| `EPREPARED` | `PreparedStatementError` | Prepared statement error |
| `ENOTPREPARED` | `PreparedStatementError` | Statement not prepared |
| `EALREADYPREPARED` | `PreparedStatementError` | Statement already prepared |

## Common SQL Server Error Numbers

### Authentication Errors (Class 14)

| Number | Message | Cause | Solution |
|--------|---------|-------|----------|
| 18456 | Login failed | Invalid credentials | Verify username/password |
| 18452 | Login failed (trusted) | Windows auth failed | Check domain/trust |
| 18470 | Account disabled | Account is disabled | Enable the account |
| 18486 | Account locked | Too many failed attempts | Unlock the account |

```javascript
try {
  await pool.connect();
} catch (err) {
  if (err.number === 18456) {
    throw new Error('Invalid database credentials');
  }
  if (err.number === 18486) {
    throw new Error('Account locked - contact administrator');
  }
  throw err;
}
```

### Connection Errors

| Number | Message | Cause | Solution |
|--------|---------|-------|----------|
| 53 | Network error | Server unreachable | Check server/port/firewall |
| 40 | Could not open connection | Network issue | Check network connectivity |
| 10060 | Connection timed out | Timeout | Increase timeout, check network |
| 10061 | Connection refused | Port blocked | Check port, firewall |

```javascript
try {
  await pool.connect();
} catch (err) {
  if (err.code === 'ESOCKET' || err.number === 53) {
    throw new Error(`Cannot reach SQL Server at ${config.server}:${config.port}`);
  }
  if (err.code === 'ETIMEOUT') {
    throw new Error('Connection timed out - server may be overloaded');
  }
  throw err;
}
```

### Database Errors

| Number | Message | Cause | Solution |
|--------|---------|-------|----------|
| 4060 | Cannot open database | DB doesn't exist or no access | Check database name/permissions |
| 916 | Cannot access database | Cross-database permission | Grant access |
| 927 | Database cannot be opened | DB starting | Wait and retry |
| 945 | Database unavailable | DB offline or corrupted | DBA intervention needed |

```javascript
try {
  await pool.connect();
} catch (err) {
  if (err.number === 4060) {
    throw new Error(`Database '${config.database}' not found or access denied`);
  }
  if (err.number === 927 || err.number === 945) {
    throw new Error('Database temporarily unavailable - try again later');
  }
  throw err;
}
```

### Constraint Violations (Class 16)

| Number | Message | Cause | Solution |
|--------|---------|-------|----------|
| 547 | FK constraint violation | Referenced record doesn't exist | Check related records |
| 2601 | Unique index violation | Duplicate value | Check for duplicates |
| 2627 | Primary key violation | Duplicate PK value | Use unique PK |
| 515 | Cannot insert NULL | NOT NULL constraint | Provide value |
| 544 | Cannot insert explicit identity | IDENTITY_INSERT is OFF | Set IDENTITY_INSERT ON |
| 8152 | String truncation | Data too long for column | Check data length |

```javascript
async function insertUser(user) {
  try {
    const request = pool.request();
    request.input('email', sql.VarChar(255), user.email);
    await request.query('INSERT INTO Users (email) VALUES (@email)');
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      throw new Error('Email address already exists');
    }
    if (err.number === 515) {
      throw new Error('Required field is missing');
    }
    if (err.number === 8152) {
      throw new Error('Input data exceeds maximum length');
    }
    throw err;
  }
}
```

### Transaction Errors

| Number | Message | Cause | Solution |
|--------|---------|-------|----------|
| 1205 | Deadlock victim | Transaction deadlocked | Retry transaction |
| 1222 | Lock timeout | Could not acquire lock | Retry or increase timeout |
| 3930 | Transaction does not exist | Invalid transaction context | Check transaction state |
| 3902 | COMMIT without BEGIN | Transaction already ended | Check transaction logic |

```javascript
async function executeWithRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Retry on deadlock
      if (err.number === 1205 && attempt < maxRetries) {
        console.log(`Deadlock detected, retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, 100 * attempt));
        continue;
      }
      // Retry on lock timeout
      if (err.number === 1222 && attempt < maxRetries) {
        console.log(`Lock timeout, retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
      throw err;
    }
  }
}

// Usage
await executeWithRetry(async () => {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // ... operations
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
});
```

### Object/Permission Errors

| Number | Message | Cause | Solution |
|--------|---------|-------|----------|
| 208 | Invalid object name | Table/view doesn't exist | Check object name |
| 207 | Invalid column name | Column doesn't exist | Check column name |
| 229 | Permission denied | No SELECT/INSERT/etc permission | Grant permission |
| 262 | CREATE permission denied | No CREATE permission | Grant permission |

```javascript
try {
  await request.query('SELECT * FROM NonExistentTable');
} catch (err) {
  if (err.number === 208) {
    throw new Error('Table or view not found');
  }
  if (err.number === 207) {
    throw new Error('Column not found in table');
  }
  if (err.number === 229) {
    throw new Error('Permission denied for this operation');
  }
  throw err;
}
```

### Query Errors

| Number | Message | Cause | Solution |
|--------|---------|-------|----------|
| 102 | Syntax error | Invalid SQL syntax | Fix query syntax |
| 137 | Variable not declared | Missing variable | Declare or add parameter |
| 156 | Syntax error near keyword | Reserved word misuse | Quote or rename identifier |
| 245 | Conversion failed | Type mismatch | Check data types |
| 8114 | Error converting data type | Invalid conversion | Check input data |
| 8115 | Arithmetic overflow | Value out of range | Use larger data type |

```javascript
try {
  await request.query(query);
} catch (err) {
  if (err.number === 102 || err.number === 156) {
    console.error('SQL syntax error at line:', err.lineNumber);
    throw new Error('Invalid query syntax');
  }
  if (err.number === 245 || err.number === 8114) {
    throw new Error('Data type conversion error');
  }
  if (err.number === 8115) {
    throw new Error('Numeric value out of range');
  }
  throw err;
}
```

## Severity Classes

| Class | Description | Action |
|-------|-------------|--------|
| 0-10 | Informational | Log only |
| 11-16 | User errors | Handle in application |
| 17 | Resource errors | Retry, then escalate |
| 18 | Software errors | Log and escalate |
| 19 | Resource limits | Reduce load, escalate |
| 20-25 | Fatal errors | Connection lost, reconnect |

```javascript
function handleError(err) {
  const severity = err.class || 0;

  if (severity <= 10) {
    // Informational - log only
    console.log('SQL Info:', err.message);
    return;
  }

  if (severity <= 16) {
    // User error - handle in application
    throw new ApplicationError(err.message);
  }

  if (severity <= 19) {
    // Resource error - may need retry
    console.error('SQL Resource Error:', err.message);
    throw new TransientError(err.message);
  }

  // Fatal error - connection may be dead
  console.error('SQL Fatal Error:', err.message);
  throw new FatalError(err.message);
}
```

## Error Handling Pattern

```javascript
const sql = require('mssql');

class DatabaseError extends Error {
  constructor(message, code, originalError) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.originalError = originalError;
  }
}

class ValidationError extends DatabaseError {
  constructor(message, field, originalError) {
    super(message, 'VALIDATION', originalError);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class ConflictError extends DatabaseError {
  constructor(message, originalError) {
    super(message, 'CONFLICT', originalError);
    this.name = 'ConflictError';
  }
}

class TransientError extends DatabaseError {
  constructor(message, originalError) {
    super(message, 'TRANSIENT', originalError);
    this.name = 'TransientError';
    this.retryable = true;
  }
}

function translateError(err) {
  // Connection errors
  if (err instanceof sql.ConnectionError) {
    if (err.code === 'ESOCKET' || err.code === 'ETIMEOUT') {
      return new TransientError('Database temporarily unavailable', err);
    }
    if (err.code === 'ELOGIN') {
      return new DatabaseError('Database authentication failed', 'AUTH', err);
    }
    return new DatabaseError('Database connection failed', 'CONNECTION', err);
  }

  // Request errors
  if (err instanceof sql.RequestError) {
    // Constraint violations
    if (err.number === 2627 || err.number === 2601) {
      return new ConflictError('Record already exists', err);
    }
    if (err.number === 547) {
      return new ValidationError('Related record not found', null, err);
    }
    if (err.number === 515) {
      return new ValidationError('Required field is missing', null, err);
    }
    if (err.number === 8152) {
      return new ValidationError('Value exceeds maximum length', null, err);
    }

    // Transient errors
    if (err.number === 1205 || err.number === 1222) {
      return new TransientError('Database busy, please retry', err);
    }

    // Object not found
    if (err.number === 208 || err.number === 207) {
      return new DatabaseError('Database schema error', 'SCHEMA', err);
    }

    // Permission
    if (err.number === 229 || err.number === 262) {
      return new DatabaseError('Permission denied', 'PERMISSION', err);
    }
  }

  // Transaction errors
  if (err instanceof sql.TransactionError) {
    if (err.code === 'EABORT') {
      return new TransientError('Transaction was aborted', err);
    }
    return new DatabaseError('Transaction failed', 'TRANSACTION', err);
  }

  // Unknown error
  return new DatabaseError(err.message, 'UNKNOWN', err);
}

// Usage
async function createUser(user) {
  try {
    const request = pool.request();
    request.input('email', sql.VarChar(255), user.email);
    request.input('name', sql.NVarChar(100), user.name);
    return await request.query(`
      INSERT INTO Users (email, name) VALUES (@email, @name);
      SELECT SCOPE_IDENTITY() as id;
    `);
  } catch (err) {
    throw translateError(err);
  }
}

// API handler
async function handleCreateUser(req, res) {
  try {
    const result = await createUser(req.body);
    res.status(201).json({ id: result.recordset[0].id });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
    } else if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
    } else if (err instanceof TransientError) {
      res.status(503).json({ error: 'Service temporarily unavailable' });
    } else {
      console.error('Database error:', err.originalError);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
```

## Logging Best Practices

```javascript
function logDatabaseError(err, context = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: err.constructor.name,
    message: err.message,
    code: err.code,
    number: err.number,
    state: err.state,
    class: err.class,
    lineNumber: err.lineNumber,
    procedure: err.procName,
    server: err.serverName,
    context,
  };

  // Don't log sensitive data
  delete logEntry.context.password;
  delete logEntry.context.credentials;

  // Log based on severity
  if (err.class >= 17) {
    console.error('CRITICAL DATABASE ERROR:', JSON.stringify(logEntry));
  } else if (err.class >= 11) {
    console.warn('Database error:', JSON.stringify(logEntry));
  } else {
    console.info('Database info:', JSON.stringify(logEntry));
  }
}
```
