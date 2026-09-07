-- The console's role password, settable from the interface.
--
-- V14 deliberately left this out, and the reasoning there was that the password
-- is what keeps the decision to *have* a SQL prompt on the production database
-- with whoever installed the server. That is still an accurate description of
-- what changes here: with this column, an administrator holding a session can
-- provision a working console on their own. It is a product decision, taken
-- knowingly.
--
-- V14's own comments still say the password is deliberately absent, and they
-- cannot be edited: `migrate.ts` records a checksum per file and refuses one
-- that changed, which is the property that makes an applied migration
-- trustworthy. So the correction is made where it can be — the table comment is
-- replaced at the bottom of this file, and V14's prose has to be read as the
-- history it now is. If you are reading V14 wondering whether this column should
-- exist: it was added on purpose, here, with the reasoning above.
--
-- What holds the line instead:
--
--   * THE ENVIRONMENT STILL WINS. `ADHOC_DB_PASSWORD` set in the environment
--     pins the field: the control renders disabled and the API refuses a change
--     with a 409. An installation that wants the old behaviour sets the variable
--     and the interface cannot contradict it.
--
--   * THE CONSOLE CANNOT READ THIS TABLE. V11 and V12 grant the console roles an
--     explicit per-table allowlist — alerts, alert_rollup_daily,
--     alert_suppressions, audit_events, known_devices, logs, and named columns
--     of users and delivery_settings. `adhoc_settings` is in neither list, so a
--     console session cannot read the credential it is running as. The REVOKE
--     below states that rather than relying on it, and `adhoc-role.test.ts`
--     proves it against a real database.
--
--   * IT NEVER LEAVES THE SERVER. The API reports whether a password is set,
--     never what it is, the same contract `delivery_settings` uses for the SMTP
--     password and the OAuth secret. The audit trail records that the password
--     changed, never the value.
--
-- Stored as given, not hashed: this is a credential the application must be able
-- to present to Postgres, so it has to be recoverable. It is the same trade the
-- SMTP password makes in V7. Anyone with read access to this table therefore
-- holds the console credential — but the only roles with that access are the
-- application owner and a superuser, both of which already outrank the console.

ALTER TABLE adhoc_settings
    ADD COLUMN db_password TEXT;

COMMENT ON COLUMN adhoc_settings.db_password IS
    'The console role''s password, installed with ALTER ROLE at startup. NULL means fall through to '
    'ADHOC_DB_PASSWORD. Never returned by the API and never written to the audit trail. Not readable '
    'by the console''s own roles: V11/V12 grant no access to this table.';

-- Belt and braces. The grants in V11 and V12 are an allowlist that never
-- mentioned this table, so this revokes nothing today — it is here so that a
-- future `GRANT SELECT ON ALL TABLES`, the obvious convenience that would
-- quietly hand the console its own credential, has to override an explicit
-- statement rather than fill a silence.
DO $$
DECLARE
    -- The SAME derivation as V11 and V12, not a simpler one. Both are
    -- byte-bounded with a fixed-width md5 tail rather than truncated, because a
    -- multibyte database name came in under a character limit and over the byte
    -- limit and the two sides then disagreed about the role's name. A cheaper
    -- `'nm_adhoc_' || current_database()` here would revoke on a role that does
    -- not exist for any long-named database and silently skip the real one.
    prefixes TEXT[] := ARRAY['nm_adhoc_', 'nm_adhocrw_'];
    prefix   TEXT;
    role_name TEXT;
BEGIN
    FOREACH prefix IN ARRAY prefixes
    LOOP
        role_name := CASE
            WHEN octet_length(prefix || current_database()) <= 63
                THEN prefix || current_database()
            ELSE prefix || left(md5(current_database()), 16)
        END;

        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON adhoc_settings FROM %I', role_name);
        END IF;
    END LOOP;
END
$$;

-- V14's table comment said the password was deliberately absent. It is not any
-- more, and a comment that describes the opposite of the schema is worse than no
-- comment: it is the one an operator would trust.
COMMENT ON TABLE adhoc_settings IS
    'Query console settings. One row. NULL means "fall through to the environment, then the default"; '
    'the environment always wins over a value stored here. Includes db_password, which is never '
    'returned by the API and is not readable by the console''s own roles.';
