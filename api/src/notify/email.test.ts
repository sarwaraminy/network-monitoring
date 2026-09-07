import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Transporter } from 'nodemailer';
import { EmailChannel, type EmailChannelOptions, transportOptionsFor } from './email.js';
import type { Notification } from './types.js';

/**
 * SMTP authentication, and what it says when it fails.
 *
 * The sending is nodemailer's; what is worth testing is everything decided before a
 * socket opens and everything said after one fails. Both are what issue #27 is
 * actually about — a Microsoft 365 tenant rejects a correct password, and the value
 * of this feature is that the rejection stops looking like a typo.
 *
 * Nothing here opens a connection: the auth block is read from `transportOptionsFor`,
 * and the failure paths come from a fake transport that rejects with the error shape
 * nodemailer really produces.
 */

const BASE: EmailChannelOptions = {
  host: 'smtp.example.test',
  port: 587,
  secure: false,
  user: '',
  password: '',
  from: 'nmt@example.test',
  to: ['ops@example.test'],
  authMethod: 'password',
  oauth: { clientId: '', clientSecret: '', refreshToken: '', tokenUrl: '', scope: '' },
};

const OAUTH: EmailChannelOptions = {
  ...BASE,
  user: 'nmt@contoso.test',
  authMethod: 'oauth2',
  oauth: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    tokenUrl: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
    scope: 'https://outlook.office.com/SMTP.Send offline_access',
  },
};

const AT = new Date('2026-01-01T00:00:00Z');

const NOTIFICATION: Notification = {
  severity: 'high',
  findings: [
    {
      sensorId: 'default',
      kind: 'port_scan',
      severity: 'high',
      title: 'Port scan',
      description: 'A host swept 40 ports.',
      sourceIp: '10.0.0.9',
      targetIp: null,
      occurrences: 1,
      firstSeen: AT,
      lastSeen: AT,
      evidence: null,
    },
  ],
  omittedCount: 0,
  countsBySeverity: { high: 1 },
  generatedAt: AT,
  dashboardUrl: null,
  isTest: false,
};

/** A transport whose sendMail and verify both reject with `error`. */
function failingTransport(error: unknown): () => Transporter {
  const transporter = {
    sendMail: () => Promise.reject(error),
    verify: () => Promise.reject(error),
    close: () => {},
  };
  return () => transporter as unknown as Transporter;
}

/**
 * The two failures nodemailer produces, shaped the way it really shapes them.
 *
 * Both arrive as `code: 'EAUTH'` — `_handleXOauth2Token` passes a token error through
 * `_formatError(err, 'EAUTH', false, …)`, which overwrites the `EOAUTH2` the xoauth2
 * client set. What separates them is `responseCode`: `_formatError` only attaches one
 * when it was given the server's reply, and a token that was never issued never
 * reached the server. Constructing these by hand from `{ code: 'EOAUTH2' }` would
 * assert a branch's wording while proving nothing about whether it is reachable.
 */

/** A mailbox refusing a credential: nodemailer's `_actionAUTHComplete` path. */
function mailboxRejection(serverLine: string): Error {
  return Object.assign(new Error(`Invalid login: ${serverLine}`), {
    code: 'EAUTH',
    response: serverLine,
    responseCode: Number(serverLine.slice(0, 3)),
    command: 'AUTH XOAUTH2',
  });
}

/** The identity provider refusing to issue one: the `_handleXOauth2Token` path. */
function tokenRefusal(message: string): Error {
  // `code` starts as EOAUTH2 in the xoauth2 client and is overwritten in place.
  return Object.assign(new Error(message), { code: 'EAUTH', command: 'AUTH XOAUTH2' });
}

