import dns from 'node:dns/promises';

/**
 * Replaces cyber.wissen.networkservice.IPInfoService, which called
 * InetAddress.getCanonicalHostName().
 *
 * Returns null when there is no PTR record, matching the Java behaviour of
 * returning null on UnknownHostException. A timeout is applied because
 * getCanonicalHostName() could block the request thread for seconds.
 */
const LOOKUP_TIMEOUT_MS = 3_000;

export async function getDomainName(ipAddress: string): Promise<string | null> {
  try {
    const hostnames = await withTimeout(dns.reverse(ipAddress), LOOKUP_TIMEOUT_MS);
    return hostnames[0] ?? null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
