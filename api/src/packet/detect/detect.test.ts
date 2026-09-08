import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { type RenderedFinding, renderFinding } from '../../i18n/catalog/findings.js';
import { decodePacket } from '../decode.js';
import { buildArp, buildDns, buildTcp, buildUdp } from './test-frames.js';
import type { Detector, Finding } from './types.js';

/**
 * Detector tests.
 *
 * Two jobs here, and the second matters as much as the first:
 *
 *  1. Attacks are detected — synthetic scans, ARP poisoning, cleartext logins.
 *  2. Ordinary traffic is NOT. The rules these replaced flagged every TCP ACK and
 *     every new connection, so 100% of the alerts in the real database were the
 *     user's own machine talking to Microsoft and Bing. The "quiet on normal
 *     traffic" suite is a regression guard against returning to that.
 */

// Detectors read env at construction, so import after the environment is set.
let detect: typeof import('./index.js');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  process.env.ARP_TRUSTED_MAPPINGS = '';
  // The device learning period is left at its default here, so the engine tests
  // exercise real behaviour. Tests that need it disabled construct the detector
  // directly with an explicit period.
  detect = await import('./index.js');
});

/**
 * A unicast MAC. The low bit of the first octet marks a multicast/group address,
 * so a first octet like 0x11 is not a device identity and detectors skip it.
 */
const UNICAST_MAC = '12:34:56:78:9a:bc';

/** Runs frames through one detector and collects every finding. */
function run(
  detector: Detector,
  frames: Buffer[],
  startedAt = Date.parse('2026-07-26T12:00:00Z'),
): Finding[] {
  const findings: Finding[] = [];
  frames.forEach((frame, index) => {
    // 10 ms apart, so windowed detectors see a realistic burst.
    findings.push(...detector.inspect(decodePacket(frame, new Date(startedAt + index * 10))));
  });
  return findings;
}

const kinds = (findings: Finding[]): string[] => [...new Set(findings.map((f) => f.kind))];

/**
 * A finding's text in English, for the assertions that are about what an operator
 * reads rather than about which branch fired.
 *
 * Detectors emit a message key and parameters since V17, so the sentence only
 * exists once something renders it. Rendering in the test keeps these assertions
 * pointed at the same thing they were before — that the description of a sweep of
 * port 445 actually says SMB — rather than at a key that could be right while the
 * catalogue entry behind it says nothing of the kind.
 */
function englishText(finding: Finding): RenderedFinding {
  return renderFinding(finding.messageKey, finding.messageParams, 'en');
}

