import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './server';

/**
 * Global test setup.
 *
 * Requests go through MSW rather than a mocked axios, so the tests exercise the
 * real client — interceptors, error unwrapping, the bearer header — and only the
 * network itself is substituted.
 */

beforeAll(() => {
  // An unhandled request is a bug in the test, not something to paper over.
  server.listen({ onUnhandledRequest: 'error' });
});

/**
 * A working `localStorage`, on runtimes that took jsdom's away.
 *
 * From Node 25 the runtime defines its own Web Storage as a global getter, and
 * in the jsdom environment `window` IS `globalThis` — so that getter shadows
 * jsdom's implementation. Started without `--localstorage-file` it yields an
 * inert object with no methods, and the first `localStorage.getItem` takes the
 * whole suite down: the auth client reads a token at module scope, so files fail
 * while being imported rather than in a test anyone wrote.
 *
 * Guarded on the capability rather than on a version, so this disappears on its
 * own the day the runtime supplies a real one, and never masks jsdom's.
 *
 * `Storage` is redefined alongside it so `vi.spyOn(Storage.prototype, ...)`
 * still reaches these methods — a test simulating storage that throws is exactly
 * the kind that would otherwise pass against the wrong object.
 */
if (typeof globalThis.localStorage?.setItem !== 'function') {
  class MemoryStorage {
    #entries = new Map<string, string>();

    get length() {
      return this.#entries.size;
    }
    key(index: number) {
      return [...this.#entries.keys()][index] ?? null;
    }
    getItem(key: string) {
      // `?? null`, not `?? undefined`: callers branch on `=== null`.
      return this.#entries.get(String(key)) ?? null;
    }
    setItem(key: string, value: string) {
      // The spec coerces both. Storing a non-string and reading it back
      // unchanged is the difference that hides a `Boolean('false')` bug.
      this.#entries.set(String(key), String(value));
    }
    removeItem(key: string) {
      this.#entries.delete(String(key));
    }
    clear() {
      this.#entries.clear();
    }
  }

  Object.defineProperty(globalThis, 'Storage', { writable: true, configurable: true, value: MemoryStorage });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});

afterAll(() => server.close());

// jsdom implements neither of these, and MUI's responsive helpers and charts
// both need them.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// @mui/x-charts measures its container; jsdom reports zero, which would collapse
// every chart to nothing.
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value(this: HTMLElement) {
    return {
      width: 800,
      height: 300,
      top: 0,
      left: 0,
      right: 800,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  },
});
