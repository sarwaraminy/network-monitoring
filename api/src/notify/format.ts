import type { Severity } from '../packet/detect/types.js';
import { type Notification, SEVERITY_COLOR } from './types.js';

/**
 * Message rendering.
 *
 * One summary line, then the findings, then a link. Deliberately terse: the point
 * of a notification is to make someone decide whether to open the dashboard, not
 * to reproduce it. A long message gets skimmed and then filtered.
 *
 * The evidence block is rendered only when it is present — `notifier.ts` strips it
 * upstream when NOTIFY_INCLUDE_EVIDENCE is off, so nothing here has to remember
 * the policy.
 */

/** Findings listed in full before the message is truncated. */
export const MAX_LISTED_FINDINGS = 8;

export function subjectFor(notification: Notification): string {
  const prefix = notification.isTest ? '[TEST] ' : '';
  const total = notification.findings.length + notification.omittedCount;

  if (total === 1) {
    const only = notification.findings[0];
    return `${prefix}[${notification.severity.toUpperCase()}] ${only?.title ?? 'Network finding'}`;
  }

  const parts = Object.entries(notification.countsBySeverity)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([severity, count]) => `${count} ${severity}`);

  return `${prefix}[${notification.severity.toUpperCase()}] ${total} network findings — ${parts.join(', ')}`;
}

