-- The query console's settings, so an administrator can change them without a
-- server restart — and without editing a file they may not have access to.
--
-- Same shape and same rules as `delivery_settings` (V7): one row, every column
-- nullable, and the environment wins. A NULL column means "nobody has chosen",
-- so the value falls through to the environment variable and then to the code
-- default; a value means an administrator chose it in the interface. A Compose
-- file that pins `ADHOC_ENABLED=false` cannot be contradicted from a browser,
-- which is what makes this safe to expose at all.
--
-- What is deliberately NOT here: `ADHOC_DB_PASSWORD`. It is installed on the
-- console's Postgres role by `ALTER ROLE` at boot, the statement text carries it
-- (so the database's own log may capture it), and — the reason that matters — it
-- is what keeps the decision to *have* this capability with whoever installed
-- the server. Without a password the console cannot start no matter what this
-- table says, so an installation that never sets one can leave every switch here
-- alone and still not have a SQL prompt on its production database.

CREATE TABLE adhoc_settings (
    -- One row, enforced. The console has one configuration, not a set of them.
    id                 SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    -- Whether the console runs at all. NULL = decide from the environment.
    enabled            BOOLEAN,

    -- Whether it authenticates as the read-write role instead of the read-only
    -- one. Not an application check: this selects a different Postgres identity,
    -- and what that identity may do is decided by V11's and V12's grants.
    write_enabled      BOOLEAN,

    -- A query stops here rather than running until somebody notices.
    timeout_ms         INTEGER      CHECK (timeout_ms IS NULL OR timeout_ms BETWEEN 100 AND 600000),

    -- The row cap. One more than this is fetched, so the console can say the
    -- result was truncated rather than quietly showing a prefix.
    max_rows           INTEGER      CHECK (max_rows IS NULL OR max_rows BETWEEN 1 AND 100000),

    -- How long a statement may be. A bound on what reaches the audit trail as
    -- much as on what reaches the database.
    max_query_length   INTEGER      CHECK (max_query_length IS NULL OR max_query_length BETWEEN 1 AND 1000000),

    -- How much of the console's activity is recorded: every accepted query,
    -- only the ones the database refused, or nothing.
    audit              VARCHAR(16)  CHECK (audit IS NULL OR audit IN ('all', 'refused', 'off')),

    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Who last changed it. The audit trail carries the same fact with more
    -- detail; this is here so the settings row can answer for itself.
    updated_by         VARCHAR(200)
);

COMMENT ON TABLE adhoc_settings IS
    'Query console settings. One row. NULL means "fall through to the environment, then the default"; '
    'the environment always wins over a value stored here. ADHOC_DB_PASSWORD is deliberately absent.';
