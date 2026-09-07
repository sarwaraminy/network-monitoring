import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as alertsApi from '../api/alerts.api';
import { ALERTS_ROOT_KEY, queryKeys } from '../api/queryClient';
import type { Alert } from '../types';

/**
 * Alert data. The page used to hold `alerts`, `summary`, `loading` and `error` in
 * its own state and refetch both endpoints by hand after every mutation; now a
 * mutation invalidates the `alerts` key and both queries refresh themselves.
 */

export function useAlerts(filters: alertsApi.AlertFilters) {
  return useQuery({
    queryKey: queryKeys.alerts(filters),
    queryFn: () => alertsApi.fetchAlerts(filters),
    // Keeps the previous rows on screen while a filter change loads, instead of
    // flashing an empty table.
    placeholderData: (previous) => previous,
  });
}

export function useAlertSummary(sensor?: string) {
  return useQuery({
    queryKey: queryKeys.alertSummary(sensor),
    queryFn: () => alertsApi.fetchAlertSummary(sensor),
    // Drives the severity tiles; cheap enough to poll while a capture runs.
    refetchInterval: 15_000,
  });
}

/**
 * The sensors writing to this database.
 *
 * Long `staleTime` because the answer changes when somebody installs a sensor,
 * which is not something a page needs to notice within seconds — and because
 * every consumer uses it only to decide whether to render a control at all. A
 * filter that appeared and vanished under the pointer would be worse than one
 * that arrives a minute late.
 */
export function useSensors() {
  return useQuery({
    queryKey: queryKeys.sensors,
    queryFn: alertsApi.fetchSensors,
    staleTime: 300_000,
  });
}

export function useAcknowledgeAlert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (alert: Alert) =>
      alert.acknowledgedAt ? alertsApi.unacknowledgeAlert(alert.id) : alertsApi.acknowledgeAlert(alert.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ALERTS_ROOT_KEY }),
  });
}

export function useDeleteAlert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => alertsApi.deleteAlert(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ALERTS_ROOT_KEY }),
  });
}

/**
 * How many distinct machines the device rows describe.
 *
 * Not `rows.length`. `known_devices` is keyed on (sensor, MAC) since V16, so one
 * physical device seen by two sensors is two rows — and every caption this number
 * appears under talks about addresses, not rows. Counting rows would inflate it by
 * exactly the overlap between sensors, on precisely the installations that have
 * overlapping coverage and therefore care.
 *
 * Exported and pure so it can be asserted without rendering a page full of charts.
 */
export function distinctMacCount(devices: readonly { macAddress: string }[]): number {
  return new Set(devices.map((device) => device.macAddress)).size;
}

export function useKnownDevices(sensor?: string) {
  return useQuery({
    queryKey: queryKeys.knownDevices(sensor),
    queryFn: () => alertsApi.fetchKnownDevices(sensor),
    staleTime: 60_000,
  });
}
