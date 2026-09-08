-- Findings stop being stored as English prose.
--
-- `alerts.title` and `alerts.description` were written at detection time by each
-- detector, as interpolated template strings — `ARP spoofing: ${ip} claimed by
-- ${mac}`. Two things follow from that, and both get worse every day the sensor
-- runs.
--
-- The first is that translating the interface translates nothing that is already
-- in the table. A German or Dari reader gets a localised page around an English
-- finding, which is the half that matters.
--
-- The second is that it cannot be fixed later. Once `445` is inside a sentence it
-- is no longer a port — it is four characters between two spaces, and no amount of
-- later parsing recovers which of the numbers in "probed 12 ports on 10.0.0.5
-- within 60 seconds" is a count, which is an address and which is a duration. The
-- structure exists exactly once, at the moment the detector emits, and this
-- migration is about keeping it.
--
-- So a finding now stores what it *is*: `message_key` names a pair of catalogue
-- entries (`arp_spoofing.sprawl` → `.title` and `.description`) and
-- `message_params` carries what they interpolate. The sentence is rendered when
-- somebody reads it, in their language. See api/src/i18n/.
--
-- This is the same reasoning that put `sensor_id` in V16 ahead of the rest of the
-- multi-sensor work: the cost of the change is fixed, the cost of not making it
-- grows with the row count, so it goes first.

ALTER TABLE alerts ADD COLUMN message_key    VARCHAR(120);
ALTER TABLE alerts ADD COLUMN message_params JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The old columns stay, and stay populated, for the rows already in the table.
--
-- Deliberately not backfilled by parsing the prose back apart, which is the thing
-- the paragraph above says cannot be done reliably. A finding recorded before this
-- migration keeps the sentence it was written with and is displayed as-is, in
-- English, for the rest of its retention window — readable, if not translatable,
-- which is the better of the two failures. New rows write the key and leave these
-- null.
ALTER TABLE alerts ALTER COLUMN title       DROP NOT NULL;
ALTER TABLE alerts ALTER COLUMN description DROP NOT NULL;

-- Whichever representation a row uses, it must have one.
--
-- Without this a row can be written with no key *and* no prose and there is
-- nothing to display: the alert list renders a severity, a time and a blank line,
-- and the finding is functionally lost while still counting towards every total on
-- the dashboard. That is a far quieter failure than an insert that is refused, and
-- the window for it is real — every INSERT in alert.service.ts had to be rewritten
-- for this migration.
ALTER TABLE alerts
    ADD CONSTRAINT alerts_message_present_check CHECK (
        message_key IS NOT NULL
        OR (title IS NOT NULL AND description IS NOT NULL)
    );

-- `message_key` is an identifier, not text: it names a catalogue entry, is chosen
-- from a fixed set the detectors share, and — like `kind` and `dedup_key` — is
-- never translated. The empty string is excluded for the same reason V16 excludes
-- it from `sensor_id`: NOT NULL does not, and a key that renders as nothing is
-- indistinguishable on screen from a row that has no key at all.
ALTER TABLE alerts
    ADD CONSTRAINT alerts_message_key_check CHECK (message_key IS NULL OR message_key <> '');

-- The rollup is unaffected on purpose. It aggregates by day, kind, severity and
-- sensor and has never carried a title — the shape survives retention, the prose
-- does not, and that was already true before this change.