describe('ARP spoofing', () => {
  const VICTIM = '10.0.0.1';
  const REAL_MAC = 'aa:bb:cc:dd:ee:01';
  const ATTACKER_MAC = 'de:ad:be:ef:00:99';

  it('stays quiet while a binding is consistent', () => {
    const detector = new detect.ArpSpoofDetector();
    const frames = Array.from({ length: 10 }, () => buildArp({ senderIp: VICTIM, senderMac: REAL_MAC }));
    assert.deepEqual(run(detector, frames), []);
  });

  it('does not alert on the first sighting of an address', () => {
    // Otherwise every device on the network alerts when a capture starts.
    const detector = new detect.ArpSpoofDetector();
    assert.deepEqual(run(detector, [buildArp({ senderIp: VICTIM, senderMac: REAL_MAC })]), []);
  });

  it('ignores a MAC change before the binding has settled', () => {
    // Two sightings is below the trust threshold: more likely DHCP churn.
    const detector = new detect.ArpSpoofDetector();
    const findings = run(detector, [
      buildArp({ senderIp: VICTIM, senderMac: REAL_MAC }),
      buildArp({ senderIp: VICTIM, senderMac: ATTACKER_MAC }),
    ]);
    assert.deepEqual(findings, []);
  });

  it('detects a settled address being claimed by a new MAC', () => {
    const detector = new detect.ArpSpoofDetector();
    const findings = run(detector, [
      ...Array.from({ length: 4 }, () => buildArp({ senderIp: VICTIM, senderMac: REAL_MAC })),
      buildArp({ senderIp: VICTIM, senderMac: ATTACKER_MAC }),
    ]);

    assert.equal(findings.length, 1);
    const finding = findings[0]!;
    assert.equal(finding.kind, 'arp_spoofing');
    assert.equal(finding.severity, 'high');
    assert.equal(finding.evidence.previousMac, REAL_MAC);
    assert.equal(finding.evidence.currentMac, ATTACKER_MAC);
    assert.equal(finding.evidence.claimedIp, VICTIM);
  });

  it('escalates to critical when two MACs alternate', () => {
    // A gratuitous ARP war is an active poisoning attack, not a device swap.
    const detector = new detect.ArpSpoofDetector();
    const settle = Array.from({ length: 4 }, () => buildArp({ senderIp: VICTIM, senderMac: REAL_MAC }));
    const findings = run(detector, [
      ...settle,
      buildArp({ senderIp: VICTIM, senderMac: ATTACKER_MAC }),
      ...Array.from({ length: 4 }, () => buildArp({ senderIp: VICTIM, senderMac: REAL_MAC })),
      buildArp({ senderIp: VICTIM, senderMac: ATTACKER_MAC }),
    ]);

    assert.ok(
      findings.some((f) => f.severity === 'critical'),
      'expected a critical finding',
    );
    const critical = findings.find((f) => f.severity === 'critical')!;
    assert.ok(Number(critical.evidence.alternations) >= 1);
  });

  it('detects one MAC claiming many addresses', () => {
    const detector = new detect.ArpSpoofDetector();
    const frames = Array.from({ length: 8 }, (_, i) =>
      buildArp({ senderIp: `10.0.0.${20 + i}`, senderMac: ATTACKER_MAC }),
    );
    const findings = run(detector, frames);

    const sprawl = findings.find((f) => String(f.dedupKey).includes('sprawl'));
    assert.ok(sprawl, 'expected a MAC-sprawl finding');
    assert.equal(sprawl.severity, 'high');
    assert.ok(Number(sprawl.evidence.claimedIpCount) > 5);
  });

  it('reports only once per offending MAC', () => {
    const detector = new detect.ArpSpoofDetector();
    const frames = Array.from({ length: 40 }, (_, i) =>
      buildArp({ senderIp: `10.0.0.${20 + (i % 15)}`, senderMac: ATTACKER_MAC }),
    );
    const sprawl = run(detector, frames).filter((f) => String(f.dedupKey).includes('sprawl'));
    assert.equal(sprawl.length, 1, 'sprawl must not re-fire on every packet');
  });
});

describe('port scan', () => {
  it('detects many ports probed on one host', () => {
    const detector = new detect.ScanDetector();
    const frames = Array.from({ length: 25 }, (_, i) =>
      buildTcp({ srcIp: '10.0.0.66', dstIp: '10.0.0.89', dstPort: 1000 + i, flags: { syn: true } }),
    );
    const findings = run(detector, frames).filter((f) => f.kind === 'port_scan');

    assert.ok(findings.length >= 1);
    const finding = findings[0]!;
    assert.equal(finding.severity, 'high');
    assert.equal(finding.sourceIp, '10.0.0.66');
    assert.equal(finding.targetIp, '10.0.0.89');
    assert.ok(Number(finding.evidence.distinctPortsProbed) >= 15);
  });

  it('ignores repeated connections to the same port', () => {
    // A busy client reconnecting is not a scan.
    const detector = new detect.ScanDetector();
    const frames = Array.from({ length: 60 }, () =>
      buildTcp({ srcIp: '10.0.0.89', dstIp: '93.184.216.34', dstPort: 443, flags: { syn: true } }),
    );
    assert.deepEqual(
      run(detector, frames).filter((f) => f.kind === 'port_scan'),
      [],
    );
  });
});

