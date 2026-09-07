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
  /** Postgres's own command tag — `SELECT`, `DELETE`, `UPDATE`, `EXPLAIN`. */
  command: string;
  /**
   * Rows changed, for the commands that change rows; `undefined` for a SELECT.
   *
   * A DELETE returns no rows, so without this the page would answer a
   * destructive statement with an empty grid and no confirmation of what it did.
   */
  rowsAffected?: number;
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
/**
 * Why the console is off, matching the server's own vocabulary.
 *
 *  - `disabled` — nobody asked for it. The default, and not a fault.
 *  - `no-password` — asked for, but no credential to install on the role.
 *  - `sandbox-failed` — asked for and provisioned, but the database would not
 *    confirm the role is neither a superuser nor able to write.
 *
 * Three situations needing three different actions, which is the whole reason
 * the server reports a reason rather than a boolean.
 */
export type AdhocOffReason = 'disabled' | 'no-password' | 'sandbox-failed';

export interface AdhocStatus {
  enabled: boolean;
  /** The Postgres role the live pool holds, and so what it may do. */
  role: string | null;
  mode: 'read' | 'write' | null;
  reason?: AdhocOffReason;
  /** A sandbox failure's own message, with the configured password stripped out. */
  detail?: string;
  /** The password could not be kept out of the Postgres log. A caveat, not a fault. */
  passwordMayBeLogged: boolean;
}

export async function fetchAdhocStatus(): Promise<AdhocStatus> {
  const { data } = await api.get<AdhocStatus>('/api/adhoc');
  return data;
}

/**
 * Asks the server to try its startup provisioning again.
 *
 * Grants nothing: it re-runs the same check the boot ran, against the same
 * environment, and the server refuses without `ADHOC_ENABLED` and without a
 * password exactly as it does at startup. It is for the case an administrator
 * can actually resolve — the role was missing or its grants were wrong and have
 * since been fixed — where the only other remedy is restarting the API, which on
 * a monitoring server means dropping a live capture to fix a console.
 */
export async function recheckAdhoc(): Promise<AdhocStatus> {
  const { data } = await api.post<AdhocStatus>('/api/adhoc/recheck');
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

/**
 * One of the query console's settings, and where its value came from.
 *
 * Provenance is part of the contract rather than decoration: a field the
 * environment pins cannot be changed here, and a form that accepted the edit
 * anyway would be a control that does nothing — this codebase's recurring bug,
 * in the one place where the control being a lie decides whether a browser can
 * run SQL.
 */
export interface AdhocSettingField {
  value: boolean | number | string;
  source: 'environment' | 'database' | 'default';
  /** The variable that pins it, so the form can name what to remove. */
  env: string;
}

export interface AdhocSettingsResponse {
  settings: Record<string, AdhocSettingField>;
  /**
   * Whether `ADHOC_DB_PASSWORD` is set. Never its value.
   *
   * The one setting that stays in the environment. Without it the console cannot
   * start whatever the switches here say, so the form has to be able to explain
   * why turning it on changed nothing.
   */
  passwordConfigured: boolean;
  effective: Record<string, boolean | number | string>;
}

/** Absent leaves a field alone; null clears it, so it falls back to env or default. */
export type AdhocSettingsPatch = Record<string, boolean | number | string | null>;

export async function fetchAdhocSettings(): Promise<AdhocSettingsResponse> {
  const { data } = await api.get<AdhocSettingsResponse>('/api/adhoc/settings');
  return data;
}

export async function saveAdhocSettings(
  patch: AdhocSettingsPatch,
): Promise<{ effective: Record<string, unknown> }> {
  const { data } = await api.put<{ effective: Record<string, unknown> }>('/api/adhoc/settings', patch);
  return data;
}
