-- Who did it. The one question this application could not answer.
--
-- Identity was already being recorded, but only where somebody thought of it and
-- only for actions that build something: `alerts.acknowledged_by`, a suppression
-- rule's `created_by`, `delivery_settings.updated_by`. Every action that *destroys*
-- or *redirects* recorded nobody at all — deleting a finding, clearing the table,
-- forgetting a device, deleting the rule that was hiding findings, pointing the
-- webhook somewhere else. Three copies of the same `req.user?.email ?? ...` helper
-- had grown up in three routers, one of them commented "Same form the alert
-- acknowledgement uses", which is what an emerging convention looks like just
-- before it should have become a table.
--
-- That gap matters more here than in most applications, because the thing being
-- deleted is evidence. "Who removed this finding, and when" is the first question
-- asked after an incident, and until now the answer was unavailable *permanently*:
-- the row was gone and nothing else knew it had existed. A tool that watches a
-- network and cannot say who told it to stop watching part of one is answering the
-- easier half of the question.
--
-- Two properties are load-bearing, and both are enforced here rather than in the
-- application:
--
--  1. **Append-only.** A trail that the application can rewrite is a trail that says
--     whatever the last writer wanted. The trigger below refuses UPDATE and DELETE
--     outright, so tampering requires dropping the trigger — an act that is itself
--     visible in the schema. This is not merely convention; the code has no path to
--     modify a row and the database would refuse if it did.
--  2. **Never pruned.** Retention deletes alerts and forgets devices; it must not
--     touch this table, or the record of a deletion would expire alongside what was
--     deleted, which is the same hole in slower motion. `sweepRetention` names the
--     tables it prunes explicitly and this is not one of them.

CREATE TABLE audit_events (
    id        BIGSERIAL    PRIMARY KEY,

    -- When, from the database's clock rather than the application's, so a wrong
    -- system time on one API replica cannot reorder the trail.
    at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Who, denormalised on purpose and with no foreign key to `users`.
    --
    -- An audit row has to remain true after the account it names is renamed or
    -- deleted, so the email is copied in rather than joined to. A foreign key would
    -- also fight the append-only trigger: ON DELETE CASCADE would try to delete
    -- these rows and ON DELETE SET NULL would try to update them, and the trigger
    -- refuses both — so deleting a user would fail with an error about auditing.
    -- 320 characters is the maximum length of an email address.
    actor     VARCHAR(320) NOT NULL,
    -- The account id at the time, for the case where two people have held one
    -- address. Nullable, because the identity may be a token with no row behind it.
    actor_id  INTEGER,

    -- What, as `domain.verb`: alert.delete, alerts.clear, device.forget,
    -- suppression.create, delivery_settings.update. Shape is checked below so the
    -- vocabulary cannot drift into free text, which is what makes filtering and
    -- grouping possible a year from now.
    action    VARCHAR(64)  NOT NULL,

    -- Which one, where that means something: an alert id, a MAC address, a rule id.
    -- NULL for an action with no single subject, such as clearing every alert.
    subject   VARCHAR(200),

    -- What changed. An object, always — see the CHECK — so a reader never has to
    -- ask whether this row's detail is a scalar, an array or absent.
    --
    -- Secrets must never be written here. The delivery settings include a webhook
    -- URL and an SMTP password, and the audit entry for a settings change records
    -- *which fields* changed rather than their values, for the same reason the API
    -- redacts them: an audit trail that quietly becomes a place to read credentials
    -- has made the system less safe, not more accountable.
    detail    JSONB        NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT audit_events_actor_not_blank   CHECK (btrim(actor) <> ''),
    CONSTRAINT audit_events_action_shape      CHECK (action ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
    CONSTRAINT audit_events_subject_not_blank CHECK (subject IS NULL OR btrim(subject) <> ''),
    CONSTRAINT audit_events_detail_is_object  CHECK (jsonb_typeof(detail) = 'object')
);

-- One index, on what is actually queried.
--
-- The listing is "most recent first, optionally filtered by action", and it reads
-- `WHERE action = $1 AND id < $2 ORDER BY id DESC` — paged on the id rather than on
-- `at`, because a timestamp cursor loses rows once two entries share a millisecond
-- (see `listAuditEvents`). So `(action, id DESC)` serves the filtered listing end to
-- end, and the primary key already serves the unfiltered one with a backward scan.
--
-- An earlier draft indexed `(at DESC)` and `(action, at DESC)`, which was right for
-- the query it was written against and wrong the moment the sort moved to `id`: the
-- first became dead weight and the second could satisfy the equality but not the
-- order, so every page sorted the whole matching set. That is worth getting right
-- here rather than later, because nothing shrinks this table — the trigger refuses
-- DELETE and TRUNCATE, and retention does not name it — so a scan that grows
-- monotonically has no maintenance path back.
--
-- No index on `at` alone: nothing filters or orders by it. It is displayed, and
-- displaying a column costs nothing.
CREATE INDEX audit_events_action_id_idx ON audit_events (action, id DESC);

-- Append-only, enforced.
--
-- A statement-level trigger rather than row-level: `DELETE FROM audit_events` with a
-- WHERE that matches nothing should still be refused, because the intent is what is
-- being rejected, and a row-level trigger would let it through silently having done
-- nothing. TRUNCATE is covered separately, since it fires neither UPDATE nor DELETE.
CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP
        USING HINT = 'The audit trail is the record of what was done to this system. '
                     'Correct a mistaken entry by appending, not by rewriting.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_rewrite
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();

CREATE TRIGGER audit_events_no_truncate
    BEFORE TRUNCATE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
