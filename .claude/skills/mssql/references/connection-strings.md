# SQL Server Connection Strings and Authentication

Reference for various connection configurations with the mssql package.

## Connection Object Format

The mssql package uses a configuration object rather than connection strings:

```javascript
const config = {
  user: 'username',
  password: 'password',
  server: 'hostname',
  database: 'database_name',
  port: 1433,
  options: { /* TLS and behavior options */ },
  pool: { /* connection pool settings */ },
};
```

## Local SQL Server

### Default Instance

```javascript
const config = {
  user: 'sa',
  password: 'YourStrong!Passw0rd',
  server: 'localhost',
  database: 'mydb',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};
```

### Named Instance

```javascript
// Using instance name (SQL Server Browser must be running)
const config = {
  user: 'sa',
  password: 'YourStrong!Passw0rd',
  server: 'localhost\\SQLEXPRESS',  // Double backslash for instance name
  database: 'mydb',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    instanceName: 'SQLEXPRESS',  // Alternative to using backslash
  },
};

// Using specific port (if instance port is known)
const configWithPort = {
  user: 'sa',
  password: 'YourStrong!Passw0rd',
  server: 'localhost',
  port: 1434,  // Non-default port
  database: 'mydb',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};
```

### Docker SQL Server

```javascript
const config = {
  user: 'sa',
  password: 'YourStrong!Passw0rd',
  server: 'localhost',
  port: 1433,
  database: 'mydb',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

// Docker run command for reference:
// docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=YourStrong!Passw0rd" \
//   -p 1433:1433 --name sql-server \
//   mcr.microsoft.com/mssql/server:2022-latest
```

## Remote SQL Server

### With Encryption

```javascript
const config = {
  user: 'app_user',
  password: 'SecurePassword123!',
  server: 'sql.example.com',
  database: 'production_db',
  options: {
    encrypt: true,
    trustServerCertificate: false,  // Verify server certificate
  },
};
```

### With Custom CA Certificate

```javascript
const fs = require('fs');

const config = {
  user: 'app_user',
  password: 'SecurePassword123!',
  server: 'sql.internal.example.com',
  database: 'production_db',
  options: {
    encrypt: true,
    trustServerCertificate: false,
    cryptoCredentialsDetails: {
      ca: fs.readFileSync('/path/to/ca-cert.pem'),
      // For client certificate authentication
      cert: fs.readFileSync('/path/to/client-cert.pem'),
      key: fs.readFileSync('/path/to/client-key.pem'),
    },
  },
};
```

### Specific TLS Version

```javascript
const config = {
  user: 'app_user',
  password: 'SecurePassword123!',
  server: 'sql.example.com',
  database: 'production_db',
  options: {
    encrypt: true,
    cryptoCredentialsDetails: {
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.3',
    },
  },
};
```

## Windows/Domain Authentication

### NTLM (Domain User)

```javascript
const config = {
  server: 'sql.example.com',
  database: 'mydb',
  domain: 'MYDOMAIN',
  user: 'domain_user',
  password: 'domain_password',
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};
```

### Integrated Security (Current Windows User)

```javascript
// Requires running on Windows with proper credentials
const config = {
  server: 'sql.example.com',
  database: 'mydb',
  options: {
    trustedConnection: true,
    encrypt: true,
    trustServerCertificate: false,
  },
};
```

## Azure SQL Database

### SQL Authentication

```javascript
const config = {
  user: 'azure_admin',
  password: 'SecurePassword123!',
  server: 'myserver.database.windows.net',
  database: 'mydb',
  options: {
    encrypt: true,  // Required for Azure
    // trustServerCertificate: false is default
  },
};
```

### Azure Active Directory Password

```javascript
const config = {
  user: 'user@yourtenant.onmicrosoft.com',
  password: 'password',
  server: 'myserver.database.windows.net',
  database: 'mydb',
  options: {
    encrypt: true,
  },
  authentication: {
    type: 'azure-active-directory-password',
    options: {
      clientId: 'your-app-client-id',  // Optional: custom app registration
      tenantId: 'your-tenant-id',       // Optional: specific tenant
    },
  },
};
```

### Azure AD with Access Token

```javascript
const { DefaultAzureCredential } = require('@azure/identity');

async function getConfig() {
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken('https://database.windows.net/');

  return {
    server: 'myserver.database.windows.net',
    database: 'mydb',
    options: {
      encrypt: true,
    },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: {
        token: token.token,
      },
    },
  };
}
```

### Azure AD Managed Identity

```javascript
// For Azure VMs
const config = {
  server: 'myserver.database.windows.net',
  database: 'mydb',
  options: {
    encrypt: true,
  },
  authentication: {
    type: 'azure-active-directory-msi-vm',
    options: {
      clientId: 'user-assigned-managed-identity-client-id',  // Optional
    },
  },
};

// For Azure App Service
const configAppService = {
  server: 'myserver.database.windows.net',
  database: 'mydb',
  options: {
    encrypt: true,
  },
  authentication: {
    type: 'azure-active-directory-msi-app-service',
  },
};
```

### Azure AD Service Principal

