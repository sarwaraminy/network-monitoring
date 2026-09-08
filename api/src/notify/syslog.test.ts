import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderFinding } from '../i18n/catalog/findings.js';
import {
  CEF_SEVERITY,
  escapeExtension,
  escapeHeader,
  frameSyslog,
  renderCef,
  renderJsonLine,
  SYSLOG_SEVERITY,
} from './cef.js';
import { SyslogChannel } from './syslog.js';
import type { NotifiableFinding, Notification } from './types.js';

/**
 * Syslog / CEF export.
 *
 * Two things are worth testing here and they are not the socket. First the
 * escaping, because a stray `|` or `=` does not fail — it silently shifts every
 * later field by one, and the SIEM shows an event that parsed "fine" and means
 * something else. Second the rule that this channel is never gated, since that
 * is the whole reason it exists separately from the chat channels.
 */

const PORT_SCAN_PARAMS = { source: '10.0.0.66', target: '10.0.0.89', count: 22, seconds: 60 };

/*
 * Rendered from the catalogue rather than typed out, because the CEF header's
 * `name` is now the *English* rendering of the finding's key — the human channels
 * follow the installation's outbound language and this feed deliberately does not.
 * A hand-written title here would pass while asserting nothing: it would agree
 * with itself and never notice the catalogue entry it is supposed to mirror.
 */
const TEXT = renderFinding('port_scan.packet', PORT_SCAN_PARAMS, 'en');

const FINDING: NotifiableFinding = {
  sensorId: 'default',
  kind: 'port_scan',
  severity: 'high',
  title: TEXT.title,
  description: TEXT.description,
  englishTitle: TEXT.title,
  englishDescription: TEXT.description,
  sourceIp: '10.0.0.66',
  targetIp: '10.0.0.89',
  occurrences: 3,
  firstSeen: new Date('2026-08-26T09:00:00.000Z'),
  lastSeen: new Date('2026-08-26T09:05:00.000Z'),
  evidence: { scanner: '10.0.0.66', distinctPortsProbed: 22 },
};

const notification = (finding: NotifiableFinding): Notification => ({
  severity: finding.severity,
  findings: [finding],
  omittedCount: 0,
  countsBySeverity: { [finding.severity]: 1 },
  generatedAt: new Date('2026-08-26T09:05:00.000Z'),
  dashboardUrl: null,
  isTest: false,
  namesSensors: false,
});

const channel = (
  overrides: Partial<ConstructorParameters<typeof SyslogChannel>[0]> = {},
  sent: string[][] = [],
) =>
  new SyslogChannel({
    host: 'siem.internal',
    port: 514,
    protocol: 'udp',
    format: 'cef',
    facility: 16,
    hostname: 'sensor-1',
    appName: 'nmt',
    rfc: '5424',
    productVersion: '1.0.0',
    sendImpl: async (lines) => {
      sent.push(lines);
    },
    ...overrides,
  });

describe('CEF escaping', () => {
  it('escapes the pipe and backslash in the header', () => {
    // A pipe ends a header field. One in a finding title would shift `severity`
    // into `name` and put the extension where severity belongs — an event that
    // parses without error and says something else entirely.
    assert.equal(escapeHeader('a|b'), 'a\\|b');
    assert.equal(escapeHeader('a\\b'), 'a\\\\b');
  });

  it('escapes the equals sign in an extension but leaves the pipe alone', () => {
    // Different rules from the header, which is where this usually goes wrong.
    assert.equal(escapeExtension('key=value'), 'key\\=value');
    assert.equal(escapeExtension('a|b'), 'a|b');
  });

  it('flattens newlines, because an extension is one line by definition', () => {
    assert.equal(escapeExtension('one\r\ntwo\nthree'), 'one two three');
  });

  it('maps info above the noise floor rather than to zero', () => {
    // Several SIEMs read CEF severity 0 as "unknown" and drop it from default
    // dashboards, which is a poor fate for an event we chose to send.
    assert.equal(CEF_SEVERITY.critical, 10);
    assert.ok(CEF_SEVERITY.info > 0);
    assert.equal(SYSLOG_SEVERITY.critical, 2);
  });
});

