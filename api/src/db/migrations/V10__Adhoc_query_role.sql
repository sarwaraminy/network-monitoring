-- Ad Hoc Query: the least-privilege role the SQL console runs as.
--
-- The console lets an administrator type SQL and see a result grid. The reason
-- this is a migration rather than a `if (looksLikeSelect(sql))` in TypeScript is
-- that app-side validation of SQL does not hold: CTEs can carry DML, comments and
-- string literals hide keywords, and `;` chains a second statement onto the first.
-- Postgres already has an authorisation system that gets all of this right, so
-- the console borrows it instead of reimplementing a worse one.
--
-- The stakes are specific here. The application connects as the database OWNER,
-- and in the default docker-compose that is `postgres`, a SUPERUSER. A console on
-- that connection is not "read some tables" — it is `COPY ... FROM PROGRAM`
-- (shell on the database host), `pg_read_file`, `UPDATE users SET role='ADMIN'`,
-- and `ALTER TABLE audit_events DISABLE TRIGGER`, which switches off the
-- append-only guarantee V9 exists to make. None of those are reachable as this
-- role.
--
-- Read-only is enforced twice over, deliberately:
--   1. This role is granted SELECT and nothing else. No INSERT, UPDATE, DELETE,
--      TRUNCATE, no CREATE on any schema, no ownership of anything.
--   2. The application also opens the console's transactions READ ONLY, so even a
--      grant added carelessly in some future migration does not become a write
--      path. Belt and braces, because the cost of being wrong is the database.
--
-- What it may NOT read is as important as what it may. Two tables hold secrets,
-- and a read-only console that can select them has exfiltrated them just as
-- thoroughly as one that could write:
--   * `users.password` — password hashes, offline-crackable.
--   * `delivery_settings.email_password` — the SMTP password, in use.
--   * `delivery_settings.webhook_url` — a Slack/Teams webhook URL is a bearer
--     credential: anyone holding it can post into the channel as this system.
-- Those are excluded at the COLUMN level, so `SELECT *` on those tables is
-- refused outright rather than quietly returning the secret.
--
-- `alerts.evidence` is deliberately NOT excluded. The cleartext-credential
-- detector records `passwordRecorded: false` and a length, never the password it
-- observed, so the evidence column carries no secret to leak. That is a property
-- of the detector, and if it ever changes this grant has to change with it.
--
-- The role is created NOLOGIN and without a password. It cannot authenticate
-- until something sets one, which the application does at boot from
-- `ADHOC_DB_PASSWORD` when the feature is switched on. A password does not belong
-- in a committed migration, and a role that can log in before anyone chose a
-- password is worse than no role.

DO $$
BEGIN
    -- Idempotent AGAINST A RACE, not just against a second run.
    --
    -- A role is cluster-wide while a migration runs per database, so several
    -- databases migrating at once all reach this line together — which is
    -- exactly what CI does now: four test suites migrate their own databases in
    -- parallel against a cluster that starts empty. A check-then-create loses
    -- there. All four see no role, all four issue CREATE ROLE, one wins on
    -- `pg_authid`'s unique index and three fail, each taking its suite down.
    -- The first run against a clean cluster is the likeliest to fail, and it
    -- fails as three unrelated-looking suite errors.
    --
    -- `CREATE ROLE` has no `IF NOT EXISTS`, so catching the duplicate is the
    -- shape that actually holds: the loser blocks on the index until the winner
    -- commits, then finds the role already there, which is the outcome it wanted.
    BEGIN
        CREATE ROLE nm_adhoc NOLOGIN;
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
END
$$;

-- Explicit, even though a fresh role starts with none of this: the point of the
-- file is to be readable as the whole of what this role may do, and "it inherits
-- nothing by default" is a fact about Postgres that a reader should not have to
-- know to audit it.
DO $$
BEGIN
    -- Everything below needs the role to exist, and it may not: the block above
    -- tolerates an owner without CREATEROLE so that an optional feature cannot
    -- block an upgrade. Without this guard those grants would fail with
    -- `undefined_object` and undo that tolerance one statement later.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nm_adhoc') THEN
        RAISE NOTICE 'Ad hoc console role absent; skipping its grants.';
        RETURN;
    END IF;

    REVOKE ALL ON SCHEMA public FROM nm_adhoc;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nm_adhoc;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM nm_adhoc;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM nm_adhoc;

    -- USAGE lets it resolve names in `public`. It does not grant CREATE, so this role
    -- cannot make a table of its own to write into.
    GRANT USAGE ON SCHEMA public TO nm_adhoc;

    -- The tables with nothing to hide.
    GRANT SELECT ON alerts               TO nm_adhoc;
    GRANT SELECT ON alert_rollup_daily   TO nm_adhoc;
    GRANT SELECT ON alert_suppressions   TO nm_adhoc;
    GRANT SELECT ON audit_events         TO nm_adhoc;
    GRANT SELECT ON known_devices        TO nm_adhoc;
    GRANT SELECT ON logs                 TO nm_adhoc;

    -- And the two that do, column by column. Adding a column to either of these
    -- tables leaves it unreadable here until someone adds it below, which is the
    -- right way round: a new column is invisible to the console until a human has
    -- decided it is not a secret.
    GRANT SELECT (id, email, role, lang_code, firstname, lastname, created_at)
        ON users TO nm_adhoc;

    GRANT SELECT (
        id, enabled, min_severity, digest_seconds, throttle_seconds, max_per_hour,
        include_evidence, dashboard_url, webhook_format,
        syslog_host, syslog_port, syslog_protocol, syslog_format, syslog_rfc,
        syslog_facility, syslog_app_name, syslog_include_evidence,
        email_host, email_port, email_secure, email_user, email_from, email_to,
        updated_at, updated_by
    ) ON delivery_settings TO nm_adhoc;

    -- The migration ledger is machinery, not data anyone should be querying, and
    -- `schema_migrations` is not granted above. Left unreadable on purpose.

    COMMENT ON ROLE nm_adhoc IS
        'Read-only role for the Ad Hoc Query console. SELECT only, secrets excluded at the column level. '
        'See V10__Adhoc_query_role.sql for why enforcement lives here rather than in application code.';
END
$$;
