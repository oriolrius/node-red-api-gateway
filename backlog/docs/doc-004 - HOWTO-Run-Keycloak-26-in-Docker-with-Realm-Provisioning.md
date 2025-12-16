---
id: doc-004
title: 'HOWTO: Run Keycloak 26 in Docker with Realm Provisioning'
type: other
created_date: '2025-12-10 16:26'
updated_date: '2025-12-10 16:32'
---
# HOWTO: Run Keycloak 26 in Docker with Realm Provisioning (Development Mode)

This guide shows how to run Keycloak 26.x in Docker with automatic realm import for development and testing environments. This guide focuses on **development mode only** using the embedded H2 database with persistent storage.

## Why Provision Realms Automatically?

- **Reproducible environments**: Same configuration every time
- **Team collaboration**: Share realm configs via version control
- **CI/CD pipelines**: Automated testing with pre-configured realms
- **Fast setup**: No manual configuration needed

## 1. Directory Structure

Create a project directory with these files and folders:

```
keycloak-dev/
├── docker-compose.yml
├── keycloak.env
├── data/
│   ├── import/                # Realm import files
│   │   └── myrealm-realm.json
│   └── h2/                    # H2 database persistence
└── themes/                    # Optional: custom themes
```

Create the directories:

```bash
mkdir -p data/import data/h2 themes
```

---

## 2. `keycloak.env`

Configure Keycloak settings:

```env
# Admin credentials (Keycloak 26+ syntax)
KC_BOOTSTRAP_ADMIN_USERNAME=admin
KC_BOOTSTRAP_ADMIN_PASSWORD=admin

# Health and metrics endpoints
KC_HEALTH_ENABLED=true
KC_METRICS_ENABLED=true

# Hostname configuration (for dev mode)
KC_HOSTNAME=localhost

# Optional: Enable specific features
# KC_FEATURES=token-exchange,passkeys,device-flow
```

> **Note:** In Keycloak 26+, use `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` instead of the deprecated `KEYCLOAK_ADMIN` variables.

---

## 3. `docker-compose.yml`

Development mode uses the embedded H2 database. Mount the data directory to persist the database across container restarts.

```yaml
networks:
  app-network-public:
    driver: bridge

services:
  keycloak:
    image: quay.io/keycloak/keycloak:26-latest
    container_name: keycloak
    hostname: keycloak
    networks:
      - app-network-public
    env_file:
      - keycloak.env
    ports:
      - "8080:8080"
    command:
      - start-dev
      - --import-realm
    volumes:
      # Host binding for realm import
      - ./data/import:/opt/keycloak/data/import:ro
      # Host binding for H2 database persistence
      - ./data/h2:/opt/keycloak/data/h2
      # Optional: custom themes
      - ./themes:/opt/keycloak/themes:ro
    healthcheck:
      test: ["CMD-SHELL", "exec 3<>/dev/tcp/localhost/8080 && echo -e 'GET /health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && cat <&3 | grep -q '\"status\":\"UP\"'"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

### Key Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `./data/import` | `/opt/keycloak/data/import` | Realm JSON files for auto-import |
| `./data/h2` | `/opt/keycloak/data/h2` | H2 database files (persistent) |
| `./themes` | `/opt/keycloak/themes` | Custom login/admin themes |

---

## 4. Realm File Naming Convention

**Critical:** Realm files must follow this naming pattern:

| File Type | Pattern | Example |
|-----------|---------|---------|
| Realm config | `<realm-name>-realm.json` | `myrealm-realm.json` |
| Users | `<realm-name>-users-<N>.json` | `myrealm-users-0.json` |
| Federated users | `<realm-name>-federated-users-<N>.json` | `myrealm-federated-users-0.json` |

---

## 5. Example Realm Configuration

Create `data/import/myrealm-realm.json`:

```json
{
  "realm": "myrealm",
  "enabled": true,
  "displayName": "My Application Realm",
  "sslRequired": "external",
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": true,
  "editUsernameAllowed": false,
  "bruteForceProtected": true,
  "roles": {
    "realm": [
      {
        "name": "user",
        "description": "Standard user role"
      },
      {
        "name": "admin",
        "description": "Administrator role"
      }
    ]
  },
  "clients": [
    {
      "clientId": "my-api",
      "name": "My API Client",
      "enabled": true,
      "publicClient": false,
      "bearerOnly": true,
      "standardFlowEnabled": false,
      "directAccessGrantsEnabled": false
    },
    {
      "clientId": "my-web-app",
      "name": "My Web Application",
      "enabled": true,
      "publicClient": true,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": true,
      "redirectUris": [
        "http://localhost:3000/*",
        "http://localhost:8080/*"
      ],
      "webOrigins": [
        "http://localhost:3000",
        "http://localhost:8080"
      ],
      "defaultClientScopes": [
        "web-origins",
        "acr",
        "profile",
        "roles",
        "email"
      ]
    }
  ],
  "users": [
    {
      "username": "testuser",
      "enabled": true,
      "email": "testuser@example.com",
      "firstName": "Test",
      "lastName": "User",
      "credentials": [
        {
          "type": "password",
          "value": "testpassword",
          "temporary": false
        }
      ],
      "realmRoles": ["user"]
    },
    {
      "username": "admin",
      "enabled": true,
      "email": "admin@example.com",
      "firstName": "Admin",
      "lastName": "User",
      "credentials": [
        {
          "type": "password",
          "value": "adminpassword",
          "temporary": false
        }
      ],
      "realmRoles": ["admin", "user"]
    }
  ]
}
```

---

## 6. Start the Container

```bash
docker compose up -d
```

Check logs to ensure realm import succeeded:

```bash
docker compose logs -f keycloak
```

Look for messages like:
```
Realm 'myrealm' imported
```

### Verify H2 Database Persistence

After starting, check that database files appear in your host directory:

```bash
ls -la data/h2/
```

You should see files like `keycloakdb.mv.db` and `keycloakdb.trace.db`.

---

## 7. Verify the Setup

### Access Admin Console

Open http://localhost:8080 and log in with:
- Username: `admin`
- Password: `admin`

### Check Health Endpoints

```bash
# Readiness check
curl http://localhost:8080/health/ready

