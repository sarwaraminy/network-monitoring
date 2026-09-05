-- Ad Hoc Query: a SECOND role, for installs that want the console to write.
--
-- Requested deliberately, after the read-only trade-off was put and declined:
-- the console should be able to UPDATE and DELETE, not only SELECT.
--
-- The important structural decision is that this is a separate role rather than
-- new grants on the read-only one. Adding write privileges to `nm_adhoc_<db>`
-- would make every install read-write the moment it migrated, including the ones
-- that never asked — the feature flag would be the only thing standing between a
-- browser session and a DELETE, and a flag is application state, not a database
-- guarantee. Two roles means a read-only install stays read-only in the place
-- that actually enforces it, and "can this console write" remains a question the
-- database answers rather than the app.
--
-- What write mode does NOT relax, and why each still holds:
--
--   * `audit_events` gets no write grants at all. It is the record of what was
--     done to this system, V9 makes it append-only with a trigger, and a console
--     that can rewrite the trail is a console whose own use cannot be
--     investigated. The trigger would refuse anyway; not granting says so.
--   * `schema_migrations` gets nothing. The ledger is machinery.
--   * The secret columns stay unreadable AND unwritable — `users.password`,
--     `delivery_settings.email_password`, `webhook_url`. Being able to write is
--     not a reason to be able to read a password hash, and being able to write
--     one is how an account gets a password only the writer knows.
--   * `users` and `delivery_settings` are readable but not writable at all. Both
--     are configuration with their own screens and their own audit entries; a
--     console UPDATE there would change who can log in, or where findings are
--     delivered, with no record beyond the query text.
--   * Still not a superuser. `COPY ... FROM PROGRAM` and `pg_read_file` remain
--     out of reach, which is the difference between "can edit rows" and "has the
--     database host".
--
-- So what write mode buys is exactly the operational data: findings, the devices
-- table, suppression rules, the legacy log, and the rollup. That is the set
-- somebody clearing test rows or fixing a bad import actually needs.

DO $$
DECLARE
    -- Same rule as V11, with its own prefix. See `adhocRole` in
    -- adhoc.service.ts: the two must agree, and both are byte-bounded with a
    -- fixed-width md5 fallback rather than truncation.
    role_name text := CASE
        WHEN octet_length('nm_adhocrw_' || current_database()) <= 63
            THEN 'nm_adhocrw_' || current_database()
        ELSE 'nm_adhocrw_' || left(md5(current_database()), 16)
    END;
BEGIN
    BEGIN
        EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    EXCEPTION
        -- Both, for the reason V10 records: 42710 is the sequential case and
        -- 23505 the concurrent one, and CI is the concurrent one.
        WHEN duplicate_object OR unique_violation THEN NULL;
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'Skipping the ad hoc write role: this database owner may not CREATE ROLE.';
    END;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        RAISE NOTICE 'Ad hoc write role absent; skipping its grants.';
        RETURN;
    END IF;

    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);

    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);

    -- The operational data: readable and writable.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON alerts             TO %I', role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON alert_rollup_daily TO %I', role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON alert_suppressions TO %I', role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON known_devices      TO %I', role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON logs               TO %I', role_name);

    -- INSERT needs the sequences behind the serial ids. USAGE and SELECT only:
    -- `nextval` and `currval`, never `setval`, so the console cannot rewind a
    -- sequence into ids that already exist.
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', role_name);

    -- Read-only, exactly as the read-only role has them. Secrets excluded.
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

    -- Readable so the trail can be QUERIED from the console, which is useful.
    -- No write grant: see the header.
    EXECUTE format('GRANT SELECT ON audit_events TO %I', role_name);

    EXECUTE format(
        'COMMENT ON ROLE %I IS %L', role_name,
        'Read-WRITE role for the Ad Hoc Query console on database ' || current_database() ||
        '. Writes operational tables only; audit_events is read-only and secrets are excluded. '
        'See V12__Adhoc_write_role.sql.');
END
$$;
