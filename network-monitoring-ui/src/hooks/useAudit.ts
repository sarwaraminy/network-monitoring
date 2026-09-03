import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchAuditActions, fetchAuditEvents } from '../api/audit.api';
import type { AuditPage } from '../types';

/**
 * The audit trail.
 *
 * Paged with `useInfiniteQuery` rather than a page number, because the server pages
 * by keyset: it returns a cursor pointing at the oldest row it sent, and the next
 * request asks for events strictly older than that. The trail only ever grows at
 * the head, so an offset would walk further through rows it had already returned
 * every time somebody deleted something mid-read.
 */
export function useAuditEvents(action: string | undefined, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: ['audit', action ?? 'all', pageSize],
    queryFn: ({ pageParam }) =>
      fetchAuditEvents({
        limit: pageSize,
        ...(action ? { action } : {}),
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AuditPage) => last.nextBefore,
  });
}

/** The action vocabulary, for the filter. Effectively static, so cached hard. */
export function useAuditActions() {
  return useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: fetchAuditActions,
    staleTime: 60 * 60 * 1000,
  });
}
