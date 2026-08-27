import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Finding, Severity } from '../packet/detect/types.js';
import type { DeliveryResult, Notification, NotificationChannel } from './types.js';

/**
 * Notification tests.
 *
 * The sending is the trivial part. What is worth testing is everything that decides
 * *not* to send: the severity gate, the per-finding throttle, the hourly ceiling and
 * the digest batching. Those are what stop the channel being muted, and a bug in any
 * of them is silent — you find out when someone says they got four hundred emails,
 * or when they got none.
 *
 * Also asserted: that a password never reaches a message. The detectors guarantee
 * evidence is secret-free and their own suite proves it, but notifications send that
 * evidence off the machine, so the guarantee is re-checked at the boundary.
 */

let notify: typeof import('./notifier.js');
let format: typeof import('./format.js');
let webhook: typeof import('./webhook.js');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  // Config is read at construction, so pin it before importing.
  process.env.NOTIFY_ENABLED = 'true';
  process.env.NOTIFY_MIN_SEVERITY = 'high';
  process.env.NOTIFY_DIGEST_SECONDS = '60';
  process.env.NOTIFY_THROTTLE_SECONDS = '900';
  process.env.NOTIFY_MAX_PER_HOUR = '3';
  process.env.NOTIFY_INCLUDE_EVIDENCE = 'true';
  process.env.NOTIFY_DASHBOARD_URL = 'https://nmt.example.test/alerts';

  notify = await import('./notifier.js');
  format = await import('./format.js');
  webhook = await import('./webhook.js');
});

const AT = new Date('2026-07-27T10:00:00Z');

/**
 * An export channel: wants every finding, ungated.
 *
 * Records what it was handed so the tests below can assert on the one property
 * that distinguishes this class of channel from a chat webhook.
 */
class RecordingExporter implements NotificationChannel {
  readonly name = 'recording-exporter';
  readonly deliversEveryFinding = true;
  readonly received: Notification[] = [];

  isConfigured(): boolean {
    return true;
  }

  async send(notification: Notification): Promise<DeliveryResult> {
    this.received.push(notification);
    return { channel: this.name, ok: true, detail: 'recorded' };
  }
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    kind: 'port_scan',
    severity: 'high',
    title: 'Port scan: 10.0.0.66 probed 22 ports on 10.0.0.89',
    description: 'A single source attempted connections to many ports.',
    dedupKey: 'port_scan|10.0.0.66|10.0.0.89',
    sourceIp: '10.0.0.66',
    targetIp: '10.0.0.89',
    protocol: 'TCP',
    evidence: { scanner: '10.0.0.66', distinctPortsProbed: 22 },
    timestamp: AT,
    ...overrides,
  };
}

/** Records what it was asked to send, without any network. */
class RecordingChannel implements NotificationChannel {
  readonly name = 'recording';
  readonly sent: Notification[] = [];
  constructor(private readonly ok = true) {}
  isConfigured(): boolean {
    return true;
  }
  async send(notification: Notification): Promise<DeliveryResult> {
    this.sent.push(notification);
    return { channel: this.name, ok: this.ok, detail: 'recorded' };
  }
}

class ThrowingChannel implements NotificationChannel {
  readonly name = 'throwing';
  isConfigured(): boolean {
    return true;
  }
  async send(): Promise<DeliveryResult> {
    throw new Error('channel exploded');
  }
}

describe('severity gating', () => {
  it('queues a finding at the threshold', () => {
    const notifier = new notify.Notifier([new RecordingChannel()]);
    assert.equal(notifier.consider(finding({ severity: 'high' }), 1, AT, AT), 'queued');
  });

  it('queues a finding above the threshold', () => {
    const notifier = new notify.Notifier([new RecordingChannel()]);
    assert.equal(notifier.consider(finding({ severity: 'critical' }), 1, AT, AT), 'queued');
  });

  it('drops anything below it, which is what keeps the channel usable', () => {
    const notifier = new notify.Notifier([new RecordingChannel()]);
    for (const severity of ['medium', 'low', 'info'] as Severity[]) {
      assert.equal(
        notifier.consider(finding({ severity, dedupKey: `k-${severity}` }), 1, AT, AT),
        'below-threshold',
      );
    }
  });

  it('reports disabled when no channel is configured', () => {
    const notifier = new notify.Notifier([]);
    assert.equal(notifier.active, false);
    assert.equal(notifier.consider(finding(), 1, AT, AT), 'disabled');
  });
});

