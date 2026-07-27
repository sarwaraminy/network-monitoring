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

/** Microsoft Teams legacy MessageCard, which incoming webhooks still accept. */
export function renderTeams(notification: Notification): unknown {
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: SEVERITY_COLOR[notification.severity].replace('#', ''),
    summary: subjectFor(notification),
    title: subjectFor(notification),
    sections: notification.findings.map((finding) => ({
      activityTitle: `**${finding.severity.toUpperCase()}** — ${finding.title}`,
      activitySubtitle: finding.description,
      facts: [
        ...(finding.sourceIp ? [{ name: 'Source', value: finding.sourceIp }] : []),
        ...(finding.targetIp ? [{ name: 'Target', value: finding.targetIp }] : []),
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

/** Slack mrkdwn only needs these three escaped. */
function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
