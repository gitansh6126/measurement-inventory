-- One-time LOCAL development setup for V2. Run as the postgres superuser from v2\app\api:
--   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -f scripts/setup-local-db.sql
-- You will be asked for the postgres password, then for a NEW password for the rs_v3 role
-- (put it into v2/app/api/.env: DATABASE_URL and TEST_DATABASE_URL).
-- To skip the second prompt, pass the password in:  -v rs_v3_password=<password>
--
-- Creates only the rs_v3 role and the rs_v31_demo / rs_v31_test databases. Never touches V1
-- (rs_v1 role, rs_v1_demo, rs_v1_test). Stops on the first error (e.g. role already exists).
-- The rs_v3 role owns only its own databases and has no superuser, CREATEDB or CREATEROLE rights.

\set ON_ERROR_STOP on

\if :{?rs_v3_password}
\else
\prompt 'New password for the rs_v3 role: ' rs_v3_password
\endif

CREATE ROLE rs_v3 LOGIN PASSWORD :'rs_v3_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;

CREATE DATABASE rs_v31_demo OWNER rs_v3 ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE rs_v31_test OWNER rs_v3 ENCODING 'UTF8' TEMPLATE template0;

REVOKE ALL ON DATABASE rs_v31_demo FROM PUBLIC;
REVOKE ALL ON DATABASE rs_v31_test FROM PUBLIC;

\echo 'Created role rs_v3 and databases rs_v31_demo, rs_v31_test. V1 untouched.'
