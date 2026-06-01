# API Gateway Development Stack

Docker Compose stack providing Keycloak (OAuth2/OIDC), OPA (Authorization), and optional SQL Server for development and E2E testing.

## Architecture

This stack uses a **shared container network namespace** architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    network-base container                       │
│                   (creates network namespace)                   │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  Keycloak   │  │     OPA     │  │ SQL Server  │            │
│  │ :8080       │  │   :8181     │  │   :1433     │ (optional) │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  All services communicate via localhost within this namespace   │
└─────────────────────────────────────────────────────────────────┘
         │                │                │
    Ports exposed to host (8080, 8181, 1433)
```

**Benefits:**

- Services communicate via `localhost:PORT` (no Docker networking complexity)
- Complete isolation from host (ports only exposed from base container)
- Mirrors single-machine deployment for realistic testing

## Quick Start

### Prerequisites

- Docker 20.10+ with Compose V2
- For SQL Server: Set directory permissions (see [SQL Server Setup](#sql-server-setup-optional))

### Start Basic Stack (Keycloak + OPA)

```bash
cd tests/e2e
docker compose up -d
```

### Start Full Stack (with SQL Server)

```bash
cd tests/e2e
docker compose --profile all up -d
```

### Start with Node-RED (E2E Testing)

```bash
cd tests/e2e
docker compose --profile nodered up -d
```

### Start Everything

```bash
cd tests/e2e
docker compose --profile sqlserver --profile nodered up -d
```

## Service URLs

| Service        | URL                   | Credentials          |
| -------------- | --------------------- | -------------------- |
| Keycloak Admin | http://localhost:8080 | admin / admin        |
| OPA            | http://localhost:8181 | -                    |
| SQL Server     | localhost:1433        | sa / DevPassword123! |
| Node-RED       | http://localhost:1880 | -                    |

## Keycloak Configuration

### Pre-configured Realm: `api-gateway`

The stack auto-imports a realm with:

**Clients:**

- `api-gateway-client` - OAuth2 client for authentication
  - Client Secret: `api-gateway-secret`
  - Direct Access Grants enabled (for testing)
  - Service Account enabled
- `api-gateway-bearer` - Bearer-only client for API validation

**Users:**

| Username | Password       | Roles  | Permissions                                |
| -------- | -------------- | ------ | ------------------------------------------ |
| testuser | testpassword   | user   | api:read                                   |
| editor   | editorpassword | editor | api:read, api:write                        |
| admin    | adminpassword  | admin  | api:read, api:write, api:delete, api:admin |

### Get Access Token

```bash
# Using password grant
curl -X POST http://localhost:8080/realms/api-gateway/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=api-gateway-client" \
  -d "client_secret=api-gateway-secret" \
  -d "username=testuser" \
  -d "password=testpassword"

# Using client credentials (service account)
curl -X POST http://localhost:8080/realms/api-gateway/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=api-gateway-client" \
  -d "client_secret=api-gateway-secret"
```

### JWKS Endpoint

```
http://localhost:8080/realms/api-gateway/protocol/openid-connect/certs
```

## OPA Configuration

### Policy Structure

Policies are mounted from `./policies/`:

```
policies/
├── authz.rego    # Authorization policy
└── data.json     # Static data (roles, rate limits)
```

### Test Authorization

```bash
# Check if user with 'user' role can read API
curl -X POST http://localhost:8181/v1/data/authz/allow \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "method": "GET",
      "path": "/api/v1/users",
      "token": {
        "exp": 9999999999,
        "realm_access": { "roles": ["user"] },
        "resource_access": {
          "api-gateway-client": { "roles": ["api:read"] }
        }
      }
    }
  }'
# Expected: {"result": true}

# Check insufficient permissions
curl -X POST http://localhost:8181/v1/data/authz/allow \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "method": "DELETE",
      "path": "/api/v1/users/123",
      "token": {
        "exp": 9999999999,
        "realm_access": { "roles": ["user"] },
        "resource_access": {
          "api-gateway-client": { "roles": ["api:read"] }
        }
      }
    }
  }'
