#!/bin/bash
# Creates Traccar's OWN database and user (ADR/skill: Traccar never shares tables with our app and our app
# never writes to Traccar's tables). Idempotent: runs on first volume init AND manually via `pnpm infra:ensure-db`
# for volumes created before Milestone 2.
set -e
export PGPASSWORD="${POSTGRES_PASSWORD}"
PSQL=(psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres)

"${PSQL[@]}" <<EOSQL
SELECT 'CREATE ROLE traccar LOGIN PASSWORD ''${TRACCAR_DB_PASSWORD}'' NOSUPERUSER NOCREATEDB NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'traccar') \gexec
ALTER ROLE traccar PASSWORD '${TRACCAR_DB_PASSWORD}';
SELECT 'CREATE DATABASE traccar OWNER traccar'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'traccar') \gexec
EOSQL