describe('host sweep', () => {
  it('detects one port probed across many hosts', () => {
    const detector = new detect.ScanDetector();
    const frames = Array.from({ length: 30 }, (_, i) =>
      buildTcp({ srcIp: '10.0.0.66', dstIp: `10.0.0.${i + 100}`, dstPort: 445, flags: { syn: true } }),
    );
    const findings = run(detector, frames).filter((f) => f.kind === 'host_sweep');

    assert.ok(findings.length >= 1);
    assert.equal(findings[0]!.evidence.port, 445);
    assert.match(englishText(findings[0]!).description, /SMB/);
  });

  it('does not flag a browser contacting many hosts on 443', () => {
    // The single most important false positive to avoid: normal web browsing.
    const detector = new detect.ScanDetector();
    const frames = Array.from({ length: 80 }, (_, i) =>
      buildTcp({ srcIp: '10.0.0.89', dstIp: `93.184.${i}.10`, dstPort: 443, flags: { syn: true } }),
    );
    assert.deepEqual(
      run(detector, frames).filter((f) => f.kind === 'host_sweep'),
      [],
    );
  });

  it('does not flag DNS traffic to many resolvers', () => {
    const detector = new detect.ScanDetector();
    const frames = Array.from({ length: 40 }, (_, i) =>
      buildTcp({ srcIp: '10.0.0.89', dstIp: `1.1.1.${i}`, dstPort: 53, flags: { syn: true } }),
    );
    assert.deepEqual(
      run(detector, frames).filter((f) => f.kind === 'host_sweep'),
      [],
    );
  });
});

describe('SYN flood', () => {
  it('detects an implausible connection rate', () => {
    const detector = new detect.ScanDetector();
    const frames = Array.from({ length: 400 }, () =>
      buildTcp({ srcIp: '10.0.0.66', dstIp: '10.0.0.89', dstPort: 80, flags: { syn: true } }),
    );
    // 1 ms apart keeps all 400 inside the 10s flood window.
    const findings: Finding[] = [];
    frames.forEach((frame, index) => {
      findings.push(...detector.inspect(decodePacket(frame, new Date(1_700_000_000_000 + index))));
    });

    const flood = findings.filter((f) => f.kind === 'syn_flood');
    assert.ok(flood.length >= 1);
    assert.ok(Number(flood[0]!.evidence.attemptsInWindow) >= 300);
  });

  it('stays quiet at an ordinary connection rate', () => {
    const detector = new detect.ScanDetector();
    const findings: Finding[] = [];
    // 30 connections spread over a minute.
    for (let i = 0; i < 30; i += 1) {
      const frame = buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '93.184.216.34',
        dstPort: 443,
        flags: { syn: true },
      });
      findings.push(...detector.inspect(decodePacket(frame, new Date(1_700_000_000_000 + i * 2000))));
    }
    assert.deepEqual(
      findings.filter((f) => f.kind === 'syn_flood'),
      [],
    );
  });
});

