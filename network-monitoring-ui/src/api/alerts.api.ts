import type { Alert, AlertDashboard, AlertKind, AlertSummary, KnownDevice, Severity } from '../types';
import { api } from './client';

export interface AlertFilters {
  severity?: Severity;
  kind?: AlertKind;
  /** ISO timestamp, or a relative window such as `24h`. */
  since?: string;
  acknowledged?: boolean;
  limit?: number;
}

export async function fetchAlerts(filters: AlertFilters = {}): Promise<Alert[]> {
  const { data } = await api.get<Alert[]>('/api/alerts', { params: filters });
  return data;
}

export async function fetchAlertSummary(): Promise<AlertSummary> {
  const { data } = await api.get<AlertSummary>('/api/alerts/summary');
  return data;
}

/** Summary plus the trend buckets and top sources the dashboard plots. */
export async function fetchAlertDashboard(days: number): Promise<AlertDashboard> {
  const { data } = await api.get<AlertDashboard>('/api/alerts/dashboard', { params: { days } });
  return data;
}

export async function acknowledgeAlert(id: number): Promise<Alert> {
  const { data } = await api.post<Alert>(`/api/alerts/${id}/acknowledge`);
  return data;
}

export async function unacknowledgeAlert(id: number): Promise<Alert> {
  const { data } = await api.post<Alert>(`/api/alerts/${id}/unacknowledge`);
  return data;
}

export async function deleteAlert(id: number): Promise<void> {
  await api.delete(`/api/alerts/${id}`);
}

export async function fetchKnownDevices(): Promise<KnownDevice[]> {
  const { data } = await api.get<KnownDevice[]>('/api/alerts/devices');
  return data;
}
