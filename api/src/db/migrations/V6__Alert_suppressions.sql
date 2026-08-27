-- Suppression rules, and the port column a port criterion needs to match on.
--
-- The problem this solves is the one that gets a monitoring tool switched off in
-- its second month. An authorised vulnerability scanner sweeping the estate every
-- night raises a `high` port-scan finding every night, correctly, forever. With no
-- way to record "that source, that kind, expected", the alert table fills with
-- known-good noise, the real findings sit underneath it, and the person on call
-- stops believing any of it.
--
-- A suppressed finding is DROPPED before it is stored, not stored and hidden.
-- That is the risky half of this feature, so it is stated here as well as in
-- services/suppression-rules.ts: a rule broader than its author realised discards
-- real findings and leaves nothing behind to notice. Three columns exist purely to
-- make that visible rather than silent — `reason`, which is mandatory;
-- `match_count` with `last_match_at`, so a rule quietly eating thousands of
-- findings a day is a number on a screen; and `expires_at`, so "suppress during
-- the pen test" does not become a permanent blind spot.
--
-- Deliberately absent: severity, an OR between criteria, negation, regular
-- expressions, any expression language. A rule that cannot be read at a glance is
-- a rule that cannot be audited, and this table is security configuration.

CREATE TABLE alert_suppressions (
    id            BIGSERIAL PRIMARY KEY,

    -- Criteria. Every column here is NULLABLE, and NULL means "any" — so a rule
    -- is the conjunction of whichever ones are set. See the CHECK below for why
    -- all-NULL is refused.
    kind          VARCHAR(64),
    source_cidr   VARCHAR(64),
    target_cidr   VARCHAR(64),
    port          INTEGER,

    -- Why this is expected. Mandatory: a suppression nobody can justify six
    -- months later is exactly the kind that should never have been written, and
    -- an empty string is not a justification.
    reason        VARCHAR(500) NOT NULL,

    -- Switched off without being deleted, so a rule can be tested against a
    -- hypothesis and put back without retyping it.
    enabled       BOOLEAN      NOT NULL DEFAULT true,
    -- NULL never expires. An expiry is the difference between a temporary
    -- suppression and a permanent one that was meant to be temporary.
    expires_at    TIMESTAMPTZ,

    created_by    VARCHAR(200) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- How much this rule is actually hiding. BIGINT because a rule pointed at a
    -- busy scanner on a busy segment will pass two billion.
    match_count   BIGINT       NOT NULL DEFAULT 0,
    last_match_at TIMESTAMPTZ,

    -- A rule with no criteria at all matches every finding from every source.
    -- Refused in the database as well as at the API boundary, because this is the
    -- one mistake here with no recoverable symptom: the tool simply goes quiet.
    CONSTRAINT alert_suppressions_criteria_check
        CHECK (kind IS NOT NULL OR source_cidr IS NOT NULL OR target_cidr IS NOT NULL OR port IS NOT NULL),

    CONSTRAINT alert_suppressions_port_check
        CHECK (port IS NULL OR (port BETWEEN 1 AND 65535)),

    CONSTRAINT alert_suppressions_reason_check
        CHECK (btrim(reason) <> '')
);

-- The read that happens on the hot path is "every enabled rule", and on a table
-- this small the partial index is about intent as much as speed.
CREATE INDEX alert_suppressions_enabled_idx ON alert_suppressions (enabled) WHERE enabled;

-- The destination port a finding is about, when exactly one port describes it.
--
-- NULL for most kinds, and that is not a gap to be filled in later. A port scan's
-- defining property is that it touched many ports, so no single port describes it;
-- recording the last one observed would make the port criterion above match
-- almost arbitrarily. Populated for the findings whose identity includes one port:
-- a sweep of a single service, a cleartext login on a known service port.
--
-- Rows written before this migration keep NULL, so a rule naming a port will not
-- match them. That is the honest outcome — the port those findings concerned was
-- never recorded — and it only affects the preview endpoint, which reports what
-- it examined.
ALTER TABLE alerts ADD COLUMN port INTEGER;
