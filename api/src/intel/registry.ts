import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';
import { type FeedSource, type LoadResult, loadFeeds, parseFeedConfig } from './feeds.js';
import { IndicatorSet } from './match.js';

/**
 * What a reload actually did, so the route can answer honestly.
 *
 * `loaded` is the only one that describes fresh data; the rest describe a set
 * that is still the previous one.
 */
export type ReloadOutcome =
  | { status: 'loaded'; result: LoadResult }
  | { status: 'already-running'; previous: LoadResult | null }
  | { status: 'kept-previous'; previous: LoadResult | null; attempted: LoadResult['sources'] }
  | { status: 'failed'; previous: LoadResult | null; error: string };

const log = componentLogger('intel');

/**
 * The loaded indicator set, shared by every detector.
 *
 * One per process. Packet capture and the flow collector both consult it, and
 * loading megabytes of indicators twice would be wasteful; more importantly, a
 * refresh has to be visible to both at once or the two would disagree about what
 * is malicious.
 *
 * Reloads swap the set atomically — a new set is built completely, then assigned.
 * A detector mid-lookup keeps using the old one and finishes against consistent
 * data, rather than seeing a set that is half-cleared.
 */
class IntelRegistry {
  private set = new IndicatorSet();
  private lastLoad: LoadResult | null = null;
  private timer: NodeJS.Timeout | null = null;
  private loading = false;

  /** Empty until the first successful load, so lookups are safe from boot. */
  get indicators(): IndicatorSet {
    return this.set;
  }

  get enabled(): boolean {
    return env.intel.enabled && this.set.size > 0;
  }

  sources(): FeedSource[] {
    return parseFeedConfig(env.intel.feeds);
  }

  /** Loads now, then on the configured interval. Never throws. */
  async start(): Promise<void> {
    if (!env.intel.enabled) {
      log.info('Threat intelligence disabled (set INTEL_ENABLED=true to load indicator feeds)');
      return;
    }

    const sources = this.sources();
    if (sources.length === 0) {
      log.warn('INTEL_ENABLED is true but INTEL_FEEDS is empty; no indicators will be loaded');
      return;
    }

    await this.reload();

    this.timer = setInterval(() => {
      void this.reload();
    }, env.intel.refreshMs);
    // The refresh timer alone must not keep the process alive.
    this.timer.unref();
  }

  /**
   * Rebuilds the set from every source. Safe to call at any time.
   *
   * The outcome is reported, not just the data. Previously this returned
   * `lastLoad` both when a reload was already running and when every source
   * failed but a prior set was kept — so `POST /api/intel/reload` answered 200
   * with a stale `loadedAt` and the old per-source rows, indistinguishable from
   * a fresh load. Keeping the old set is right; reporting it as the result of
   * "reload now" is not.
   */
  async reload(): Promise<ReloadOutcome> {
    if (this.loading) {
      return { status: 'already-running', previous: this.lastLoad };
    }
    this.loading = true;

    try {
      const result = await loadFeeds(this.sources(), env.intel.cacheDir);

      if (result.set.size === 0 && this.set.size > 0) {
        // Every source failed and there was no cache. Keeping what is already
        // loaded is better than silently switching detection off: stale
        // indicators still catch yesterday's C2, an empty set catches nothing.
        log.error('Indicator reload produced nothing; keeping the previously loaded set');
        return { status: 'kept-previous', previous: this.lastLoad, attempted: result.sources };
      }

      this.set = result.set;
      this.lastLoad = result;
      log.info({ indicators: result.set.size, feeds: result.sources.length }, 'Indicators loaded');
      return { status: 'loaded', result };
    } catch (error) {
      log.error({ err: error }, 'Indicator reload failed');
      return {
        status: 'failed',
        previous: this.lastLoad,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.loading = false;
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  status(): {
    enabled: boolean;
    loadedAt: string | null;
    refreshSeconds: number;
    stats: ReturnType<IndicatorSet['stats']>;
    sources: LoadResult['sources'];
  } {
    return {
      enabled: env.intel.enabled,
      loadedAt: this.lastLoad?.loadedAt.toISOString() ?? null,
      refreshSeconds: env.intel.refreshMs / 1000,
      stats: this.set.stats(),
      sources: this.lastLoad?.sources ?? [],
    };
  }

  /** Test seam: install a prepared set without touching the network. */
  replaceForTesting(set: IndicatorSet): void {
    this.set = set;
  }
}

let instance: IntelRegistry | null = null;

export function intel(): IntelRegistry {
  instance ??= new IntelRegistry();
  return instance;
}

export async function startIntel(): Promise<void> {
  try {
    await intel().start();
  } catch (error) {
    // Never fatal: the API must serve, and the other detectors must run, even if
    // no intelligence could be loaded.
    log.error({ err: error }, 'Could not start threat intelligence');
  }
}

export function stopIntel(): void {
  instance?.stop();
}
