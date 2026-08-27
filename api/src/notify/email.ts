import nodemailer, { type Transporter } from 'nodemailer';
import { renderHtml, renderText, subjectFor } from './format.js';
import type { DeliveryResult, Notification, NotificationChannel } from './types.js';

/**
 * Email delivery over SMTP.
 *
 * nodemailer rather than a hand-rolled SMTP client. SMTP is not the hard part —
 * STARTTLS negotiation, AUTH mechanisms, MIME multipart and header encoding are,
 * and getting any of them subtly wrong produces mail that silently lands in spam.
 * This is the case for taking a dependency.
 *
 * The transport is created lazily and reused. Nodemailer pools connections, so a
 * digest every few minutes does not reconnect each time, and a mail server that is
 * down does not cost anything until there is something to send.
 */

export interface EmailChannelOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  to: string[];
  /** Injected by tests so nothing opens a socket. */
  transportFactory?: () => Transporter;
}

export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  private transporter: Transporter | null = null;

  constructor(private readonly options: EmailChannelOptions) {}

  isConfigured(): boolean {
    return this.options.host.trim() !== '' && this.options.from.trim() !== '' && this.options.to.length > 0;
  }

  /** Never throws; a mail failure is logged by the notifier and otherwise ignored. */
  async send(notification: Notification): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return { channel: this.name, ok: false, detail: 'email is not configured' };
    }

    try {
      const transporter = this.transport();
      await transporter.sendMail({
        from: this.options.from,
        to: this.options.to.join(', '),
        subject: subjectFor(notification),
        text: renderText(notification),
        html: renderHtml(notification),
        headers: {
          // Marks these as automated so mail clients and out-of-office responders
          // treat them correctly, and replies do not bounce back into a loop.
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'All',
        },
      });

      return { channel: this.name, ok: true, detail: `sent to ${this.options.to.length} recipient(s)` };
    } catch (error) {
      return { channel: this.name, ok: false, detail: `send failed: ${describe(error)}` };
    }
  }

  /** Proves the SMTP credentials work without sending anything. */
  async verify(): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return { channel: this.name, ok: false, detail: 'email is not configured' };
    }
    try {
      await this.transport().verify();
      return { channel: this.name, ok: true, detail: `${this.options.host}:${this.options.port} reachable` };
    } catch (error) {
      return { channel: this.name, ok: false, detail: `SMTP check failed: ${describe(error)}` };
    }
  }

  close(): void {
    this.transporter?.close();
    this.transporter = null;
  }

  private transport(): Transporter {
    if (this.transporter) return this.transporter;

    this.transporter =
      this.options.transportFactory?.() ??
      nodemailer.createTransport({
        host: this.options.host,
        port: this.options.port,
        // `secure` means implicit TLS on connect (port 465). On 587 it must be
        // false, and STARTTLS is negotiated instead — setting it true there is the
        // classic cause of a connection that hangs and then times out.
        secure: this.options.secure,
        ...(this.options.user !== ''
          ? { auth: { user: this.options.user, pass: this.options.password } }
          : {}),
        pool: true,
        maxConnections: 2,
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });

    return this.transporter;
  }
}

/**
 * SMTP failures, in language that names the likely cause.
 *
 * One case earns the special handling. Microsoft 365 and Google both disable basic
 * SMTP AUTH by default on modern tenants, so a customer pointing this at their
 * company mailbox gets a rejection whose raw text — `535 5.7.139 Authentication
 * unsuccessful` — is indistinguishable from a typo in the password. They then check
 * the password, which is correct, and conclude the tool is broken. The failure is
 * real and unavoidable; presenting it as "wrong password" is not.
 *
 * `EAUTH` is nodemailer's own classification, and the 5xx codes are SMTP's. Both are
 * checked because a server may return one without the other.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const smtp = error as Error & { responseCode?: number; code?: string };
  const rejectedCredentials = smtp.code === 'EAUTH' || smtp.responseCode === 535 || smtp.responseCode === 534;

  if (rejectedCredentials) {
    return (
      `${error.message} — the server rejected these credentials. Microsoft 365 and Google ` +
      'disable basic SMTP AUTH by default, so a correct password fails exactly like a wrong ' +
      'one. Either point SMTP_HOST at an internal relay and leave SMTP_USER empty, or use an ' +
      'app password where the tenant still permits one.'
    );
  }

  return error.message;
}
