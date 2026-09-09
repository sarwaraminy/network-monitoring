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
  /**
   * Which sensor observed this.
   *
   * Present on every finding, but only worth showing when more than one sensor
   * writes to this database — see `SensorSummary`. On a single-sensor
   * installation it is the same string on every row, and a column of one repeated
   * value is a column that costs width and says nothing.
   */
  sensorId: string;
  kind: AlertKind;
  severity: Severity;
  /**
   * What this finding says, as a catalogue key plus what it interpolates.
   *
   * The pair `arp_spoofing.sprawl.title` / `.description` is derived from the key
   * and rendered in the reader's language — see i18n/findings.ts. Null only on
   * rows written before V17, which carry `title` and `description` instead.
   */
  messageKey: string | null;
  messageParams: Record<string, unknown>;
  /** Pre-V17 English prose. Null on everything written since. */
  title: string | null;
  description: string | null;
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

/** The units the trend can be bucketed into; mirrors `TREND_BUCKETS` in the API. */
export type TrendBucket = 'hour' | 'day' | 'week' | 'month';

export interface AlertDashboard extends AlertSummary {
  trend: AlertTrendPoint[];
  /**
   * The unit `trend` is bucketed in, chosen by the API from the window.
   *
   * Read rather than recomputed. This page used to derive `days <= 2 ? 'hour' :
   * 'day'` for its axis labels while the route derived the same expression for the
   * query — one rule in two places, which held only while there were two units.
   */
  bucket: TrendBucket;
  /**
   * Where detail ends and the daily rollup begins, or `null` when the window does
   * not reach that far back and there is nothing to mark.
   */
  rolledUpBefore: string | null;
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

/**
 * A stored rule the server cannot use, and why.
 *
 * The reason travels with the id because it is the difference between fixing a
 * typo and staring at the row: a range that will not parse, or a detector kind
 * that no longer exists after a rename.
 */
export interface SuppressionProblem {
  id: number;
  reason: string;
}

export interface SuppressionListing {
  rules: SuppressionRule[];
  /** Rules that match nothing at all. Their authors believe otherwise. */
  invalid: SuppressionProblem[];
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
  /** Which sensor has seen this device. One row per sensor, per address. */
  sensorId: string;
  macAddress: string;
  firstIp: string | null;
  lastIp: string | null;
  label: string | null;
  firstSeen: string;
  lastSeen: string;
}

/**
 * An installation writing findings to this database.
 *
 * There is no registration step: a sensor is whatever has written a finding, plus
 * the one serving the request. That is why `self` is here — the interface has to
 * be able to say which of them you are talking to, and a newly installed sensor
 * that has found nothing yet still has to appear, or a correct configuration
 * renders as an installation that does not exist.
 */
export interface SensorSummary {
  sensorId: string;
  /** True for the sensor serving this page. */
  self: boolean;
}

export interface NetworkInterface {
  name: string;
  description: string | null;
  addresses: string[];
}

/**
 * A capture the previous process was running and did not stop cleanly — see V18.
 *
 * Present on the status until this process starts a capture of its own. Without
 * it the Capture screen can only say "Idle", which is equally true of a host that
 * has never captured anything and one that was capturing until the service
 * restarted at 03:14.
 */
export interface InterruptedCapture {
  interfaceName: string;
  filterIp: string | null;
  snapshotLength: number;
  timeoutMs: number;
  startedAt: string;
  startedBy: string;
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
  /** What a restart interrupted, or `null` when nothing was left running. */
  interrupted: InterruptedCapture | null;
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
  /**
   * The account's language, and the reason `users.lang_code` exists.
   *
   * The column has been `NOT NULL` since V1, is written by sign-up and by the user
   * CLI, and until the interface was translated nothing read it. It is the second
   * of the three sources `LocaleContext` consults, behind an explicit choice made
   * in this browser.
   */
  langCode: string;
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
  /**
   * Why it is not configured, when the reason is not the obvious one.
   *
   * Null for a mailbox that is simply unset — the standing "SMTP host, sender and at
   * least one recipient" covers that. Present for an OAuth2 mailbox whose credentials
   * are incomplete, where those three are exactly what has already been filled in.
   */
  reason: string | null;
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

/**
 * Where a delivery setting's current value came from.
 *
 * `environment` is the one that changes the UI: such a field is pinned in api/.env
 * or a Compose file, the API refuses to store a change to it, and the form must
 * render it uneditable. A control that accepts an edit and changes nothing is worse
 * than one that is visibly disabled.
 */
export type SettingSource = 'environment' | 'database' | 'default';

/**
 * One setting as the API reports it.
 *
 * `value` is absent for the two credentials — the webhook URL and the SMTP password —
 * which report `configured` instead. The API never sends those out: for Slack and
 * Teams the URL *is* the credential, and `/api/notify/status` has never returned it.
 */
export interface DeliverySettingField {
  source: SettingSource;
  value?: unknown;
  configured?: boolean;
}

export interface DeliverySettingsResponse {
  settings: Record<string, DeliverySettingField>;
  /** Fields pinned in the environment, which cannot be changed from the page. */
  pinnedByEnvironment: string[];
}

/**
 * A change to the stored settings.
 *
 * Absent and null mean different things: absent leaves the stored value alone, null
 * clears it so the field falls back to the environment or the code default. That is
 * what lets the form save without round-tripping a secret it was never given.
 */
export type DeliverySettingsPatch = Record<string, string | number | boolean | string[] | null>;

export interface NotifyTestResult {
  delivered: number;
  results: { channel: string; ok: boolean; detail: string }[];
}

/**
 * One entry in the audit trail.
 *
 * Append-only on the server — the table refuses UPDATE, DELETE and TRUNCATE — so
 * there is no draft, patch or delete counterpart to this type, and there should
 * never be one.
 */
export interface AuditEvent {
  id: number;
  at: string;
  /** The actor's email, or `user:<id>` where there was none. */
  actor: string;
  actorId: number | null;
  /** `domain.verb`, from a closed vocabulary the server validates against. */
  action: string;
  /** The thing acted on, where the action had a single subject. */
  subject: string | null;
  /**
   * What changed. Shape varies by action, and deliberately never holds a
   * credential — a settings change records which fields moved, not their values.
   */
  detail: Record<string, unknown>;
}

export interface AuditPage {
  events: AuditEvent[];
  /**
   * Cursor for the next, older page — an `id`, not a timestamp. Absent on the last
   * one. See `listAuditEvents` on the server for why a timestamp cursor loses rows.
   */
  nextBefore?: number;
}

/** An action and the label to show for it, served so the filter cannot drift. */
export interface AuditActionOption {
  action: string;
  label: string;
}
