/**
 * Facts about capture that other modules need without needing the service.
 *
 * A module of its own, holding nothing but constants, for the reason
 * `audit-types.ts` exists: `routes/validation.ts` needs them, and importing them
 * from `packet-capture.service.ts` pulled `db/index.js` in behind them — which
 * constructs a `pg.Pool` at module load. Every importer of `validation.ts` then
 * opened a database pool as a side effect of importing a schema, including
 * `validation.test.ts`, which wants nothing but the two bounds.
 *
 * Both the schema and the clamps read from here, so the bound and its
 * enforcement cannot drift.
 */

/**
 * Bytes per frame.
 *
 * Below the Ethernet header nothing can be decoded; above this wastes memory,
 * and libpcap discards the excess anyway.
 */
export const MAX_SNAPSHOT_LENGTH = 262_144;

/** pcap read timeout, in milliseconds. */
export const MAX_CAPTURE_TIMEOUT_MS = 10_000;

/**
 * What `started_by` records when the service resumed a capture by itself.
 *
 * A sentinel rather than the original operator's name. `started_by` is the record
 * of who started a capture — redacted from non-admin `/status` because it names a
 * person — so carrying the previous session's value forward would file an
 * unattended machine action against somebody who was not there.
 *
 * Prefixed `system:` so it cannot collide with an email address, which is what
 * every other value in this column is.
 */
export const AUTO_RESUME_ACTOR = 'system:auto-resume';
