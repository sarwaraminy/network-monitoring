import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import { renderHtml, renderText, subjectFor } from './format.js';
import type { EmailAuthMethod } from './settings.js';
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
 *
 * Two ways to authenticate, and a third that is really the first:
 *
 *   - **No AUTH at all**, when the username is blank. An internal relay needs no
 *     credentials and is the right answer for an on-prem sensor.
 *   - **A password**, over AUTH LOGIN/PLAIN. Works with an app password; usually
 *     rejected by a Microsoft 365 or Google tenant, which disable basic SMTP AUTH
 *     by default — see `describe` below for why that rejection needs explaining.
 *   - **XOAUTH2**, for the tenants that permit nothing else. Issue #27.
 *
 * The OAuth2 flow here is the refresh-token grant and nothing more ambitious: the
 * operator registers an application with their identity provider, consents once, and
 * pastes the resulting refresh token in. Nodemailer exchanges it for an access token
 * on first use and again whenever that one expires, so nothing in this codebase holds
 * or schedules a token — which is the point of using its XOAuth2 support rather than
 * minting the header here. There is no authorization-code redirect, deliberately:
 * that needs a browser round trip through a public callback URL, and this thing runs
 * on a sensor inside somebody's network.
 */

/** The refresh-token grant's inputs. Only read when `authMethod` is `oauth2`. */
export interface EmailOauthOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /**
   * The provider's token endpoint.
   *
   * Required rather than defaulted. Nodemailer's own default is Google's endpoint,
   * so a Microsoft tenant that left this blank would post its refresh token to
   * accounts.google.com and get back a refusal naming neither problem.
   */
  tokenUrl: string;
  /** Optional; Google's refresh grant ignores it, some Microsoft tenants require it. */
  scope: string;
}

export interface EmailChannelOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  to: string[];
  authMethod: EmailAuthMethod;
  oauth: EmailOauthOptions;
  /** Injected by tests so nothing opens a socket. */
  transportFactory?: () => Transporter;
}

/**
 * What XOAUTH2 needs, by the environment variable an operator would set.
 *
 * The username is on this list because nodemailer treats OAuth2 without a user as
 * *no auth configured at all*: it would connect, send no AUTH command, and the
 * server would refuse the message with a 530 that says nothing about a missing
 * mailbox address. Named here instead.
 */
const OAUTH_REQUIREMENTS: ReadonlyArray<{ variable: string; get: (options: EmailChannelOptions) => string }> =
  [
    { variable: 'SMTP_USER', get: (options) => options.user },
    { variable: 'SMTP_OAUTH_CLIENT_ID', get: (options) => options.oauth.clientId },
    { variable: 'SMTP_OAUTH_CLIENT_SECRET', get: (options) => options.oauth.clientSecret },
    { variable: 'SMTP_OAUTH_REFRESH_TOKEN', get: (options) => options.oauth.refreshToken },
    { variable: 'SMTP_OAUTH_TOKEN_URL', get: (options) => options.oauth.tokenUrl },
  ];

/**
 * The OAuth2 settings that are missing, named by their variable.
 *
 * Exported so the refusal has a test that does not need a mail server. Checked
 * before anything opens a socket, because the alternative — build the transport
 * anyway — produces either a silent unauthenticated send or a provider error about
 * a malformed grant, and neither says "you did not finish filling this in".
 */