# Liveness check
curl http://localhost:8080/health/live

# Metrics (Prometheus format)
curl http://localhost:8080/metrics
```

### Test Token Endpoint

```bash
# Get access token using direct grant
curl -X POST http://localhost:8080/realms/myrealm/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=my-web-app" \
  -d "username=testuser" \
  -d "password=testpassword"
```

---

## 8. Export Existing Realm

To export a realm you've configured manually:

```bash
docker exec -it keycloak /opt/keycloak/bin/kc.sh export \
  --dir /opt/keycloak/data/export \
  --realm myrealm \
  --users realm_file
```

Then copy from the container:

```bash
docker cp keycloak:/opt/keycloak/data/export/myrealm-realm.json ./data/import/
```

---

## 9. Memory Configuration

Keycloak uses percentage-based heap allocation by default:
- **Maximum heap**: 70% of container memory
- **Initial heap**: 50% of container memory

Recommended container memory limits for development:
- **Minimum**: 512 MB
- **Recommended**: 1 GB

```yaml
services:
  keycloak:
    # ... other config ...
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M
```

---

## 10. Reset Database

To start fresh with a clean database:

```bash
docker compose down
rm -rf data/h2/*
docker compose up -d
```

The realm will be re-imported from the JSON files on next startup.

---

## 11. Troubleshooting

### Realm not imported

- Verify file naming convention: `<realm-name>-realm.json`
- Check `--import-realm` flag is present in command
- Ensure volume mount path is correct: `/opt/keycloak/data/import`
- Check file permissions are readable

### Admin console not accessible

- Ensure `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` are set
- Check container logs for startup errors
- Verify port 8080 is not in use

### Health check failing

- Wait for `start_period` to complete (Keycloak takes 30-60s to start)
- Ensure `KC_HEALTH_ENABLED=true` is set

### Database not persisting

- Verify volume mount: `./data/h2:/opt/keycloak/data/h2`
- Check directory permissions
- Ensure the host directory exists before starting

### Container exits immediately

Common causes:
- Invalid realm JSON syntax
- Port conflicts
- Permission issues on mounted directories

Check logs:
```bash
docker compose logs keycloak
```

---

## 12. Important Notes

1. **Development mode only** - This configuration uses `start-dev` which is insecure and not suitable for production
2. **H2 database limitations** - The embedded H2 database is single-user and not designed for production workloads
3. **Data persistence** - All data (users, sessions, realms) is stored in the `data/h2` directory
4. **Realm import behavior** - Realms are only imported if they don't already exist in the database

---

## References

- [Keycloak Container Documentation](https://www.keycloak.org/server/containers)
- [Keycloak Import/Export Guide](https://www.keycloak.org/server/importExport)
- [Keycloak Docker Getting Started](https://www.keycloak.org/getting-started/getting-started-docker)
- [Keycloak 26.3.0 Release Notes](https://www.keycloak.org/2025/07/keycloak-2630-released)
