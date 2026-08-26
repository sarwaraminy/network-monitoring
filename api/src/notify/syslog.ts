import { createSocket } from 'node:dgram';
import { connect, type Socket } from 'node:net';
import { componentLogger } from '../logger.js';
import { frameSyslog, renderCef, renderJsonLine } from './cef.js';
import type { DeliveryResult, Notification, NotificationChannel } from './types.js';

const log = componentLogger('notify-syslog');

/**
 * Syslog delivery, for a SIEM rather than a person.
 *
 * This is the channel that changes what the product is. Slack and email say
 * "replace the thing you already own"; syslog says "feed the thing you already
 * own", and the second is an easy yes for anyone running Splunk, QRadar,
 * Sentinel, Graylog or plain rsyslog.
 *
 * ONE RULE SEPARATES IT FROM THE OTHER CHANNELS, and it is the whole design:
 *
 *   A SIEM must receive every finding. It is not digested, not throttled, and
 *   not filtered by NOTIFY_MIN_SEVERITY.
 *
 * Those gates exist because a human mutes a noisy channel and then misses the
 * one that mattered. A SIEM does its own correlation, deduplication and
 * alerting, and it does them on the assumption that it has the complete event
 * stream. Sending it a digest is worse than sending it nothing: occurrence
 * counts stop reconciling, gaps look like quiet periods rather than suppressed
 * events, and any rule counting events over a window silently under-reports.
 *
 * So `deliversEveryFinding` is true and the notifier hands findings here before
 * the gate. Volume is the SIEM's problem, which is what it is for.
 *
 * NOT BUILT, and worth knowing before you deploy this across a boundary you do
 * not control: there is no TLS transport. Both options put findings on the wire
 * in cleartext, and a finding carries internal addresses, usernames and queried
 * domains. RFC 5425 syslog-over-TLS on 6514 is what a SIEM onboarding guide
 * expects from a security product. Until it exists, keep the collector on a
 * trusted segment or tunnel it.
 */

export const SYSLOG_FORMATS = ['cef', 'json'] as const;
export type SyslogFormat = (typeof SYSLOG_FORMATS)[number];

export const SYSLOG_PROTOCOLS = ['udp', 'tcp'] as const;
export type SyslogProtocol = (typeof SYSLOG_PROTOCOLS)[number];

/** Fail fast rather than holding the detection path open behind a dead collector. */
const TCP_TIMEOUT_MS = 5_000;

/**
 * RFC 5426 puts the practical UDP ceiling here. Beyond it a datagram fragments,
 * and a fragmented syslog datagram is routinely dropped by collectors rather
 * than reassembled — a visible truncation is better than a silent disappearance.
 */
const UDP_SAFE_BYTES = 1024;

const TRUNCATION_MARKER = ' [truncated]';

/**
 * Cut a line to a BYTE budget without splitting a character.
 *
 * This used to be `line.slice(0, cap - 15)`, which measures the budget in bytes
 * and then cuts in UTF-16 code units. For anything multi-byte the result stayed
 * over the limit — a rendered finding with a CJK description came out at 2.4x
 * the cap, carrying the `[truncated]` marker that said it had been handled. The
 * guard failed silently in exactly the way it exists to prevent, and non-ASCII
 * is reachable: a threat-feed note is arbitrary text from a third-party file.
 *
 * `TextDecoder` without `fatal` drops a partial trailing sequence rather than
 * emitting a replacement character, so the cut lands on a character boundary.
 */
export function truncateToBytes(line: string, maxBytes: number): string {
  const buffer = Buffer.from(line, 'utf8');
  if (buffer.byteLength <= maxBytes) return line;

  const budget = maxBytes - Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  const kept = new TextDecoder('utf-8').decode(buffer.subarray(0, Math.max(0, budget)));
  return kept + TRUNCATION_MARKER;
}

export interface SyslogChannelOptions {
  host: string;
  port: number;
  protocol: SyslogProtocol;
  format: SyslogFormat;
  facility: number;
  hostname: string;
  appName: string;
  rfc: '5424' | '3164';
  productVersion: string;
  /** Test seam: swap the wire for an array. */
  sendImpl?: (lines: string[]) => Promise<void>;
}

export class SyslogChannel implements NotificationChannel {
  readonly name = 'syslog';

