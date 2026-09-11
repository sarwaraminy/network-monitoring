import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
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
import type { Message } from '../i18n/message-state';
import type { CaptureStatus, InterruptedCapture, StartCaptureParams } from '../types';

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
/**
 * Whether the capture status is still worth asking about.
 *
 * Exported and pure because the alternative is asserting a `refetchInterval`
 * through React Query with fake timers, which tests the harness more than the
 * rule — the same reason `boundaryBandIndex` is exported from the trend chart.
 *
 * `resumePending` rather than `interrupted`, and the difference is a request per
 * second per open tab. An interruption means the state is still in motion only
 * when something is going to act on it: with `CAPTURE_RESUME_ON_START` on the
 * server is about to start a capture, and with it off — the default — the notice
 * waits on a person, and polling a value the server has no path to change would
 * hold a 1 Hz loop open on the screen an operator is most likely to leave open.
 */
export function keepPolling(status: CaptureStatus | undefined): boolean {
  return Boolean(status?.capturing || status?.resumePending);
}

export function usePacketCapture(scope: CaptureScope) {
  const client = useQueryClient();

  const [selectedInterface, setSelectedInterface] = useState('');
  const [snapshotLength, setSnapshotLength] = useState(DEFAULT_SNAPSHOT_LENGTH);
  const [timeout, setTimeoutMs] = useState(DEFAULT_TIMEOUT_MS);
  const [filterIp, setFilterIp] = useState('');
  // The message rather than its words, so the toolbar re-reads it when the
  // language changes — see i18n/message-state.ts.
  const [actionError, setActionError] = useState<Message | null>(null);

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
    /*
     * Polling follows an unresolved interruption as well as a running capture,
     * because the server can now start one without being asked.
     *
     * With `CAPTURE_RESUME_ON_START=true` the first status after an API restart
     * reports `capturing: false` with an `interrupted` notice — the report happens
     * early in boot and the resume only after `startIntel()`, which can take
     * seconds. Keyed on `capturing` alone the page stopped asking at exactly that
     * moment and never asked again, leaving the operator on an interruption
     * banner, an Idle chip and a frozen packet table while the capture was in fact
     * running and recording findings.
     *
     * An interruption nobody has acted on means the state is still in motion, so
     * it is worth asking about.
     */
    refetchInterval: (query) => (keepPolling(query.state.data) ? POLL_INTERVAL_MS : false),
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

  /**
   * Starts a capture, from the form or from a recorded session.
   *
   * `session` is what an interrupted capture is resumed with — see V18. Passed
   * explicitly rather than by filling the form and calling `start()`, because
   * React state is not updated synchronously: setting four fields and starting in
   * the same handler would start the previous values.
   */
  const startMutation = useMutation({
    mutationFn: (session?: StartCaptureParams) =>
      startCapture(
        scope,
        session ?? {
          interfaceName: selectedInterface,
          snaplength: snapshotLength,
          timeout,
          ...(scope === 'filtered-ip' ? { ipAddress: filterIp.trim() } : {}),
        },
      ),
    onSuccess: (status) => {
      client.setQueryData(queryKeys.captureStatus(scope), status);
      void refreshAll();
    },
    onError: (error) => setActionError({ error, fallbackKey: 'capture.start_failed' }),
  });

  const stopMutation = useMutation({
    mutationFn: () => stopCapture(scope),
    onSuccess: (status) => {
      client.setQueryData(queryKeys.captureStatus(scope), status);
      // A capture writes alerts, so the alerts views are now stale too.
      void client.invalidateQueries({ queryKey: ALERTS_ROOT_KEY });
      void refreshAll();
    },
    onError: (error) => setActionError({ error, fallbackKey: 'capture.stop_failed' }),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearPackets(scope),
    onSuccess: () => {
      client.setQueryData(queryKeys.packets(scope), []);
      void refreshAll();
    },
    onError: (error) => setActionError({ error, fallbackKey: 'capture.clear_failed' }),
  });

  const busy = startMutation.isPending || stopMutation.isPending || clearMutation.isPending;

  // The first load error that matters, whichever query hit it, plus any failed action.
  const error: Message | null =
    actionError ??
    (interfacesQuery.error
      ? { error: interfacesQuery.error, fallbackKey: 'capture.interfaces_failed' }
      : null) ??
    (packetsQuery.error ? { error: packetsQuery.error, fallbackKey: 'capture.packets_failed' } : null);

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
      setActionError(null);
      startMutation.mutate(undefined);
    },
    /**
     * Runs the capture a restart interrupted, on the settings it was started with.
     *
     * The form is filled too, so the controls afterwards describe what is actually
     * running rather than whatever was last typed — but the request carries the
     * recorded values, not the fields.
     */
    resume: (session: InterruptedCapture) => {
      setActionError(null);
      setSelectedInterface(session.interfaceName);
      setSnapshotLength(session.snapshotLength);
      setTimeoutMs(session.timeoutMs);
      if (session.filterIp !== null) setFilterIp(session.filterIp);
      startMutation.mutate({
        interfaceName: session.interfaceName,
        snaplength: session.snapshotLength,
        timeout: session.timeoutMs,
        ...(session.filterIp !== null ? { ipAddress: session.filterIp } : {}),
      });
    },
    stop: () => {
      setActionError(null);
      stopMutation.mutate();
    },
    clear: () => {
      setActionError(null);
      clearMutation.mutate();
    },
    refreshPackets: refreshAll,
  };
}

export type UsePacketCapture = ReturnType<typeof usePacketCapture>;
