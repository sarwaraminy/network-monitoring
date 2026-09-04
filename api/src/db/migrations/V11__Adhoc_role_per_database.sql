-- Ad Hoc Query: give each DATABASE its own console role.
--
-- V10 created one `nm_adhoc` for the whole cluster, and that is wrong in a way
-- that only shows up when more than one database on a server runs these
-- migrations — which is every developer machine, because the test harness
-- creates a database per suite and each one boots the console.
--
-- Roles are cluster-wide; grants are per-database. So the grants were correctly
-- separate while the ROLE and, fatally, its PASSWORD were shared. The console
-- sets that password at boot from `ADHOC_DB_PASSWORD`, so whichever process
-- started last owned it and every other one began failing with "password
-- authentication failed for user nm_adhoc". Running the test suite logged the
-- developer's own running app out of its query console.
--
-- The fix is a role per database, named from `current_database()`. That keeps
-- the property V10 was protecting — the name is derived, never configured, so no
-- setting can point the console at a superuser — while making two databases on
-- one cluster independent.
--
-- Dynamic SQL because a migration cannot know the database name at the time it
-- is written. `format(%I)` quotes the identifier, which matters here: the
-- harness's database names contain hyphens.
--
-- V10 is left in place rather than rewritten. It has already been applied on
-- machines that ran this branch, and editing an applied migration only produces
-- a checksum mismatch and a database nobody updates. What this does instead is
-- take the old role's access away in THIS database, so the shared role is inert
-- everywhere V11 has run.

DO $$
DECLARE
    -- Bounded to Postgres's 63-byte identifier limit, and NOT by truncation
    -- alone. An over-long identifier is silently cut at creation, so the plain
    -- concatenation left this migration and `adhocRole()` in adhoc.service.ts
    -- naming different roles — and the resulting error compares two strings that
    -- are identical for as far as anyone reads. Truncating on both sides would
    -- trade that for a worse one: two long database names cut to the same role,
    -- which is the shared-role collision this file exists to remove. So the tail
    -- is an md5 of the whole name; the prefix stays readable and the identity
    -- stays unique. Nothing is truncated in the over-long case, deliberately:
    -- `left(…, 54)` counts CHARACTERS while the budget is BYTES, so a multibyte
    -- database name came in under one and over the other, and the two sides
    -- disagreed again. `adhoc.service.ts` computes this exact rule — the prefix
    -- plus 16 hex characters of md5 — and the two must move together.
    role_name text := CASE
        WHEN octet_length('nm_adhoc_' || current_database()) <= 63
            THEN 'nm_adhoc_' || current_database()
        ELSE 'nm_adhoc_' || left(md5(current_database()), 16)
    END;
BEGIN
    -- Same shape as V10: caught rather than checked. The per-database name means
    -- two DATABASES cannot collide here, but two processes migrating the SAME
    -- database can — `migrate.ts` takes no lock — and check-then-create loses
    -- that race the same way.
    BEGIN
        EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    EXCEPTION
        -- BOTH codes, and the second is the one that matters. `duplicate_object`
        -- (42710) is what CreateRole raises from its own pre-check, which is the
        -- SEQUENTIAL case: the role was already committed before this session
        -- looked. The CONCURRENT case never reaches that check — both sessions
        -- look, both find nothing, and the loser fails at `pg_authid_rolname_index`
        -- with `unique_violation` (23505), because nothing serialises the two
        -- between the check and the insert.
        --
        -- Catching only 42710 therefore missed the exact race this handler was
        -- written for. Verified against a real cluster: two concurrent
        -- `CREATE ROLE` statements return `ok` and `23505`.
        WHEN duplicate_object OR unique_violation THEN NULL;
        -- And `insufficient_privilege`, which is a different problem with the
        -- same right answer: CREATE ROLE needs SUPERUSER or CREATEROLE, and a
        -- hardened install's database owner has neither. Letting 42501 out of
        -- this block fails `runMigrations()`, which fails `main()`, which exits
        -- 1 — so an existing deployment could not START after pulling this
        -- release, blocked by a migration for a feature that is off by default
        -- and that it may never enable. An optional feature must not be able to
        -- stop an upgrade.
        --
        -- Not silent: the NOTICE says what did not happen, and the console's own
        -- startup check then reports `role ... does not exist; has V11 run on
        -- this database?`, which is accurate about the state it finds.
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'Skipping the ad hoc console role: this database owner may not CREATE ROLE. '
                         'The console will stay off until a role with CREATEROLE runs this migration.';
    END;

    -- Same reason as V10: the handler above tolerates an owner that cannot
    -- CREATE ROLE, and every statement below needs the role to exist. Without
    -- this the next line fails with `undefined_object` and takes the migration
    -- down anyway.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        RAISE NOTICE 'Ad hoc console role absent; skipping its grants.';
        RETURN;
    END IF;

    -- Explicit, though a fresh role has none of this: the point is that the file
    -- can be read as the whole of what this role may do.
    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);

    -- USAGE resolves names in `public`. Not CREATE: this role cannot make a
    -- table of its own to write into.
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);

    -- The tables with nothing to hide.
    EXECUTE format('GRANT SELECT ON alerts             TO %I', role_name);
    EXECUTE format('GRANT SELECT ON alert_rollup_daily TO %I', role_name);
    EXECUTE format('GRANT SELECT ON alert_suppressions TO %I', role_name);
    EXECUTE format('GRANT SELECT ON audit_events       TO %I', role_name);
    EXECUTE format('GRANT SELECT ON known_devices      TO %I', role_name);
    EXECUTE format('GRANT SELECT ON logs               TO %I', role_name);

    -- And the two that do, column by column. A column added to either of these
    -- tables is unreadable here until somebody lists it, which is the right way
    -- round: new columns are invisible until a human has decided they are not a
    -- secret. `users.password`, `delivery_settings.email_password` and
    -- `webhook_url` are the exclusions — hashes, the SMTP password in use, and a
    -- webhook URL, which is a bearer credential.
    EXECUTE format(
        'GRANT SELECT (id, email, role, lang_code, firstname, lastname, created_at) ON users TO %I',
        role_name);
    EXECUTE format(
        'GRANT SELECT (id, enabled, min_severity, digest_seconds, throttle_seconds, max_per_hour, '
        'include_evidence, dashboard_url, webhook_format, syslog_host, syslog_port, syslog_protocol, '
        'syslog_format, syslog_rfc, syslog_facility, syslog_app_name, syslog_include_evidence, '
        'email_host, email_port, email_secure, email_user, email_from, email_to, updated_at, updated_by) '
        'ON delivery_settings TO %I',
        role_name);

    EXECUTE format(
        'COMMENT ON ROLE %I IS %L', role_name,
        'Read-only role for the Ad Hoc Query console on database ' || current_database() ||
        '. SELECT only, secrets excluded at the column level. See V11__Adhoc_role_per_database.sql.');

    -- Retire V10's shared role in this database. It keeps existing, because
    -- dropping a cluster-wide role from a per-database migration would break any
    -- database that has not run V11 yet; it simply has no access here any more.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nm_adhoc') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA public FROM nm_adhoc';
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nm_adhoc';
    END IF;
END
$$;
