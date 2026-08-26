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
 * than reassembled — a silent truncation is better than a silent disappearance.
 */
const UDP_SAFE_BYTES = 1024;

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
      if (this.options.protocol === 'udp' && Buffer.byteLength(line) > UDP_SAFE_BYTES) {
        return `${line.slice(0, UDP_SAFE_BYTES - 15)} [truncated]`;
      }
      return line;
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
   * costs a handshake and tells us immediately when the collector is gone.
   */
  private sendTcp(lines: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket: Socket = connect({ host: this.options.host, port: this.options.port });
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };

      socket.setTimeout(TCP_TIMEOUT_MS, () => finish(new Error('syslog TCP timed out')));
      socket.on('error', finish);
      socket.on('connect', () => {
        socket.write(`${lines.join('\n')}\n`, (error) => finish(error ?? undefined));
      });
    });
  }
}

/** Logged once at startup so a misconfigured collector is visible before an incident. */
export function describeSyslogTarget(options: SyslogChannelOptions): string {
  return `${options.protocol}://${options.host}:${options.port} (${options.format}, RFC ${options.rfc})`;
}

export { log as syslogLog };
