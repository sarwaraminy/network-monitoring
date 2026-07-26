import { componentLogger } from '../logger.js';

/**
 * Replaces cyber.wissen.networkservice.IPGeolocationService, which read
 * http://ip-api.com/json/<ip> over HttpURLConnection and parsed it with org.json.
 *
 * Returns null on failure, as the Java version did. Uses global fetch (Node 18+)
 * with an abort timeout instead of an unbounded blocking read.
 */

const log = componentLogger('geo');

const GEO_API_BASE = 'http://ip-api.com/json';
const TIMEOUT_MS = 5_000;

export async function getGeolocationData(ipAddress: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${GEO_API_BASE}/${encodeURIComponent(ipAddress)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      log.warn({ ipAddress, status: response.status }, 'Geolocation provider returned an error status');
      return null;
    }

    const data: unknown = await response.json();
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  } catch (error) {
    log.warn({ ipAddress, err: error }, 'Geolocation lookup failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