describe('throttling', () => {
  it('will not re-notify the same finding inside the window', () => {
    const notifier = new notify.Notifier([new RecordingChannel()]);
    const now = AT.getTime();

    assert.equal(notifier.consider(finding(), 1, AT, AT, now), 'queued');
    assert.equal(notifier.consider(finding(), 2, AT, AT, now + 1000), 'throttled');
    assert.equal(notifier.consider(finding(), 3, AT, AT, now + 899_000), 'throttled');
  });

  it('notifies again once the window has passed', () => {
    const notifier = new notify.Notifier([new RecordingChannel()]);
    const now = AT.getTime();

    assert.equal(notifier.consider(finding(), 1, AT, AT, now), 'queued');
    assert.equal(notifier.consider(finding(), 1, AT, AT, now + 901_000), 'queued');
  });

  it('throttles per finding, not globally', () => {
    // A port scan and a credential leak are different events; one must not
    // suppress the other.
    const notifier = new notify.Notifier([new RecordingChannel()]);
    const now = AT.getTime();

    assert.equal(notifier.consider(finding({ dedupKey: 'a' }), 1, AT, AT, now), 'queued');
    assert.equal(notifier.consider(finding({ dedupKey: 'b' }), 1, AT, AT, now + 1), 'queued');
  });
});

describe('hourly ceiling', () => {
  /**
   * A notifier whose clock the test drives. The ceiling counts *sends*, and a send
   * happens on flush, so the fake clock has to be shared by both — which is the
   * bug this originally caught: `consider` took an instant while `dispatch` read
   * the real clock, so the two limits measured different hours.
   */
  function clockedNotifier(channel: NotificationChannel) {
    let current = AT.getTime();
    const notifier = new notify.Notifier([channel], () => current);
    return { notifier, advance: (ms: number) => (current += ms) };
  }

  it('stops sending once the limit is reached', async () => {
    // NOTIFY_MAX_PER_HOUR is 3 in this suite.
    const channel = new RecordingChannel();
    const { notifier, advance } = clockedNotifier(channel);

    for (let index = 0; index < 3; index += 1) {
      assert.equal(notifier.consider(finding({ dedupKey: `k${index}` }), 1, AT, AT), 'queued');
      await notifier.flush();
      advance(1000);
    }

    assert.equal(channel.sent.length, 3);
    assert.equal(notifier.consider(finding({ dedupKey: 'k-over' }), 1, AT, AT), 'rate-limited');
  });

  it('allows sending again once the hour rolls over', async () => {
    const channel = new RecordingChannel();
    const { notifier, advance } = clockedNotifier(channel);

    for (let index = 0; index < 3; index += 1) {
      notifier.consider(finding({ dedupKey: `k${index}` }), 1, AT, AT);
      await notifier.flush();
    }
    assert.equal(notifier.consider(finding({ dedupKey: 'x' }), 1, AT, AT), 'rate-limited');

    // Rolling hour, not a fixed bucket.
    advance(3_600_001);
    assert.equal(notifier.consider(finding({ dedupKey: 'y' }), 1, AT, AT), 'queued');
  });
});

