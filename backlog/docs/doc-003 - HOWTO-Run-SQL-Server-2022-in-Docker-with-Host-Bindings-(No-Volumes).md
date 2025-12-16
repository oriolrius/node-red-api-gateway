---
id: doc-003
title: 'HOWTO: Run SQL Server 2022 in Docker with Host Bindings (No Volumes)'
type: other
created_date: '2025-12-10 16:13'
---
# HOWTO: Run SQL Server 2022 (latest LTS) in Docker with Host Bindings

This guide shows how to run SQL Server 2022 in Docker using **host directory bindings** instead of Docker volumes. Host bindings give you direct access to the data files on your filesystem, making backups, migrations, and debugging easier.

## Why Host Bindings vs Docker Volumes?

| Aspect | Docker Volumes | Host Bindings |
|--------|---------------|---------------|
| Data location | Managed by Docker | Explicit path on host |
| Portability | Tied to Docker | Easy to backup/migrate |
| Performance | Slightly better on some systems | Direct filesystem access |
| Visibility | Hidden in Docker storage | Visible in your filesystem |

## 1. Directory Structure

Create a project directory with these files and folders:

```
sqlserver-dev/
├── docker-compose.yml
├── sqlserver.env
├── sapassword.env
└── data/
    ├── system/      # SQL Server system databases
    ├── user/        # User database files (.mdf, .ndf)
    ├── log/         # Transaction logs (.ldf)
    └── backup/      # Backup files (.bak)
```

Create the data directories:

```bash
mkdir -p data/{system,user,log,backup}
```

**Important:** Set proper permissions for the `mssql` user (UID 10001):

```bash
sudo chown -R 10001:0 data/
sudo chmod -R 755 data/
```

---

## 2. `sapassword.env`

Store the SA password separately for security:

```env
MSSQL_SA_PASSWORD=The2password.
```

> **Note:** Password must meet SQL Server complexity requirements:
> - At least 8 characters
> - Include uppercase, lowercase, numbers, and symbols

---

## 3. `sqlserver.env`

Configure SQL Server paths and settings:

```env
ACCEPT_EULA=Y
MSSQL_PID=Developer

# Point SQL Server to our custom directories
MSSQL_DATA_DIR=/var/opt/sqlserver/data
MSSQL_LOG_DIR=/var/opt/sqlserver/log
MSSQL_BACKUP_DIR=/var/opt/sqlserver/backup
```

---

## 4. `docker-compose.yml`

```yaml
networks:
  app-network-public:
    driver: bridge

services:
  db:
    image: mcr.microsoft.com/mssql/server:2022-latest
    container_name: db-sqlserver-2022
    hostname: sqlserver
    networks:
      - app-network-public
    restart: always
    env_file:
      - sqlserver.env
      - sapassword.env
    ports:
      - "1433:1433"
    volumes:
      # Host bindings - paths relative to docker-compose.yml location
      - ./data/system:/var/opt/mssql
      - ./data/user:/var/opt/sqlserver/data
      - ./data/log:/var/opt/sqlserver/log
      - ./data/backup:/var/opt/sqlserver/backup
```

---

## 5. Start the Container

```bash
docker compose up -d
```

Check logs to ensure SQL Server started successfully:

```bash
docker compose logs -f db
```

Wait for the message: `SQL Server is now ready for client connections`

---

## 6. Verify the Setup

### Connect using sqlcmd

```bash
docker exec -it db-sqlserver-2022 /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'The2password.' -C
```

### Check SQL Server version

```sql
SELECT @@VERSION;
GO
```

### Verify data directories

```sql
SELECT name, physical_name 
FROM sys.master_files;
GO
```

---

## 7. Verify Host Bindings

After starting, check that files appear in your host directories:

```bash
ls -la data/system/
ls -la data/user/
ls -la data/log/
```

You should see SQL Server's system database files in `data/system/data/`.

---

## 8. Common Operations

### Stop the container

```bash
docker compose down
```

### Backup data (with host bindings, just copy the directories)

```bash
cp -r data/ data-backup-$(date +%Y%m%d)/
```

### Restore on another machine

1. Copy the `data/` directory to the new machine
2. Set permissions: `sudo chown -R 10001:0 data/`
3. Run `docker compose up -d`

---

## 9. Troubleshooting

### Permission denied errors

If SQL Server fails to start with permission errors:

```bash
# Check current ownership
ls -la data/

# Fix ownership (SQL Server runs as UID 10001)
sudo chown -R 10001:0 data/
sudo chmod -R 755 data/
```

### Container exits immediately

Check logs for details:

```bash
docker compose logs db
```

Common causes:
- Invalid SA password (doesn't meet complexity requirements)
- Permission issues on mounted directories
- Port 1433 already in use

### Reset everything

```bash
docker compose down
sudo rm -rf data/*
mkdir -p data/{system,user,log,backup}
sudo chown -R 10001:0 data/
docker compose up -d
```

---

## 10. Security Considerations

1. **Never commit `sapassword.env` to version control** - add it to `.gitignore`
2. **Use Docker secrets in production** instead of env files
3. **Restrict network access** - don't expose port 1433 publicly
4. **Regular backups** - host bindings make this easy with standard filesystem tools
