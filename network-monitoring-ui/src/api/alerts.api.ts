import type {
  Alert,
  AlertDashboard,
  AlertKind,
  AlertSummary,
  DecommissionResult,
  KnownDevice,
  RetirableSensor,
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

/**
 * Sensors that could be decommissioned, with what is recorded under each.
 *
 * Not `fetchSensors` above: that one is the filter, and it always includes the
 * installation serving the page even before it has written anything. This one is
 * the menu a destructive action is chosen from, so the server leaves the live
 * sensor out of it — see `listRetirableSensors`.
 */
export async function fetchRetirableSensors(): Promise<RetirableSensor[]> {
  const { data } = await api.get<RetirableSensor[]>('/api/alerts/sensors/retirable');
  return data;
}

/** Drops a retired sensor's findings, devices, rollups and capture session. */
export async function decommissionSensor(sensorId: string): Promise<DecommissionResult> {
  const { data } = await api.delete<DecommissionResult>(
    `/api/alerts/sensors/${encodeURIComponent(sensorId)}`,
  );
  return data;
}
