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

/**
 * A retention window in days, with a floor.
 *
 * The floor is the point. `ALERT_RETENTION_DAYS=1` is a plausible typo for 10 or 100,
 * and it would delete very nearly every finding on the next sweep — irreversibly,
 * because the rollup keeps counts rather than rows. Seven days is short enough to be
 * a legitimate choice for a noisy lab and long enough that a slipped digit cannot
 * empty the table. Clamped loudly rather than honoured, since silently accepting a
 * dangerous number is how this goes wrong once and unrecoverably.
 */
const MIN_RETENTION_DAYS = 7;

function retentionDays(name: string, fallback: number): number {
  const days = int(name, fallback);
  if (days < MIN_RETENTION_DAYS) {
    console.warn(
      `[config] ${name}=${days} is below the ${MIN_RETENTION_DAYS}-day minimum; using ${MIN_RETENTION_DAYS}. ` +
        'Set RETENTION_ENABLED=false to keep everything instead.',
    );
    return MIN_RETENTION_DAYS;
  }
  return days;
}

/**
 * `setInterval` takes a signed 32-bit delay in milliseconds. Anything larger is not
 * rejected and does not throw — Node emits a `TimeoutOverflowWarning` and silently
 * uses **1 ms**, so `RETENTION_SWEEP_HOURS=720` (a monthly sweep, and a perfectly
 * reasonable thing to ask for) would run the sweep continuously against the database
 * instead of once a month.
 */
const MAX_SWEEP_HOURS = Math.floor(2_147_483_647 / 3_600_000);

function sweepHours(name: string, fallback: number): number {
  const hours = int(name, fallback);

  if (hours < 1) {
    console.warn(`[config] ${name}=${hours} is not a usable interval; using 1 hour.`);
    return 1;
  }
  if (hours > MAX_SWEEP_HOURS) {
    // Named and explained rather than quietly clamped: the operator asked for a
    // month and is getting 24 days, and the reason is a platform limit they have
    // no way to guess.
    console.warn(
      `[config] ${name}=${hours} exceeds the ${MAX_SWEEP_HOURS}-hour maximum a JavaScript timer ` +
        `can express; using ${MAX_SWEEP_HOURS}. Retention only needs to run often enough to keep ` +
        'the backlog small, so a longer interval buys nothing.',
    );
    return MAX_SWEEP_HOURS;
  }

  return hours;
}

/**
 * A setting whose value must be one of a fixed set.
 *
 * Falls back loudly rather than silently: a typo in a mode name is a
 * configuration the operator believes is in force, and the difference between
 * `off` and `all` here is a table filling up or not.
 */