```javascript
const config = {
  server: 'myserver.database.windows.net',
  database: 'mydb',
  options: {
    encrypt: true,
  },
  authentication: {
    type: 'azure-active-directory-service-principal-secret',
    options: {
      clientId: 'service-principal-client-id',
      clientSecret: 'service-principal-secret',
      tenantId: 'your-tenant-id',
    },
  },
};
```

## Connection Pool Configuration

### Basic Pool Settings

```javascript
const config = {
  user: 'user',
  password: 'password',
  server: 'localhost',
  database: 'mydb',
  pool: {
    max: 10,                      // Maximum connections in pool
    min: 0,                       // Minimum connections in pool
    idleTimeoutMillis: 30000,     // Close idle connections after 30s
  },
};
```

### Advanced Pool Settings

```javascript
const config = {
  user: 'user',
  password: 'password',
  server: 'localhost',
  database: 'mydb',
  pool: {
    max: 50,                       // High-traffic application
    min: 5,                        // Keep minimum connections ready
    idleTimeoutMillis: 60000,      // 1 minute idle timeout
    acquireTimeoutMillis: 30000,   // Wait up to 30s for connection
    createTimeoutMillis: 30000,    // Timeout for creating new connection
    destroyTimeoutMillis: 5000,    // Timeout for destroying connection
    reapIntervalMillis: 1000,      // Check for idle connections every 1s
    createRetryIntervalMillis: 200, // Retry interval for failed creates
    propagateCreateError: true,    // Throw error if connection fails
  },
};
```

## Timeout Configuration

```javascript
const config = {
  user: 'user',
  password: 'password',
  server: 'localhost',
  database: 'mydb',
  options: {
    connectTimeout: 15000,   // Connection timeout in ms (default: 15000)
    requestTimeout: 15000,   // Request/query timeout in ms (default: 15000)
    cancelTimeout: 5000,     // Cancel timeout in ms (default: 5000)
  },
};

// Per-request timeout override
const request = pool.request();
request.timeout = 60000;  // 60 seconds for this query
await request.query('SELECT * FROM LargeTable');
```

## Environment Variable Pattern

```javascript
const config = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_SERVER || 'localhost',
  database: process.env.MSSQL_DATABASE,
  port: parseInt(process.env.MSSQL_PORT) || 1433,
  options: {
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.MSSQL_TRUST_CERT === 'true',
  },
  pool: {
    max: parseInt(process.env.MSSQL_POOL_MAX) || 10,
    min: parseInt(process.env.MSSQL_POOL_MIN) || 0,
    idleTimeoutMillis: parseInt(process.env.MSSQL_IDLE_TIMEOUT) || 30000,
  },
};

// .env file example:
// MSSQL_USER=app_user
// MSSQL_PASSWORD=SecurePassword123!
// MSSQL_SERVER=sql.example.com
// MSSQL_DATABASE=production
// MSSQL_PORT=1433
// MSSQL_ENCRYPT=true
// MSSQL_TRUST_CERT=false
// MSSQL_POOL_MAX=20
```

## Connection String Parser

If you have a connection string and need to parse it:

```javascript
function parseConnectionString(connectionString) {
  const config = {
    options: {},
    pool: {},
  };

  const parts = connectionString.split(';');

  parts.forEach((part) => {
    const [key, value] = part.split('=').map((s) => s.trim());

    switch (key.toLowerCase()) {
      case 'server':
      case 'data source':
        if (value.includes('\\')) {
          const [server, instance] = value.split('\\');
          config.server = server;
          config.options.instanceName = instance;
        } else if (value.includes(',')) {
          const [server, port] = value.split(',');
          config.server = server;
          config.port = parseInt(port);
        } else {
          config.server = value;
        }
        break;

      case 'database':
      case 'initial catalog':
        config.database = value;
        break;

      case 'user id':
      case 'uid':
        config.user = value;
        break;

      case 'password':
      case 'pwd':
        config.password = value;
        break;

      case 'encrypt':
        config.options.encrypt = value.toLowerCase() === 'true';
        break;

      case 'trustservercertificate':
        config.options.trustServerCertificate = value.toLowerCase() === 'true';
        break;

      case 'connection timeout':
      case 'connect timeout':
        config.options.connectTimeout = parseInt(value) * 1000;
        break;

      case 'integrated security':
        if (value.toLowerCase() === 'true' || value.toLowerCase() === 'sspi') {
          config.options.trustedConnection = true;
        }
        break;
    }
  });

  return config;
}

// Usage
const connStr = 'Server=sql.example.com;Database=mydb;User Id=user;Password=pass;Encrypt=true';
const config = parseConnectionString(connStr);
```

## Testing Connection

```javascript
const sql = require('mssql');

async function testConnection(config) {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT @@VERSION as version');
    console.log('Connected successfully');
    console.log('SQL Server version:', result.recordset[0].version);
    await pool.close();
    return true;
  } catch (err) {
    console.error('Connection failed:', err.message);

    // Specific error handling
    if (err.code === 'ESOCKET') {
      console.error('Network error - check server/port');
    } else if (err.number === 18456) {
      console.error('Authentication error - check credentials');
    } else if (err.number === 4060) {
      console.error('Database error - check database name');
    }

    return false;
  }
}
```
