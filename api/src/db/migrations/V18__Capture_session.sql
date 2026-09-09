-- What this sensor was capturing, so a restart stops being silent.
--
-- Packet capture lives entirely in process memory: `startCapture` opens a pcap
-- handle and sets a few fields, and nothing outside the process knows it
-- happened. Flow collection restarts itself at boot from `FLOW_ENABLED`; capture
-- does not, and the Capture screen shows "Idle" afterwards — which is equally
-- true of "nobody ever started one" and "this host was capturing on eth0 until
-- the service was restarted at 03:14". For a monitoring product, a period of not
-- monitoring that nothing reports is the worst of the two states it can be in,
-- because it looks exactly like the good one.
--
-- So the session is written down. This table is not configuration: it is a record
-- of what an operator asked for and whether it was still running when this
-- process last had an opinion. `stopped_at IS NULL` means the previous process
-- was capturing and did not stop cleanly — a crash, a container restart, a
-- machine reboot.
--
-- Keyed on (sensor_id, scope), and both halves are load-bearing.
--
-- `sensor_id` follows V16: two sensors sharing a database capture on their own
-- interfaces, and a global row would have each overwriting the other's session
-- and reporting the other's interruption.
--
-- `scope` because one process runs TWO captures — `packet-capture.registry.ts`
-- holds an interface-wide service and an IP-filtered one, each with its own
-- handle, buffer and detection state. A row per sensor alone would have those two
-- overwriting each other exactly as two sensors would: start a filtered capture
-- while an interface-wide one is running and the second write erases the first,
-- so a restart resumes one of them and silently forgets the other.
--
-- Deliberately NOT a settings table. There is no environment layer and nothing
-- here is editable in the interface, because none of it is a choice — it is a
-- record. Whether an interrupted session is resumed *is* a choice, and it lives
-- in `CAPTURE_RESUME_ON_START` rather than here, for the reason `env.ts` gives
-- about the query console: starting a packet capture unattended is a decision
-- that belongs to whoever installed the server, not to a browser session.

CREATE TABLE capture_session (
    sensor_id       VARCHAR(64)  NOT NULL,
    -- 'interface' or 'filtered-ip'; see packet-capture.registry.ts. Not a CHECK
    -- constraint: the set is the registry's to decide, and a migration that has
    -- to be written to add a third capture scope is a migration nobody expects.
    scope           VARCHAR(16)  NOT NULL,

    -- Enough to start the same capture again, and nothing more. The snapshot
    -- length and read timeout are stored as the operator sent them rather than as
    -- `startCapture` clamps them, so a resumed session is the session that was
    -- asked for and the clamps stay in one place.
    interface_name  TEXT         NOT NULL,
    snapshot_length INTEGER      NOT NULL,
    timeout_ms      INTEGER      NOT NULL,

    -- The BPF host filter, or NULL for an unfiltered capture. Stored as the
    -- address rather than the compiled filter string so resuming rebuilds it
    -- through `buildFilter` — one place that decides what a filter looks like.
    filter_ip       TEXT,

    started_at      TIMESTAMPTZ  NOT NULL,

    -- Who started it. The audit trail already records the act; this is here so
    -- the interruption notice can say whose capture was cut short without a join.
    started_by      VARCHAR(200) NOT NULL,

    -- NULL while running. Stamped by `stopCapture`, and stamped at boot for a
    -- session that was found still running — so the notice is shown once, by the
    -- process that discovered it, and a second restart does not repeat a report
    -- about an interruption that has already been seen.
    stopped_at      TIMESTAMPTZ,

    PRIMARY KEY (sensor_id, scope)
);

COMMENT ON TABLE capture_session IS
    'The last capture each (sensor, scope) was asked to run. stopped_at IS NULL means it was interrupted.';
