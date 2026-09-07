import { QueryClient } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Shared query client.
 *
 * Replaces the hand-rolled `useState` + `useEffect` + `setInterval` fetching that
 * each page carried its own copy of. What that code could not do, and this does:
 * deduplicate concurrent requests, cache between route changes, retry transient
 * failures, and refetch in the background without blanking the screen.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Capture data changes constantly, so nothing is fresh for long. Individual
      // queries raise this where the data is stable.
      staleTime: 2_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // A 4xx will not fix itself: bad input, or a token the server rejected.
        if (axios.isAxiosError(error)) {
          const status = error.response?.status ?? 0;
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    },
    mutations: {
      // A mutation is a user action; failing fast beats silently retrying a write.
      retry: false,
    },
  },
});

/**
 * Query keys in one place, so a mutation can invalidate exactly what it affected
 * without a stringly-typed guess at the key another file used.
 */
export const queryKeys = {
  currentUser: ['auth', 'me'] as const,
  // The filter object is part of the key, so each filter combination caches
  // separately. `unknown` rather than a concrete shape keeps this file free of
  // imports from the API modules.
  alerts: (filters: object) => ['alerts', 'list', filters] as const,
  // Keyed by sensor, so the tiles cached for one sensor are not served for
  // another. `all` rather than `undefined`, which would not survive the key.
  alertSummary: (sensor?: string) => ['alerts', 'summary', sensor ?? 'all'] as const,
  sensors: ['alerts', 'sensors'] as const,
  knownDevices: ['alerts', 'devices'] as const,
  interfaces: (scope: string) => ['packets', scope, 'interfaces'] as const,
  captureStatus: (scope: string) => ['packets', scope, 'status'] as const,
  packets: (scope: string) => ['packets', scope, 'list'] as const,
  ipInfo: (ipAddress: string) => ['ip-info', ipAddress] as const,
} as const;

/** Everything under `alerts`, for after an acknowledge or delete. */
export const ALERTS_ROOT_KEY = ['alerts'] as const;
