/**
 * The largest values a capture will honour.
 *
 * A module of its own, holding nothing but two numbers, for the reason
 * `audit-types.ts` exists: `routes/validation.ts` needs them, and importing them
 * from `packet-capture.service.ts` pulled `db/index.js` in behind them — which
 * constructs a `pg.Pool` at module load. Every importer of `validation.ts` then
 * opened a database pool as a side effect of importing a schema, including
 * `validation.test.ts`, which wants nothing but these two numbers.
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