describe('plaintext credentials', () => {
  const detector = () => new detect.PlaintextCredentialDetector();

  it('detects HTTP Basic authentication and never records the password', () => {
    const credentials = Buffer.from('alice:SuperSecret123').toString('base64');
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.50',
        dstPort: 80,
        flags: { ack: true, psh: true },
        payload: `GET /admin HTTP/1.1\r\nHost: intranet.local\r\nAuthorization: Basic ${credentials}\r\n\r\n`,
      }),
    ]);

    assert.equal(findings.length, 1);
    const finding = findings[0]!;
    assert.equal(finding.kind, 'plaintext_credentials');
    assert.equal(finding.severity, 'critical');
    assert.equal(finding.evidence.username, 'alice');
    assert.equal(finding.evidence.passwordLength, 'SuperSecret123'.length);
    assert.equal(finding.evidence.passwordRecorded, false);

    // The privacy contract: the secret must appear nowhere in the finding.
    const serialized = JSON.stringify(finding);
    assert.ok(!serialized.includes('SuperSecret123'), 'password leaked into the finding');
    assert.ok(!serialized.includes(credentials), 'encoded credential leaked into the finding');
  });

  it('detects an FTP login without recording the password', () => {
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.60',
        dstPort: 21,
        flags: { ack: true, psh: true },
        payload: 'USER bob\r\n',
      }),
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.60',
        dstPort: 21,
        flags: { ack: true, psh: true },
        payload: 'PASS hunter2\r\n',
      }),
    ]);

    assert.ok(findings.length >= 1);
    assert.ok(findings.some((f) => f.evidence.username === 'bob'));
    assert.ok(!JSON.stringify(findings).includes('hunter2'), 'password leaked into the finding');
  });

  it('flags a Telnet session', () => {
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.70',
        dstPort: 23,
        flags: { ack: true, psh: true },
        payload: 'login: ',
      }),
    ]);
    assert.equal(findings[0]?.severity, 'high');
    assert.match(englishText(findings[0]!).title, /Telnet/);
  });

  it('detects a password in an HTTP form post', () => {
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.50',
        dstPort: 80,
        flags: { ack: true, psh: true },
        payload:
          'POST /login HTTP/1.1\r\nHost: shop.local\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\n' +
          'username=carol&password=Tr0ub4dor',
      }),
    ]);

    const form = findings.find((f) => f.evidence.fieldName === 'password');
    assert.ok(form, 'expected a form-password finding');
    assert.equal(form.evidence.username, 'carol');
    assert.equal(form.evidence.valueRecorded, false);
    assert.ok(!JSON.stringify(form).includes('Tr0ub4dor'), 'password leaked into the finding');
  });

  it('never records the secret when the login is sent as a GET query string', () => {
    /*
     * The regression this pins. The form regex treats `?` and `&` as field
     * separators, so a GET login was always detected — but the request line went
     * into evidence verbatim, which put the password in `alerts.evidence`, in the
     * UI evidence panel, and in the chat webhook, since NOTIFY_INCLUDE_EVIDENCE
     * is on by default.
     *
     * The suite missed it for a year because the test above posts a body. This
     * module's whole promise is username and length, never the value, so the
     * query-string case needs its own guard.
     */
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.50',
        dstPort: 80,
        flags: { ack: true, psh: true },
        payload: 'GET /login?username=carol&password=Tr0ub4dor HTTP/1.1\r\nHost: shop.local\r\n\r\n',
      }),
    ]);

    const form = findings.find((f) => f.evidence.fieldName === 'password');
    assert.ok(form, 'expected a form-password finding');
    assert.equal(form.evidence.username, 'carol');
    assert.equal(form.evidence.valueRecorded, false);
    assert.ok(!JSON.stringify(form).includes('Tr0ub4dor'), 'password leaked into the finding');
    // And the path is still there, so the finding says WHERE it happened.
    assert.match(String(form.evidence.requestLine), /\/login/);
  });

  it('redacts cleanly when the request line is truncated mid-query', () => {
    /*
     * The case a capture ring actually produces. With no space after the query
     * string there is no HTTP version to keep, and `indexOf(' ', query)` returns
     * -1 — `slice(-1)` then appended the LAST character instead of nothing, so
     * the evidence read `GET /login?<redacted>t`. Never a leak, but wrong in
     * exactly the branch truncation makes common.
     */
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.50',
        dstPort: 80,
        flags: { ack: true, psh: true },
        payload: 'GET /login?username=carol&password=Tr0ub4dor',
      }),
    ]);

    const form = findings.find((f) => f.evidence.fieldName === 'password');
    assert.ok(form, 'expected a form-password finding');
    assert.ok(!JSON.stringify(form).includes('Tr0ub4dor'), 'password leaked into the finding');
    assert.equal(form.evidence.requestLine, 'GET /login?<redacted>');
  });

  it('detects SMTP AUTH PLAIN and decodes only the username', () => {
    const secret = Buffer.from(' dave mailpass').toString('base64');
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.80',
        dstPort: 25,
        flags: { ack: true, psh: true },
        payload: `AUTH PLAIN ${secret}\r\n`,
      }),
    ]);

    assert.equal(findings[0]?.evidence.username, 'dave');
    assert.ok(!JSON.stringify(findings).includes('mailpass'), 'password leaked into the finding');
  });

  it('ignores HTTPS traffic, which is opaque anyway', () => {
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '93.184.216.34',
        dstPort: 443,
        flags: { ack: true, psh: true },
        payload: ' binary tls handshake bytes',
      }),
    ]);
    assert.deepEqual(findings, []);
  });

  it('ignores plain HTTP with no credentials in it', () => {
    const findings = run(detector(), [
      buildTcp({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.50',
        dstPort: 80,
        flags: { ack: true, psh: true },
        payload: 'GET /index.html HTTP/1.1\r\nHost: intranet.local\r\nAccept: text/html\r\n\r\n',
      }),
    ]);
    assert.deepEqual(findings, []);
  });
});

