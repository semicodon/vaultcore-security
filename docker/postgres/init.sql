-- Enable pgcrypto for cryptographic functions and UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create a dedicated read-only role for security auditors / reporting
   DO
   $DO$
   BEGIN
        IF NOT EXISTS(
           SELECT FROM pg_catalog.pg_roles
           WHERE rolname = 'vaultcore_auditor') THEN
           CREATE ROLE vaultcore_auditor NOLOGIN;
        )
        END IF;
    END
    $do$;

-- Revoke default public creation privileges on the public schema (PostgreSQL 15+ default, enforced explicitly)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;