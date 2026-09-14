# Backup & Restore

## Required backup layers

1. PostgreSQL logical backup
2. PostgreSQL physical/base backup strategy if operationally justified
3. application data volume backup if used
4. configuration/secret recovery procedure
5. export bundle

## 3-2-1 goal

Maintain multiple copies on different storage media/locations where the homelab supports it.

## Restore drill

At least quarterly during active development and before major releases:
1. provision clean PostgreSQL
2. restore backup
3. run migrations if required
4. start app
5. run integrity checks
6. verify representative records
7. verify permissions
8. record restore duration and result

## RPO/RTO

Initial target to be decided after host/backup inspection:
- RPO: 24h maximum
- RTO: 4h maximum

Tighten only if the household's backup architecture supports it.
