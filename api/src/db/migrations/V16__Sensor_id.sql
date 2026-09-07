-- Which sensor a finding came from.
--
-- Two installations sharing one database used to write into each other's rows.
-- `alerts.dedup_key` was globally UNIQUE, and the dedup key is derived from what
-- was observed — a kind, the addresses involved and a time bucket — so two sensors
-- watching different segments produce the *same* key for two unrelated events on
-- two different networks. The upsert in alert.service.ts then found the other
-- sensor's row: occurrence counts added together, `first_seen`/`last_seen` widened
-- to span both, and the title, severity and evidence became whichever sensor
-- flushed last. Nothing anywhere reported a conflict, because at the database level
-- there was not one.
--
-- `known_devices` was quieter and worse. Its primary key was the MAC address alone,
-- so a phone one sensor had already learned was, to the other sensor, a device it
-- had seen before — and new-device detection, the thing that notices an unknown
-- machine appearing on a segment, simply never fired for it. A merged alert is
-- visibly wrong once somebody looks; a detection that does not happen leaves no
-- trace at all.
--
-- `alert_rollup_daily` follows both, because a rollup that merged what the alerts
-- table now separates would put the two sensors back together the moment retention
-- swept, and the rollup is never pruned.
--
-- The default is `default`, matching env.ts's default for SENSOR_ID, so an existing
-- installation's rows keep working against the identity the process will use. That
-- pairing is the whole upgrade story: a single-sensor installation upgrades, its
-- alerts stay where they are, its recurring findings go on merging into the rows
-- they were already merging into, and nothing about the interface changes until an
-- operator sets the variable on a second sensor.

-- Backfill, then DROP DEFAULT. The default exists to fill in the rows already in
-- the table and must not survive that: with it in place, an INSERT that forgot to
-- name the sensor would quietly land on `default` and merge with somebody else's
-- findings — the exact bug this migration exists to remove, restored silently and
-- with a passing test suite. Without it, that INSERT fails.
ALTER TABLE alerts             ADD COLUMN sensor_id VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE known_devices      ADD COLUMN sensor_id VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE alert_rollup_daily ADD COLUMN sensor_id VARCHAR(64) NOT NULL DEFAULT 'default';

ALTER TABLE alerts             ALTER COLUMN sensor_id DROP DEFAULT;
ALTER TABLE known_devices      ALTER COLUMN sensor_id DROP DEFAULT;
ALTER TABLE alert_rollup_daily ALTER COLUMN sensor_id DROP DEFAULT;

-- The same rule env.ts applies to SENSOR_ID, applied where the value is actually
-- stored. `NOT NULL` does not exclude the empty string, and an empty sensor id
-- would be a second identity that renders as nothing in every list — indistinguishable
-- on screen from the sensor that has not been named yet.
ALTER TABLE alerts
    ADD CONSTRAINT alerts_sensor_id_check CHECK (sensor_id <> '');
ALTER TABLE known_devices
    ADD CONSTRAINT known_devices_sensor_id_check CHECK (sensor_id <> '');
ALTER TABLE alert_rollup_daily
    ADD CONSTRAINT alert_rollup_daily_sensor_id_check CHECK (sensor_id <> '');

-- Alerts: the dedup key becomes unique *per sensor* rather than globally.
--
-- Dropping the old constraint drops the index behind it; the new one creates an
-- index on (sensor_id, dedup_key), which is also the lookup the upsert's ON
-- CONFLICT needs. Leading with sensor_id means that index additionally serves
-- "everything from this sensor", so the per-sensor filter the API gains has
-- something to read.
ALTER TABLE alerts DROP CONSTRAINT alerts_dedup_key_key;
ALTER TABLE alerts ADD CONSTRAINT alerts_sensor_dedup_key_key UNIQUE (sensor_id, dedup_key);

-- Known devices: "seen before" becomes a question about one sensor's segment.
--
-- Two sensors on the same segment now each learn the device independently, which
-- costs one extra row per device and is the correct answer: what a sensor has seen
-- is a fact about that sensor, and the alternative silently disables detection on
-- every sensor but whichever one booted first.
ALTER TABLE known_devices DROP CONSTRAINT known_devices_pkey;
ALTER TABLE known_devices ADD PRIMARY KEY (sensor_id, mac_address);

-- The index the per-sensor retention cutoff reads, added with the correlation
-- that needs it rather than after somebody notices.
--
-- `forgetStaleDevices` derives each sensor's cutoff from `max(last_seen)` for
-- that sensor, evaluated against the row being considered for deletion. Nothing
-- already here serves that: V4's index is on `last_seen` alone, and the primary
-- key above leads with `sensor_id` but carries the MAC second, so a per-sensor
-- maximum would still have to read every row for the sensor. This one answers it
-- from the first entry of the sensor's range instead, which matters because the
-- table it is on is the one whose unbounded growth is the reason that sweep
-- exists, and the sweep runs nightly.
--
-- DESC to match the direction the maximum is read from; Postgres can scan either
-- way, but stating it keeps the index and the query obviously about the same
-- thing.
CREATE INDEX known_devices_sensor_last_seen_idx
    ON known_devices (sensor_id, last_seen DESC);

-- The rollup's natural key gains the same column, so a sweep on one sensor cannot
-- add its counts to another's bucket. This is what keeps the sweep idempotent per
-- sensor rather than per day.
ALTER TABLE alert_rollup_daily DROP CONSTRAINT alert_rollup_daily_pkey;
ALTER TABLE alert_rollup_daily ADD PRIMARY KEY (sensor_id, day, kind, severity);
