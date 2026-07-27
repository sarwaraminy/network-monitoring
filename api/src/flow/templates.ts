import type { Template } from './fields.js';

/**
 * Templates learned from exporters.
 *
 * NetFlow v9 and IPFIX are self-describing but not self-contained: a data record
 * is an opaque byte string until the template describing it arrives, and templates
 * come in their own periodic messages. So records are undecodable for the first
 * few minutes after start, and again after a collector restart, until the exporter
 * resends. That is normal operation, not an error.
 *
 * The cache is bounded because it is filled directly from unauthenticated UDP.
 * Anything that grows without a cap on remote input is a memory-exhaustion bug
 * waiting to happen, and a single spoofed source could otherwise mint templates
 * until the process dies.
 */

const DEFAULT_MAX_TEMPLATES = 4096;

export interface TemplateKey {
  exporter: string;
  observationDomain: number;
  templateId: number;
}

function cacheKey(key: TemplateKey): string {
  return `${key.exporter}|${key.observationDomain}|${key.templateId}`;
}

export class TemplateCache {
  private readonly templates = new Map<string, Template>();
  private evictions = 0;

  constructor(private readonly maxTemplates: number = DEFAULT_MAX_TEMPLATES) {}

  get(key: TemplateKey): Template | undefined {
    return this.templates.get(cacheKey(key));
  }

  /**
   * Stores a template, replacing any previous definition.
   *
   * Replacement is required, not merely allowed: exporters reuse template IDs
   * after a configuration change, and RFC 7011 §8 says the newest definition
   * wins. Keeping the old one would decode every subsequent record with the wrong
   * field layout, which produces plausible-looking nonsense rather than an error.
   */
  set(key: TemplateKey, template: Template): void {
    const id = cacheKey(key);
    if (!this.templates.has(id) && this.templates.size >= this.maxTemplates) {
      // Oldest first. Map preserves insertion order, and a template that has not
      // been redefined in the longest time is the safest thing to lose.
      const oldest = this.templates.keys().next();
      if (!oldest.done) {
        this.templates.delete(oldest.value);
        this.evictions += 1;
      }
    }
    this.templates.set(id, template);
  }

  /** Drops every template for one exporter, e.g. when it signals a restart. */
  forgetExporter(exporter: string): number {
    let removed = 0;
    for (const id of this.templates.keys()) {
      if (id.startsWith(`${exporter}|`)) {
        this.templates.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.templates.size;
  }

  get evictionCount(): number {
    return this.evictions;
  }

  reset(): void {
    this.templates.clear();
    this.evictions = 0;
  }
}