export function missingOauthSettings(options: EmailChannelOptions): string[] {
  if (options.authMethod !== 'oauth2') return [];
  return OAUTH_REQUIREMENTS.filter(({ get }) => get(options).trim() === '').map(({ variable }) => variable);
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

    const incomplete = this.incompleteOauth();
    if (incomplete) return { channel: this.name, ok: false, detail: incomplete };

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
      return {
        channel: this.name,
        ok: false,
        detail: `send failed: ${describe(error, this.options.authMethod)}`,
      };
    }
  }

  /** Proves the SMTP credentials work without sending anything. */
  async verify(): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return { channel: this.name, ok: false, detail: 'email is not configured' };
    }

    const incomplete = this.incompleteOauth();
    if (incomplete) return { channel: this.name, ok: false, detail: incomplete };

    try {
      await this.transport().verify();
      return { channel: this.name, ok: true, detail: `${this.options.host}:${this.options.port} reachable` };
    } catch (error) {
      return {
        channel: this.name,
        ok: false,
        detail: `SMTP check failed: ${describe(error, this.options.authMethod)}`,
      };
    }
  }

  close(): void {
    this.transporter?.close();
    this.transporter = null;
  }

  /** The message for an OAuth2 setup that is not finished, or null when it is. */
  private incompleteOauth(): string | null {
    const missing = missingOauthSettings(this.options);
    if (missing.length === 0) return null;
    return (
      `email is set to OAuth2 but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
      'Fill these in on the Delivery page, or set the email auth method back to password.'
    );
  }

  private transport(): Transporter {
    if (this.transporter) return this.transporter;

    this.transporter =
      this.options.transportFactory?.() ?? nodemailer.createTransport(transportOptionsFor(this.options));

    return this.transporter;
  }
}

/**
 * The nodemailer transport configuration these options describe.
 *
 * A pure function rather than a method, so a test can read what would be sent to the
 * mail server without one existing: `transportFactory` — the seam the other tests use
 * — replaces `createTransport` entirely and therefore hides exactly the object worth
 * checking. Which auth block gets built is the whole of this change.
 */
export function transportOptionsFor(options: EmailChannelOptions): SMTPPool.Options {
  return {
    host: options.host,
    port: options.port,
    // `secure` means implicit TLS on connect (port 465). On 587 it must be false,
    // and STARTTLS is negotiated instead — setting it true there is the classic
    // cause of a connection that hangs and then times out.
    secure: options.secure,
    ...authFor(options),
    pool: true,
    maxConnections: 2,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

/**
 * The `auth` block, or nothing at all.
 *
 * Nothing at all is a real answer and the first one to check: a relay with a blank
 * username wants no AUTH command, and sending an empty one is a rejection rather
 * than a no-op.
 *
 * Nodemailer's own XOAuth2 client does the token work — the refresh-token exchange
 * on first use, the cached access token, and the renewal when it expires — so the
 * only thing built here is the description of where to get one.
 */
function authFor(options: EmailChannelOptions): Pick<SMTPPool.Options, 'auth'> {
  if (options.authMethod === 'oauth2') {
    const { clientId, clientSecret, refreshToken, tokenUrl, scope } = options.oauth;
    return {
      auth: {
        type: 'OAuth2',
        user: options.user,
        clientId,
        clientSecret,
        refreshToken,
        accessUrl: tokenUrl,
        /*
         * Merged into the token request body by nodemailer. `scope` is the only
         * thing this needs it for: Google's refresh grant ignores scope, while
         * Microsoft's wants the scopes the refresh token was issued for and
         * refuses some tenants without them.
         *
         * Omitted entirely when blank rather than sent empty — an empty `scope`
         * parameter is not the same as an absent one to Microsoft, which reads it
         * as "no scopes requested".
         *
         * Cast because `customParams` is missing from @types/nodemailer, not from
         * nodemailer: `lib/xoauth2/index.js` assigns it over the request body, and
         * `smtp-transport` hands the whole auth object to the XOAuth2 constructor
         * unfiltered. Asserted in email.test.ts against the object this builds, so
         * a types update that adds the field cannot quietly change what is sent.
         */
        ...(scope !== '' ? { customParams: { scope } } : {}),
      } as SMTPPool.Options['auth'],
    };
  }

  return options.user !== '' ? { auth: { user: options.user, pass: options.password } } : {};
}

/**
 * SMTP failures, in language that names the likely cause.
 *
 * Authentication earns the special handling, and what to say about it depends on how
 * this is authenticating — the same `535 5.7.139 Authentication unsuccessful` means
 * two different things in the two modes, and the advice for one is useless in the
 * other.
 *
 * With a **password**: Microsoft 365 and Google disable basic SMTP AUTH by default on
 * modern tenants, so a correct password is rejected exactly like a typo. The operator
 * checks the password, finds it right, and concludes the tool is broken. The failure
 * is real and unavoidable; presenting it as "wrong password" is not.
 *
 * With **OAuth2**, the same rejection means the opposite thing — the credentials were
 * accepted well enough to mint a token — and there are two distinct failures worth
 * separating:
 *
 *   - `EOAUTH2`: the token endpoint refused. The refresh token has expired or been
 *     revoked, the client secret has rotated, or the token URL is the wrong tenant.
 *     The provider's own `error_description` is already in the message.
 *   - `EAUTH` / 535: a token was obtained and the *mailbox* refused it. On Microsoft
 *     365 this is almost always SMTP AUTH still disabled for that mailbox, which is a
 *     per-mailbox setting that OAuth2 does not bypass.
 *
 * `EAUTH` is nodemailer's own classification and the 5xx codes are SMTP's; both are
 * checked because a server may return one without the other.
 */
function describe(error: unknown, authMethod: EmailAuthMethod): string {
  if (!(error instanceof Error)) return String(error);

  const smtp = error as Error & { responseCode?: number; code?: string };

  if (smtp.code === 'EOAUTH2') {
    return (
      `${error.message} — the identity provider refused to issue an access token. The refresh ` +
      'token may have expired or been revoked, the client secret may have rotated, or ' +
      'SMTP_OAUTH_TOKEN_URL may point at the wrong tenant. A new refresh token has to be ' +
      'obtained the same way the first one was.'
    );
  }

  const rejectedCredentials = smtp.code === 'EAUTH' || smtp.responseCode === 535 || smtp.responseCode === 534;

  if (rejectedCredentials && authMethod === 'oauth2') {
    return (
      `${error.message} — a token was issued but the mailbox rejected it. On Microsoft 365 this ` +
      'is usually SMTP AUTH still disabled for this specific mailbox, which OAuth2 does not ' +
      'bypass (Set-CASMailbox -SmtpClientAuthenticationDisabled $false). Check too that ' +
      'SMTP_USER is the mailbox being sent from and that the app registration holds the ' +
      'SMTP.Send permission.'
    );
  }

  if (rejectedCredentials) {
    return (
      `${error.message} — the server rejected these credentials. Microsoft 365 and Google ` +
      'disable basic SMTP AUTH by default, so a correct password fails exactly like a wrong ' +
      'one. Either point SMTP_HOST at an internal relay and leave SMTP_USER empty, use an ' +
      'app password where the tenant still permits one, or switch the auth method to OAuth2.'
    );
  }

  return error.message;
}
