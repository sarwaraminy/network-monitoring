import { env } from '../../config/env.js';
import type { FindingRef } from '../../i18n/catalog/findings.js';
import type { DecodedPacket } from '../decode.js';
import { BoundedMap, type Detector, type Finding, SlidingWindow } from './types.js';

/**
 * DNS used as a covert channel.
 *
 * DNS is almost always permitted outbound, even on networks that block
 * everything else, which makes it the standard fallback for data exfiltration
 * and malware command-and-control. The traffic is not malformed — it is valid
 * DNS — so the signal is in the shape of the names being queried.
 *
 * Three signals, each weak alone and reported together:
 *   - very long query names, because payload has to be encoded into the labels;
 *   - high-entropy labels, because encoded or encrypted data looks random where
 *     real hostnames are pronounceable;
 *   - an implausible number of distinct subdomains under one parent domain,
 *     which is what a tunnel looks like over time.
 */

const MAX_TRACKED_DOMAINS = 4096;
const REPORT_COOLDOWN_MS = 60_000;

/** Shortest label worth testing; below this, entropy is meaningless. */
const MIN_LABEL_LENGTH = 16;
/** Shannon entropy per character expected of base32/base64 encoded data. */
const ENCODED_ENTROPY = 3.8;
/** Digit share typical of encoded data but rare in words. */
const ENCODED_DIGIT_RATIO = 0.15;
/** Vowel share below which a string is not pronounceable. */
const UNPRONOUNCEABLE_VOWEL_RATIO = 0.12;

export class DnsTunnelingDetector implements Detector {
  readonly name = 'dns_tunneling' as const;

  private readonly subdomainsPerDomain: SlidingWindow<string>;
  private readonly lastReported = new BoundedMap<string, number>(MAX_TRACKED_DOMAINS);

  constructor() {
    this.subdomainsPerDomain = new SlidingWindow<string>(env.detection.scanWindowMs * 5);
  }

  inspect(packet: DecodedPacket): Finding[] {
    const udp = packet.udp;
    if (!udp || (udp.dstPort !== 53 && udp.srcPort !== 53)) return [];
    if (!packet.payload || packet.payload.length < 13) return [];

    const question = readFirstQuestion(packet.payload);
    if (!question) return [];

    const now = packet.timestamp.getTime();
    const source = packet.ipv4?.srcAddr ?? packet.ipv6?.srcAddr ?? null;
    const target = packet.ipv4?.dstAddr ?? packet.ipv6?.dstAddr ?? null;

    const labels = question.split('.');
    const registrable = labels.slice(-2).join('.');
    const longestLabel = labels.reduce((longest, label) => Math.max(longest, label.length), 0);

    // The strongest single signal: a label that carries encoded bytes rather than
    // a name. Raw entropy alone is not enough — any long, varied string scores
    // high, including legitimate hyphenated hostnames.
    const encoded = labels.map(describeIfEncoded).find((result) => result !== null) ?? null;

    const distinctSubdomains = this.subdomainsPerDomain.add(`dns|${source}|${registrable}`, question, now);

    // Each reason is a reference to its own catalogue entry rather than a
    // sentence: they are interpolated into the description as a list, and
    // `Intl.ListFormat` joins them with the separator the reader's language uses.
    const reasons: FindingRef[] = [];
    if (question.length >= 100) {
      reasons.push({ key: 'dns_tunneling.reason.length', params: { length: question.length } });
    }
    if (encoded) {
      reasons.push({
        key: 'dns_tunneling.reason.encoded',
        params: {
          length: encoded.length,
          entropy: encoded.entropy,
          digitPercent: Math.round(encoded.digitRatio * 100),
          vowelPercent: Math.round(encoded.vowelRatio * 100),
        },
      });
    }
    if (distinctSubdomains >= env.detection.dnsDistinctSubdomains) {
      reasons.push({
        key: 'dns_tunneling.reason.subdomains',
        params: { count: distinctSubdomains, domain: registrable },
      });
    }

    // One weak signal alone is not worth an alert; two together is.
    if (reasons.length < 2) return [];

    const key = `dns_tunneling|${source}|${registrable}`;
    const last = this.lastReported.get(key);
    if (last !== undefined && now - last < REPORT_COOLDOWN_MS) return [];
    this.lastReported.set(key, now);

    return [
      {
        kind: this.name,
        severity: 'medium',
        messageKey: 'dns_tunneling.detected',
        messageParams: {
          domain: registrable,
          source,
          hasSource: source !== null,
          reasons,
        },
        dedupKey: key,
        sourceIp: source,
        sourceMac: packet.ethernet?.sourceAddress ?? null,
        targetIp: target,
        protocol: 'DNS',
        evidence: {
          registrableDomain: registrable,
          // Truncated: query names can carry the exfiltrated data itself.
          sampleQuery: question.slice(0, 120),
          queryNameLength: question.length,
          longestLabelLength: longestLabel,
          encodedLabelEntropy: encoded ? Number(encoded.entropy.toFixed(2)) : null,
          distinctSubdomainsInWindow: distinctSubdomains,
          // The reason *codes*, not the sentences they render to. Evidence is
          // structured detail, and every number these quote — the name length,
          // the entropy, the subdomain count — is already a field of its own
          // here.
          reasons: reasons.map((reason) => reason.key),
        },
        timestamp: packet.timestamp,
      },
    ];
  }

