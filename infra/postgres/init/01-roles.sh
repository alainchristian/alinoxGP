#!/bin/bash
# Creates the three application roles required by ADR-0003 and the databases.
#   gps_owner  - owns schema objects, runs migrations ONLY
#   gps_app    - used by the API; not owner, NO BYPASSRLS (RLS applies)
#   gps_system - named cross-tenant role (BYPASSRLS) used only by reviewed code paths
# Runs once, on first initialisation of the data volume.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<EOSQL
CREATE ROLE gps_owner LOGIN PASSWORD '${GPS_OWNER_PASSWORD}' CREATEDB NOBYPASSRLS;
CREATE ROLE gps_app LOGIN PASSWORD '${GPS_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOBYPASSRLS;
CREATE ROLE gps_system LOGIN PASSWORD '${GPS_SYSTEM_PASSWORD}' NOSUPERUSER NOCREATEDB BYPASSRLS;
CREATE DATABASE gps OWNER gps_owner;
CREATE DATABASE gps_test OWNER gps_owner;
EOSQL

for db in gps gps_test; do
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<EOSQL
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${db} TO gps_app, gps_system;
GRANT USAGE ON SCHEMA public TO gps_app, gps_system;
ALTER DEFAULT PRIVILEGES FOR ROLE gps_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gps_app, gps_system;
ALTER DEFAULT PRIVILEGES FOR ROLE gps_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gps_app, gps_system;
EOSQL
done
