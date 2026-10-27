-- One-time LOCAL setup for V3.1. Run as the postgres superuser (asks for the postgres password):
--   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -f "D:\client works\rs new\v3.1\app\api\scripts\setup-v31-db.sql"
--
-- Creates rs_v31_demo (a copy of rs_v3_demo, so the V3 demo data carries over) and an empty
-- rs_v31_test, both owned by the existing rs_v2 role used in v3.1\app\api\.env.
-- Never touches rs_v3_demo / rs_v3_test except reading rs_v3_demo as the copy template.
-- Stop the V3 demo server first (v3\local-server\STOP-V3.bat): a template database must have
-- no open connections.

\set ON_ERROR_STOP on

SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = 'rs_v3_demo' AND pid <> pg_backend_pid();

CREATE DATABASE rs_v31_demo OWNER rs_v2 TEMPLATE rs_v3_demo;
CREATE DATABASE rs_v31_test OWNER rs_v2 ENCODING 'UTF8' TEMPLATE template0;

REVOKE ALL ON DATABASE rs_v31_demo FROM PUBLIC;
REVOKE ALL ON DATABASE rs_v31_test FROM PUBLIC;

\echo 'Created rs_v31_demo (copy of rs_v3_demo) and rs_v31_test. V3 databases unchanged.'
