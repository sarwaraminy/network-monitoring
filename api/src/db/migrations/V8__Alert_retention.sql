-- Daily rollups, so alerts can expire without the history disappearing with them.
--
-- `alerts` and `known_devices` grow forever. One recurring finding produces a fresh
-- row every `DETECT_ALERT_WINDOW_MS` (five minutes by default), so a scanner that
-- runs nightly is ~288 rows a day on its own; `known_devices` gains a row per MAC
-- address ever seen, which on a network of modern phones means a row per phone per
-- randomised address. Neither is a crisis in month one and both are in year two.
--
-- The obvious fix — delete anything older than N days — would break something worth
-- more than the disk it saves. The dashboard's trend chart reads `alerts.last_seen`
-- directly, so a view set to 365 days would silently show a flat line before the
-- retention cutoff: deleted history rendered exactly like a quiet network. This
-- codebase spends a lot of effort on not confusing those two things, and a retention
-- sweep that reintroduced the confusion would be a poor trade.
--
-- So detail expires and the shape survives. Before a day's alerts are deleted they
-- are aggregated into this table, which is never pruned: one row per
-- (day, kind, severity), carrying how many alerts there were and how many
-- observations they represented. The dashboard reads both and can therefore answer
-- "what did last March look like?" long after the individual rows are gone.

CREATE TABLE alert_rollup_daily (
    -- The UTC day being summarised. DATE, not a timestamp: this is a bucket, and
    -- storing an instant would invite the question of which instant.
    day          DATE         NOT NULL,
    kind         VARCHAR(64)  NOT NULL,
    severity     VARCHAR(16)  NOT NULL,

    -- Distinct alert rows collapsed into this bucket.
    alerts       INTEGER      NOT NULL,
    -- Observations those alerts represented. BIGINT, even though the per-alert
    -- `alerts.occurrences` this is summed from is INTEGER: Postgres's own sum() over
    -- an integer column returns bigint, precisely because a sum can plausibly exceed
    -- what any single 32-bit row holds, and a day's total across a busy segment is
    -- exactly that case. Matching the aggregate's own return type avoids a narrowing
    -- cast back to int.
    occurrences  BIGINT       NOT NULL,

    -- The real extremes within the bucket, so a rolled-up day still says when
    -- something happened rather than only that it did.
    first_seen   TIMESTAMPTZ  NOT NULL,
    last_seen    TIMESTAMPTZ  NOT NULL,

    rolled_up_at TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- The natural key. Also what makes the sweep idempotent: a re-run adds to an
    -- existing bucket rather than creating a second one for the same day.
    PRIMARY KEY (day, kind, severity),

    -- Mirrors the constraint on `alerts` itself. A rollup carrying a severity the
    -- application cannot produce would be unreadable by every consumer of it.
    CONSTRAINT alert_rollup_daily_severity_check
        CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    CONSTRAINT alert_rollup_daily_counts_check
        CHECK (alerts >= 1 AND occurrences >= 1),
    CONSTRAINT alert_rollup_daily_window_check
        CHECK (last_seen >= first_seen)
);

-- The dashboard asks for a date range, oldest-first.
CREATE INDEX alert_rollup_daily_day_idx ON alert_rollup_daily (day DESC);

-- The sweep deletes by age, and without this it seq-scans a table whose whole
-- problem is that it got large. `alerts_last_seen_idx` from V4 already covers
-- last_seen DESC; retention reads the other end of the same column, which that index
-- serves too, so nothing new is needed on `alerts`.
--
-- `known_devices` has `known_devices_last_seen_idx` from V4 for the same reason.