describe('DNS tunnelling', () => {
  it('detects long high-entropy names across many subdomains', () => {
    const detector = new detect.DnsTunnelingDetector();
    const frames = Array.from({ length: 60 }, (_, i) =>
      buildDns({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.1',
        queryName: `${encodedLabel(50, i)}.tunnel.example.com`,
      }),
    );
    const findings = run(detector, frames).filter((f) => f.kind === 'dns_tunneling');

    assert.ok(findings.length >= 1, 'expected a DNS tunnelling finding');
    assert.equal(findings[0]!.severity, 'medium');
    assert.equal(findings[0]!.evidence.registrableDomain, 'example.com');
    assert.ok(Array.isArray(findings[0]!.evidence.reasons));
    assert.ok((findings[0]!.evidence.reasons as string[]).length >= 2, 'needs two independent signals');
  });

  it('ignores ordinary lookups', () => {
    const detector = new detect.DnsTunnelingDetector();
    const hosts = ['www.google.com', 'outlook.office365.com', 'api.github.com', 'cdn.jsdelivr.net'];
    const frames = Array.from({ length: 80 }, (_, i) =>
      buildDns({ srcIp: '10.0.0.89', dstIp: '10.0.0.1', queryName: hosts[i % hosts.length]! }),
    );
    assert.deepEqual(
      run(detector, frames).filter((f) => f.kind === 'dns_tunneling'),
      [],
    );
  });

  it('ignores a single long name without the other signals', () => {
    const detector = new detect.DnsTunnelingDetector();
    const findings = run(detector, [
      buildDns({
        srcIp: '10.0.0.89',
        dstIp: '10.0.0.1',
        queryName: 'this-is-a-fairly-long-but-perfectly-ordinary-hostname.example.com',
      }),
    ]);
    assert.deepEqual(findings, []);
  });
});