describe('CEF rendering', () => {
  it('names the producing sensor, on every event including an unnamed one', () => {
    /*
     * Unconditional, unlike the human channels, which omit the sensor while it
     * still carries the `default` name nobody chose. A SIEM correlating events
     * per segment needs the field present on every event or its rule silently
     * counts the unnamed installation's events as belonging to no producer;
     * filtering noise is the collector's job, not this renderer's.
     *
     * `dvchost` is the CEF-standard "device that observed this", so a SIEM maps
     * it without a custom rule.
     */
    assert.match(renderCef(FINDING, '1.0.0'), /\bdvchost=default\b/);
    assert.match(renderCef({ ...FINDING, sensorId: 'branch-office' }, '1.0.0'), /\bdvchost=branch-office\b/);

    const json = JSON.parse(renderJsonLine({ ...FINDING, sensorId: 'branch-office' }, '1.0.0'));
    assert.equal(json.sensorId, 'branch-office');
  });

  it('puts the detector kind in signatureId, where a SIEM rule keys on it', () => {
    const line = renderCef(FINDING, '1.0.0');
    const [prefix, vendor, product, version, signature, name, severity] = line.split('|');

    assert.equal(prefix, 'CEF:0');
    assert.equal(vendor, 'NetworkMonitoring');
    assert.equal(product, 'NMT');
    assert.equal(version, '1.0.0');
    assert.equal(signature, 'port_scan');
    assert.equal(name, FINDING.englishTitle);
    assert.equal(severity, '8');
  });

  it('maps addresses onto the standard src and dst fields', () => {
    const line = renderCef(FINDING, '1.0.0');
    assert.match(line, /\bsrc=10\.0\.0\.66\b/);
    assert.match(line, /\bdst=10\.0\.0\.89\b/);
    assert.match(line, /\bcnt=3\b/);
  });

  it('omits an address field entirely rather than sending an empty one', () => {
    // `src=` with nothing after it is a parse ambiguity, not an absent value.
    const line = renderCef({ ...FINDING, sourceIp: null, targetIp: null }, '1.0.0');
    assert.ok(!line.includes('src='));
    assert.ok(!line.includes('dst='));
  });

  it('carries evidence in the custom-string slots, with stable labels', () => {
    const line = renderCef(FINDING, '1.0.0');
    // Sorted, so a rule written against cs1Label does not start matching a
    // different field because a detector changed its property order.
    assert.match(line, /cs1Label=distinctPortsProbed/);
    assert.match(line, /cs2Label=scanner/);
  });

  it('drops evidence when the caller withheld it', () => {
    const line = renderCef({ ...FINDING, evidence: null }, '1.0.0');
    assert.ok(!line.includes('cs1Label'));
  });

  it('renders JSON when that format is chosen', () => {
    const parsed = JSON.parse(renderJsonLine(FINDING, '1.0.0'));
    assert.equal(parsed.kind, 'port_scan');
    assert.equal(parsed.severity, 'high');
    assert.equal(parsed.lastSeen, '2026-08-26T09:05:00.000Z');
  });
});

describe('syslog framing', () => {
  it('computes PRI as facility * 8 + severity', () => {
    // Getting this wrong is the most common reason a collector files everything
    // under user.notice. local0 (16) with Error (3) is 131.
    const line = frameSyslog('body', 'high', new Date('2026-08-26T09:05:00.000Z'), {
      facility: 16,
      hostname: 'sensor-1',
      appName: 'nmt',
      rfc: '5424',
    });
    assert.ok(line.startsWith('<131>1 '), line);
  });

  it('writes an ISO timestamp and the hostname for RFC 5424', () => {
    const line = frameSyslog('body', 'critical', new Date('2026-08-26T09:05:00.000Z'), {
      facility: 16,
      hostname: 'sensor-1',
      appName: 'nmt',
      rfc: '5424',
    });
    assert.match(line, /2026-08-26T09:05:00\.000Z sensor-1 nmt /);
  });

  it('falls back to the BSD shape for RFC 3164', () => {
    const line = frameSyslog('body', 'medium', new Date('2026-08-26T09:05:00.000Z'), {
      facility: 16,
      hostname: 'sensor-1',
      appName: 'nmt',
      rfc: '3164',
    });
    assert.match(line, /^<132>Aug \d{2} \d{2}:\d{2}:\d{2} sensor-1 nmt: body$/);
  });
});

describe('SyslogChannel', () => {
  it('declares that it wants every finding, ungated', () => {
    // The flag the notifier reads to hand findings over before the severity
    // gate, the throttle and the digest. A digested SIEM feed is a broken one.
    assert.equal(channel().deliversEveryFinding, true);
  });

  it('is unconfigured without a host, so nothing is attempted', async () => {
    const unconfigured = channel({ host: '' });
    assert.equal(unconfigured.isConfigured(), false);

    const result = await unconfigured.send(notification(FINDING));
    assert.equal(result.ok, false);
  });

  it('sends one line per finding', async () => {
    const sent: string[][] = [];
    const result = await channel({}, sent).send({
      ...notification(FINDING),
      findings: [FINDING, { ...FINDING, kind: 'host_sweep' }],
    });

    assert.equal(result.ok, true);
    assert.equal(sent[0]?.length, 2);
  });

  it('truncates an oversized UDP datagram rather than letting it fragment', async () => {
    // A fragmented syslog datagram is routinely dropped rather than reassembled,
    // so a visible truncation beats a silent disappearance.
    const sent: string[][] = [];
    const huge = { ...FINDING, englishDescription: 'x'.repeat(4000) };
    await channel({ protocol: 'udp' }, sent).send(notification(huge));

    const line = sent[0]?.[0] ?? '';
    assert.ok(Buffer.byteLength(line) <= 1024, `line was ${Buffer.byteLength(line)} bytes`);
    assert.ok(line.endsWith('[truncated]'));
  });

  it('does not truncate over TCP, where there is no datagram limit', async () => {
    // Cutting a TCP line would corrupt a stream the receiver frames by newline.
    const sent: string[][] = [];
    const huge = { ...FINDING, englishDescription: 'x'.repeat(4000) };
    await channel({ protocol: 'tcp' }, sent).send(notification(huge));

    assert.ok(Buffer.byteLength(sent[0]?.[0] ?? '') > 1024);
  });

  it('reports a failed send rather than throwing into the detection path', async () => {
    const failing = channel({
      sendImpl: async () => {
        throw new Error('collector unreachable');
      },
    });

    const result = await failing.send(notification(FINDING));
    assert.equal(result.ok, false);
    assert.match(result.detail, /collector unreachable/);
  });
});
