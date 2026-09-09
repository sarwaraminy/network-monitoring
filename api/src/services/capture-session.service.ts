import { and, eq, isNull } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { type CaptureSessionRow, captureSession } from '../db/schema.js';
import { componentLogger } from '../logger.js';

const log = componentLogger('capture-session');

/**
 * The record of what this sensor was asked to capture — see V18.
 *
 * Packet capture is otherwise entirely in-process: `startCapture` opens a pcap
 * handle and sets some fields, and nothing survives the process that did it. Flow
 * collection comes back at boot from `FLOW_ENABLED`; capture does not, and the
 * screen afterwards says "Idle" — the same word it uses for a host that has never
 * captured anything. A monitoring product that stops monitoring is a thing that
 * has to be *reported*, and this is the only durable place to report it from.
 *
 * Every write here is best-effort. This is bookkeeping about a capture, not the
 * capture, and a database that cannot be written must not be able to stop packets
 * being read — the whole point of the feature is still working at that moment.
 * Failures warn and return.
 */

/** What starting a capture recorded, as the operator asked for it. */
export interface CaptureSessionRecord {
  interfaceName: string;
  snapshotLength: number;
  timeoutMs: number;
  filterIp: string | null;
  startedAt: Date;
  startedBy: string;
}

/**
 * A session the previous process was running and did not stop cleanly.
 *
 * Reported on `CaptureStatus` so the interface can say what happened instead of
 * showing an "Idle" that is technically true and useless.
 */
export interface InterruptedCapture {
  interfaceName: string;
  filterIp: string | null;
  snapshotLength: number;
  timeoutMs: number;
  startedAt: string;
  startedBy: string;
}

/**
 * The row this sensor's capture of a given scope owns.
 *
 * Both halves matter. `sensorId` follows V16; `scope` is because one process runs
 * two captures — interface-wide and IP-filtered, from `packet-capture.registry.ts`
 * — and keying on the sensor alone would have them overwriting each other's
 * session exactly as two sensors would.
 */
const rowFor = (scope: string) =>
  and(eq(captureSession.sensorId, env.sensorId), eq(captureSession.scope, scope));

/** Notes that a capture has begun, replacing what this scope recorded before. */
export async function recordCaptureStarted(scope: string, session: CaptureSessionRecord): Promise<void> {
  const values = {
    sensorId: env.sensorId,
    scope,
    interfaceName: session.interfaceName,
    snapshotLength: session.snapshotLength,
    timeoutMs: session.timeoutMs,
    filterIp: session.filterIp,
    startedAt: session.startedAt,
    startedBy: session.startedBy.slice(0, 200),
    // Explicitly cleared: this row is reused, and leaving a previous session's
    // stamp would make a running capture look like a finished one.
    stoppedAt: null,
  };

  try {
    await db
      .insert(captureSession)
      .values(values)
      .onConflictDoUpdate({
        target: [captureSession.sensorId, captureSession.scope],
        set: values,
      });
  } catch (error) {
    log.warn({ err: error }, 'Could not record that capture started; a restart will not report it');
  }
}

/**
 * Stamps the session as finished.
 *
 * Called on a clean operator stop, and at boot for one found still running with
 * nothing going to resume it.
 *
 * **`startedAt` is what makes this safe, and callers should always pass it.**
 * Without it the update is `WHERE (sensor_id, scope)` and names no particular
 * session — so it closes whatever row is there now, which is not necessarily the
 * row the caller read. The window is real: a `POST /start` sitting inside an
 * awaited step has already written its own open row while its `capturing` flag is
 * still false, so every in-memory guard passes and this statement stamps the live
 * capture stopped. That capture then runs with no open row and the next boot has
 * nothing to report — the silence the guards exist to prevent, reached through
 * the one statement they cannot cover, because a check on process memory cannot
 * fence a database row.
 *
 * `stopped_at IS NULL` goes with it, so a row already closed is not re-stamped
 * with a later time.
 */
export async function recordCaptureStopped(
  scope: string,
  options: { startedAt?: Date; at?: Date } = {},
): Promise<void> {
  const { startedAt, at = new Date() } = options;

  try {
    await db
      .update(captureSession)
      .set({ stoppedAt: at })
      .where(
        startedAt
          ? and(rowFor(scope), isNull(captureSession.stoppedAt), eq(captureSession.startedAt, startedAt))
          : rowFor(scope),
      );
  } catch (error) {
    log.warn({ err: error }, 'Could not record that capture stopped');
  }
}

/**
 * The session this sensor was running when the last process ended, if it was.
 *
 * `null` covers three cases that are all "nothing to report": no row at all, a
 * row that was stopped cleanly, and a database that could not be read. The last
 * is the interesting one — an unreadable row must not be reported as an
 * interruption, because "we cannot tell" and "you were interrupted" are different
 * claims and only one of them is true.
 */
export async function findInterruptedCapture(scope: string): Promise<InterruptedCapture | null> {
  let row: CaptureSessionRow | undefined;

  try {
    [row] = await db.select().from(captureSession).where(rowFor(scope)).limit(1);
  } catch (error) {
    log.warn({ err: error }, 'Could not read the last capture session; not reporting an interruption');
    return null;
  }

  if (!row || row.stoppedAt !== null) return null;

  return {
    interfaceName: row.interfaceName,
    filterIp: row.filterIp,
    snapshotLength: row.snapshotLength,
    timeoutMs: row.timeoutMs,
    startedAt: row.startedAt.toISOString(),
    startedBy: row.startedBy,
  };
}