describe('digest batching', () => {
  it('sends one message for a burst rather than one per finding', async () => {
    const channel = new RecordingChannel();
    const notifier = new notify.Notifier([channel]);
    const now = AT.getTime();

    for (let index = 0; index < 5; index += 1) {
      notifier.consider(finding({ dedupKey: `burst-${index}` }), 1, AT, AT, now + index);
    }
    await notifier.flush();

    assert.equal(channel.sent.length, 1, 'a burst must collapse into one message');
    assert.equal(channel.sent[0]?.findings.length, 5);
  });

  it('leads with the most urgent finding, so truncation keeps what matters', async () => {
    const channel = new RecordingChannel();
    const notifier = new notify.Notifier([channel]);
    const now = AT.getTime();

    notifier.consider(finding({ dedupKey: 'h', severity: 'high', title: 'high one' }), 1, AT, AT, now);
    notifier.consider(
      finding({ dedupKey: 'c', severity: 'critical', title: 'critical one' }),
      1,
      AT,
      AT,
      now + 1,
    );
    await notifier.flush();

    const sent = channel.sent[0];
    assert.equal(sent?.severity, 'critical');
    assert.equal(sent?.findings[0]?.title, 'critical one');
  });

  it('counts what it truncated instead of dropping it silently', async () => {
    const channel = new RecordingChannel();
    const notifier = new notify.Notifier([channel]);
    const now = AT.getTime();

    for (let index = 0; index < 12; index += 1) {
      notifier.consider(finding({ dedupKey: `many-${index}` }), 1, AT, AT, now + index);
    }
    await notifier.flush();

    const sent = channel.sent[0];
    assert.equal(sent?.findings.length, format.MAX_LISTED_FINDINGS);
    assert.equal(sent?.omittedCount, 12 - format.MAX_LISTED_FINDINGS);
  });

  it('sends nothing when nothing was queued', async () => {
    const channel = new RecordingChannel();
    const notifier = new notify.Notifier([channel]);
    await notifier.flush();
    assert.equal(channel.sent.length, 0);
  });
});

describe('resilience', () => {
  it('a channel that throws does not stop the others', async () => {
    const good = new RecordingChannel();
    const notifier = new notify.Notifier([new ThrowingChannel(), good]);

    notifier.consider(finding(), 1, AT, AT);
    await notifier.flush();

    assert.equal(good.sent.length, 1, 'the working channel must still receive it');
  });

  it('a failing channel does not throw out of flush', async () => {
    const notifier = new notify.Notifier([new RecordingChannel(false)]);
    notifier.consider(finding(), 1, AT, AT);
    await assert.doesNotReject(() => notifier.flush());
  });
});

describe('evidence policy', () => {
  it('includes evidence when configured to', async () => {
    const channel = new RecordingChannel();
    const notifier = new notify.Notifier([channel]);
    notifier.consider(finding(), 1, AT, AT);
    await notifier.flush();

    assert.deepEqual(channel.sent[0]?.findings[0]?.evidence, {
      scanner: '10.0.0.66',
      distinctPortsProbed: 22,
    });
  });

  it('never puts a password in a message, in any format', () => {
    // Detectors are built never to place a secret in evidence, and their own suite
    // asserts it. This re-checks at the boundary where data leaves the machine.
    const secret = 'sup3rs3cret-passw0rd';
    const notification: Notification = {
      severity: 'critical',
      findings: [
        {
          kind: 'plaintext_credentials',
          severity: 'critical',
          title: 'Cleartext HTTP credentials for "alice" to 10.0.0.50',
          description: 'An HTTP Basic Authorization header was captured in the clear.',
          sourceIp: '10.0.0.89',
          targetIp: '10.0.0.50',
          occurrences: 3,
          firstSeen: AT,
          lastSeen: AT,
          evidence: { username: 'alice', passwordLength: secret.length, passwordRecorded: false },
        },
      ],
      omittedCount: 0,
      countsBySeverity: { critical: 1 },
      generatedAt: AT,
      dashboardUrl: null,
      isTest: false,
    };

    const rendered = [
      format.renderText(notification),
      format.renderHtml(notification),
      JSON.stringify(format.renderSlack(notification)),
      JSON.stringify(format.renderTeams(notification)),
      JSON.stringify(format.renderDiscord(notification)),
      JSON.stringify(format.renderGeneric(notification)),
    ];

    for (const output of rendered) {
      assert.ok(!output.includes(secret), 'a password must never appear in a notification');
      assert.ok(!output.includes(Buffer.from(`alice:${secret}`).toString('base64')), 'nor its base64 form');
      // The username and the length are fine, and useful.
      assert.ok(output.includes('alice'));
    }
  });
});

