/** Mirrors api/src/types/dto.ts and the Drizzle row types. */

export interface Log {
  id: number;
  timestamp: string | null;
  sourceip: string;
  sourcemac: string | null;
  destinationip: string;
  destinationmac: string | null;
  protocol: string;
  ipversion: string | null;
  details: string;
  createdAt: string;
}

export interface EthernetHeader {
  destinationAddress: string;
  sourceAddress: string;
  type: string;
}

export interface LlcHeader {
  dsap: string;
  ssap: string;
  control: string;
}

export interface Packet {
  ethernetHeader: EthernetHeader;
  llcHeader: LlcHeader | null;
  dataHexStream: string;
  ethernetPadHexStream: string;
  sourceIpAddress: string | null;
  destinationIpAddress: string | null;
  frameLength: number;
  /** True when the server has REDACT_PACKET_PAYLOAD enabled. */
  payloadRedacted: boolean;
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

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

/** A security finding. Repeats inside a window are merged into `occurrences`. */
export interface Alert {
  id: number;
  kind: AlertKind;
  severity: Severity;
  title: string;
  description: string;
  sourceIp: string | null;
  sourceMac: string | null;
  targetIp: string | null;
  targetMac: string | null;
  protocol: string | null;
  /** The one destination port this finding is about, when exactly one describes it. */
  port: number | null;
  dedupKey: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  /** Structured supporting detail. Never contains payloads or secrets. */
  evidence: Record<string, unknown>;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
}

export interface AlertSummary {
  total: number;
  unacknowledged: number;
  bySeverity: Record<Severity, number>;
  byKind: Array<{ kind: string; count: number; occurrences: number }>;
  latestAt: string | null;
}

/** One time bucket of the alert trend, split by severity. */
export interface AlertTrendPoint {
  bucket: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AlertDashboard extends AlertSummary {
  trend: AlertTrendPoint[];
  topSources: Array<{ sourceIp: string; count: number; occurrences: number }>;
}

/**
 * A suppression rule: findings the operator has declared expected.
 *
 * Every criterion is nullable and null means "any", so a rule is the conjunction
 * of whichever ones are set. `matchCount` and `lastMatchAt` are the point of
 * showing these at all — a suppressed finding is dropped rather than hidden, so
 * the counter is the only evidence of what a rule is actually eating.
 */
export interface SuppressionRule {
  id: number;
  kind: AlertKind | null;
  sourceCidr: string | null;
  targetCidr: string | null;
  port: number | null;
  reason: string;
  enabled: boolean;
  /** Null never expires. */
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  matchCount: number;
  lastMatchAt: string | null;
}

export interface SuppressionListing {
  rules: SuppressionRule[];
  /** Ids whose stored range will not parse. Such a rule matches nothing at all. */
  invalid: number[];
}

/** The editable half of a rule, as the form holds it. */
export interface SuppressionDraft {
  kind: AlertKind | null;
  sourceCidr: string | null;
  targetCidr: string | null;
  port: number | null;
  reason: string;
  enabled: boolean;
  expiresAt: string | null;
}

/**
 * What an unsaved rule would have hidden, measured against alerts already stored.
 *
 * `occurrences` matters more than `matched`: three alerts can carry twelve
 * thousand observations between them, so a row count reads as trivial while
 * describing most of the noise on the network.
 */
export interface SuppressionPreview {
  examined: number;
  matched: number;
  occurrences: number;
  /** Range of `lastSeen` across what was examined, so a zero is interpretable. */
  window: { from: string; to: string } | null;
  samples: Array<{
    id: number;
    kind: string;
    severity: Severity;
    sourceIp: string | null;
    targetIp: string | null;
    port: number | null;
    occurrences: number;
    lastSeen: string;
  }>;
}

/** Where a feed's contents actually came from on the last load. */
export type IntelFeedOrigin = 'network' | 'cache' | 'file' | 'failed';

export interface IntelFeedStatus {
  name: string;
  indicators: number;
  /** Lines that were not indicators: comments, headers, junk. */
  skipped: number;
  from: IntelFeedOrigin;
  error?: string;
}

export interface IntelStatus {
  enabled: boolean;
  loadedAt: string | null;
  refreshSeconds: number;
  stats: {
    total: number;
    ipv4: number;
    ipv6: number;
    cidr: number;
    domain: number;
    /** Entries refused on the way in — private ranges, malformed lines. */
    rejected: number;
    bySource: Record<string, number>;
  };
  sources: IntelFeedStatus[];
}

export interface IntelReloadResult {
  status: 'loaded';
  loadedAt: string;
  indicators: number;
  sources: IntelFeedStatus[];
}

export interface KnownDevice {
  macAddress: string;
  firstIp: string | null;
  lastIp: string | null;
  label: string | null;
  firstSeen: string;
  lastSeen: string;
}

export interface NetworkInterface {
  name: string;
  description: string | null;
  addresses: string[];
}

export interface CaptureStatus {
  capturing: boolean;
  captureAvailable: boolean;
  captureLibrary: string | null;
  interfaceName: string | null;
  filter: string | null;
  linkType: string | null;
  packetCount: number;
  droppedPackets: number;
  /** Findings raised during this capture, before deduplication. */
  findingCount: number;
  startedAt: string | null;
}

/** ip-api.com fields the UI surfaces. Everything else is passed through. */
export interface GeoData {
  status?: string;
  message?: string;
  country?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  [key: string]: unknown;
}

export interface IpInfo {
  ipAddress: string;
  domainName: string | null;
  whoisData: string | null;
  geoData: GeoData | null;
}

export interface AuthenticatedUser {
  id: number;
  email: string | null;
  firstName: string;
  lastName: string | null;
  role: string;
}

export interface LoginResponse extends AuthenticatedUser {
  token: string;
}

export interface SignupPayload {
  email: string;
  password: string;
  firstname: string;
  lastname: string;
  role: 'USER' | 'ADMIN';
  langCode: string;
}

/** Parameters accepted by both capture start endpoints. */
export interface StartCaptureParams {
  interfaceName: string;
  snaplength: number;
  timeout: number;
  ipAddress?: string;
}

/**
 * Alert delivery.
 *
 * Two classes of channel, and the distinction is the point of the page built on
 * this: webhook and email are read by a person, so they are gated by severity,
 * throttled and digested. Syslog feeds a SIEM, which correlates and deduplicates
 * itself and needs the complete stream, so it receives every finding ungated.
 */
export interface NotifyChannelWebhook {
  configured: boolean;
  /** Never the URL — it is a bearer credential for Slack and Teams. */
  format: string | null;
}

export interface NotifyChannelEmail {
  configured: boolean;
  recipients: number;
}

export interface NotifyChannelSyslog {
  configured: boolean;
  /** `host:port`. Safe to show: a syslog target carries no credential. */
  target: string | null;
  protocol: 'udp' | 'tcp';
  format: 'cef' | 'json';
  rfc: '5424' | '3164';
  includeEvidence: boolean;
}

export interface NotifyStatus {
  enabled: boolean;
  /** True only when at least one channel could actually deliver. */
  active: boolean;
  channels: string[];
  minSeverity: string;
  digestSeconds: number;
  throttleSeconds: number;
  maxPerHour: number;
  includeEvidence: boolean;
  queued: number;
  sentLastHour: number;
  throttledKeys: number;
  webhook: NotifyChannelWebhook;
  email: NotifyChannelEmail;
  syslog: NotifyChannelSyslog;
}

export interface NotifyTestResult {
  delivered: number;
  results: { channel: string; ok: boolean; detail: string }[];
}
