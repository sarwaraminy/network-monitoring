import type { AuditActionOption, AuditPage } from '../types';
import { api } from './client';

/**
 * The audit trail. Read-only, and not because this file chose to be.
 *
 * `audit_events` refuses UPDATE, DELETE and TRUNCATE at the database level, so
 * there is no write endpoint for this module to wrap. ADMIN-only on the server.
 */
export async function fetchAuditEvents(params: {
  limit?: number;
  action?: string;
  before?: string;
}): Promise<AuditPage> {
  const { data } = await api.get<AuditPage>('/api/audit', { params });
  return data;
}

/**
 * The action vocabulary and its labels.
 *
 * Fetched rather than duplicated here: the filter options and the values the server
 * validates against then cannot drift apart, which is how a filter ends up quietly
 * offering something that returns 400.
 */
export async function fetchAuditActions(): Promise<AuditActionOption[]> {
  const { data } = await api.get<AuditActionOption[]>('/api/audit/actions');
  return data;
}
