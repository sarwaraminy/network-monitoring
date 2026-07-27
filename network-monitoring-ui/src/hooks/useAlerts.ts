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

export function useAlertSummary() {
  return useQuery({
    queryKey: queryKeys.alertSummary,
    queryFn: alertsApi.fetchAlertSummary,
    // Drives the severity tiles; cheap enough to poll while a capture runs.
    refetchInterval: 15_000,
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

export function useKnownDevices() {
  return useQuery({
    queryKey: queryKeys.knownDevices,
    queryFn: alertsApi.fetchKnownDevices,
    staleTime: 60_000,
  });
}