# Expected: {"result": false}
```

### Policy Endpoints

| Endpoint                                | Description                  |
| --------------------------------------- | ---------------------------- |
| `GET /health`                         | Health check                 |
| `GET /v1/policies`                    | List loaded policies         |
| `POST /v1/data/authz/allow`           | Check authorization          |
| `POST /v1/data/authz/decision_reason` | Get denial reason            |
| `POST /v1/data/authz/user_info`       | Extract user info from token |

## SQL Server Setup (Optional)

### Directory Permissions

SQL Server runs as UID 10001. Set permissions before starting:

```bash
cd tests/e2e

# Create directories
mkdir -p data/sqlserver/{system,user,log,backup}

# Set ownership
sudo chown -R 10001:0 data/sqlserver/
sudo chmod -R 755 data/sqlserver/
```

### Connection String

```
Server=localhost,1433;Database=master;User Id=sa;Password=DevPassword123!;TrustServerCertificate=True;
```

### Security Note

The default SA password is for development only. For any shared environment:

1. Edit `config/sapassword.env`
2. Change the password to something secure
3. Never commit `sapassword.env` to version control

## Health Checks

All services include health checks:

```bash
# Check all services
docker compose ps

# Keycloak health
curl http://localhost:8080/health/ready

# OPA health
curl http://localhost:8181/health

# SQL Server (if running)
docker exec api-gateway-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'DevPassword123!' -C -Q 'SELECT 1'
```

## Stopping the Stack

```bash
# Stop and remove containers
docker compose down

# Stop and remove with volumes
docker compose down -v

