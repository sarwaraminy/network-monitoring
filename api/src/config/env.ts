import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolve api/.env from this module rather than from process.cwd(), so the server
// behaves the same whether it is started from api/ or from the repository root.
// Both src/config/ and dist/config/ sit two levels below api/.
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(API_ROOT, '.env') });
// Also honour a .env in the working directory, without overriding the above.
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy api/.env.example to api/.env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    // TypeError, not Error: the value is the wrong shape, not a failed operation.
    throw new TypeError(`Environment variable ${name} must be an integer, got "${raw}".`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url && url.trim() !== '') return url;

  const host = optional('PGHOST', 'localhost');
  const port = int('PGPORT', 5432);
  const database = optional('PGDATABASE', 'netminitoring');
  const user = optional('PGUSER', 'postgres');
  const password = process.env.PGPASSWORD ?? '';
  const auth =
    password === ''
      ? encodeURIComponent(user)
      : `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgres://${auth}@${host}:${port}/${database}`;
}

/**
 * Parses `ip=mac,ip=mac` into a lookup used by the ARP spoof detector.
 * Replaces the hardcoded map in the old PacketCaptureService.getKnownMappings().
 */
function arpTrustedMappings(): ReadonlyMap<string, string> {
  const raw = optional('ARP_TRUSTED_MAPPINGS', '');
  const map = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const ip = trimmed.slice(0, separator).trim();
    const mac = trimmed
      .slice(separator + 1)
      .trim()
      .toLowerCase();
    if (ip !== '' && mac !== '') map.set(ip, mac);
  }
  return map;
}

/** Parses `10.0.0.1,10.0.0.2` into the flow exporter allow-list. */
function flowExporters(): string[] {
  return optional('FLOW_EXPORTERS', '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  port: int('PORT', 8080),
  corsOrigins: optional('CORS_ORIGIN', 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== ''),

  databaseUrl: databaseUrl(),
  dbAutoMigrate: bool('DB_AUTO_MIGRATE', true),

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '1d'),

  captureBufferSize: int('CAPTURE_BUFFER_SIZE', 5000),
  /** How often a running capture is drained. The pcap handle is non-blocking. */
  capturePollIntervalMs: Math.max(1, int('CAPTURE_POLL_INTERVAL_MS', 10)),
  /**
   * Blanks packet payloads in API responses. For deployments where captured
   * traffic may contain personal data or message content — which brings wiretap
   * statutes and GDPR into scope — this keeps payloads off the wire entirely.
   */
  redactPacketPayload: bool('REDACT_PACKET_PAYLOAD', false),
  arpTrustedMappings: arpTrustedMappings(),

  /**
   * NetFlow/IPFIX collector. Off by default because it opens a UDP port, and a
   * listening port nobody asked for is not something a deployment should acquire
   * by upgrading.
   */
  flow: {
    enabled: bool('FLOW_ENABLED', false),
    /** 2055 is the de facto NetFlow port; 4739 is IANA's for IPFIX. */
    port: int('FLOW_PORT', 2055),
    /**
     * Defaults to all interfaces so a first run works without knowing the
     * container's address. Narrow this to a management interface in production:
     * the protocol has no authentication, so reachability is the access control.
     */
    bindAddress: optional('FLOW_BIND_ADDRESS', '0.0.0.0'),
    /**
     * Addresses permitted to send flow data. Empty accepts any source, which is
     * needed for discovery but should be filled in once the exporters are known —
     * NetFlow source addresses are spoofable, so this is the only filter available.
     */
    allowedExporters: flowExporters(),
  },

  /** Requests allowed per minute per client IP, by endpoint group. */
  rateLimit: {
    /** Failed logins and signups per minute. Successful ones are not counted. */
    authPerMinute: int('RATE_LIMIT_AUTH_PER_MINUTE', 20),
    /** Starting and stopping captures. */
    captureControlPerMinute: int('RATE_LIMIT_CAPTURE_PER_MINUTE', 20),
    /** ip-info, which fans out to DNS, WHOIS and a third-party API. */
    lookupPerMinute: int('RATE_LIMIT_LOOKUP_PER_MINUTE', 30),
    /** Backstop for everything else under /api. */
    apiPerMinute: int('RATE_LIMIT_API_PER_MINUTE', 600),
  },

  /**
   * Detection thresholds. Every one of these trades false positives against
   * missed detections, so they are tunable per network rather than hardcoded.
   */
  detection: {
    /** Window for scan/sweep breadth counting. */
    scanWindowMs: int('DETECT_SCAN_WINDOW_MS', 60_000),
    /** Distinct ports on one host before it counts as a port scan. */
    portScanPorts: int('DETECT_PORT_SCAN_PORTS', 15),
    /** Distinct hosts on one port before it counts as a host sweep. */
    hostSweepHosts: int('DETECT_HOST_SWEEP_HOSTS', 20),
    /** Window for connection-rate counting. */
    floodWindowMs: int('DETECT_FLOOD_WINDOW_MS', 10_000),
    /** Connection attempts in that window before it counts as a flood. */
    synFloodAttempts: int('DETECT_SYN_FLOOD_ATTEMPTS', 300),
    /** Distinct subdomains of one parent domain that suggest DNS tunnelling. */
    dnsDistinctSubdomains: int('DETECT_DNS_SUBDOMAINS', 40),
    /** Grace period at the start of a capture during which devices are learned silently. */
    deviceLearningPeriodMs: int('DETECT_DEVICE_LEARNING_MS', 60_000),
    /** Repeats of one finding merge into a single alert for this long. */
    alertWindowMs: int('DETECT_ALERT_WINDOW_MS', 300_000),
  },
} as const;
