import type {
  Alert,
  AlertDashboard,
  CaptureStatus,
  IntelStatus,
  NetworkInterface,
  NotifyStatus,
  Packet,
} from '../types';

/** Shapes here mirror what the API actually returns; see api/src/types/dto.ts. */

export const ADMIN_USER = {
  id: 1,
  email: 'admin@example.com',
  firstname: 'Admin',
  lastname: 'User',
  role: 'ADMIN',
  langCode: 'en',
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const CRITICAL_ALERT: Alert = {
  id: 101,
  kind: 'plaintext_credentials',
  severity: 'critical',
  title: 'Cleartext HTTP credentials for "alice" to 10.0.0.50',
  description: 'An HTTP Basic Authorization header was captured in the clear.',
  sourceIp: '10.0.0.89',
  sourceMac: '38:f7:cd:c4:a0:6f',
  targetIp: '10.0.0.50',
  targetMac: '10:56:ca:05:3c:14',
  protocol: 'TCP',
  dedupKey: 'plaintext_credentials|http-basic|alice|10.0.0.50:80|w1',
  occurrences: 3,
  firstSeen: '2026-07-26T09:00:00.000Z',
  lastSeen: '2026-07-26T09:05:00.000Z',
  // Deliberately records the username and the password's length, never the password.
  evidence: { username: 'alice', passwordLength: 14, passwordRecorded: false, service: 'HTTP Basic' },
  acknowledgedAt: null,
  acknowledgedBy: null,
  createdAt: '2026-07-26T09:00:00.000Z',
};

export const HIGH_ALERT: Alert = {
  id: 102,
  kind: 'port_scan',
  severity: 'high',
  title: 'Port scan: 10.0.0.66 probed 22 ports on 10.0.0.89',
  description: 'A single source attempted connections to many ports.',
  sourceIp: '10.0.0.66',
  sourceMac: 'de:ad:be:ef:00:99',
  targetIp: '10.0.0.89',
  targetMac: '38:f7:cd:c4:a0:6f',
  protocol: 'TCP',
  dedupKey: 'port_scan|10.0.0.66|10.0.0.89|w1',
  occurrences: 1,
  firstSeen: '2026-07-26T08:00:00.000Z',
  lastSeen: '2026-07-26T08:01:00.000Z',
  evidence: { scanner: '10.0.0.66', distinctPortsProbed: 22 },
  acknowledgedAt: null,
  acknowledgedBy: null,
  createdAt: '2026-07-26T08:00:00.000Z',
};

export const ACKNOWLEDGED_ALERT: Alert = {
  ...HIGH_ALERT,
  id: 103,
  kind: 'new_device',
  severity: 'medium',
  title: 'New device on the network: aa:bb:cc:dd:ee:ff',
  acknowledgedAt: '2026-07-26T09:30:00.000Z',
  acknowledgedBy: 'admin@example.com',
};

export const ALERTS = [CRITICAL_ALERT, HIGH_ALERT, ACKNOWLEDGED_ALERT];

export const DASHBOARD: AlertDashboard = {
  total: 3,
  unacknowledged: 2,
  bySeverity: { critical: 1, high: 1, medium: 1, low: 0, info: 0 },
  byKind: [
    { kind: 'plaintext_credentials', count: 1, occurrences: 3 },
    { kind: 'port_scan', count: 1, occurrences: 1 },
    { kind: 'new_device', count: 1, occurrences: 1 },
  ],
  latestAt: '2026-07-26T09:05:00.000Z',
  trend: [
    { bucket: '2026-07-25T00:00:00.000Z', critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    { bucket: '2026-07-26T00:00:00.000Z', critical: 1, high: 0, medium: 1, low: 0, info: 0 },
  ],
  topSources: [
    { sourceIp: '10.0.0.66', count: 2, occurrences: 5 },
    { sourceIp: '10.0.0.89', count: 1, occurrences: 3 },
  ],
};

/**
 * One healthy feed, one that fell back to its cache, one that failed outright.
 *
 * Deliberately not three healthy rows: the page exists to make a degraded feed
 * visible, so the default fixture has to contain degradation.
 */
export const INTEL_STATUS: IntelStatus = {
  enabled: true,
  loadedAt: '2026-08-26T11:55:00.000Z',
  refreshSeconds: 21600,
  stats: {
    total: 1204,
    ipv4: 900,
    ipv6: 4,
    cidr: 120,
    domain: 180,
    rejected: 7,
    bySource: { feodo: 900, drop: 120, internal: 184 },
  },
  sources: [
    { name: 'feodo', indicators: 900, skipped: 12, from: 'network' },
    { name: 'drop', indicators: 120, skipped: 40, from: 'cache' },
    { name: 'internal', indicators: 184, skipped: 3, from: 'file' },
    { name: 'urlhaus', indicators: 0, skipped: 0, from: 'failed', error: 'HTTP 503' },
  ],
};

/**
 * One channel of each kind, and deliberately a mixed state: webhook on, email
 * off, syslog on. The page exists to make a half-configured delivery path
 * visible, so the default fixture has to be half-configured.
 */
export const NOTIFY_STATUS: NotifyStatus = {
  enabled: true,
  active: true,
  channels: ['webhook', 'syslog'],
  minSeverity: 'high',
  digestSeconds: 60,
  throttleSeconds: 900,
  maxPerHour: 12,
  includeEvidence: true,
  queued: 2,
  sentLastHour: 4,
  throttledKeys: 1,
  webhook: { configured: true, format: 'slack' },
  email: { configured: false, recipients: 0 },
  syslog: {
    configured: true,
    target: 'siem.internal:514',
    protocol: 'udp',
    format: 'cef',
    rfc: '5424',
    includeEvidence: true,
  },
};

export const INTERFACES: NetworkInterface[] = [
  { name: '\\Device\\NPF_{ABC}', description: 'Intel(R) Ethernet Connection', addresses: ['10.0.0.89'] },
  {
    name: '\\Device\\NPF_Loopback',
    description: 'Adapter for loopback traffic capture',
    addresses: ['127.0.0.1'],
  },
];

export const IDLE_STATUS: CaptureStatus = {
  capturing: false,
  captureAvailable: true,
  captureLibrary: 'libpcap version 1.10.4',
  interfaceName: null,
  filter: null,
  linkType: null,
  packetCount: 0,
  droppedPackets: 0,
  findingCount: 0,
  startedAt: null,
};

export const RUNNING_STATUS: CaptureStatus = {
  ...IDLE_STATUS,
  capturing: true,
  interfaceName: '\\Device\\NPF_{ABC}',
  linkType: 'ETHERNET',
  packetCount: 42,
  findingCount: 2,
  startedAt: '2026-07-26T09:00:00.000Z',
};

export const PACKET: Packet = {
  ethernetHeader: {
    destinationAddress: '10:56:ca:05:3c:14',
    sourceAddress: '38:f7:cd:c4:a0:6f',
    type: '0x0800 (IPv4)',
  },
  llcHeader: null,
  dataHexStream: '38 f7 cd c4 a0 6f 10 56 ca 05 3c 14 08 00',
  ethernetPadHexStream: '',
  sourceIpAddress: '10.0.0.89',
  destinationIpAddress: '52.98.50.18',
  frameLength: 60,
  payloadRedacted: false,
};
