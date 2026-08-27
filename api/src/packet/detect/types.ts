import type { DecodedPacket } from '../decode.js';

/**
 * Detection framework.
 *
 * The previous implementation asked one question per packet — "is this packet
 * anomalous?" — which cannot express anything interesting. A port scan is not a
 * property of a packet; it is a property of many packets from one source over
 * time. Detectors here are therefore stateful and windowed, and they emit
 * findings describing *what* was observed rather than flagging raw packets.
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Lower is more urgent; used for sorting. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const ALERT_KINDS = [
  'arp_spoofing',
  'port_scan',
  'host_sweep',
  'syn_flood',
  'plaintext_credentials',
  'dns_tunneling',
  'new_device',
  'threat_intel',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface Finding {
  kind: AlertKind;
  severity: Severity;
  /** One line, shown in the alert list. */
  title: string;
  /** What was seen and why it matters. Shown when the row is expanded. */
  description: string;
  /**
   * Identity of the finding, before any time bucketing. Repeats of the same
   * finding must produce the same key so they aggregate instead of flooding.
   */
  dedupKey: string;
  sourceIp?: string | null;
  sourceMac?: string | null;
  targetIp?: string | null;
  targetMac?: string | null;
  protocol?: string | null;
  /**
   * The destination port this finding is about, when exactly one port describes it.
   *
   * Left unset for most kinds, deliberately. A port scan's defining property is
   * that it touched *many* ports, so there is no one port that describes it, and
   * putting the last one observed here would make a suppression rule naming a
   * port behave like a lottery — a rule for 445 would swallow a whole scan that
   * happened to include it. Set only where one port is part of the finding's
   * identity: a sweep of a single service, a cleartext login on a service port.
   *
   * Consumed by suppression matching and stored on the alert row.
   */
  port?: number | null;
  /**
   * Structured supporting detail. Must never contain packet payloads, passwords
   * or other secrets — it is persisted and displayed.
   */
  evidence: Record<string, unknown>;
  /** When the observation was made, taken from the packet's capture timestamp. */
  timestamp: Date;
}

export interface Detector {
  readonly name: AlertKind;
  /** Called for every decoded packet. Returns findings, if any. */
  inspect(packet: DecodedPacket): Finding[];
  /** Called periodically so window-based detectors can expire state. */
  sweep?(now: number): void;
  /** Drops all learned state. */
  reset(): void;
}

/** Tracks counts per key inside a sliding time window. */
export class SlidingWindow<T> {
  private readonly entries = new Map<string, { items: Map<T, number>; expiresAt: number }>();

  constructor(private readonly windowMs: number) {}

  /** Records `item` under `key` and returns how many distinct items that key holds. */
  add(key: string, item: T, now: number): number {
    let entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { items: new Map(), expiresAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.items.set(item, (entry.items.get(item) ?? 0) + 1);
    return entry.items.size;
  }

  /** Total observations recorded under `key` in the current window. */
  total(key: string, now: number): number {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now) return 0;
    let total = 0;
    for (const count of entry.items.values()) total += count;
    return total;
  }

  distinct(key: string, now: number): T[] {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now) return [];
    return [...entry.items.keys()];
  }

  /** Forgets `key`, so a fresh burst starts a new window. */
  clear(key: string): void {
    this.entries.delete(key);
  }

  /** Drops expired keys. Called from the engine's sweep. */
  sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  reset(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Caps how many keys a detector will track, so hostile or very busy traffic
 * cannot grow detector state without bound. Oldest keys are evicted first.
 */
export class BoundedMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, value);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  reset(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }
}
