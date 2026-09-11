/**
 * Values shared between layers, kept here so the packet decoders do not have to
 * import a service module (and with it the database pool) to reach them.
 */

/**
 * What a sensor may be called.
 *
 * Here rather than in `config/env.ts` because two layers have to agree on it and
 * neither can import the other's: `env.ts` refuses a bad `SENSOR_ID` at boot, and
 * `routes/validation.ts` refuses one in a query string. A filter that accepted names
 * the configuration could never produce would be a filter that silently matches
 * nothing, which reads on screen as a sensor with no findings rather than as a typo.
 *
 * Conservative on purpose: the value is a database key, a query parameter and a
 * column in a table people read. Leading with a letter or digit keeps out the
 * whitespace and punctuation that would render as an invisible or unquotable name.
 */
export const SENSOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Matches the `VARCHAR(64)` the three sensor-scoped tables declare. */
export const SENSOR_ID_MAX_LENGTH = 64;