describe('new device', () => {
  it('reports a MAC it has not seen', () => {
    const detector = new detect.NewDeviceDetector(0);
    const findings = run(detector, [
      buildTcp({ srcIp: '10.0.0.90', dstIp: '10.0.0.1', dstPort: 443, srcMac: UNICAST_MAC }),
    ]);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, 'new_device');
    assert.equal(findings[0]!.evidence.macAddress, UNICAST_MAC);
    assert.equal(findings[0]!.evidence.vendorPrefix, UNICAST_MAC.slice(0, 8));
  });

  it('skips multicast source addresses, whose low bit is set', () => {
    const detector = new detect.NewDeviceDetector(0);
    const findings = run(detector, [
      // 0x11 has the group bit set, so this is not a device identity.
      buildTcp({ srcIp: '10.0.0.90', dstIp: '10.0.0.1', dstPort: 443, srcMac: '11:22:33:44:55:66' }),
    ]);
    assert.deepEqual(findings, []);
  });

  it('reports each device only once', () => {
    const detector = new detect.NewDeviceDetector(0);
    const frames = Array.from({ length: 10 }, () =>
      buildTcp({ srcIp: '10.0.0.90', dstIp: '10.0.0.1', dstPort: 443, srcMac: UNICAST_MAC }),
    );
    assert.equal(run(detector, frames).length, 1);
  });

  it('stays silent for devices seeded from previous runs', () => {
    const detector = new detect.NewDeviceDetector(0);
    detector.seed([UNICAST_MAC]);
    const findings = run(detector, [
      buildTcp({ srcIp: '10.0.0.90', dstIp: '10.0.0.1', dstPort: 443, srcMac: UNICAST_MAC }),
    ]);
    assert.deepEqual(findings, []);
  });

  it('learns silently during the grace period', () => {
    // Without this, every device alerts the moment a capture starts.
    const detector = new detect.NewDeviceDetector(60_000);
    const findings = run(detector, [
      buildTcp({ srcIp: '10.0.0.90', dstIp: '10.0.0.1', dstPort: 443, srcMac: 'aa:11:22:33:44:55' }),
      buildTcp({ srcIp: '10.0.0.91', dstIp: '10.0.0.1', dstPort: 443, srcMac: 'aa:11:22:33:44:66' }),
    ]);
    assert.deepEqual(findings, []);
  });

  it('ignores multicast and broadcast source addresses', () => {
    const detector = new detect.NewDeviceDetector(0);
    const findings = run(detector, [
      buildTcp({ srcIp: '10.0.0.90', dstIp: '10.0.0.1', dstPort: 443, srcMac: '01:00:5e:00:00:fb' }),
      buildTcp({ srcIp: '10.0.0.90', dstIp: '10.0.0.1', dstPort: 443, srcMac: 'ff:ff:ff:ff:ff:ff' }),
    ]);
    assert.deepEqual(findings, []);
  });
});

