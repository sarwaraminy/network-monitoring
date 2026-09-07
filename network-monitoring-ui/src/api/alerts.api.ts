import type {
  Alert,
  AlertDashboard,
  AlertKind,
  AlertSummary,
  KnownDevice,
  SensorSummary,
  Severity,
} from '../types';
import { api } from './client';

export interface AlertFilters {
  severity?: Severity;
  kind?: AlertKind;
  /** ISO timestamp, or a relative window such as `24h`. */
  since?: string;
  acknowledged?: boolean;
  /**
   * One sensor's findings. Omitted means every sensor, which is the server's
   * default too — sharing a database is what makes a second sensor worth having.
   */
  sensor?: string;
  limit?: number;
}

export async function fetchAlerts(filters: AlertFilters = {}): Promise<Alert[]> {
  const { data } = await api.get<Alert[]>('/api/alerts', { params: filters });
  return data;
}

export async function fetchAlertSummary(sensor?: string): Promise<AlertSummary> {
  const { data } = await api.get<AlertSummary>('/api/alerts/summary', {
    ...(sensor ? { params: { sensor } } : {}),
  });
  return data;
}

/** Which sensors have written findings here, and which one is serving this page. */
export async function fetchSensors(): Promise<SensorSummary[]> {
  const { data } = await api.get<SensorSummary[]>('/api/alerts/sensors');
  return data;
}

/** Summary plus the trend buckets and top sources the dashboard plots. */
export async function fetchAlertDashboard(days: number, sensor?: string): Promise<AlertDashboard> {
  const { data } = await api.get<AlertDashboard>('/api/alerts/dashboard', {
    params: { days, ...(sensor ? { sensor } : {}) },
  });
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

export async function fetchKnownDevices(sensor?: string): Promise<KnownDevice[]> {
  const { data } = await api.get<KnownDevice[]>('/api/alerts/devices', {
    ...(sensor ? { params: { sensor } } : {}),
  });
  return data;
}
