import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../api/client';
import {
  type CaptureScope,
  clearPackets,
  fetchCaptureStatus,
  fetchNetworkInterfaces,
  fetchPackets,
  startCapture,
  stopCapture,
} from '../api/packets.api';
import { ALERTS_ROOT_KEY, queryKeys } from '../api/queryClient';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const POLL_INTERVAL_MS =
  Number.parseInt(import.meta.env.VITE_POLL_INTERVAL_MS ?? '', 10) || DEFAULT_POLL_INTERVAL_MS;

export const DEFAULT_SNAPSHOT_LENGTH = 65_536;
export const DEFAULT_TIMEOUT_MS = 10;

/**
 * All the capture state the two pages share. PacketCapture and
 * PacketCaptureWithIP differ only in the endpoint prefix and one extra input.
 *
 * Polling is now `refetchInterval` on the packets and status queries rather than a
 * hand-managed `setInterval`. TanStack Query handles what the old code did not:
 * it will not stack overlapping requests, it pauses while the tab is hidden, and
 * it keeps showing the last good data instead of blanking on a transient failure.
 */
export function usePacketCapture(scope: CaptureScope) {
  const client = useQueryClient();

  const [selectedInterface, setSelectedInterface] = useState('');
  const [snapshotLength, setSnapshotLength] = useState(DEFAULT_SNAPSHOT_LENGTH);
  const [timeout, setTimeoutMs] = useState(DEFAULT_TIMEOUT_MS);
  const [filterIp, setFilterIp] = useState('');
  const [actionError, setActionError] = useState('');

  const interfacesQuery = useQuery({
    queryKey: queryKeys.interfaces(scope),
    queryFn: () => fetchNetworkInterfaces(scope),
    // The interface list only changes when hardware does.
    staleTime: 5 * 60_000,
  });

  const statusQuery = useQuery({
    queryKey: queryKeys.captureStatus(scope),
    queryFn: () => fetchCaptureStatus(scope),
    // Reading status on mount is what lets a page reload mid-capture show the real
    // state rather than resetting to idle.
    refetchInterval: (query) => (query.state.data?.capturing ? POLL_INTERVAL_MS : false),
  });

  const capturing = statusQuery.data?.capturing ?? false;

  const packetsQuery = useQuery({
    queryKey: queryKeys.packets(scope),
    queryFn: () => fetchPackets(scope),
    refetchInterval: capturing ? POLL_INTERVAL_MS : false,
    placeholderData: (previous) => previous,
  });

  // Default the dropdown to whatever a capture already in progress is using.
  useEffect(() => {
    const running = statusQuery.data?.interfaceName;
    if (running) setSelectedInterface((previous) => previous || running);
  }, [statusQuery.data?.interfaceName]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.captureStatus(scope) }),
      client.invalidateQueries({ queryKey: queryKeys.packets(scope) }),
    ]);
  }, [client, scope]);

  const startMutation = useMutation({
    mutationFn: () =>
      startCapture(scope, {
        interfaceName: selectedInterface,
        snaplength: snapshotLength,
        timeout,
        ...(scope === 'filtered-ip' ? { ipAddress: filterIp.trim() } : {}),
      }),
    onSuccess: (status) => {
      client.setQueryData(queryKeys.captureStatus(scope), status);
      void refreshAll();
    },
    onError: (error) => setActionError(describeError(error, 'Could not start the capture')),
  });

  const stopMutation = useMutation({
    mutationFn: () => stopCapture(scope),
    onSuccess: (status) => {
      client.setQueryData(queryKeys.captureStatus(scope), status);
      // A capture writes alerts, so the alerts views are now stale too.
      void client.invalidateQueries({ queryKey: ALERTS_ROOT_KEY });
      void refreshAll();
    },
    onError: (error) => setActionError(describeError(error, 'Could not stop the capture')),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearPackets(scope),
    onSuccess: () => {
      client.setQueryData(queryKeys.packets(scope), []);
      void refreshAll();
    },
    onError: (error) => setActionError(describeError(error, 'Could not clear the captured packets')),
  });

  const busy = startMutation.isPending || stopMutation.isPending || clearMutation.isPending;

  // The first load error that matters, whichever query hit it, plus any failed action.
  const error =
    actionError ||
    (interfacesQuery.error
      ? describeError(interfacesQuery.error, 'Could not load network interfaces')
      : '') ||
    (packetsQuery.error ? describeError(packetsQuery.error, 'Could not fetch captured packets') : '');

  const canStart =
    !capturing && !busy && selectedInterface !== '' && (scope !== 'filtered-ip' || filterIp.trim() !== '');

  return {
    interfaces: interfacesQuery.data ?? [],
    selectedInterface,
    setSelectedInterface,
    snapshotLength,
    setSnapshotLength,
    timeout,
    setTimeoutMs,
    filterIp,
    setFilterIp,
    packets: packetsQuery.data ?? [],
    status: statusQuery.data ?? null,
    capturing,
    busy,
    loadingInterfaces: interfacesQuery.isPending,
    loadingPackets: packetsQuery.isPending,
    error,
    setError: setActionError,
    canStart,
    start: () => {
      setActionError('');
      startMutation.mutate();
    },
    stop: () => {
      setActionError('');
      stopMutation.mutate();
    },
    clear: () => {
      setActionError('');
      clearMutation.mutate();
    },
    refreshPackets: refreshAll,
  };
}

export type UsePacketCapture = ReturnType<typeof usePacketCapture>;