/** Plain text, used for email bodies and as the fallback for chat services. */
export function renderText(notification: Notification): string {
  const lines: string[] = [];

  if (notification.isTest) {
    lines.push('This is a test notification from Network Monitoring. No findings are involved.', '');
  }

  lines.push(summaryLine(notification), '');

  for (const finding of notification.findings) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
    lines.push(`  ${finding.description}`);

    const where = [
      finding.sourceIp ? `source ${finding.sourceIp}` : null,
      finding.targetIp ? `target ${finding.targetIp}` : null,
      finding.occurrences > 1 ? `${finding.occurrences} occurrences` : null,
      `last seen ${finding.lastSeen.toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`  ${where}`);

    if (finding.evidence) {
      lines.push(`  evidence: ${compactEvidence(finding.evidence)}`);
    }
    lines.push('');
  }

  if (notification.omittedCount > 0) {
    lines.push(`…and ${notification.omittedCount} more. Open the dashboard for the full list.`, '');
  }

  if (notification.dashboardUrl) lines.push(notification.dashboardUrl);

  return lines.join('\n');
}

/** Minimal HTML for email clients that prefer it. */
export function renderHtml(notification: Notification): string {
  const rows = notification.findings
    .map((finding) => {
      const meta = [
        finding.sourceIp ? `source ${escapeHtml(finding.sourceIp)}` : null,
        finding.targetIp ? `target ${escapeHtml(finding.targetIp)}` : null,
        finding.occurrences > 1 ? `${finding.occurrences} occurrences` : null,
      ]
        .filter(Boolean)
        .join(' &middot; ');

      return `<tr>
  <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
    <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;
      color:#fff;background:${SEVERITY_COLOR[finding.severity]}">${finding.severity.toUpperCase()}</span>
  </td>
  <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">
    <div style="font-weight:600;color:#111827">${escapeHtml(finding.title)}</div>
    <div style="color:#4b5563;font-size:13px;margin-top:2px">${escapeHtml(finding.description)}</div>
    ${meta ? `<div style="color:#6b7280;font-size:12px;margin-top:4px">${meta}</div>` : ''}
    ${
      finding.evidence
        ? `<div style="color:#6b7280;font-size:12px;margin-top:4px;font-family:Consolas,monospace">${escapeHtml(
            compactEvidence(finding.evidence),
          )}</div>`
        : ''
    }
  </td>
</tr>`;
    })
    .join('\n');

  const testBanner = notification.isTest
    ? '<p style="padding:10px 12px;background:#fef3c7;border-radius:8px;color:#92400e">' +
      'This is a test notification. No findings are involved.</p>'
    : '';

  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:720px">
${testBanner}
<p style="font-size:15px">${escapeHtml(summaryLine(notification))}</p>
<table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px">
${rows}
</table>
${
  notification.omittedCount > 0
    ? `<p style="color:#4b5563;font-size:13px">…and ${notification.omittedCount} more.</p>`
    : ''
}
${
  notification.dashboardUrl
    ? `<p><a href="${escapeHtml(notification.dashboardUrl)}"
        style="color:#1d4ed8">Open the dashboard</a></p>`
    : ''
}
</div>`;
}

/**
 * Slack incoming-webhook payload.
 *
 * `text` is set as well as `blocks` because it is what Slack shows in the
 * notification popup and in the mobile push — blocks alone arrive as a silent,
 * contentless alert.
 */
export function renderSlack(notification: Notification): unknown {
  const blocks: unknown[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${escapeSlack(summaryLine(notification))}*` },
    },
  ];

  for (const finding of notification.findings) {
    const meta = [
      finding.sourceIp ? `source \`${finding.sourceIp}\`` : null,
      finding.targetIp ? `target \`${finding.targetIp}\`` : null,
      finding.occurrences > 1 ? `${finding.occurrences} occurrences` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${finding.severity.toUpperCase()}* — ${escapeSlack(finding.title)}\n` +
          `${escapeSlack(finding.description)}${meta ? `\n${meta}` : ''}`,
      },
    });
  }

  if (notification.omittedCount > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `…and ${notification.omittedCount} more.` }],
    });
  }

  if (notification.dashboardUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open dashboard' },
          url: notification.dashboardUrl,
        },
      ],
    });
  }

  return { text: subjectFor(notification), blocks };
}

/**
 * Microsoft Teams, via a Power Automate Workflows webhook.
 *
 * Microsoft retired Office 365 connectors in Teams. The supported replacement is a
 * Workflows webhook, and it does not accept the MessageCard those connectors took —
 * it expects an **Adaptive Card**, wrapped in an `attachments` array under a
 * `type: "message"` envelope. Posting a MessageCard to one produces either a
 * rejection or an unreadable message, from the channel most customers configure
 * first and press "Send test" on before they trust anything else.
 *
 * Three things about this shape are load-bearing and easy to get subtly wrong:
 *
 *  - **`FactSet` facts use `title`, not `name`.** MessageCard used `name`. A card
 *    with `name` renders with every fact blank rather than failing, so the mistake
 *    survives a successful-looking test send.
 *  - **Colour is a fixed vocabulary, not a hex value.** `SEVERITY_COLOR` cannot be
 *    used here at all: a `Container` takes one of six named styles. So the severity
 *    word is always printed in the text, and the style is a coarse cue on top of it
 *    rather than the only signal — see `CONTAINER_STYLE`.
 *  - **Version 1.4.** Teams supports it everywhere; 1.5 and above are only partly
 *    supported, and an unsupported version renders as a blank card.
 */

/**
 * Severity to one of Adaptive Cards' six container styles.
 *
 * Five severities, six styles, and only three of the styles read as escalating, so
 * this deliberately collapses rather than inventing distinctions the vocabulary
 * cannot carry. `good` is avoided entirely: green next to a security finding reads
 * as "resolved", which is the opposite of true for a `low` one. The exact severity
 * is in the text of every block regardless.
 */
const CONTAINER_STYLE: Record<Severity, string> = {
  critical: 'attention',
  high: 'attention',
  medium: 'warning',
  low: 'emphasis',
  info: 'emphasis',
};

export function renderTeams(notification: Notification): unknown {
  const body: unknown[] = [];

  if (notification.isTest) {
    body.push({
      type: 'TextBlock',
      text: 'This is a test notification from Network Monitoring. No findings are involved.',
      wrap: true,
      isSubtle: true,
    });
  }

  body.push({
    type: 'TextBlock',
    text: escapeAdaptive(summaryLine(notification)),
    wrap: true,
    weight: 'Bolder',
    size: 'Medium',
  });

  for (const finding of notification.findings) {
    const facts = [
      ...(finding.sourceIp ? [{ title: 'Source', value: escapeAdaptive(finding.sourceIp) }] : []),
      ...(finding.targetIp ? [{ title: 'Target', value: escapeAdaptive(finding.targetIp) }] : []),
      { title: 'Occurrences', value: String(finding.occurrences) },
      { title: 'Last seen', value: finding.lastSeen.toISOString() },
      ...(finding.evidence
        ? [{ title: 'Evidence', value: escapeAdaptive(compactEvidence(finding.evidence)) }]
        : []),
    ];

    body.push({
      type: 'Container',
      style: CONTAINER_STYLE[finding.severity],
      // No `bleed`. An earlier version set it to keep the three items reading as one
      // block, which is not what it does — `bleed` extends an element through its
      // parent's padding to the card edge, and the items are already one unit by
      // being `items` of a single Container. Dropped rather than re-justified: the
      // edge-to-edge tint it actually produces is a visual claim this cannot verify.
      items: [
        {
          type: 'TextBlock',
          text: `${finding.severity.toUpperCase()} — ${escapeAdaptive(finding.title)}`,
          wrap: true,
          weight: 'Bolder',
        },
        { type: 'TextBlock', text: escapeAdaptive(finding.description), wrap: true, isSubtle: true },
        { type: 'FactSet', facts },
      ],
    });
  }

  if (notification.omittedCount > 0) {
    body.push({
      type: 'TextBlock',
      text: `…and ${notification.omittedCount} more. Open the dashboard for the full list.`,
      wrap: true,
      isSubtle: true,
    });
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        // Present and null in Microsoft's own samples. Omitting it is accepted, but
        // matching the documented shape costs nothing and removes a variable if a
        // tenant ever rejects the payload.
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(notification.dashboardUrl
            ? {
                actions: [
                  {
                    type: 'Action.OpenUrl',
                    title: 'Open dashboard',
                    url: notification.dashboardUrl,
                  },
                ],
              }
            : {}),
        },
      },
    ],
  };
}

/**
 * The retired Office 365 connector MessageCard.
 *
 * Kept because an installation with a connector webhook still provisioned will go on
 * working until Microsoft finally switches it off, and breaking that on upgrade would
 * be a worse outcome than carrying this function. `detectFormat` routes every
 * `*.webhook.office.com` URL here, because such a URL is definitionally a connector —
 * they can no longer be created — so this is a default path, not a museum piece.
 *
 * Which is why it escapes its interpolated values the same way `renderTeams` does,
 * even though nothing it currently carries needs it: its four facts are Source,
 * Target, Occurrences and Last seen, all charset-restricted or generated here, and it
 * has no Evidence fact, so the threat-feed note that motivated `escapeAdaptive` never
 * reaches it. Two renderers for one product, one escaping and one not, is a gap that
 * opens silently the moment either gains a field — and Evidence, for parity with the
 * Adaptive Card, is the obvious next one. Cheaper to make them agree than to leave a
 * warning for whoever adds it.
 *
 * `markdown: true` stays on each section: the `**bold**` in `activityTitle` is ours
 * and intentional, and only the interpolated values are escaped.
 */
export function renderTeamsConnector(notification: Notification): unknown {
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: SEVERITY_COLOR[notification.severity].replace('#', ''),
    summary: subjectFor(notification),
    title: subjectFor(notification),
    sections: notification.findings.map((finding) => ({
      activityTitle: `**${finding.severity.toUpperCase()}** — ${escapeAdaptive(finding.title)}`,
      activitySubtitle: escapeAdaptive(finding.description),
      facts: [
        ...(finding.sourceIp ? [{ name: 'Source', value: escapeAdaptive(finding.sourceIp) }] : []),
        ...(finding.targetIp ? [{ name: 'Target', value: escapeAdaptive(finding.targetIp) }] : []),
        { name: 'Occurrences', value: String(finding.occurrences) },
        { name: 'Last seen', value: finding.lastSeen.toISOString() },
      ],
      markdown: true,
    })),
    ...(notification.dashboardUrl
      ? {
          potentialAction: [
            {
              '@type': 'OpenUri',
              name: 'Open dashboard',
              targets: [{ os: 'default', uri: notification.dashboardUrl }],
            },
          ],
        }
      : {}),
  };
}

/** Discord webhook payload. Embeds are capped at 10 by the API. */
export function renderDiscord(notification: Notification): unknown {
  return {
    content: subjectFor(notification),
    embeds: notification.findings.slice(0, 10).map((finding) => ({
      title: finding.title.slice(0, 256),
      description: finding.description.slice(0, 2048),
      color: Number.parseInt(SEVERITY_COLOR[finding.severity].replace('#', ''), 16),
      fields: [
        ...(finding.sourceIp ? [{ name: 'Source', value: finding.sourceIp, inline: true }] : []),
        ...(finding.targetIp ? [{ name: 'Target', value: finding.targetIp, inline: true }] : []),
      ],
      timestamp: finding.lastSeen.toISOString(),
    })),
  };
}

/** Generic JSON, for anything that is not a known chat service. */
export function renderGeneric(notification: Notification): unknown {
  return {
    subject: subjectFor(notification),
    severity: notification.severity,
    generatedAt: notification.generatedAt.toISOString(),
    isTest: notification.isTest,
    countsBySeverity: notification.countsBySeverity,
    omittedCount: notification.omittedCount,
    dashboardUrl: notification.dashboardUrl,
    findings: notification.findings.map((finding) => ({
      ...finding,
      firstSeen: finding.firstSeen.toISOString(),
      lastSeen: finding.lastSeen.toISOString(),
    })),
  };
}

function summaryLine(notification: Notification): string {
  const total = notification.findings.length + notification.omittedCount;
  if (total === 1) {
    return `Network Monitoring raised 1 ${notification.severity} finding.`;
  }
  const parts = Object.entries(notification.countsBySeverity)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([severity, count]) => `${count} ${severity}`);
  return `Network Monitoring raised ${total} findings: ${parts.join(', ')}.`;
}

/**
 * Evidence as one short line.
 *
 * Truncated hard. Evidence is guaranteed free of passwords and payloads by the
 * detectors, but it can still be long — a scan's sample port list runs to forty
 * numbers — and a notification is not the place to read it.
 */
function compactEvidence(evidence: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(evidence)) {
    if (value === null || value === undefined) continue;
    const rendered = Array.isArray(value)
      ? `[${value.slice(0, 6).join(', ')}${value.length > 6 ? ', …' : ''}]`
      : String(value);
    parts.push(`${key}=${rendered}`);
    if (parts.length >= 6) break;
  }
  return parts.join(' ').slice(0, 300);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Escapes the markdown an Adaptive Card renders.
 *
 * The counterpart to `escapeSlack` and `escapeHtml`, and until now Teams had no
 * equivalent — a gap that only became load-bearing when the Adaptive Card started
 * carrying an Evidence fact. `TextBlock` renders a markdown subset and `FactSet`
 * values render a narrower one, so text arriving from outside this codebase can
 * inject formatting, and the one field that does arrive from outside is a
 * threat-feed note: `intel/parse.ts` takes the remainder of a feed line verbatim,
 * caps it at 200 characters, restricts no character, and the detectors put it in
 * evidence as `feedNote`. `NOTIFY_INCLUDE_EVIDENCE` is on by default, so a feed
 * line reading `1.2.3.4 [click here](http://attacker.test)` would otherwise reach a
 * Teams channel as a rendered link attributed to this tool.
 *
 * It needs a hostile or compromised feed the operator chose to trust, so it is not
 * a high-severity hole. It is also the one place in this file where the asymmetry
 * with the other two renderers had a consequence.
 *
 * Backslash goes first, or every escape added below gets escaped again. The rest is
 * deliberately narrow — emphasis, code, strikethrough and the opening bracket of a
 * link — because escaping too much is its own bug, and a visible one.
 *
 * What is NOT escaped, and why:
 *
 *  - `-`, `#`, `>` begin a construct only at the START of a line: a list item, a
 *    heading, a quote. Mid-string they are ordinary characters. Escaping them put a
 *    backslash into every threat-intelligence alert this tool raises — the three
 *    titles in intel/assess.ts all read "known-malicious address …" — so a channel
 *    people are asked to trust filled with `known\-malicious` on the tool's own
 *    prose. Any evidence carrying a MAC address got the same treatment.
 *  - `|` delimits a table, and the Adaptive Card subset does not render tables.
 *  - `(` and `)` are only meaningful immediately after a `]`, and `[` is escaped
 *    here, so the link never forms and the parenthesis never matters.
 *
 * The asymmetry is the point: escaping too little is a formatting injection, while
 * escaping too much is noise on every message. Full CommonMark renders `\-` as `-`,
 * so a compliant renderer would hide the damage — but a restricted subset need not
 * implement an escape for a character it never treats as special, and betting the
 * legibility of every alert on that is the wrong way round.
 */
function escapeAdaptive(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([*_[`~])/g, '\\$1');
}

/** Slack mrkdwn only needs these three escaped. */
function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
