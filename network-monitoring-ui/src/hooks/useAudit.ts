import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchAuditActions, fetchAuditEvents } from '../api/audit.api';
import type { AuditPage } from '../types';

/**
 * The audit trail.
 *
 * Paged with `useInfiniteQuery` rather than a page number, because the server pages
 * by keyset: it returns the `id` of the oldest row it sent, and the next request asks
 * for events below that id. The trail only ever grows at the head, so an offset would
 * walk further through rows it had already returned every time somebody deleted
 * something mid-read.
 *
 * An id and not a timestamp — see `listAuditEvents` on the server: the driver
 * truncates the column's microseconds, and a lossy cursor drops rows rather than
 * merely reordering them.
 */
export function useAuditEvents(
  action: string | undefined,
  options: { enabled?: boolean; pageSize?: number } = {},
) {
  const pageSize = options.pageSize ?? 50;

  return useInfiniteQuery({
    queryKey: ['audit', action ?? 'all', pageSize],
    queryFn: ({ pageParam }) =>
      fetchAuditEvents({
        limit: pageSize,
        ...(action ? { action } : {}),
        ...(pageParam === undefined ? {} : { before: pageParam }),
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last: AuditPage) => last.nextBefore,
    // See the page: a role check in the component cannot stop these, because hooks
    // are not conditional. Without it a non-admin who opens the URL sends two
    // requests that are correctly refused, and the 403s land in the very logs this
    // feature exists to keep readable.
    enabled: options.enabled ?? true,
  });
}

/** The action vocabulary, for the filter. Effectively static, so cached hard. */
export function useAuditActions(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: fetchAuditActions,
    staleTime: 60 * 60 * 1000,
    enabled: options.enabled ?? true,
  });
}
