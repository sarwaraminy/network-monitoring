-- The flow collector's settings, so they can be changed without a server restart
-- and without editing a file the operator may have no access to.
--
-- Same shape and same rules as `delivery_settings` (V7) and `adhoc_settings`
-- (V14): one row, every column nullable, and the environment wins. A NULL column
-- means "nobody has chosen", so the value falls through to the environment
-- variable and then to the code default; a value means an administrator chose it
-- in the interface.
--
-- Why this one is worth having, given the others already exist: a restart on a
-- monitoring server drops a live packet capture. Changing the exporter allowlist
-- — the one setting here that changes in ordinary operation, as devices are added
-- — should not cost that.
--
-- What is deliberately NOT here: anything about *publishing* the UDP port. On a
-- Compose deployment the host port is forwarded by `docker-compose.flow.yml`, and
-- the application cannot see or change that. So a port changed here rebinds the
-- socket inside the container while Docker goes on forwarding the old one, and
-- collection stops with every counter reading exactly like a device that is not
-- sending. The interface says so next to the field; that overlay pins the port
-- and the bind address for the same reason, which is why this table can be safe
-- without knowing anything about Docker.

CREATE TABLE flow_settings (
    -- One row, enforced. The collector has one configuration, not a set of them.
    id            SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    -- Whether the collector binds a socket at all. NULL = decide from the
    -- environment.
    enabled       BOOLEAN,

    -- The UDP port. Floor of 1024 rather than 1: the API runs unprivileged in a
    -- container, so a privileged port cannot be bound and would report itself as
    -- "not listening" — indistinguishable from a port already in use. Refusing
    -- the value beats accepting one that cannot work.
    port          INTEGER      CHECK (port IS NULL OR port BETWEEN 1024 AND 65535),

    -- Which local address to bind. Inside a container this has to be 0.0.0.0:
    -- a published port forwards to the container's own interface, not to its
    -- loopback, so 127.0.0.1 silently produces a collector nothing can reach.
    bind_address  VARCHAR(64),

    -- Comma-separated sender addresses; empty accepts any. Stored as the string
    -- the environment carries rather than as an array, so the form, the row and
    -- the variable cannot disagree about what an empty one means.
    --
    -- This is the access control. NetFlow has no authentication of any kind, so
    -- reachability plus this list is the whole of it, and a forged datagram from
    -- a permitted address forges a finding.
    exporters     TEXT,

    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Who last changed it. The audit trail carries the same fact with more
    -- detail; this is here so the settings row can answer for itself.
    updated_by    VARCHAR(200)
);

COMMENT ON TABLE flow_settings IS
    'Flow collector settings. One row. NULL means "fall through to the environment, then the '
    'default"; the environment always wins over a value stored here. Publishing the UDP port is '
    'the deployment''s job and is not represented here.';
