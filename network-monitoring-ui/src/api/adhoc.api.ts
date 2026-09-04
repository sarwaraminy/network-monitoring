import { api } from './client';

export interface AdhocColumn {
  name: string;
  /** Postgres type oid. Numeric types right-align; see `isNumericOid`. */
  dataTypeId: number;
}

export interface AdhocResult {
  columns: AdhocColumn[];
  /**
   * POSITIONAL, lining up one-to-one with `columns`.
   *
   * Not keyed by column name, because two columns can share one — a join where
   * both tables have `id` — and an object row silently keeps only the last. The
   * grid would then show that value under both headers with nothing saying so.
   */
  rows: unknown[][];
  /** The row cap stopped the read. The grid must say so rather than imply completeness. */
  truncated: boolean;
  durationMs: number;
}

/**
 * The Ad Hoc Query console. ADMIN-only on the server, and read-only by a
 * database role rather than by anything this file could enforce.
 *
 * Worth knowing from the client side: nothing here validates the SQL, on
 * purpose. A check in the browser would be advice, not a control — the request
 * can be made without it — and writing one invites the belief that it is doing
 * something. The server runs every query as a role that can only SELECT, and
 * cannot read the columns holding secrets.
 */
export async function fetchAdhocAvailability(): Promise<{ enabled: boolean }> {
  const { data } = await api.get<{ enabled: boolean }>('/api/adhoc');
  return data;
}

/**
 * POST rather than GET for a read, deliberately: a query string is written into
 * the access log of every proxy in between, and into browser history. Neither is
 * somewhere a `SELECT ... FROM users` belongs, even a permitted one.
 */
export async function runAdhocQuery(sql: string): Promise<AdhocResult> {
  const { data } = await api.post<AdhocResult>('/api/adhoc/query', { sql });
  return data;
}

/**
 * Postgres type oids that should right-align in the grid.
 *
 * int2/int4/int8, float4/float8, numeric, and oid itself. Listed rather than
 * inferred from the value, because a column of nulls has no value to infer from
 * and would then change alignment as it scrolled.
 */
const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]);

export const isNumericOid = (oid: number): boolean => NUMERIC_OIDS.has(oid);