describe('recording that a known device is still here', () => {
  /**
   * Frames from one MAC at chosen offsets from a fixed start, in milliseconds.
   *
   * `run` above spaces frames 10 ms apart, which is right for windowed detectors
   * and useless here: what is under test is a throttle measured in minutes.
   */
  const sightingsAt = (detector: Detector, offsetsMs: number[], mac = UNICAST_MAC): void => {
    const start = Date.parse('2026-07-26T12:00:00Z');
    for (const offset of offsetsMs) {
      detector.inspect(
        decodePacket(
          buildTcp({ srcIp: '10.0.0.90', dstIp: '10.0.0.1', dstPort: 443, srcMac: mac }),
          new Date(start + offset),
        ),
      );
    }
  };

  it('reports a sighting of a device that is already known', () => {
    /*
     * The bug this guards is not a false alert, it is a deletion.
     *
     * `inspect` returned early for a known MAC, so the only code that ever wrote
     * `known_devices.last_seen` was the discovery callback — making the column mean
     * "first inserted", permanently. Retention prunes on that column, so a device
     * that had been on the LAN continuously since install would be forgotten at the
     * end of the window and re-alerted as new on the next capture: the whole
     * network at once, a year after install, with nothing having changed.
     */
    const refreshed: Array<[string, string | null]> = [];
    const detector = new detect.NewDeviceDetector(0, {
      onSeen: (address, ip) => refreshed.push([address, ip]),
    });
    detector.seed([UNICAST_MAC]);

    sightingsAt(detector, [0]);

    // On the first frame, not a quarter hour into the capture: these addresses came
    // from a previous run, so every one of them is already due a refresh.
    assert.deepEqual(refreshed, [[UNICAST_MAC, '10.0.0.90']]);
  });

  it('leaves a first sighting to the discovery callback', () => {
    // A brand-new MAC is persisted by `onDiscovered` with the same upsert. Firing
    // both would be a redundant write on the busiest path in the process.
    const discovered: string[] = [];
    const refreshed: string[] = [];
    const detector = new detect.NewDeviceDetector(0, {
      onDiscovered: (address) => discovered.push(address),
      onSeen: (address) => refreshed.push(address),
    });

    sightingsAt(detector, [0]);

    assert.deepEqual(discovered, [UNICAST_MAC]);
    assert.deepEqual(refreshed, []);
  });

  it('refreshes once per quarter hour, not once per frame', () => {
    // A device sending a thousand frames a second is the normal case, and a write
    // per frame is why this is not simply an upsert on the known path. `last_seen`
    // feeds a decision taken in days.
    const refreshed: string[] = [];
    const detector = new detect.NewDeviceDetector(0, { onSeen: (address) => refreshed.push(address) });
    detector.seed([UNICAST_MAC]);

    sightingsAt(detector, [0, 1, 10, 1_000, 60_000, 899_999]);

    assert.deepEqual(refreshed, [UNICAST_MAC]);
  });

  it('refreshes again once the interval has passed', () => {
    // The other half of the throttle: one that never released would be the original
    // bug again, with an extra fifteen minutes of grace.
    let refreshes = 0;
    const detector = new detect.NewDeviceDetector(0, {
      onSeen: () => {
        refreshes += 1;
      },
    });
    detector.seed([UNICAST_MAC]);

    // t=0, then the boundary exactly, then a millisecond past it, then the next one.
    sightingsAt(detector, [0, 900_000, 900_001, 1_800_000]);

    assert.equal(refreshes, 3);
  });

  it('measures the interval per device rather than globally', () => {
    // A shared timestamp would let a chatty device starve every quiet one, which on
    // a network of mostly-idle devices is most of them.
    const refreshed: string[] = [];
    const other = 'aa:bb:cc:00:11:22';
    const detector = new detect.NewDeviceDetector(0, { onSeen: (address) => refreshed.push(address) });
    detector.seed([UNICAST_MAC, other]);

    sightingsAt(detector, [0]);
    sightingsAt(detector, [1], other);

    assert.deepEqual(refreshed, [UNICAST_MAC, other]);
  });

  it('says nothing about a structural address', () => {
    // Broadcast and multicast MACs are not device identities, and a row per
    // multicast group is not something retention should be keeping alive.
    const refreshed: string[] = [];
    const detector = new detect.NewDeviceDetector(0, { onSeen: (address) => refreshed.push(address) });
    detector.seed(['ff:ff:ff:ff:ff:ff', '01:00:5e:00:00:fb']);

    sightingsAt(detector, [0], 'ff:ff:ff:ff:ff:ff');
    sightingsAt(detector, [1], '01:00:5e:00:00:fb');

    assert.deepEqual(refreshed, []);
  });
});

