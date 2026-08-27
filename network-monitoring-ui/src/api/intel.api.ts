import type { IntelReloadResult, IntelStatus } from '../types';
import { api } from './client';

/**
 * Threat-intelligence status and control.
 *
 * The status endpoint is deliberately detailed. "How many indicators are loaded"
 * is the least useful number here — a feed silently serving an empty file, or
 * quietly falling back to a months-old cache, looks identical to a healthy one
 * from a total. What matters is the per-feed breakdown, which is why the page
 * built on this is a table rather than a counter.
 */
export async function fetchIntelStatus(): Promise<IntelStatus> {
  const { data } = await api.get<IntelStatus>('/api/intel/status');
  return data;
}

/**
 * Re-reads every feed now. Admin only.
 *
 * Resolves for a genuine reload and rejects otherwise, so the caller does not
 * have to inspect a status field to know whether anything actually changed. The
 * server answers 409 when a reload is already running and 503 when every source
 * failed and the previous set was kept.
 */
export async function reloadIntel(): Promise<IntelReloadResult> {
  const { data } = await api.post<IntelReloadResult>('/api/intel/reload');
  return data;
}
