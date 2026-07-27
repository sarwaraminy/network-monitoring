-- Replaces the per-packet `logs` model with aggregated security events.
--
-- The old design wrote one row per suspicious packet, which meant a single port
-- scan produced thousands of rows and a normal web page produced dozens. An alert
-- here is a finding: it carries a severity, an occurrence count, and structured
-- evidence rather than a raw packet dump.
--
-- Deliberately absent: raw packet payloads. Captured payloads can contain
-- personal data and message content, which brings wiretap statutes and GDPR into
-- scope for whoever runs this. Evidence is structured metadata only, and secrets
-- such as passwords are never recorded.

CREATE TABLE alerts (
    id              BIGSERIAL PRIMARY KEY,

    -- Detector identity and triage fields.
    kind            VARCHAR(64)  NOT NULL,
    severity        VARCHAR(16)  NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT         NOT NULL,

    -- Who and what. Any of these may be unknown for a given detector.
    source_ip       VARCHAR(64),
    source_mac      VARCHAR(32),
    target_ip       VARCHAR(64),
    target_mac      VARCHAR(32),
    protocol        VARCHAR(32),

    -- Aggregation. `dedup_key` collapses repeats of the same finding inside one
    -- time window; a later window produces a fresh alert instead of inflating an
    -- old one forever.
    dedup_key       VARCHAR(255) NOT NULL UNIQUE,
    occurrences     INTEGER      NOT NULL DEFAULT 1,
    first_seen      TIMESTAMPTZ  NOT NULL,
    last_seen       TIMESTAMPTZ  NOT NULL,

    -- Structured, payload-free supporting detail.
    evidence        JSONB        NOT NULL DEFAULT '{}'::jsonb,

    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(200),

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT alerts_severity_check
        CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info'))
);

CREATE INDEX alerts_last_seen_idx ON alerts (last_seen DESC);
CREATE INDEX alerts_kind_idx ON alerts (kind);
CREATE INDEX alerts_unacknowledged_idx ON alerts (acknowledged_at) WHERE acknowledged_at IS NULL;

-- Known devices, so "a MAC address never seen before" survives a restart instead
-- of re-alerting on every device each time the server boots.
CREATE TABLE known_devices (
    mac_address VARCHAR(32) PRIMARY KEY,
    first_ip    VARCHAR(64),
    last_ip     VARCHAR(64),
    label       VARCHAR(200),
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX known_devices_last_seen_idx ON known_devices (last_seen DESC);