describe('quiet on normal traffic', () => {
  /**
   * The regression guard. This mirrors what the real database actually contained:
   * a workstation talking to Microsoft, Bing, Akamai and OpenDNS. The rules this
   * replaced flagged 100% of it. The whole engine must stay silent.
   */
  it('produces no findings for a realistic browsing session', () => {
    const engine = new detect.DetectionEngine({ knownDevices: ['38:f7:cd:c4:a0:6f'] });
    const WORKSTATION = '10.0.0.89';
    const MAC = '38:f7:cd:c4:a0:6f';
    const servers = ['20.189.173.14', '204.79.197.239', '208.67.222.222', '23.206.197.35', '52.98.50.18'];

    const frames: Buffer[] = [];
    for (let i = 0; i < servers.length; i += 1) {
      const server = servers[i]!;
      // Handshake, data, teardown — the shape of every real connection.
      frames.push(
        buildTcp({ srcIp: WORKSTATION, dstIp: server, dstPort: 443, srcMac: MAC, flags: { syn: true } }),
        buildTcp({
          srcIp: server,
          dstIp: WORKSTATION,
          srcPort: 443,
          dstPort: 40000 + i,
          flags: { syn: true, ack: true },
        }),
        buildTcp({ srcIp: WORKSTATION, dstIp: server, dstPort: 443, srcMac: MAC, flags: { ack: true } }),
        buildTcp({
          srcIp: WORKSTATION,
          dstIp: server,
          dstPort: 443,
          srcMac: MAC,
          flags: { ack: true, psh: true },
          payload: 'x'.repeat(1400),
        }),
        buildTcp({
          srcIp: server,
          dstIp: WORKSTATION,
          srcPort: 443,
          dstPort: 40000 + i,
          flags: { ack: true, psh: true },
          payload: 'y'.repeat(1400),
        }),
        buildTcp({
          srcIp: WORKSTATION,
          dstIp: server,
          dstPort: 443,
          srcMac: MAC,
          flags: { ack: true, fin: true },
        }),
        buildTcp({
          srcIp: server,
          dstIp: WORKSTATION,
          srcPort: 443,
          dstPort: 40000 + i,
          flags: { ack: true, fin: true },
        }),
      );
      // DNS lookups for each.
      frames.push(buildDns({ srcIp: WORKSTATION, dstIp: '10.0.0.1', queryName: `host${i}.microsoft.com` }));
    }
    // Router ARP chatter, consistent throughout.
    for (let i = 0; i < 8; i += 1) {
      frames.push(buildArp({ senderIp: '10.0.0.1', senderMac: 'b0:b1:b2:b3:b4:b5' }));
    }
    // A broadcast DHCP frame, which the old rules also flagged.
    frames.push(
      buildUdp({ srcIp: '0.0.0.0', dstIp: '255.255.255.255', srcPort: 68, dstPort: 67, payload: 'dhcp' }),
    );

    const findings: Finding[] = [];
    frames.forEach((frame, index) => {
      findings.push(
        ...engine.inspect(decodePacket(frame, new Date(Date.parse('2026-07-26T12:00:00Z') + index * 50))),
      );
    });

    assert.deepEqual(
      // The key, not a rendering: this assertion exists to name what leaked when
      // it fails, and the key is the stable identifier that says which branch of
      // which detector fired.
      findings.map((f) => `${f.kind}: ${f.messageKey}`),
      [],
      'normal traffic must produce no findings',
    );
  });

  it('still catches an attack hidden in normal traffic', () => {
    const engine = new detect.DetectionEngine({ knownDevices: ['38:f7:cd:c4:a0:6f'] });
    const frames: Buffer[] = [];

    // Background browsing.
    for (let i = 0; i < 20; i += 1) {
      frames.push(
        buildTcp({
          srcIp: '10.0.0.89',
          dstIp: `20.189.173.${i}`,
          dstPort: 443,
          srcMac: '38:f7:cd:c4:a0:6f',
          flags: { syn: true },
        }),
      );
    }
    // A scanner sweeping SMB across the subnet.
    for (let i = 0; i < 30; i += 1) {
      frames.push(
        buildTcp({
          srcIp: '10.0.0.66',
          dstIp: `10.0.0.${100 + i}`,
          dstPort: 445,
          srcMac: 'de:ad:be:ef:00:99',
          flags: { syn: true },
        }),
      );
    }

    const findings: Finding[] = [];
    frames.forEach((frame, index) => {
      findings.push(...engine.inspect(decodePacket(frame, new Date(1_700_000_000_000 + index * 20))));
    });

    assert.ok(kinds(findings).includes('host_sweep'), 'the sweep must still be found');
    // Everything reported must implicate the scanner, not the workstation.
    for (const finding of findings.filter((f) => f.kind === 'host_sweep' || f.kind === 'port_scan')) {
      assert.equal(finding.sourceIp, '10.0.0.66');
    }
  });
});

/**
 * A base32 label of the kind a real DNS tunnel emits — iodine and dnscat2 encode
 * their payload this way. Derived from a hash so it is deterministic, but with
 * the character distribution of encoded data rather than of a word.
 */
function encodedLabel(length: number, seed: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let value = '';
  let counter = 0;
  while (value.length < length) {
    const digest = createHash('sha256').update(`${seed}:${counter}`).digest();
    counter += 1;
    for (const byte of digest) value += alphabet[byte % alphabet.length];
  }
  return value.slice(0, length);
}