  /**
   * The notifier reads this and hands over every finding, ungated. See the
   * module docblock — a digested SIEM feed is a broken SIEM feed.
   */
  readonly deliversEveryFinding = true;

  private readonly options: SyslogChannelOptions;

  constructor(options: SyslogChannelOptions) {
    this.options = options;
  }

  isConfigured(): boolean {
    return this.options.host !== '' && this.options.port > 0;
  }

  /** Every finding in the notification becomes one syslog line. */
  render(notification: Notification): string[] {
    const { format, productVersion, facility, hostname, appName, rfc } = this.options;

    return notification.findings.map((finding) => {
      const body =
        format === 'json' ? renderJsonLine(finding, productVersion) : renderCef(finding, productVersion);

      const line = frameSyslog(body, finding.severity, finding.lastSeen, {
        facility,
        hostname,
        appName,
        rfc,
      });

      // UDP only. Truncating a TCP line would corrupt a stream the receiver
      // frames by newline, and TCP has no datagram limit to respect.
      return this.options.protocol === 'udp' ? truncateToBytes(line, UDP_SAFE_BYTES) : line;
    });
  }

  async send(notification: Notification): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return { channel: this.name, ok: false, detail: 'syslog is not configured' };
    }

    const lines = this.render(notification);

    try {
      if (this.options.sendImpl) {
        await this.options.sendImpl(lines);
      } else if (this.options.protocol === 'tcp') {
        await this.sendTcp(lines);
      } else {
        await this.sendUdp(lines);
      }

      const { host, port, protocol } = this.options;
      return {
        channel: this.name,
        ok: true,
        detail: `sent ${lines.length} event(s) to ${host}:${port} over ${protocol}`,
      };
    } catch (error) {
      return {
        channel: this.name,
        ok: false,
        detail: `syslog send failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * UDP: fire and forget, which is what syslog has always been.
   *
   * No delivery guarantee and no retry — a retry on a protocol with no
   * acknowledgement just doubles the traffic. Anyone who needs delivery should
   * be on TCP, which is why both exist.
   */
  private sendUdp(lines: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createSocket('udp4');
      let pending = lines.length;
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.close();
        if (error) reject(error);
        else resolve();
      };

      socket.on('error', finish);

      for (const line of lines) {
        socket.send(Buffer.from(line), this.options.port, this.options.host, (error) => {
          if (error) return finish(error);
          pending -= 1;
          if (pending === 0) finish();
        });
      }

      if (lines.length === 0) finish();
    });
  }

  /**
   * TCP: newline-framed, one connection per batch.
   *
   * Not a held-open connection, deliberately. A long-lived socket to a collector
   * that restarts leaves this process writing into a black hole until the OS
   * notices, and findings vanish with no error anywhere. A connection per batch
   * costs a handshake and tells us immediately when the collector is gone — and
   * a batch really is a batch, because the notifier coalesces findings before
   * calling this.
   */
  private sendTcp(lines: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket: Socket = connect({ host: this.options.host, port: this.options.port });
      let failure: Error | undefined;
      let settled = false;

      const settle = () => {
        if (settled) return;
        settled = true;
        if (failure) reject(failure);
        else resolve();
      };

      const fail = (error: Error) => {
        failure ??= error;
        socket.destroy();
      };

      socket.setTimeout(TCP_TIMEOUT_MS, () => fail(new Error('syslog TCP timed out')));
      socket.on('error', fail);
      // `end()`, not `destroy()`. The write callback fires when the data reaches
      // the kernel, not when the peer has it, and an abortive close sends an RST
      // where a collector expects a FIN — some treat that as a failed record
      // rather than a completed one. TCP is the option this module points at for
      // anyone who needs delivery, so it closes properly.
      socket.on('close', settle);
      socket.on('connect', () => {
        socket.write(`${lines.join('\n')}\n`, (error) => {
          if (error) fail(error);
          else socket.end();
        });
      });
    });
  }
}

/** Logged once at startup so a misconfigured collector is visible before an incident. */
export function describeSyslogTarget(options: SyslogChannelOptions): string {
  return `${options.protocol}://${options.host}:${options.port} (${options.format}, RFC ${options.rfc})`;
}

export { log as syslogLog };
