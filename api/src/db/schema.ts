import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
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

    /** How much this rule is actually hiding. The point of the whole table. */
    matchCount: bigint('match_count', { mode: 'number' }).notNull().default(0),
    lastMatchAt: timestamp('last_match_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('alert_suppressions_enabled_idx').on(table.enabled)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type LogRow = typeof logs.$inferSelect;
export type NewLogRow = typeof logs.$inferInsert;
export type AlertRow = typeof alerts.$inferSelect;
export type NewAlertRow = typeof alerts.$inferInsert;
export type KnownDeviceRow = typeof knownDevices.$inferSelect;
export type SuppressionRow = typeof alertSuppressions.$inferSelect;
export type NewSuppressionRow = typeof alertSuppressions.$inferInsert;
