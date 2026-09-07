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
 * The key segment standing for "every sensor", where a sensor id would otherwise go.
 *
 * `'*'` and not `'all'`, and the difference is a real collision rather than a
 * preference. A sensor id must match `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, which `all`
 * satisfies — so a sensor actually named `all` produced the identical key to the
 * unfiltered view, and React Query, behaving perfectly correctly, served one for
 * the other: pick that sensor and get every sensor's numbers out of cache without a
 * refetch, and the reverse. `*` cannot collide, because the first character of an id
 * has to be alphanumeric.
 *
 * Unlikely as a name, and `all` is exactly what somebody would call an aggregating
 * collector. Nothing rejects it, so the key must not depend on nobody choosing it.
 */
export const ALL_SENSORS = '*';

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
  // another. A sentinel rather than `undefined`, which would not survive the key.
  alertSummary: (sensor?: string) => ['alerts', 'summary', sensor ?? ALL_SENSORS] as const,
  sensors: ['alerts', 'sensors'] as const,
  knownDevices: (sensor?: string) => ['alerts', 'devices', sensor ?? ALL_SENSORS] as const,
  interfaces: (scope: string) => ['packets', scope, 'interfaces'] as const,
  captureStatus: (scope: string) => ['packets', scope, 'status'] as const,
  packets: (scope: string) => ['packets', scope, 'list'] as const,
  ipInfo: (ipAddress: string) => ['ip-info', ipAddress] as const,
} as const;

/** Everything under `alerts`, for after an acknowledge or delete. */
export const ALERTS_ROOT_KEY = ['alerts'] as const;
