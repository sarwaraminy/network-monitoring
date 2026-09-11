import { describe, expect, it } from 'vitest';
import type { CaptureStatus } from '../types';
import { keepPolling } from './usePacketCapture';

/**
 * When the Capture page keeps asking the server what is happening.
 *
 * Keyed on `capturing` alone this was safe, because a capture could only ever
 * start from this page. The server starts one by itself now, and that broke the
 * assumption: with `CAPTURE_RESUME_ON_START=true` the first status after an API
 * restart reports `capturing: false` with an interruption, because the report
 * happens early in boot and the resume only after `startIntel()`, which can take
 * seconds. The page stopped asking at exactly that moment and never asked again —
 * leaving an interruption banner, an Idle chip and a frozen packet table over a
 * capture that was running and recording findings.
 */

const status = (over: Partial<CaptureStatus>): CaptureStatus =>
  ({
    capturing: false,
    interfaceName: null,
    filter: null,
    linkType: null,
    bufferedPackets: 0,
    droppedPackets: 0,
    findingCount: 0,
    startedAt: null,
    interrupted: null,
    resumePending: false,
    ...over,
  }) as CaptureStatus;

const INTERRUPTED = {
  interfaceName: 'eth0',
  filterIp: null,
  snapshotLength: 65_535,
  timeoutMs: 1000,
  startedAt: '2026-09-09T03:14:00.000Z',
  startedBy: 'alice',
};

describe('whether the capture status is still worth asking about', () => {
  it('keeps asking while a capture is running', () => {
    expect(keepPolling(status({ capturing: true }))).toBe(true);
  });

  /*
   * The case this was added for: the window between the server reporting an
   * interruption and resuming it. Nothing is capturing yet, and the state is
   * still in motion.
   */
  it('keeps asking while the server still means to resume', () => {
    expect(keepPolling(status({ capturing: false, interrupted: INTERRUPTED, resumePending: true }))).toBe(
      true,
    );
  });

  /*
   * The other half, and the reason this is not keyed on `interrupted`: with
   * `CAPTURE_RESUME_ON_START` off — the default — nothing will clear the notice
   * until a person acts. Polling it would hold a request per second per open tab
   * against a value the server has no path to change, on the screen an operator
   * is most likely to leave open.
   */
  it('stops asking about an interruption only a person can clear', () => {
    expect(keepPolling(status({ capturing: false, interrupted: INTERRUPTED, resumePending: false }))).toBe(
      false,
    );
  });

  /*
   * A resume that has had its turn and failed leaves the notice standing and the
   * row open for the next boot — but nothing further happens in this process, so
   * there is nothing left to wait for.
   */
  it('stops asking once the resume has had its turn', () => {
    expect(keepPolling(status({ capturing: false, interrupted: INTERRUPTED, resumePending: false }))).toBe(
      false,
    );
  });

  it('stops once nothing is running and nothing is outstanding', () => {
    expect(keepPolling(status({}))).toBe(false);
  });

  it('stops before the first answer has arrived', () => {
    expect(keepPolling(undefined)).toBe(false);
  });
});
