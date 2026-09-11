import { db } from '../db/index.js';
import { componentLogger } from '../logger.js';
import { type Actor, recordAudit } from './audit.service.js';

const log = componentLogger('capture-audit');

/**
 * The audit entries for beginning and ending a capture.
 *
 * Until this existed, starting to read other people's traffic off an interface was
 * one of the few administrator actions on this server that left no trail at all.
 * `AUDIT_ACTIONS` had no capture verb, `POST /start` never called `recordAudit`,
 * and the only record anywhere that somebody had started a capture was
 * `capture_session.started_by` — a column whose purpose is a banner after a
 * restart, standing in for an audit row because there was none. Noticed while
 * adding that column, and written down in the roadmap rather than bolted onto the
 * pull request that found it.
 *
 * Three things decide the shape here.
 *
 * **Recorded after the fact, from the outcome.** `startCapture` has three
 * outcomes and only one of them starts anything: a caller that reaches an
 * already-running capture is told 200 and the live status, and a row saying it
 * started a capture would be false. Same on the other side — `stopCapture` runs
 * happily against an idle service and stops nothing. So both callers pass what
 * actually happened, which is why `stopCapture` reports it.
 *
 * **Best-effort, and this is the one uncomfortable decision.** `recordAudit`
 * elsewhere is deliberately not error-swallowing, because it shares a transaction
 * with the act it records and a caller *wants* a failed audit to abort the
 * deletion. A capture cannot be in that transaction: it is a pcap handle, and by
 * the time there is anything to record, frames are already being read. Failing the
 * request would report an error for a capture that is running — the dishonesty
 * this subsystem spends most of its comments avoiding — and there is no way to
 * un-start it. So a failure warns, loudly, and the trail is missing an entry rather
 * than the operator being misinformed. Same trade `recordCaptureStarted` makes one
 * file over, for the same reason.
 *
 * **The unattended resume is audited too.** It is the case where an audit row is
 * worth most, because nobody is present to remember: `CAPTURE_RESUME_ON_START`
 * makes the service begin reading traffic by itself at boot. It is filed under
 * `AUTO_RESUME_ACTOR` rather than under the person who started the original
 * capture — the same argument `resumeInterruptedCapture` makes about
 * `started_by`. Auditing only the route would have left exactly the start nobody
 * witnessed unrecorded.
 */

/** What a capture entry records beyond who and when. */
export interface CaptureAuditDetail {
  /** `'interface'` or `'filtered-ip'` — the two captures one process runs. */
  scope: string;
  /** As the operator sent them, not as `startCapture` clamps them. */
  snapshotLength?: number;
  timeoutMs?: number;
  /** The address the BPF filter was built from, where there was one. */
  filterIp?: string | null;
  /**
   * Set when the service started this capture by itself at boot.
   *
   * The actor already says `system:auto-resume`, but an operator reading the trail
   * should not have to know that string to tell an unattended start from a
   * deliberate one.
   */
  automatic?: boolean;
}

/**
 * Appends `capture.start`.
 *
 * `interfaceName` is the subject because it is what was acted on. "Started a
 * capture" without saying where reads as an administrative act with no object,
 * and on a host with several interfaces it is the only part worth knowing.
 */
export async function auditCaptureStarted(
  actor: Actor,
  interfaceName: string,
  detail: CaptureAuditDetail,
): Promise<void> {
  await append('capture.start', actor, interfaceName, detail);
}

/** Appends `capture.stop`. Only for a stop that ended a capture that was running. */
export async function auditCaptureStopped(
  actor: Actor,
  interfaceName: string | null,
  detail: CaptureAuditDetail,
): Promise<void> {
  await append('capture.stop', actor, interfaceName, detail);
}

async function append(
  action: 'capture.start' | 'capture.stop',
  actor: Actor,
  interfaceName: string | null,
  detail: CaptureAuditDetail,
): Promise<void> {
  try {
    await recordAudit(db, {
      actor: actor.name,
      actorId: actor.id,
      action,
      /*
       * `subject` is nullable but CHECKed non-blank, so an unknown interface is a
       * null subject rather than an empty string.
       *
       * And it IS reachable, on the stop side: a second stop entering behind the
       * first finds `wasCapturing` true with the session already detached, so
       * `stopCapture` reports `{ interfaceName: null }` — something was stopped,
       * by a call that cannot name which capture. An earlier version of this
       * comment claimed the state was unreachable while `capture-lifecycle.test.ts`
       * had a case asserting it; `stopCapture`'s docblock is the one that was
       * right. Recording the event without a subject is the honest answer: the
       * alternative is either no row for a stop that happened, or a row naming an
       * interface this call guessed at.
       */
      subject: interfaceName || null,
      detail: { ...detail },
    });
  } catch (error) {
    log.warn(
      { err: error, action, interface: interfaceName, scope: detail.scope },
      'Could not record a capture in the audit trail; the capture itself is unaffected',
    );
  }
}
