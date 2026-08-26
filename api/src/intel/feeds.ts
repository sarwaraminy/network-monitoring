import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';
import { IndicatorSet } from './match.js';
import { parseFeed } from './parse.js';

const log = componentLogger('intel');

/**
 * Loading indicator feeds.
 *
 * Two constraints shape this, and they pull in opposite directions.
 *
 * Feeds must be able to come from the internet, because that is where current
 * intelligence lives and stale intelligence is close to useless. But the tool is
 * aimed at exactly the deployments least likely to have outbound internet from
 * the monitoring host — a defence subcontractor's segregated network, a
 * manufacturing VLAN. So a local file is a first-class source, not a fallback,
 * and a downloaded feed is cached to disk so a restart without connectivity
 * still starts with the last known-good copy rather than nothing.
 *
 * A feed that fails is never fatal. Losing one source degrades coverage; taking
 * the process down over it would remove detection entirely, which is worse.
 */

/** A feed URL or local path, with the name that appears in alert evidence. */
export interface FeedSource {
  name: string;
  /** `https://…` or a filesystem path. */
  location: string;
}

const FETCH_TIMEOUT_MS = 30_000;
/** Refuse a response larger than this rather than reading it into memory. */
const MAX_FEED_BYTES = 32 * 1024 * 1024;

export interface LoadResult {
  set: IndicatorSet;
  sources: Array<{
    name: string;
    indicators: number;
    skipped: number;
    from: 'network' | 'cache' | 'file' | 'failed';
    error?: string;
  }>;
  loadedAt: Date;
}

/**
 * Loads every configured feed into one set.
 *
 * Sources are independent: one failing does not stop the others, and each
 * reports how it resolved so `/api/intel/status` can show a feed that has
 * silently been serving an empty file for a month.
 */
export async function loadFeeds(
  sources: FeedSource[],
  cacheDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadResult> {
  const set = new IndicatorSet(env.intel.maxIndicators);
  const results: LoadResult['sources'] = [];

  for (const source of sources) {
    try {
      const { body, from } = await readSource(source, cacheDir, fetchImpl);
      const parsed = parseFeed(body, source.name);

      let added = 0;
      for (const indicator of parsed.indicators) {
        if (set.add(indicator)) added += 1;
      }

      results.push({ name: source.name, indicators: added, skipped: parsed.skipped, from });
      log.info(
        { feed: source.name, indicators: added, skipped: parsed.skipped, from },
        'Loaded indicator feed',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: source.name, indicators: 0, skipped: 0, from: 'failed', error: message });
      // Warn, not error: coverage is reduced, the tool still works.
      log.warn({ feed: source.name, err: message }, 'Could not load indicator feed');
    }
  }

  // Must happen once, after every source: the CIDR search depends on merged ranges.
  set.seal();
  return { set, sources: results, loadedAt: new Date() };
}

async function readSource(
  source: FeedSource,
  cacheDir: string,
  fetchImpl: typeof fetch,
): Promise<{ body: string; from: 'network' | 'cache' | 'file' }> {
  if (!/^https?:\/\//i.test(source.location)) {
    const path = isAbsolute(source.location) ? source.location : resolve(source.location);
    if (!existsSync(path)) throw new Error(`no such file: ${path}`);
    return { body: readFileSync(path, 'utf8'), from: 'file' };
  }

  try {
    const response = await fetchImpl(source.location, {
      headers: { accept: 'text/plain, */*', 'user-agent': 'network-monitoring-tool' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_FEED_BYTES) throw new Error(`feed is ${declared} bytes, over the limit`);

    const body = await response.text();
    if (body.length > MAX_FEED_BYTES) throw new Error('feed exceeded the size limit while reading');

    writeCache(cacheDir, source.name, body);
    return { body, from: 'network' };
  } catch (error) {
    // Fall back to the last good copy. A monitoring host with no outbound
    // internet is the normal case in the networks this is aimed at, so a failed
    // fetch is expected rather than exceptional.
    const cached = readCache(cacheDir, source.name);
    if (cached !== null) {
      log.warn(
        { feed: source.name, err: error instanceof Error ? error.message : String(error) },
        'Feed fetch failed; using the cached copy',
      );
      return { body: cached, from: 'cache' };
    }
    throw error;
  }
}

function cachePath(cacheDir: string, name: string): string {
  // The name reaches the filesystem, so reduce it to a safe slug rather than
  // trusting configuration to contain no separators.
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 64);
  return join(cacheDir, `${slug}.txt`);
}

function writeCache(cacheDir: string, name: string, body: string): void {
  try {
    const path = cachePath(cacheDir, name);
    mkdirSync(dirname(path), { recursive: true });
    // Write then rename, so an interrupted write cannot leave a truncated cache
    // that would silently load as a shorter feed next boot.
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, body, 'utf8');
    renameSync(temporary, path);
  } catch (error) {
    log.warn({ feed: name, err: error }, 'Could not cache the feed');
  }
}

function readCache(cacheDir: string, name: string): string | null {
  try {
    const path = cachePath(cacheDir, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Parses `name=location,name=location` into feed sources.
 *
 * No feeds are shipped as defaults. Which intelligence to trust is the operator's
 * decision, and silently pointing a security tool at a third-party list nobody
 * chose would be the wrong default — as well as making outbound requests a
 * deployment did not ask for.
 */
export function parseFeedConfig(raw: string): FeedSource[] {
  const sources: FeedSource[] = [];

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      // Bare location: derive a name from it so evidence still says where it came from.
      sources.push({ name: deriveName(trimmed), location: trimmed });
      continue;
    }

    const name = trimmed.slice(0, separator).trim();
    const location = trimmed.slice(separator + 1).trim();
    if (name !== '' && location !== '') sources.push({ name, location });
  }

  return sources;
}

function deriveName(location: string): string {
  try {
    return new URL(location).hostname;
  } catch {
    return location.split(/[\\/]/).pop() ?? location;
  }
}