describe('message formats', () => {
  const notification: Notification = {
    severity: 'critical',
    findings: [
      {
        kind: 'arp_spoofing',
        severity: 'critical',
        title: 'ARP spoofing: 10.0.0.1 claimed by a new MAC',
        description: 'A settled address is now being claimed by a different device.',
        sourceIp: '10.0.0.66',
        targetIp: '10.0.0.1',
        occurrences: 4,
        firstSeen: AT,
        lastSeen: AT,
        evidence: { previousMac: 'aa:bb:cc:dd:ee:ff' },
      },
    ],
    omittedCount: 2,
    countsBySeverity: { critical: 1 },
    generatedAt: AT,
    dashboardUrl: 'https://nmt.example.test/alerts',
    isTest: false,
  };

  it('summarises the count when more than one finding is involved', () => {
    // 1 listed plus 2 omitted is 3 findings, so the subject counts rather than
    // naming one — naming the first would misrepresent the other two.
    const subject = format.subjectFor(notification);
    assert.match(subject, /CRITICAL/);
    assert.match(subject, /3 network findings/);
  });

  it('names the finding when there is only one', () => {
    const single = { ...notification, omittedCount: 0 };
    assert.match(format.subjectFor(single), /ARP spoofing/);
  });

  it('sets Slack `text` as well as blocks, or the push arrives empty', () => {
    const payload = format.renderSlack(notification) as { text?: string; blocks?: unknown[] };
    assert.ok(payload.text, 'Slack shows `text` in the notification popup');
    assert.ok(Array.isArray(payload.blocks) && payload.blocks.length > 0);
  });

  it('renders Teams as an Adaptive Card in the Workflows envelope', () => {
    // This test previously pinned the MessageCard shape, which is exactly how the
    // retired format survived: the assertion agreed with the code and both were
    // wrong. Office 365 connectors are gone; a Power Automate Workflows webhook
    // expects an Adaptive Card wrapped in `attachments`.
    const payload = format.renderTeams(notification) as {
      type?: string;
      attachments?: { contentType?: string; content?: Record<string, unknown> }[];
    };

    assert.equal(payload.type, 'message');
    assert.equal(payload.attachments?.length, 1);

    const attachment = payload.attachments?.[0];
    assert.equal(attachment?.contentType, 'application/vnd.microsoft.card.adaptive');
    assert.equal(attachment?.content?.type, 'AdaptiveCard');
    // 1.4 is supported across every Teams client; a version Teams does not know
    // renders as a blank card rather than an error.
    assert.equal(attachment?.content?.version, '1.4');
    assert.ok(Array.isArray(attachment?.content?.body) && attachment.content.body.length > 0);
  });

  it('puts the severity in the text, not only in the container style', () => {
    // Adaptive Cards take one of six named container styles, not a hex colour, so
    // SEVERITY_COLOR cannot express five severities here. The word has to carry it.
    const payload = JSON.stringify(format.renderTeams(notification));
    assert.match(payload, /CRITICAL/);
    assert.match(payload, /"style":"attention"/);
  });

  it('labels Teams facts with `title`, which is what an Adaptive Card reads', () => {
    // The MessageCard key was `name`. A FactSet given `name` renders every fact
    // blank instead of failing, so a test send looks like it worked.
    const payload = format.renderTeams(notification) as {
      attachments: {
        content: { body: { type: string; items?: { type: string; facts?: unknown[] }[] }[] };
      }[];
    };
    const factSets = payload.attachments[0]!.content.body.flatMap((block) => block.items ?? []).filter(
      (item) => item.type === 'FactSet',
    );

    assert.ok(factSets.length > 0, 'no FactSet in the card');
    for (const factSet of factSets) {
      for (const fact of (factSet.facts ?? []) as Record<string, unknown>[]) {
        assert.ok(fact.title, 'a fact without `title` renders blank in Teams');
        assert.equal(fact.name, undefined, '`name` is the retired MessageCard key');
      }
    }
  });

  it('escapes markdown in the Teams card, because evidence carries feed text', () => {
    // The untrusted field: intel/parse.ts takes the remainder of a feed line
    // verbatim, caps it at 200 characters and restricts no character, and the
    // detectors put it in evidence as `feedNote`. NOTIFY_INCLUDE_EVIDENCE is on by
    // default, so without escaping a feed line could put a rendered link in a Teams
    // channel attributed to this tool. Slack and email have escapers; Teams did not.
    const hostile: Notification = {
      ...notification,
      findings: [
        {
          ...notification.findings[0]!,
          title: 'Indicator match [click here](http://attacker.test)',
          description: 'note says **urgent** _now_',
          evidence: { feedNote: '[click here](http://attacker.test)' },
        },
      ],
    };

    const payload = JSON.stringify(format.renderTeams(hostile));

    // No unescaped link syntax survives anywhere in the card.
    assert.ok(!/[^\\]\[click here\]/.test(payload), 'an unescaped markdown link reached the card');
    assert.ok(!/[^\\]\*\*urgent\*\*/.test(payload), 'unescaped bold reached the card');
    // And the text is still there, just inert.
    assert.match(payload, /click here/);
  });

  it('leaves the tool’s own prose alone, hyphens included', () => {
    // The other half of escaping, and the half the previous version of this test
    // missed: it checked the summary line for an escaped capital letter, which
    // passes whether or not the finding titles below it are full of backslashes.
    //
    // This is not hypothetical. All three threat-intelligence titles in
    // intel/assess.ts read "known-malicious address …", so escaping `-` put a
    // backslash into every intel alert the tool raises. Escaping too little is a
    // formatting injection; escaping too much is visible noise on every message, in
    // a channel people are being asked to trust.
    const intel: Notification = {
      ...notification,
      findings: [
        {
          ...notification.findings[0]!,
          title: 'Outbound connection to known-malicious address 203.0.113.7',
          description: 'A host contacted an address on a threat feed (feodo). See #1 below.',
          evidence: { mac: 'aa-bb-cc-dd-ee-ff', port: 445 },
        },
      ],
    };

    const payload = JSON.stringify(format.renderTeams(intel));

    // Each of these would carry a backslash under the over-broad set.
    assert.match(payload, /known-malicious address 203\.0\.113\.7/);
    assert.match(payload, /aa-bb-cc-dd-ee-ff/);
    assert.match(payload, /See #1 below/);
    assert.ok(!payload.includes('\\\\-'), 'a hyphen was escaped');
    assert.ok(!payload.includes('\\\\#'), 'a hash was escaped');
  });

  it('escapes the connector card too, so the two renderers cannot drift', () => {
    // Nothing the MessageCard currently carries needs escaping — four facts, all
    // charset-restricted or generated here, and no Evidence. But detectFormat now
    // routes every *.webhook.office.com URL to it, so it is a default path rather
    // than a museum piece, and two renderers for one product with different escaping
    // is a gap that opens the moment either gains a field.
    const hostile: Notification = {
      ...notification,
      findings: [
        {
          ...notification.findings[0]!,
          title: 'Indicator match [click here](http://attacker.test)',
          description: 'note says **urgent**',
        },
      ],
    };

    const payload = JSON.stringify(format.renderTeamsConnector(hostile));
    assert.ok(!/[^\\]\[click here\]/.test(payload), 'an unescaped markdown link reached the card');
    // The bold in activityTitle is ours and deliberate, so it survives; the bold
    // inside the finding's own text does not.
    assert.ok(!payload.includes('says **urgent**'), 'unescaped bold reached the card');
    assert.match(payload, /\*\*CRITICAL\*\*/);
  });

  it('links the dashboard as an Action.OpenUrl', () => {
    const payload = format.renderTeams(notification) as {
      attachments: { content: { actions?: { type: string; url: string }[] } }[];
    };
    const actions = payload.attachments[0]!.content.actions ?? [];
    assert.equal(actions[0]?.type, 'Action.OpenUrl');
    assert.equal(actions[0]?.url, 'https://nmt.example.test/alerts');
  });

  it('keeps the retired MessageCard reachable, but only on request', () => {
    // An installation with a connector webhook still provisioned goes on working
    // until Microsoft switches it off. Breaking that on upgrade would be worse than
    // carrying the function — but it must never be what a URL infers.
    const payload = format.renderTeamsConnector(notification) as Record<string, unknown>;
    assert.equal(payload['@type'], 'MessageCard');
    assert.equal(payload['@context'], 'https://schema.org/extensions');
    assert.ok(payload.summary, 'Teams rejects a card with no summary');
  });

  it('keeps Discord embeds within the API limit', () => {
    const many: Notification = {
      ...notification,
      findings: Array.from({ length: 20 }, () => notification.findings[0]!),
    };
    const payload = format.renderDiscord(many) as { embeds: unknown[] };
    assert.ok(payload.embeds.length <= 10);
  });

  it('mentions how many were omitted rather than hiding them', () => {
    assert.match(format.renderText(notification), /and 2 more/);
  });

  it('links the dashboard when one is configured', () => {
    assert.ok(format.renderText(notification).includes('https://nmt.example.test/alerts'));
  });

  it('marks a test message clearly, so nobody is alarmed by it', async () => {
    const channel = new RecordingChannel();
    const notifier = new notify.Notifier([channel]);
    await notifier.sendTest();

    const sent = channel.sent[0];
    assert.ok(sent);
    assert.equal(sent.isTest, true);
    assert.match(format.subjectFor(sent), /^\[TEST\]/);
    assert.match(format.renderText(sent), /test notification/i);
  });
});

describe('webhook transport', () => {
  /** Enough of a notification to render any format. Shared by the payload tests. */
  const MINIMAL_NOTIFICATION: Notification = {
    severity: 'high',
    findings: [
      {
        kind: 'port_scan',
        severity: 'high',
        title: 'Port scan',
        description: 'many ports on one host',
        sourceIp: '10.0.0.66',
        targetIp: '10.0.0.89',
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

  it('infers the payload format from the URL', () => {
    assert.equal(webhook.detectFormat('https://hooks.slack.com/services/T000/B000/xxx'), 'slack');
    assert.equal(webhook.detectFormat('https://acme.webhook.office.com/webhookb2/abc'), 'teams-connector');
    assert.equal(webhook.detectFormat('https://discord.com/api/webhooks/1/xyz'), 'discord');
    assert.equal(webhook.detectFormat('https://internal.example.test/hooks/nmt'), 'generic');
    // A malformed URL must not throw during construction.
    assert.equal(webhook.detectFormat('not a url'), 'generic');
  });

  it('recognises a Power Automate Workflows URL as Teams', () => {
    // The failure this fixes: Microsoft retired Office 365 connectors, the supported
    // replacement lives on *.logic.azure.com, and that host fell through to
    // `generic` — so an admin following Microsoft's current documentation had plain
    // JSON posted to an endpoint expecting an Adaptive Card.
    assert.equal(
      webhook.detectFormat(
        'https://prod-27.westeurope.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01',
      ),
      'teams',
    );
    // The retired host resolves too, but to the format it accepts — see below.
  });

  it('does not match a host that merely ends with a known domain', () => {
    // `endsWith('slack.com')` also matches `evilslack.com`, and `includes('office365')`
    // matches `notoffice365.example.com`. Not a security boundary — this only picks a
    // payload shape — but a check that means what it says costs nothing.
    assert.equal(webhook.detectFormat('https://evilslack.com/hook'), 'generic');
    assert.equal(webhook.detectFormat('https://notoffice365.example.test/hook'), 'generic');
    assert.equal(webhook.detectFormat('https://mydiscord.com/hook'), 'generic');
  });

  it('routes each Teams host to the payload it can actually accept', () => {
    // Not one Teams format but two products. A *.webhook.office.com URL is
    // definitionally an Office 365 connector — Microsoft retired connectors, so no
    // new one can be created — and it accepts a MessageCard, not an Adaptive Card.
    // Mapping it to `teams` would have swapped a working payload for a rejected one
    // on every installation still running a provisioned connector, which is exactly
    // the population renderTeamsConnector was kept for.
    assert.equal(
      webhook.detectFormat(
        'https://prod-27.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke',
      ),
      'teams',
    );
    assert.equal(webhook.detectFormat('https://acme.webhook.office.com/webhookb2/abc'), 'teams-connector');
  });

  it('sends a connector URL a MessageCard end to end under `auto`', () => {
    // The finding was about `auto` specifically, so this asserts the whole path
    // rather than detectFormat alone: URL in, payload out.
    const connectorUrl = 'https://acme.webhook.office.com/webhookb2/abc';
    const workflowsUrl =
      'https://prod-1.northeurope.logic.azure.com/workflows/x/triggers/manual/paths/invoke';

    const forConnector = webhook.buildPayload(
      MINIMAL_NOTIFICATION,
      webhook.detectFormat(connectorUrl),
    ) as Record<string, unknown>;
    assert.equal(forConnector['@type'], 'MessageCard');

    const forWorkflows = webhook.buildPayload(
      MINIMAL_NOTIFICATION,
      webhook.detectFormat(workflowsUrl),
    ) as Record<string, unknown>;
    assert.equal(forWorkflows.type, 'message');
  });

  it('sends the connector format only when it is asked for by name', () => {
    // teams-connector is never inferred: no URL maps to it, so no new installation
    // is quietly pointed at a format Microsoft has retired.
    const inferred = webhook.buildPayload(MINIMAL_NOTIFICATION, 'teams') as Record<string, unknown>;
    assert.equal(inferred.type, 'message', 'a Teams URL must produce an Adaptive Card');

    const requested = webhook.buildPayload(MINIMAL_NOTIFICATION, 'teams-connector') as Record<
      string,
      unknown
    >;
    assert.equal(requested['@type'], 'MessageCard');
  });

  it('posts JSON and reports success', async () => {
    // An array rather than a nullable local: TypeScript does not track assignments
    // made inside a callback, so a `let … | null` narrows to `never` after the
    // assertion and the property read fails to compile.
    const posted: Array<{ url: string; body: string }> = [];
    const channel = new webhook.WebhookChannel({
      url: 'https://internal.example.test/hooks/nmt',
      format: 'auto',
      sleepImpl: async () => {},
      fetchImpl: async (url, init) => {
        posted.push({ url: String(url), body: String(init?.body) });
        return new Response('ok', { status: 200 });
      },
    });

    const result = await channel.send(await onlyNotification());
    assert.equal(result.ok, true);
    assert.equal(posted.length, 1);
    assert.match(posted[0]?.body ?? '', /"severity"/);
  });

  it('does not retry a 4xx, because the same payload would be rejected again', async () => {
    let calls = 0;
    const channel = new webhook.WebhookChannel({
      url: 'https://internal.example.test/hooks/nmt',
      format: 'generic',
      sleepImpl: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return new Response('bad payload', { status: 400 });
      },
    });

    const result = await channel.send(await onlyNotification());
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  });

  it('retries a 5xx and then succeeds', async () => {
    let calls = 0;
    const channel = new webhook.WebhookChannel({
      url: 'https://internal.example.test/hooks/nmt',
      format: 'generic',
      sleepImpl: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? new Response('oops', { status: 503 }) : new Response('ok', { status: 200 });
      },
    });

    const result = await channel.send(await onlyNotification());
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  });

  it('returns a failure rather than throwing when the network is down', async () => {
    const channel = new webhook.WebhookChannel({
      url: 'https://internal.example.test/hooks/nmt',
      format: 'generic',
      sleepImpl: async () => {},
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    const result = await channel.send(await onlyNotification());
    assert.equal(result.ok, false);
    assert.match(result.detail, /ECONNREFUSED/);
  });
});

/** A minimal notification, for transport tests. */
async function onlyNotification(): Promise<Notification> {
  return {
    severity: 'high',
    findings: [
      {
        kind: 'port_scan',
        severity: 'high',
        title: 'Port scan',
        description: 'Many ports probed.',
        sourceIp: '10.0.0.66',
        targetIp: '10.0.0.89',
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
}

describe('export channels are never gated', () => {
  /*
   * The rule that makes syslog a separate class of channel.
   *
   * A SIEM correlates and deduplicates itself, on the assumption that it holds
   * the complete event stream. Applying the human gates to it — the severity
   * threshold, the per-finding throttle, the hourly ceiling — makes every rule
   * that counts events over a window silently under-report, and turns suppressed
   * events into what look like quiet periods.
   *
   * Not covered here: NOTIFY_ENABLED=false. `active` is derived from the env,
   * which this file pins once in `before()`, so the disabled path needs its own
   * module fixture. The export call sits above that check in `consider()`.
   */

  it('exports a finding below the notification threshold', async () => {
    // NOTIFY_MIN_SEVERITY is `high`, so this one never reaches a chat channel.
    const exporter = new RecordingExporter();
    const notifier = new notify.Notifier([exporter]);

    assert.equal(notifier.consider(finding({ severity: 'medium' }), 1, AT, AT), 'below-threshold');

    // `flush()` drains the export queue as well as the digest — exports are
    // coalesced on a short timer so they share a socket, not sent one per call.
    await notifier.flush();
    assert.equal(exporter.received.length, 1);
    assert.equal(exporter.received[0]?.findings[0]?.severity, 'medium');
  });

  it('exports a repeat that the throttle would suppress', async () => {
    const exporter = new RecordingExporter();
    const notifier = new notify.Notifier([exporter]);
    const now = Date.now();

    assert.equal(notifier.consider(finding(), 1, AT, AT, now), 'queued');
    assert.equal(notifier.consider(finding(), 2, AT, AT, now + 1000), 'throttled');

    await notifier.flush();
    // Two considered, two exported — the throttle applies to the inbox only.
    const exported = exporter.received.flatMap((batch) => batch.findings);
    assert.equal(exported.length, 2);
    assert.equal(exported[1]?.occurrences, 2);
  });

  it('does not also deliver the digest to an export channel', async () => {
    /*
     * Found by the coalescing change, and it predates it: an export channel is
     * in `this.channels`, so the digest dispatch was sending it every finding a
     * SECOND time — once ungated as its own event, once inside the summary.
     * Every SIEM rule counting occurrences would have doubled.
     */
    const exporter = new RecordingExporter();
    const notifier = new notify.Notifier([exporter]);

    // `high` clears the threshold, so this one is queued for the digest too.
    assert.equal(notifier.consider(finding({ severity: 'high' }), 1, AT, AT), 'queued');
    await notifier.flush();

    const delivered = exporter.received.flatMap((batch) => batch.findings);
    assert.equal(delivered.length, 1, 'the finding reached the exporter twice');
  });

  it('coalesces findings into one send without summarising them', async () => {
    /*
     * The distinction that matters, and it is not the digest.
     *
     * Nothing is summarised, dropped or deduplicated: both findings are carried
     * whole, each becoming its own syslog line with its own timestamp. What the
     * coalescing window decides is only how many share a socket — because one
     * send per finding meant one TCP connection, or one fresh dgram socket, per
     * finding, with nothing bounding how many were in flight during a burst.
     */
    const exporter = new RecordingExporter();
    const notifier = new notify.Notifier([exporter]);

    notifier.consider(finding({ dedupKey: 'a' }), 1, AT, AT);
    notifier.consider(finding({ dedupKey: 'b', kind: 'host_sweep' }), 1, AT, AT);

    await notifier.flush();

    assert.equal(exporter.received.length, 1, 'expected one send, not one per finding');
    assert.equal(exporter.received[0]?.findings.length, 2);
    assert.deepEqual(
      exporter.received[0]?.findings.map((entry) => entry.kind),
      ['port_scan', 'host_sweep'],
    );
  });
});
