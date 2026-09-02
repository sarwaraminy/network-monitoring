import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Mirrors the tables created by db/migrations/V1__Initial_setup.sql, which were
 * previously described by the JPA entities cyber.wissen.entity.User / .Log.
 * Column names are kept exactly as-is so an existing database needs no changes.
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  password: varchar('password', { length: 100 }).notNull(),
  email: varchar('email', { length: 200 }).unique(),
  role: varchar('role', { length: 50 }).notNull(),
  langCode: varchar('lang_code', { length: 10 }).notNull(),
  firstname: varchar('firstname', { length: 50 }).notNull(),
  lastname: varchar('lastname', { length: 50 }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const logs = pgTable('logs', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp', { mode: 'date' }).defaultNow(),
  sourceip: varchar('sourceip', { length: 200 }).notNull(),
  sourcemac: varchar('sourcemac', { length: 2000 }),
  destinationip: varchar('destinationip', { length: 200 }).notNull(),
  destinationmac: varchar('destinationmac', { length: 2000 }),
  protocol: varchar('protocol', { length: 100 }).notNull(),
  ipversion: varchar('ipversion', { length: 100 }),
  details: varchar('details', { length: 2000 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

/**
 * Aggregated security findings — see V4__Alerts_and_devices.sql. This supersedes
 * `logs`, which recorded one row per suspicious packet.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: varchar('kind', { length: 64 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: varchar('description').notNull(),

    sourceIp: varchar('source_ip', { length: 64 }),
    sourceMac: varchar('source_mac', { length: 32 }),
    targetIp: varchar('target_ip', { length: 64 }),
    targetMac: varchar('target_mac', { length: 32 }),
    protocol: varchar('protocol', { length: 32 }),
    /**
     * The destination port this finding is about, when exactly one port describes
     * it — see V6. Null for kinds like a port scan, whose defining property is
     * that they touched many.
     */
    port: integer('port'),

    dedupKey: varchar('dedup_key', { length: 255 }).notNull().unique(),
    occurrences: integer('occurrences').notNull().default(1),
    firstSeen: timestamp('first_seen', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeen: timestamp('last_seen', { withTimezone: true, mode: 'date' }).notNull(),

    /** Structured supporting detail. Never contains packet payloads or secrets. */
    evidence: jsonb('evidence').notNull().default({}),

    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    acknowledgedBy: varchar('acknowledged_by', { length: 200 }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('alerts_last_seen_idx').on(table.lastSeen), index('alerts_kind_idx').on(table.kind)],
);

/** MAC addresses seen before, so new-device detection survives a restart. */
export const knownDevices = pgTable('known_devices', {
  macAddress: varchar('mac_address', { length: 32 }).primaryKey(),
  firstIp: varchar('first_ip', { length: 64 }),
  lastIp: varchar('last_ip', { length: 64 }),
  label: varchar('label', { length: 200 }),
  firstSeen: timestamp('first_seen', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Findings the operator has declared expected — see V6__Alert_suppressions.sql
 * and services/suppression-rules.ts.
 *
 * Every criterion column is nullable, and null means "any", so a rule is the
 * conjunction of whichever ones are set. A rule with none of them set would match
 * everything; both the database and the API boundary refuse it.
 */
export const alertSuppressions = pgTable(
  'alert_suppressions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    kind: varchar('kind', { length: 64 }),
    sourceCidr: varchar('source_cidr', { length: 64 }),
    targetCidr: varchar('target_cidr', { length: 64 }),
    port: integer('port'),

    /** Why this is expected. Mandatory, and never blank. */
    reason: varchar('reason', { length: 500 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Null never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),

    createdBy: varchar('created_by', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),

    /**
     * How much this rule is actually hiding. The point of the whole table.
     *
     * BIGINT in the column, `mode: 'number'` here, and the two ceilings are not
     * the same: the SQL comment expects a busy rule to pass two billion, which
     * needs BIGINT, while the JS side stays exact only to 2^53. That is four
     * million times the figure the column was widened for, so the gap is
     * comfortable rather than a bug — but it is a gap, not an equivalence.
     */
    matchCount: bigint('match_count', { mode: 'number' }).notNull().default(0),
    lastMatchAt: timestamp('last_match_at', { withTimezone: true, mode: 'date' }),
  },
  // Carries the partial predicate from the migration. Migrations here are raw SQL
  // so nothing depends on this at runtime, but `drizzle-kit` is a dependency and
  // api/drizzle.config.ts exists — declaring the index without its `WHERE` makes a
  // diff report a phantom change against a table that is in fact correct.
  (table) => [index('alert_suppressions_enabled_idx').on(table.enabled).where(sql`${table.enabled}`)],
);

/**
 * Delivery settings — see V7__Delivery_settings.sql and notify/settings.ts.
 *
 * One row, every column nullable, because this is the middle layer of
 * environment → row → default and NULL means "no opinion". The environment still
 * wins, so a Compose-driven deployment cannot be contradicted by the UI.
 */
export const deliverySettings = pgTable('delivery_settings', {
  id: smallint('id').primaryKey().default(1),

  enabled: boolean('enabled'),
  minSeverity: varchar('min_severity', { length: 16 }),
  digestSeconds: integer('digest_seconds'),
  throttleSeconds: integer('throttle_seconds'),
  maxPerHour: integer('max_per_hour'),
  includeEvidence: boolean('include_evidence'),
  dashboardUrl: varchar('dashboard_url', { length: 500 }),

  /** A bearer credential for Slack and Teams. Never returned by the API. */
  webhookUrl: varchar('webhook_url', { length: 1000 }),
  webhookFormat: varchar('webhook_format', { length: 32 }),

  syslogHost: varchar('syslog_host', { length: 255 }),
  syslogPort: integer('syslog_port'),
  syslogProtocol: varchar('syslog_protocol', { length: 8 }),
  syslogFormat: varchar('syslog_format', { length: 8 }),
  syslogRfc: varchar('syslog_rfc', { length: 8 }),
  syslogFacility: integer('syslog_facility'),
  syslogAppName: varchar('syslog_app_name', { length: 64 }),
  syslogIncludeEvidence: boolean('syslog_include_evidence'),

  emailHost: varchar('email_host', { length: 255 }),
  emailPort: integer('email_port'),
  emailSecure: boolean('email_secure'),
  emailUser: varchar('email_user', { length: 255 }),
  /** A password. Never returned by the API. */
  emailPassword: varchar('email_password', { length: 500 }),
  emailFrom: varchar('email_from', { length: 255 }),
  /** An array, so a recipient containing a comma cannot corrupt the set. */
  emailTo: text('email_to').array(),

  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedBy: varchar('updated_by', { length: 200 }),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type LogRow = typeof logs.$inferSelect;
export type NewLogRow = typeof logs.$inferInsert;
export type AlertRow = typeof alerts.$inferSelect;
export type NewAlertRow = typeof alerts.$inferInsert;
export type KnownDeviceRow = typeof knownDevices.$inferSelect;
export type DeliverySettingsRow = typeof deliverySettings.$inferSelect;
export type NewDeliverySettingsRow = typeof deliverySettings.$inferInsert;
export type SuppressionRow = typeof alertSuppressions.$inferSelect;
export type NewSuppressionRow = typeof alertSuppressions.$inferInsert;
