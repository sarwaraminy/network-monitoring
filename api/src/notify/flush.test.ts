import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { renderFinding } from '../i18n/catalog/findings.js';
import type { Finding } from '../packet/detect/types.js';
import type { DeliveryResult, Notification, NotificationChannel } from './types.js';

/**
 * Shutdown behaviour of the notifier.
 *
 * `flush()` used to resolve without sending whenever a dispatch was already in
 * flight, because `dispatch()` returns immediately when `sending` is true. That is
 * exactly the state a shutdown lands in — mid-SMTP-send — and the findings still
 * queued were then left to an unref'd 60-second timer the process was about to
 * kill. Silent alert loss at the worst possible moment.
 */

let notify: typeof import('./notifier.js');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  process.env.NOTIFY_ENABLED = 'true';
  process.env.NOTIFY_MIN_SEVERITY = 'high';
  process.env.NOTIFY_DIGEST_SECONDS = '60';
  process.env.NOTIFY_THROTTLE_SECONDS = '900';
  process.env.NOTIFY_MAX_PER_HOUR = '100';
  notify = await import('./notifier.js');
});

const AT = new Date('2026-07-27T10:00:00Z');

const paramsFor = (dedupKey: string) => ({
  source: dedupKey,
  target: '10.0.0.89',
  count: 22,
  seconds: 60,
});

const titleOf = (dedupKey: string) => renderFinding('port_scan.packet', paramsFor(dedupKey), 'en').title;

function finding(dedupKey: string): Finding {
  return {
    kind: 'port_scan',
    severity: 'high',
    messageKey: 'port_scan.packet',
    // The dedup key rides in as the scanner's address so each finding still
    // renders distinctly: these assertions are about which findings were flushed,
    // and they read the rendered title to say so.
    messageParams: paramsFor(dedupKey),
    dedupKey,
    sourceIp: '10.0.0.66',
    targetIp: '10.0.0.89',
    protocol: 'TCP',
    evidence: {},
    timestamp: AT,
  };
}

/** A channel whose send can be held open, standing in for a slow SMTP relay. */
class BlockingChannel implements NotificationChannel {
  readonly name = 'blocking';
  readonly sent: Notification[] = [];
  private release: (() => void) | null = null;

  isConfigured(): boolean {
    return true;
  }

  async send(notification: Notification): Promise<DeliveryResult> {
    this.sent.push(notification);
    if (this.release === null) {
      // Hold only the first send, so the test can flush while it is in flight.
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    return { channel: this.name, ok: true, detail: 'sent' };
  }

  finish(): void {
    this.release?.();
  }
}

describe('flush during an in-flight send', () => {
  it('waits for the send in progress and then delivers what is still queued', async () => {
    const channel = new BlockingChannel();
    const notifier = new notify.Notifier([channel]);

    // First finding starts a dispatch that will block inside the channel.
    notifier.consider(finding('first'), 1, AT, AT);
    const firstFlush = notifier.flush();
    // Let the dispatch reach the channel and park there.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(channel.sent.length, 1, 'the first send should be in flight');

    // A finding arrives while that send is still open — the shutdown case.
    notifier.consider(finding('second'), 1, AT, AT);

    channel.finish();
    await firstFlush;

    assert.equal(channel.sent.length, 2, 'the finding queued mid-send must also be delivered');
    const titles = channel.sent.flatMap((n) => n.findings.map((f) => f.title));
    // Rendered, not typed out: the finding carries a message key and its params,
    // and the title only exists once something renders them. Each fixture puts its
    // dedup key in the `source` parameter, which is what makes the two distinct.
    assert.ok(titles.includes(titleOf('first')));
    assert.ok(titles.includes(titleOf('second')), 'the second finding must not be dropped');
  });

  it('resolves without sending when nothing is queued', async () => {
    const channel = new BlockingChannel();
    const notifier = new notify.Notifier([channel]);
    await notifier.flush();
    assert.equal(channel.sent.length, 0);
  });
});
