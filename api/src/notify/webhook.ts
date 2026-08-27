import { renderDiscord, renderGeneric, renderSlack, renderTeams } from './format.js';
import type { DeliveryResult, Notification, NotificationChannel } from './types.js';

/**
 * Webhook delivery.
 *
 * Chosen as the first channel because it needs no dependency and no mail server:
 * Slack, Teams and Discord all accept an incoming-webhook URL, and anything else
 * takes generic JSON. For most teams this is a five-minute setup, where SMTP is a
 * conversation with whoever runs the mail domain.
 *
 * The payload shape differs per service, so the format is inferred from the URL.
 * Sending a Slack body to a Teams webhook produces a 400 and no message, which is
 * a confusing way to discover a configuration mistake.
 */

export const WEBHOOK_FORMATS = ['auto', 'slack', 'teams', 'discord', 'generic'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

/** Fail fast rather than holding a request open behind the alert flush. */
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

export function detectFormat(url: string): Exclude<WebhookFormat, 'auto'> {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'generic';
  }

  if (host.endsWith('hooks.slack.com') || host.endsWith('slack.com')) return 'slack';
  if (host.endsWith('webhook.office.com') || host.includes('office365')) return 'teams';
  if (host.endsWith('discord.com') || host.endsWith('discordapp.com')) return 'discord';
  return 'generic';
}

export function buildPayload(notification: Notification, format: Exclude<WebhookFormat, 'auto'>): unknown {
  switch (format) {
    case 'slack':
      return renderSlack(notification);
    case 'teams':
      return renderTeams(notification);
    case 'discord':
      return renderDiscord(notification);
    default:
      return renderGeneric(notification);
  }
}

export interface WebhookChannelOptions {
  url: string;
  format: WebhookFormat;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export class WebhookChannel implements NotificationChannel {
  readonly name = 'webhook';
  private readonly url: string;
  private readonly format: Exclude<WebhookFormat, 'auto'>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: WebhookChannelOptions) {
    this.url = options.url;
    this.format = options.format === 'auto' ? detectFormat(options.url) : options.format;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  isConfigured(): boolean {
    return this.url.trim() !== '';
  }

  /** Never throws. A broken webhook must not disturb detection or storage. */
  async send(notification: Notification): Promise<DeliveryResult> {
    const body = JSON.stringify(buildPayload(notification, this.format));

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (response.ok) {
          return {
            channel: this.name,
            ok: true,
            detail: `${this.format} webhook accepted (${response.status})`,
          };
        }

        // 4xx means the payload or URL is wrong; retrying sends the same thing again.
        if (response.status < 500 && response.status !== 429) {
          const detail = await safeText(response);
          return {
            channel: this.name,
            ok: false,
            detail: `${this.format} webhook rejected it (${response.status}): ${detail}`,
          };
        }

        if (attempt === MAX_ATTEMPTS) {
          return {
            channel: this.name,
            ok: false,
            detail: `webhook returned ${response.status} after ${MAX_ATTEMPTS} attempts`,
          };
        }
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          return { channel: this.name, ok: false, detail: `webhook request failed: ${describe(error)}` };
        }
      }

      await this.sleepImpl(500 * 2 ** (attempt - 1));
    }

    return { channel: this.name, ok: false, detail: 'webhook retries exhausted' };
  }

  /** The resolved format, so `doctor`-style checks can report it. */
  get resolvedFormat(): string {
    return this.format;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '(no body)';
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // A timeout surfaces as an unhelpfully generic abort otherwise.
    if (error.name === 'TimeoutError') return `timed out after ${TIMEOUT_MS}ms`;
    return error.message;
  }
  return String(error);
}