  sweep(now: number): void {
    this.subdomainsPerDomain.sweep(now);
  }

  reset(): void {
    this.subdomainsPerDomain.reset();
    this.lastReported.reset();
  }
}

/**
 * Reads the QNAME of the first question in a DNS message. Compression pointers
 * cannot appear in a question's name, so a plain label walk is sufficient.
 */
export function readFirstQuestion(payload: Buffer): string | null {
  // The guard lives here rather than at the call site. It used to sit in this
  // detector's inspect(), and when this function was exported for the
  // threat-intel detector the guard did not travel with it — a 3-byte UDP/53
  // payload then threw RangeError out of readUInt16BE. Nothing crashed, because
  // the engine catches, but the whole packet was abandoned mid-inspection, so a
  // listed *address* on that packet was missed too and every such packet wrote
  // an error log line. Trivially craftable traffic, unbounded log flood.
  //
  // 12 bytes of header plus at least one byte of question is the minimum a
  // readable query can be.
  if (payload.length < 13) return null;

  const questionCount = payload.readUInt16BE(4);
  if (questionCount === 0) return null;

  const labels: string[] = [];
  let offset = 12; // Past the fixed 12-byte header.

  while (offset < payload.length) {
    const length = payload[offset]!;
    if (length === 0) break;
    // 0xc0 marks a compression pointer, which is invalid here — bail out.
    if ((length & 0xc0) !== 0) return null;
    offset += 1;
    if (offset + length > payload.length) return null;
    labels.push(payload.toString('latin1', offset, offset + length));
    offset += length;
    if (labels.length > 63) return null; // Malformed: too many labels.
  }

  if (labels.length === 0) return null;
  return labels.join('.').toLowerCase();
}

interface EncodedLabel {
  length: number;
  entropy: number;
  digitRatio: number;
  vowelRatio: number;
}

/**
 * Decides whether a label carries encoded bytes rather than a name.
 *
 * Entropy alone gives false positives: a legitimate hostname such as
 * "this-is-a-fairly-long-but-perfectly-ordinary-hostname" scores over 4 bits per
 * character simply because it is long and varied. What separates base32/base64
 * payloads from names is structure — no hyphens, and either a high proportion of
 * digits or too few vowels to be pronounceable.
 */
function describeIfEncoded(label: string): EncodedLabel | null {
  if (label.length < MIN_LABEL_LENGTH) return null;
  // Hyphens and underscores are word separators; encoders do not emit them.
  if (!/^[a-z0-9]+$/.test(label)) return null;

  const digits = (label.match(/\d/g) ?? []).length / label.length;
  const vowels = (label.match(/[aeiou]/g) ?? []).length / label.length;
  const entropy = shannonEntropy(label);

  if (entropy < ENCODED_ENTROPY) return null;
  if (digits < ENCODED_DIGIT_RATIO && vowels > UNPRONOUNCEABLE_VOWEL_RATIO) return null;

  return { length: label.length, entropy, digitRatio: digits, vowelRatio: vowels };
}

/** Shannon entropy in bits per character; ~2 for words, >3.8 for encoded data. */
function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}
