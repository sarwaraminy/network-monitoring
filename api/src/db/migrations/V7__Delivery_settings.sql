-- Delivery settings, so an IT admin can change them without a shell and a restart.
--
-- Every delivery setting is currently read once from api/.env at boot. That is fine
-- for the developer and wrong for the buyer: the person configuring this is an IT
-- admin, and asking them to edit a file on the host to add a second recipient makes
-- every tuning change an outage. See issue #28.
--
-- This table is the middle of three layers, resolved per field in
-- notify/settings.ts:
--
--     environment variable  ->  this row  ->  code default
--
-- The environment still wins, and that is what makes the table safe to add. A
-- deployment driven by Compose or config management keeps its settings pinned in a
-- file that a web form cannot contradict; without that ordering the file would say
-- one thing, the process would do another, and the next redeploy would silently
-- revert whatever had been changed in the UI.
--
-- Every column is therefore NULLABLE, and NULL means "no opinion — fall through to
-- the default". That is not the same as an empty string, which for a text setting is
-- a deliberate blank.

CREATE TABLE delivery_settings (
    -- Exactly one row, ever. A settings table that can hold two rows eventually
    -- holds two rows, and then which one applies is a coin toss.
    id                      SMALLINT PRIMARY KEY DEFAULT 1,

    -- Gates. These apply to the channels a person reads, never to the SIEM feed.
    enabled                 BOOLEAN,
    min_severity            VARCHAR(16),
    digest_seconds          INTEGER,
    throttle_seconds        INTEGER,
    max_per_hour            INTEGER,
    include_evidence        BOOLEAN,
    dashboard_url           VARCHAR(500),

    -- Webhook. The URL is a bearer credential for Slack and Teams, which is why
    -- GET /api/notify/status has never returned it and why the API redacts it here
    -- too: the form reports whether it is configured and offers to replace it.
    webhook_url             VARCHAR(1000),
    webhook_format          VARCHAR(32),

    -- Syslog / CEF export.
    syslog_host             VARCHAR(255),
    syslog_port             INTEGER,
    syslog_protocol         VARCHAR(8),
    syslog_format           VARCHAR(8),
    syslog_rfc              VARCHAR(8),
    syslog_facility         INTEGER,
    syslog_app_name         VARCHAR(64),
    syslog_include_evidence BOOLEAN,

    -- Email over SMTP. The password is a password.
    email_host              VARCHAR(255),
    email_port              INTEGER,
    email_secure            BOOLEAN,
    email_user              VARCHAR(255),
    email_password          VARCHAR(500),
    email_from              VARCHAR(255),
    -- A list, stored as a list rather than a comma-separated string, so a recipient
    -- containing a comma cannot corrupt the set.
    email_to                TEXT[],

    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Who last changed it. There is no audit log yet (roadmap item 4); this is the
    -- minimum that makes "who turned delivery off?" answerable.
    updated_by              VARCHAR(200),

    CONSTRAINT delivery_settings_single_row CHECK (id = 1),

    -- Value constraints mirror the closed sets in notify/settings.ts. The resolver
    -- refuses an unparseable stored value and falls through to the default, so these
    -- are belt-and-braces against a hand-written UPDATE rather than the only guard.
    CONSTRAINT delivery_settings_min_severity_check
        CHECK (min_severity IS NULL OR min_severity IN ('critical', 'high', 'medium', 'low', 'info')),
    CONSTRAINT delivery_settings_webhook_format_check
        CHECK (webhook_format IS NULL OR webhook_format IN ('auto', 'slack', 'teams', 'teams-connector', 'discord', 'generic')),
    CONSTRAINT delivery_settings_syslog_protocol_check
        CHECK (syslog_protocol IS NULL OR syslog_protocol IN ('udp', 'tcp')),
    CONSTRAINT delivery_settings_syslog_format_check
        CHECK (syslog_format IS NULL OR syslog_format IN ('cef', 'json')),
    CONSTRAINT delivery_settings_syslog_rfc_check
        CHECK (syslog_rfc IS NULL OR syslog_rfc IN ('5424', '3164')),
    CONSTRAINT delivery_settings_ports_check
        CHECK ((syslog_port IS NULL OR syslog_port BETWEEN 1 AND 65535)
           AND (email_port IS NULL OR email_port BETWEEN 1 AND 65535)),
    -- A digest or throttle of zero is meaningful (no batching, no throttling); a
    -- negative one is not. `max_per_hour` of zero would mute every channel, which is
    -- what `enabled = false` is for, so it is refused rather than offered as a
    -- second way to spell it.
    CONSTRAINT delivery_settings_windows_check
        CHECK ((digest_seconds IS NULL OR digest_seconds >= 0)
           AND (throttle_seconds IS NULL OR throttle_seconds >= 0)
           AND (max_per_hour IS NULL OR max_per_hour >= 1)
           AND (syslog_facility IS NULL OR syslog_facility BETWEEN 0 AND 23))
);

-- The row is created on first boot from whatever the environment currently says, so
-- an existing installation keeps its behaviour and nothing changes silently on
-- upgrade. Seeding lives in the application rather than here because only it can read
-- the environment; this insert just guarantees the row exists.
INSERT INTO delivery_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
