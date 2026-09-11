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

/** One field's resolved value, with which layer decided it. */
export interface FlowSettingField {
  source: 'environment' | 'database' | 'default';
  /** The environment variable that would pin it. */
  env: string;
  value: unknown;
}

export interface FlowSettingsResponse {
  settings: Record<string, FlowSettingField>;
  /** Fields the environment has pinned, which must not be offered for editing. */
  pinned: string[];
}

export interface FlowSettingsPatch {
  enabled?: boolean | null;
  port?: number | null;
  bindAddress?: string | null;
  exporters?: string | null;
}

export interface FlowSettingsSaved extends FlowSettingsResponse {
  /** Whether the socket had to be closed and reopened for this to take effect. */
  rebound: boolean;
  /** The state straight afterwards — how a failed rebind is reported. */
  status: FlowStatus;
}

export async function fetchFlowSettings(): Promise<FlowSettingsResponse> {
  const { data } = await api.get<FlowSettingsResponse>('/api/flow/settings');
  return data;
}

export async function saveFlowSettings(patch: FlowSettingsPatch): Promise<FlowSettingsSaved> {
  const { data } = await api.put<FlowSettingsSaved>('/api/flow/settings', patch);
  return data;
}