describe('the SMTP auth block', () => {
  it('sends no AUTH at all when the username is blank', () => {
    // The internal relay case, and the one the README puts first. An empty AUTH
    // command is a rejection, not a no-op, so the block has to be absent rather
    // than present and empty.
    assert.equal('auth' in transportOptionsFor(BASE), false);
  });

  it('uses the password when one is set', () => {
    const options = transportOptionsFor({ ...BASE, user: 'nmt@example.test', password: 'app-password' });
    assert.deepEqual(options.auth, { user: 'nmt@example.test', pass: 'app-password' });
  });

  it('describes the refresh-token grant when the method is oauth2', () => {
    const auth = transportOptionsFor(OAUTH).auth as unknown as Record<string, unknown>;

    assert.equal(auth.type, 'OAuth2');
    // The mailbox identity, not a login name: XOAUTH2 carries `user=` in the token.
    assert.equal(auth.user, 'nmt@contoso.test');
    assert.equal(auth.clientId, 'client-id');
    assert.equal(auth.refreshToken, 'refresh-token');
    // Never nodemailer's own default, which is Google's endpoint.
    assert.equal(auth.accessUrl, 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token');
    // `customParams` is missing from @types/nodemailer but read by its xoauth2
    // client, which is why the builder casts. This is the assertion that makes the
    // cast safe to keep: a types update cannot quietly change what gets sent.
    assert.deepEqual(auth.customParams, { scope: 'https://outlook.office.com/SMTP.Send offline_access' });
  });

  it('omits the scope entirely rather than sending an empty one', () => {
    // Microsoft reads an empty `scope` as "no scopes requested", which fails
    // differently and less legibly than not asking at all. Google ignores the
    // parameter either way.
    const auth = transportOptionsFor({ ...OAUTH, oauth: { ...OAUTH.oauth, scope: '' } })
      .auth as unknown as Record<string, unknown>;
    assert.equal('customParams' in auth, false);
  });

  it('ignores the oauth settings while the method is password', () => {
    // A tenant configured for OAuth2 and then switched back must send the password,
    // not a stale token request.
    const options = transportOptionsFor({ ...OAUTH, authMethod: 'password', password: 'app-password' });
    assert.deepEqual(options.auth, { user: 'nmt@contoso.test', pass: 'app-password' });
  });
});

describe('what a rejection is reported as', () => {
  it('blames basic SMTP AUTH being disabled when a password was used', async () => {
    const channel = new EmailChannel({
      ...BASE,
      user: 'nmt@contoso.test',
      password: 'correct-password',
      transportFactory: failingTransport(mailboxRejection('535 5.7.139 Authentication unsuccessful')),
    });

    const detail = (await channel.send(NOTIFICATION)).detail ?? '';

    assert.match(detail, /535 5\.7\.139/);
    assert.match(detail, /basic SMTP AUTH/);
  });

  it('does not blame basic SMTP AUTH for the same rejection under oauth2', async () => {
    // The identical 535, and the password advice is now actively wrong: a token was
    // issued and the mailbox refused it, which on Microsoft 365 is a per-mailbox
    // setting that OAuth2 does not bypass.
    const channel = new EmailChannel({
      ...OAUTH,
      transportFactory: failingTransport(mailboxRejection('535 5.7.3 Authentication unsuccessful')),
    });

    const detail = (await channel.send(NOTIFICATION)).detail ?? '';

    assert.doesNotMatch(detail, /app password/);
    assert.match(detail, /SmtpClientAuthenticationDisabled/);
  });

  it('separates a token that could not be issued from one the mailbox refused', async () => {
    // The failure this feature exists to diagnose, and the one that is easiest to
    // mislabel: it arrives as the same EAUTH as a mailbox rejection, and telling the
    // operator to run Set-CASMailbox would send them to change a mailbox setting when
    // what needs reissuing is their refresh token. The absence of a responseCode is
    // the only thing separating the two.
    const channel = new EmailChannel({
      ...OAUTH,
      transportFactory: failingTransport(tokenRefusal('invalid_grant: The refresh token has expired')),
    });

    const detail = (await channel.send(NOTIFICATION)).detail ?? '';

    assert.match(detail, /invalid_grant/);
    assert.match(detail, /refresh token/);
    assert.doesNotMatch(detail, /SmtpClientAuthenticationDisabled/);
  });

  it('still reads a bare EOAUTH2 as the provider refusing', async () => {
    // Belt and braces: nodemailer rewrites the code today, and this is what happens
    // if a future version stops.
    const channel = new EmailChannel({
      ...OAUTH,
      transportFactory: failingTransport(
        Object.assign(new Error('invalid_client: bad secret'), { code: 'EOAUTH2' }),
      ),
    });

    assert.match((await channel.send(NOTIFICATION)).detail ?? '', /identity provider refused/);
  });

  it('leaves a password mailbox out of the OAuth2 explanations entirely', async () => {
    // A password login can fail without a response code too — a socket dropped
    // mid-AUTH. It must not be described as a refresh token problem.
    const channel = new EmailChannel({
      ...BASE,
      user: 'nmt@example.test',
      password: 'app-password',
      transportFactory: failingTransport(
        Object.assign(new Error('Unexpected socket close'), { code: 'EAUTH', command: 'AUTH LOGIN' }),
      ),
    });

    const detail = (await channel.send(NOTIFICATION)).detail ?? '';

    assert.doesNotMatch(detail, /refresh token/);
    assert.match(detail, /basic SMTP AUTH/);
  });

  it('passes an ordinary failure through unexplained', async () => {
    // Only authentication gets an explanation. A refused connection is already as
    // clear as it is going to get, and wrapping it in advice about tenants would
    // send somebody to the wrong place.
    const channel = new EmailChannel({
      ...BASE,
      transportFactory: failingTransport(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ESOCKET' }),
      ),
    });

    const detail = (await channel.send(NOTIFICATION)).detail ?? '';

    assert.equal(detail, 'send failed: connect ECONNREFUSED');
  });
});
