import type { AdhocSettingField } from '../api/adhoc.api';
import type {
  Alert,
  AlertDashboard,
  CaptureStatus,
  DeliverySettingsResponse,
  FlowStatus,
  IntelStatus,
  NetworkInterface,
  NotifyStatus,
  Packet,
  SuppressionListing,
  SuppressionPreview,
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

/**
 * Accounts as `GET /auth/users` returns them.
 *
 * Two administrators, so the default render is one where roles CAN be changed:
 * with a single administrator every control is disabled by the last-admin rule,
 * and a test asserting a select is enabled would be asserting the fixture. The
 * one-administrator case is what a test asks for explicitly.
 *
 * `ADMIN_USER` is first, because `/auth/me` returns it — so its row is the one
 * the self-refusal applies to.
 */
export const ACCOUNTS = [
  ADMIN_USER,
  {
    id: 2,
    email: 'second-admin@example.com',
    firstname: 'Second',
    lastname: 'Admin',
    role: 'ADMIN',
    langCode: 'en',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 3,
    email: 'plain@example.com',
    firstname: 'Plain',
    lastname: null,
    role: 'USER',
    langCode: 'en',
    createdAt: '2026-01-03T00:00:00.000Z',
  },
];

export const CRITICAL_ALERT: Alert = {
  id: 101,
  sensorId: 'default',
  kind: 'plaintext_credentials',
  severity: 'critical',
  // A finding as V17 writes them: a key and its parameters, rendered in the
  // reader's language when the row is displayed.
  messageKey: 'plaintext_credentials.http_basic',
  messageParams: { username: 'alice', target: '10.0.0.50', port: '80' },
  title: null,
  description: null,
  sourceIp: '10.0.0.89',
  sourceMac: '38:f7:cd:c4:a0:6f',
  targetIp: '10.0.0.50',
  targetMac: '10:56:ca:05:3c:14',
  protocol: 'TCP',
  // One service on one port describes this finding, so a suppression rule may
  // name the port. A port scan below cannot: it touched many.
  port: 80,
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
  sensorId: 'default',
  kind: 'port_scan',
  severity: 'high',
  /*
   * A finding from before V17, kept in this shape deliberately.
   *
   * Retention windows are measured in months, so an installation that upgrades
   * has both shapes in one table for as long as the older rows survive, and the
   * alert list has to render them side by side. Holding one fixture back is what
   * makes the display fallback a tested path rather than a commented one.
   */
  messageKey: null,
  messageParams: {},
  title: 'Port scan: 10.0.0.66 probed 22 ports on 10.0.0.89',
  description: 'A single source attempted connections to many ports.',
  sourceIp: '10.0.0.66',
  sourceMac: 'de:ad:be:ef:00:99',
  targetIp: '10.0.0.89',
  targetMac: '38:f7:cd:c4:a0:6f',
  protocol: 'TCP',
  port: null,
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

/**
 * Four rules covering the states the page has to distinguish.
 *
 * Deliberately not four healthy rows. The page exists to make the cost of a
 * suppression visible, so the default fixture contains a rule that has hidden a
 * great deal, one that has hidden nothing, one switched off, and one whose range
 * the server could not parse — which is the state that looks like coverage and
 * is not.
 */
export const SUPPRESSION_RULES: SuppressionListing = {
  rules: [
    {
      id: 1,
      kind: 'port_scan',
      sourceCidr: '10.20.30.0/24',
      targetCidr: null,
      port: null,
      reason: 'Authorised Nessus scanner, ticket OPS-1421',
      enabled: true,
      expiresAt: null,
      createdBy: 'admin@example.com',
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-01T09:00:00.000Z',
      matchCount: 4820,
      lastMatchAt: '2026-08-27T02:00:00.000Z',
    },
    {
      id: 2,
      kind: 'host_sweep',
      sourceCidr: null,
      targetCidr: null,
      port: 445,
      reason: 'Backup agent enumerating SMB shares nightly',
      enabled: true,
      expiresAt: null,
      createdBy: 'admin@example.com',
      createdAt: '2026-08-10T09:00:00.000Z',
      updatedAt: '2026-08-10T09:00:00.000Z',
      matchCount: 0,
      lastMatchAt: null,
    },
    {
      id: 3,
      kind: null,
      sourceCidr: '192.168.50.10/32',
      targetCidr: null,
      port: null,
      reason: 'Pen test window, week of 12 August',
      // Left switched on and allowed to lapse, which is the realistic version of
      // this rule and the state the page has to name rather than imply.
      enabled: true,
      expiresAt: '2026-08-19T00:00:00.000Z',
      createdBy: 'admin@example.com',
      createdAt: '2026-08-12T09:00:00.000Z',
      updatedAt: '2026-08-19T09:00:00.000Z',
      matchCount: 311,
      lastMatchAt: '2026-08-18T22:40:00.000Z',
    },
    {
      id: 4,
      kind: 'arp_spoofing',
      sourceCidr: '10.0.0.0/99',
      targetCidr: null,
      port: null,
      reason: 'Router failover flaps the gateway MAC',
      enabled: true,
      expiresAt: null,
      createdBy: 'admin@example.com',
      createdAt: '2026-08-20T09:00:00.000Z',
      updatedAt: '2026-08-20T09:00:00.000Z',
      matchCount: 0,
      lastMatchAt: null,
    },
  ],
  invalid: [{ id: 4, reason: 'source "10.0.0.0/99" is not an address or CIDR range' }],
};

export const SUPPRESSION_PREVIEW: SuppressionPreview = {
  examined: 500,
  matched: 2,
  occurrences: 4821,
  window: { from: '2026-08-20T00:00:00.000Z', to: '2026-08-27T08:00:00.000Z' },
  samples: [
    {
      id: 102,
      kind: 'port_scan',
      severity: 'high',
      sourceIp: '10.20.30.40',
      targetIp: '10.0.0.89',
      port: null,
      occurrences: 4800,
      lastSeen: '2026-08-27T02:00:00.000Z',
    },
    {
      id: 140,
      kind: 'port_scan',
      severity: 'high',
      sourceIp: '10.20.30.41',
      targetIp: '10.0.0.90',
      port: null,
      occurrences: 21,
      lastSeen: '2026-08-26T02:00:00.000Z',
    },
  ],
};

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
  bucket: 'day',
  // Two days of trend cannot reach a retention boundary, so there is none to mark.
  rolledUpBefore: null,
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
  email: { configured: false, recipients: 0, reason: null },
  syslog: {
    configured: true,
    target: 'siem.internal:514',
    protocol: 'udp',
    format: 'cef',
    rfc: '5424',
    includeEvidence: true,
  },
};

/**
 * Delivery settings as the API reports them.
 *
 * Deliberately mixed: one field pinned by the environment, one secret configured and
 * one not, and the rest at their defaults. A fixture where everything came from the
 * database would never exercise the two states that change the form's behaviour.
 */
export const DELIVERY_SETTINGS: DeliverySettingsResponse = {
  settings: {
    enabled: { source: 'environment', value: true },
    minSeverity: { source: 'database', value: 'high' },
    digestSeconds: { source: 'default', value: 60 },
    throttleSeconds: { source: 'default', value: 900 },
    maxPerHour: { source: 'database', value: 12 },
    includeEvidence: { source: 'default', value: true },
    dashboardUrl: { source: 'database', value: 'https://nmt.example.test/alerts' },

    // Configured, and never sent back: for Slack and Teams the URL is the credential.
    webhookUrl: { source: 'database', configured: true },
    webhookFormat: { source: 'default', value: 'auto' },

    syslogHost: { source: 'database', value: 'siem.internal' },
    syslogPort: { source: 'default', value: 514 },
    syslogProtocol: { source: 'default', value: 'udp' },
    syslogFormat: { source: 'default', value: 'cef' },
    syslogRfc: { source: 'default', value: '5424' },
    syslogFacility: { source: 'default', value: 16 },
    syslogAppName: { source: 'default', value: 'nmt' },
    syslogIncludeEvidence: { source: 'default', value: true },

    emailHost: { source: 'default', value: '' },
    emailPort: { source: 'default', value: 587 },
    emailSecure: { source: 'default', value: false },
    emailUser: { source: 'default', value: '' },
    emailPassword: { source: 'default', configured: false },
    emailFrom: { source: 'default', value: '' },
    emailTo: { source: 'default', value: [] },

    emailAuthMethod: { source: 'default', value: 'password' },
    emailOauthClientId: { source: 'default', value: '' },
    emailOauthClientSecret: { source: 'default', configured: false },
    emailOauthRefreshToken: { source: 'default', configured: false },
    emailOauthTokenUrl: { source: 'default', value: '' },
    emailOauthScope: { source: 'default', value: '' },
  },
  pinnedByEnvironment: ['enabled'],
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
  // Nothing was left running by a previous process.
  interrupted: null,
  // Nothing to resume, so nothing pending — `RUNNING_STATUS` inherits both by spread.
  resumePending: false,
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

/**
 * Flow settings as a deployment that manages them from the browser reports them.
 *
 * Nothing pinned, which is the shipped state since the Compose file stopped
 * baking its defaults in — see `compose-unpinned.test.ts`. A test that needs a
 * pinned field overrides one, because that is the interesting case rather than
 * the default one.
 */
export const FLOW_SETTINGS = {
  settings: {
    enabled: { source: 'database', env: 'FLOW_ENABLED', value: true },
    port: { source: 'default', env: 'FLOW_PORT', value: 2055 },
    bindAddress: { source: 'default', env: 'FLOW_BIND_ADDRESS', value: '0.0.0.0' },
    exporters: { source: 'database', env: 'FLOW_EXPORTERS', value: '10.0.0.1, 10.0.0.2' },
  },
  pinned: [] as string[],
};

/**
 * A flow collector that is working, with one exporter of each interesting shape.
 *
 * Not three healthy rows, for the same reason `SUPPRESSION_RULES` is not four: the
 * page exists to tell working from broken, so the default fixture contains one
 * exporter decoding normally, one whose records are all awaiting a template —
 * counted, unread, and indistinguishable from a working device in any total — and
 * one sending a version there is no parser for.
 *
 * `ignoredReasons` is non-zero so the discard panel renders by default. On a
 * healthy installation it is hidden entirely, which is asserted separately.
 */
export const FLOW_STATUS: FlowStatus = {
  enabled: true,
  listening: true,
  address: '0.0.0.0',
  port: 2055,
  configuredPort: 2055,
  // Bound from the settings that are in force, which is the ordinary case.
  bindingOutOfDate: false,
  datagrams: 5120,
  // Equal to `datagrams`, which is what it is until somebody edits the allowlist.
  datagramsUnderAllowlist: 5120,
  records: 48210,
  malformed: 3,
  ignored: 9,
  ignoredReasons: { notAllowed: 7, sflow: 2, unsupportedVersion: 0 },
  allowedExporterCount: 2,
  allowedExporters: ['10.0.0.1', '10.0.0.2'],
  templatesCached: 4,
  detection: { flowsInspected: 48210, unansweredFlows: 112, findings: 6, intelMatches: 1 },
  exporters: [
    {
      exporter: '10.0.0.1',
      version: 10,
      protocolVersion: 'ipfix',
      datagrams: 4000,
      records: 48210,
      pendingTemplates: 0,
      malformed: 3,
      lastSeen: '2026-09-11T09:30:00.000Z',
    },
    {
      exporter: '10.0.0.2',
      version: 9,
      protocolVersion: 'netflow9',
      datagrams: 1000,
      records: 0,
      pendingTemplates: 640,
      malformed: 0,
      lastSeen: '2026-09-11T09:29:00.000Z',
    },
    {
      exporter: '10.0.0.3',
      version: 7,
      protocolVersion: null,
      datagrams: 120,
      records: 0,
      pendingTemplates: 0,
      malformed: 0,
      lastSeen: '2026-09-11T09:20:00.000Z',
    },
  ],
  startedAt: '2026-09-11T08:00:00.000Z',
};

/** Off, which is the default an installation starts from. */
export const FLOW_OFF: FlowStatus = {
  ...FLOW_STATUS,
  enabled: false,
  listening: false,
  address: null,
  // Not listening, so no bound port — but still configured for one, which is the
  // number every "point your device here" sentence has to use.
  port: null,
  configuredPort: 2055,
  datagrams: 0,
  datagramsUnderAllowlist: 0,
  records: 0,
  malformed: 0,
  ignored: 0,
  ignoredReasons: { notAllowed: 0, sflow: 0, unsupportedVersion: 0 },
  templatesCached: 0,
  detection: { flowsInspected: 0, unansweredFlows: 0, findings: 0, intelMatches: 0 },
  exporters: [],
  startedAt: null,
};

/**
 * Sensors that could be retired, and what is under each.
 *
 * Two of them, and neither is `default` — the fixture `GET /api/alerts/sensors`
 * returns as `self`. That asymmetry is the endpoint's whole behaviour: the live
 * sensor is excluded by the server, so a panel offering it would be a panel
 * ignoring the list it was given.
 *
 * The second one has only rollup buckets left, which is retention's end state and
 * the most likely state of a sensor somebody wants to retire.
 */
export const RETIRABLE_SENSORS = [
  {
    sensorId: 'branch-2',
    alerts: 4812,
    devices: 260,
    rollupBuckets: 190,
    lastSeen: '2026-08-30T22:05:00.000Z',
    active: false,
  },
  { sensorId: 'old-laptop', alerts: 0, devices: 0, rollupBuckets: 12, lastSeen: null, active: false },
];

/**
 * Audit entries.
 *
 * One of each interesting shape: a deletion carrying what was deleted, a settings
 * change carrying field *names* only, and a bulk clear with no single subject.
 */
export const AUDIT_ACTIONS = [
  { action: 'alert.delete', label: 'Deleted a finding' },
  { action: 'alerts.clear', label: 'Cleared every finding' },
  { action: 'delivery_settings.update', label: 'Changed where findings are delivered' },
];

export const AUDIT_EVENTS = [
  {
    id: 3,
    at: '2026-09-03T10:15:00.000Z',
    actor: 'admin@example.com',
    actorId: 1,
    action: 'alert.delete',
    subject: '412',
    detail: { kind: 'port_scan', severity: 'high', title: 'Port scan from 10.0.0.90' },
  },
  {
    id: 2,
    at: '2026-09-03T09:40:00.000Z',
    actor: 'admin@example.com',
    actorId: 1,
    action: 'delivery_settings.update',
    subject: null,
    detail: { fields: ['webhookUrl', 'emailPassword'] },
  },
  {
    id: 1,
    at: '2026-09-02T18:00:00.000Z',
    actor: 'user:9',
    actorId: 9,
    action: 'alerts.clear',
    subject: null,
    detail: { deleted: 1204, bySeverity: { critical: 3, high: 40 } },
  },
];

/**
 * The query console as shipped: off because nobody asked for it.
 *
 * `reason` is the part that matters — "off" is three situations needing three
 * different actions, and the default fixture is the one an installation starts in.
 */
export const ADHOC_OFF = {
  enabled: false,
  role: null,
  mode: null,
  reason: 'disabled' as const,
  passwordMayBeLogged: false,
};

/** Running, read-only, with nothing to warn about. */
export const ADHOC_RUNNING = {
  enabled: true,
  role: 'nm_adhoc_netminitoring',
  mode: 'read' as const,
  passwordMayBeLogged: false,
};

/**
 * Query console settings as a fresh install resolves them: nothing stored,
 * nothing pinned, so every field reads from the code default.
 */
export const ADHOC_SETTINGS = {
  settings: {
    enabled: { value: false, source: 'default' as const, env: 'ADHOC_ENABLED' },
    writeEnabled: { value: false, source: 'default' as const, env: 'ADHOC_WRITE_ENABLED' },
    timeoutMs: { value: 10_000, source: 'default' as const, env: 'ADHOC_TIMEOUT_MS' },
    maxRows: { value: 1000, source: 'default' as const, env: 'ADHOC_MAX_ROWS' },
    maxQueryLength: { value: 20_000, source: 'default' as const, env: 'ADHOC_MAX_QUERY_LENGTH' },
    audit: { value: 'all', source: 'default' as const, env: 'ADHOC_AUDIT' },
    /*
     * A credential, so `configured` rather than `value` — the server redacts it
     * in the resolver and no endpoint returns it. Set in this fixture, so the
     * default render is a healthy install and the missing-password warning is
     * something a test has to ask for rather than the baseline.
     */
    dbPassword: {
      source: 'database' as AdhocSettingField['source'],
      env: 'ADHOC_DB_PASSWORD',
      configured: true,
    },
  },
  passwordConfigured: true,
  /*
   * No `dbPassword` here either: the route builds `effective` by omitting every
   * secret field, so the credential is absent from this half of the response as
   * well as from `settings`.
   */
  effective: {
    enabled: false,
    writeEnabled: false,
    timeoutMs: 10_000,
    maxRows: 1000,
    maxQueryLength: 20_000,
    audit: 'all',
  },
};