# Stop all profiles
docker compose --profile sqlserver --profile nodered down
```

## Reset Database/State

### Keycloak (Reset H2 Database)

```bash
docker compose down
rm -rf data/keycloak/h2/*
docker compose up -d
# Realm will be re-imported from JSON
```

### SQL Server (Full Reset)

```bash
docker compose --profile sqlserver down
sudo rm -rf data/sqlserver/*
mkdir -p data/sqlserver/{system,user,log,backup}
sudo chown -R 10001:0 data/sqlserver/
docker compose --profile sqlserver up -d
```

### OPA (Reload Policies)

OPA watches the policies directory and auto-reloads changes. To force reload:

```bash
docker compose restart opa
```

## Directory Structure

```
tests/e2e/
├── docker-compose.yml          # Main compose file
├── .env.example                 # Environment template
├── README.md                    # This file
├── config/
│   ├── keycloak.env            # Keycloak configuration
│   ├── sqlserver.env           # SQL Server configuration
│   └── sapassword.env          # SA password (gitignored)
├── data/
│   ├── keycloak/
│   │   ├── import/             # Realm import files
│   │   │   └── api-gateway-realm.json
│   │   └── h2/                 # H2 database (persistent)
│   └── sqlserver/              # SQL Server data (host bindings)
│       ├── system/
│       ├── user/
│       ├── log/
│       └── backup/
├── policies/
│   ├── authz.rego              # OPA authorization policy
│   └── data.json               # Static policy data
├── .nodered/                   # Node-RED user directory
├── flows.json                  # E2E test flows
└── run-e2e-tests.js           # E2E test runner
```

## Troubleshooting

### Keycloak Not Starting

Check logs:

```bash
docker compose logs keycloak
```

Common issues:

- Realm JSON syntax error - validate with `jq . data/keycloak/import/*.json`
- Port 8080 in use - check with `lsof -i :8080`

### OPA Policies Not Loading

```bash
# Check if policies are mounted
docker exec api-gateway-opa ls -la /policies

# Validate policy syntax
opa check policies/

# Check OPA logs
docker compose logs opa
```

### SQL Server Permission Denied

```bash
# Fix ownership
sudo chown -R 10001:0 data/sqlserver/
sudo chmod -R 755 data/sqlserver/

# Check logs
docker compose --profile sqlserver logs db
```

### Services Can't Communicate

Verify all services are using the shared network namespace:

```bash
# All services should show network_mode: container:api-gateway-network
docker inspect api-gateway-keycloak | grep -A5 NetworkMode
docker inspect api-gateway-opa | grep -A5 NetworkMode
```

## Running E2E Tests

### Available Test Scripts

| Script                              | Description                                            |
| ----------------------------------- | ------------------------------------------------------ |
| `npm run test:e2e`                | Run basic E2E tests (node registration, functionality) |
| `npm run test:integration`        | OAuth2 password grant flow tests                       |
| `npm run test:client-credentials` | OAuth2 client credentials flow tests                   |
| `npm run test:opa`                | OPA policy integration tests                           |
| `npm run test:openapi-tls`        | TLS/HTTPS endpoint tests                               |
| `npm run test:full-stack`         | Full stack: TLS + OAuth2 + OPA + SQL Server (15 tests) |

### OAuth2 Client Credentials Flow Tests

Tests for machine-to-machine authentication using the OAuth2 Client Credentials grant.

**Service Accounts:**

| Client ID        | Secret               | Roles                     |
| ---------------- | -------------------- | ------------------------- |
| my-api-client    | my-client-secret     | user, api:read, api:write |
| my-admin-service | admin-service-secret | admin, api:admin          |

**Run tests:**

```bash
# Start the stack
npm run docker:e2e:up

# Wait for services to be healthy
docker compose -f tests/e2e/docker-compose.yml ps

# Run client credentials tests
npm run test:client-credentials
```

**What's tested:**

- Token acquisition via client credentials grant
- Service account claims in JWT tokens
- Role-based access control for service accounts
- Invalid credentials rejection (wrong client ID/secret)
- Token expiration validation
- Protected endpoint access with service account tokens

### Full Stack Integration Tests

Comprehensive test validating all security and data layers working together over HTTPS.

**Layers Tested:**

```
Request → TLS (HTTPS) → OAuth2 (JWT) → OPA (Policy) → SQL Server (CRUD)
```

**Run tests:**

```bash
# Automatically starts Docker stack with nodered + sqlserver profiles
npm run test:full-stack

# Keep stack running after tests (for debugging)
SKIP_DOCKER_TEARDOWN=1 npm run test:full-stack

# Use existing running stack
SKIP_DOCKER_SETUP=1 npm run test:full-stack
```

**Test Cases (15 tests):**

| Layer      | Tests | Description                                    |
| ---------- | ----- | ---------------------------------------------- |
| TLS        | 2     | HTTPS with valid CA, reject invalid CA         |
| OAuth2     | 3     | Token acquisition, invalid credentials         |
| OPA        | 4     | Role-based access (user read, admin write)     |
| SQL Server | 6     | CRUD operations, pagination, data verification |

**Service Accounts Used:**

| Client ID          | Role  | Permissions                          |
| ------------------ | ----- | ------------------------------------ |
| `my-api-client`    | user  | api:read, api:write                  |
| `my-admin-service` | admin | api:read, api:write, api:delete      |

**Example Flow:**

The test uses `examples/full-stack-api.json` which configures:
- TLS on port 3443 with mkcert certificates
- OAuth2 validation against Keycloak
- OPA authorization at `/v1/data/api/authz`
- SQL Server CRUD on `testdb.products` table

## Related Documentation

- [doc-003: SQL Server Docker Setup](../../backlog/docs/doc-003%20-%20HOWTO-Run-SQL-Server-2022-in-Docker-with-Host-Bindings-(No-Volumes).md)
- [doc-004: Keycloak Docker Setup](../../backlog/docs/doc-004%20-%20HOWTO-Run-Keycloak-26-in-Docker-with-Realm-Provisioning.md)
- [doc-005: OPA Docker Setup](../../backlog/docs/doc-005%20-%20HOWTO-Run-OPA-(Open-Policy-Agent)-in-Docker-with-Policy-Provisioning.md)
