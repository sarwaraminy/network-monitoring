/**
 * Values shared between layers, kept here so the packet decoders do not have to
 * import a service module (and with it the database pool) to reach them.
 */

/** Width of the `logs.details` column; the Java service truncated to the same. */
export const DETAILS_MAX_LENGTH = 2000;
