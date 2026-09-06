import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Transporter } from 'nodemailer';
import {
  EmailChannel,
  type EmailChannelOptions,
  missingOauthSettings,
  transportOptionsFor,
} from './email.js';
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

/** The rejection nodemailer surfaces for a refused login. */
function authError(message: string): Error {
  return Object.assign(new Error(message), { code: 'EAUTH', responseCode: 535 });
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

describe('an unfinished OAuth2 setup', () => {
  it('names every missing setting, by the name an operator would set', () => {
    // Field keys would send them searching for something that appears in no file
    // they can edit.
    assert.deepEqual(missingOauthSettings({ ...BASE, authMethod: 'oauth2' }), [
      'SMTP_USER',
      'SMTP_OAUTH_CLIENT_ID',
      'SMTP_OAUTH_CLIENT_SECRET',
      'SMTP_OAUTH_REFRESH_TOKEN',
      'SMTP_OAUTH_TOKEN_URL',
    ]);
  });

  it('counts a whitespace-only value as missing', () => {
    const options = { ...OAUTH, oauth: { ...OAUTH.oauth, refreshToken: '   ' } };
    assert.deepEqual(missingOauthSettings(options), ['SMTP_OAUTH_REFRESH_TOKEN']);
  });

  it('says nothing is missing while the method is password', () => {
    // Not "these fields are blank" — they are irrelevant, and reporting them would
    // make an ordinary relay look misconfigured.
    assert.deepEqual(missingOauthSettings(BASE), []);
  });

  it('refuses to send without opening a socket, and says which settings are unset', async () => {
    let built = 0;
    const channel = new EmailChannel({
      ...OAUTH,
      oauth: { ...OAUTH.oauth, refreshToken: '' },
      transportFactory: () => {
        built += 1;
        return failingTransport(new Error('should not be reached'))();
      },
    });

    const result = await channel.send(NOTIFICATION);

    assert.equal(result.ok, false);
    assert.match(result.detail ?? '', /SMTP_OAUTH_REFRESH_TOKEN/);
    // The point of checking before building: a half-configured OAuth2 transport
    // either sends unauthenticated or fails at the provider, and neither failure
    // mentions the field that was never filled in.
    assert.equal(built, 0);
  });

  it('refuses the connection check too', async () => {
    const channel = new EmailChannel({
      ...OAUTH,
      oauth: { ...OAUTH.oauth, clientSecret: '' },
      transportFactory: failingTransport(new Error('should not be reached')),
    });

    const result = await channel.verify();

    assert.equal(result.ok, false);
    assert.match(result.detail ?? '', /SMTP_OAUTH_CLIENT_SECRET/);
  });
});

describe('what a rejection is reported as', () => {
  it('blames basic SMTP AUTH being disabled when a password was used', async () => {
    const channel = new EmailChannel({
      ...BASE,
      user: 'nmt@contoso.test',
      password: 'correct-password',
      transportFactory: failingTransport(authError('535 5.7.139 Authentication unsuccessful')),
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
      transportFactory: failingTransport(authError('535 5.7.3 Authentication unsuccessful')),
    });

    const detail = (await channel.send(NOTIFICATION)).detail ?? '';

    assert.doesNotMatch(detail, /app password/);
    assert.match(detail, /SmtpClientAuthenticationDisabled/);
  });

  it('separates a token that could not be issued from one the mailbox refused', async () => {
    // nodemailer's EOAUTH2 carries the provider's own error_description, so "the
    // refresh token has expired" is already in the message; what it does not say is
    // that a new one has to be obtained the way the first was.
    const channel = new EmailChannel({
      ...OAUTH,
      transportFactory: failingTransport(
        Object.assign(new Error('invalid_grant: The refresh token has expired'), { code: 'EOAUTH2' }),
      ),
    });

    const detail = (await channel.send(NOTIFICATION)).detail ?? '';

    assert.match(detail, /invalid_grant/);
    assert.match(detail, /refresh token/);
    assert.doesNotMatch(detail, /SmtpClientAuthenticationDisabled/);
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
