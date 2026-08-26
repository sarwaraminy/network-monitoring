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