function oneOf<const T extends readonly string[]>(name: string, allowed: T, fallback: T[number]): T[number] {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T[number];
  console.warn(`[config] ${name}=${raw} is not one of ${allowed.join(', ')}; using ${fallback}.`);
  return fallback;
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

  /**
   * Allow anyone to register an account.
   *
   * False by default, and it should stay false for any real deployment. Account
   * creation is otherwise restricted to an authenticated administrator, plus a
   * single unauthenticated request to create the very first account on an empty
   * installation — see routes/auth.routes.ts.
   *
   * Even when this is true, a self-registered account is always a USER. A public
   * form that can mint administrators is exactly the hole this setting replaced.
   */
  allowOpenSignup: bool('ALLOW_OPEN_SIGNUP', false),

  captureBufferSize: int('CAPTURE_BUFFER_SIZE', 5000),
  /** How often a running capture is drained. The pcap handle is non-blocking. */
  capturePollIntervalMs: Math.max(1, int('CAPTURE_POLL_INTERVAL_MS', 10)),
  /**
   * Blanks packet payloads in API responses. For deployments where captured
   * traffic may contain personal data or message content — which brings wiretap
   * statutes and GDPR into scope — this keeps payloads off the wire entirely.
   *
   * On by default. Off was the wrong default for a tool whose API hands back the
   * whole frame hex-encoded: it made every reader of /api/packets a wiretap, and
   * a deployment that wants raw frames should have to say so.
   */
  redactPacketPayload: bool('REDACT_PACKET_PAYLOAD', true),

  /**
   * Whether something in front of this API sets `X-Forwarded-For`.
   *
   * Off by default, and that matters: express-rate-limit keys on `req.ip`, which
   * with this on is read from that header. Enabled where nothing sets it — an
   * API reached directly, which the README's host-install path produces — a
   * caller can send a fresh value per request and never trip the auth limiter.
   */
  trustProxy: bool('TRUST_PROXY', false),
  arpTrustedMappings: arpTrustedMappings(),

  /**
   * Threat intelligence.
   *
   * Off by default, and no feeds are shipped. Which intelligence to trust is the
   * operator's call, and a security tool should not start making outbound
   * requests to a third-party list nobody chose.
   */
  intel: {
    enabled: bool('INTEL_ENABLED', false),
    /**
     * `name=location` pairs, comma-separated. A location is a URL or a file path.
     * Local files are first-class: the networks this tool is aimed at frequently
     * have no outbound internet from the monitoring host.
     */
    feeds: optional('INTEL_FEEDS', ''),
    /**
     * How often feeds are re-read. Stale intelligence is close to useless.
     *
     * Floored at one hour. `0` is the natural way to write "never refresh", but
     * without a floor it becomes `setInterval(…, 0)` — a continuous refetch loop
     * that hammers whatever third-party URL is configured until they block you.
     * `capturePollIntervalMs` above sets the same precedent.
     */
    refreshMs: Math.max(1, int('INTEL_REFRESH_HOURS', 6)) * 3_600_000,
    /** Downloaded copies live here so a restart without connectivity still loads. */
    cacheDir: (() => {
      const configured = optional('INTEL_CACHE_DIR', '');
      return configured !== '' ? configured : resolve(API_ROOT, '.cache/intel');
    })(),
    /** Ceiling on indicators held in memory, so one bad feed cannot exhaust it. */
    maxIndicators: int('INTEL_MAX_INDICATORS', 500_000),
  },

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

  /**
   * How long findings are kept in full detail.
   *
   * `alerts` and `known_devices` grow without bound — one recurring finding produces
   * a row every `alertWindowMs`, and `known_devices` gains one per MAC address ever
   * seen, which on a network of phones using randomised addresses is one per phone
   * per address.
   *
   * Detail expires; the shape does not. Every day of alerts is aggregated into
   * `alert_rollup_daily` in the same transaction that deletes it, and the rollup is
   * never pruned — so a dashboard set to a year still has a trend long after the
   * individual rows have gone. Deleting without that would make an expired month
   * render exactly like a quiet one, which is the confusion this codebase works
   * hardest to avoid.
   */
  retention: {
    /**
     * On by default: an unbounded table is a problem every installation eventually
     * has, and the default window is long enough that nobody meets it by surprise.
     * Set false to keep everything for ever.
     */
    enabled: bool('RETENTION_ENABLED', true),
    /** Full-detail alert rows. A year, after which the daily rollup carries it. */
    alertDays: retentionDays('ALERT_RETENTION_DAYS', 365),
    /**
     * How long a device is remembered after it was last seen.
     *
     * Pruning one means it is reported as new if it ever returns, which is the same
     * trade `DELETE /api/alerts/devices/:mac` already makes deliberately — after a
     * year of absence, "this appeared on the network" is arguably true again.
     */
    deviceDays: retentionDays('DEVICE_RETENTION_DAYS', 365),
    /**
     * Gap between sweeps. The work is idempotent, so a missed one costs nothing.
     *
     * Clamped at both ends — see `sweepHours`. The upper bound is not a policy
     * choice: past it a JavaScript timer silently becomes 1 ms.
     */
    sweepHours: sweepHours('RETENTION_SWEEP_HOURS', 24),
  },

  /**
   * The Ad Hoc Query console.
   *
   * OFF by default, and that is the important default in this whole file. Every
   * other feature here fails towards doing less; this one, switched on without
   * thought, is a SQL prompt on the production database reachable from a browser
   * session. An installation should have to decide to have it.
   *
   * There is deliberately no connection-string setting. The console's role name
   * is fixed in code, and only its password comes from here — an
   * `ADHOC_DATABASE_URL` would be one an operator could point at `postgres`,
   * turning every restriction off while the feature still appeared to work. See
   * `adhoc.service.ts`, which additionally refuses to start unless the database
   * confirms the role is neither a superuser nor able to write.
   *
   * ---
   *
   * **Do not read these values to decide what the console does.** Since V14 they
   * are one layer of three — environment, then the stored row, then the code
   * default — and `adhoc-settings.service.ts` is the only correct reader. An
   * administrator can change **all of them, including the password**, from the
   * interface, without the restart that on a monitoring server means dropping a
   * live capture.
   *
   * This paragraph used to say the password was the exception, on the grounds
   * that keeping it here is what kept the decision to *have* a SQL prompt on
   * production with whoever installed the server. That was true when it was
   * written and V15 reversed it deliberately — see `adhoc-settings.ts`, which
   * argues the trade and lists what holds the line instead. The text was simply
   * left behind, which matters more here than in most comments: this is the
   * paragraph an operator reads to decide whether shipping `ADHOC_DB_PASSWORD`
   * in their environment is what gates console access. Setting it here still
   * PINS the field, so it is still an answer — just no longer the only one.
   *
   * **One consequence neither layer states, and it is the surprising one:**
   * because `seedAdhocSettingsFromEnvironment` copies whatever the environment
   * says into the row at first boot, *removing* `ADHOC_ENABLED` or
   * `ADHOC_DB_PASSWORD` later does not turn the console off. The row keeps the
   * copy and the console goes on running. That follows from the seed's stated
   * intent — deleting a line should keep the behaviour you had rather than
   * revert to a default nobody chose — but for the two fields that decide
   * whether a browser can run SQL, an operator will reasonably expect deleting
   * the line to be the off switch. It is not. Set `ADHOC_ENABLED=false`
   * explicitly, or clear the setting in the interface.
   *
   * What this block is still for is boot-time validation. `int()` throws on
   * `ADHOC_MAX_ROWS=lots`, which the resolver would only ignore, and being told
   * at startup beats a limit quietly not applying. Note the one gap: a value
   * that parses but falls outside V14's CHECK bounds passes here and is then
   * ignored by the resolver, so the field reports itself as unpinned. Refusing
   * to boot over a console limit seemed the worse trade.
   */
  adhoc: {
    enabled: bool('ADHOC_ENABLED', false),
    /**
     * Lets the console UPDATE, INSERT and DELETE as well as read.
     *
     * OFF by default, and separate from `enabled` on purpose: turning the console
     * ON and letting it WRITE are two different decisions, and only one of them
     * can destroy data from a browser session.
     *
     * This does not merely permit the app to issue writes — it selects a
     * different Postgres ROLE. Off, the console authenticates as V11's
     * `nm_adhoc_<db>`, which holds SELECT and nothing else; on, as V12's
     * `nm_adhocrw_<db>`. So a read-only install stays read-only in the database
     * rather than in an `if`, and this flag is never the only thing standing
     * between a session and a DELETE.
     *
     * What write mode still cannot do: touch `audit_events` (the trail stays
     * append-only, so the console's own use remains investigable), read or write
     * the secret columns, change `users` or `delivery_settings`, or act as a
     * superuser. It writes the operational tables — findings, devices,
     * suppressions, the legacy log, the rollup — and nothing else. See V12.
     *
     * Auditing is forced to `all` while this is on: a write nobody recorded is
     * the one entry a trail cannot afford to be missing.
     */
    write: bool('ADHOC_WRITE_ENABLED', false),
    /**
     * Set on the console's role at boot. Empty leaves the console off.
     *
     * Worth knowing before choosing one: `ALTER ROLE … PASSWORD` has no
     * parameterised form, so this value is part of the statement text. The app
     * runs it with `SET LOCAL log_statement = 'none'`, but that setting is
     * superuser-only — so if the database owner is not a superuser, the
     * suppression is skipped and this password is written to the Postgres log in
     * cleartext under `log_statement = 'ddl'` or `'all'`. Treat it as a
     * credential the database server may record, and not as one reused anywhere.
     */
    password: process.env.ADHOC_DB_PASSWORD ?? '',
    /**
     * A query stops here rather than running until somebody notices. Ten seconds
     * is long for an interactive question and short next to the damage a
     * cartesian join does to a pool shared with detection.
     */
    timeoutMs: int('ADHOC_TIMEOUT_MS', 10_000),
    /** Rows returned to the browser. A grid, not an export. */
    maxRows: int('ADHOC_MAX_ROWS', 1_000),
    /** Characters accepted, so the body limit is not the thing that rejects a query. */
    maxLength: int('ADHOC_MAX_QUERY_LENGTH', 20_000),
    /**
     * How much of the console's activity reaches the audit trail.
     *
     *  - `all`     — every query as it is accepted, before its result is known.
     *  - `refused` — only queries the database rejected, which is the set worth
     *                keeping if the trail is being read for attempts rather than
     *                for activity: a `SELECT password FROM users` that came back
     *                `permission denied` is exactly the row somebody wants later.
     *  - `off`     — nothing.
     *
     * `all` is the default because this is a SQL console over security findings,
     * and "who asked what" is the question an audit trail exists for. It is
     * configurable because that is also a lot of rows on an installation using
     * the console routinely, and an operator who cannot quiet it will end up
     * reading past it — which is worse for the trail than not writing it.
     */
    audit: bool('ADHOC_WRITE_ENABLED', false)
      ? // Not configurable in write mode: `refused` or `off` would leave a
        // successful DELETE with no record of who ran it, which is the single
        // entry this trail most needs.
        ('all' as const)
      : oneOf('ADHOC_AUDIT', ['all', 'refused', 'off'] as const, 'all'),
  },
} as const;
