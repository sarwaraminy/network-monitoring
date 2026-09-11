import type { FlowStatus } from '../types';
import { api } from './client';

/**
 * The flow collector's status.
 *
 * Read-only, and the endpoint is too: the collector's lifetime is the process's.
 * It is infrastructure driven by whether exporters are configured to send to it,
 * not something a person starts and stops like a packet capture — see
 * `flow.routes.ts`, which declines to expose a start or a stop on the grounds
 * that a button for it would invite silently switching security telemetry off.
 */
export async function fetchFlowStatus(): Promise<FlowStatus> {
  const { data } = await api.get<FlowStatus>('/api/flow/status');
  return data;
}
