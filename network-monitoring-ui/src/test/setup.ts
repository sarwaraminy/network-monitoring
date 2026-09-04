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
 * The global `Storage` class is deliberately NOT replaced. Doing so made
 * `vi.spyOn(Storage.prototype, ...)` reach this shim, which was convenient for
 * one test file — and made `sessionStorage instanceof Storage` false and any
 * future spy on `Storage.prototype` miss `sessionStorage` entirely, since jsdom
 * still provides that one. A shim for `localStorage` has no business changing
 * what `sessionStorage` is. Tests that need to make storage misbehave spy on the
 * `localStorage` OBJECT, which works whichever implementation is underneath.
 *
 * ---------------------------------------------------------------------------
 * ENTRIES ARE OWN ENUMERABLE PROPERTIES, and that is not an implementation
 * detail — it is the whole reason this shim can be trusted.
 *
 * A real `Storage` exposes each stored key as an own enumerable property, so
 * `Object.keys(localStorage)` and `{ ...localStorage }` see the contents. The
 * first version of this held its entries in a private Map, which is tidier and
 * silently wrong: the spread came back `{}` no matter what was stored, and
 * `auth.test.tsx`'s "never writes the password to storage" — which inspects
 * exactly that spread — became an assertion that could not fail. It would have
 * passed against a login that persisted the raw password.
 *
 * So the entries live on the instance. The methods sit on the prototype, where
 * class syntax puts them and where they are non-enumerable, so they never show
 * up in a spread of the contents.
 */
if (typeof globalThis.localStorage?.setItem !== 'function') {
  class MemoryStorage {
    [key: string]: unknown;

    get length() {
      return Object.keys(this).length;
    }
    key(index: number) {
      return Object.keys(this)[index] ?? null;
    }
    getItem(key: string) {
      const name = String(key);
      // `hasOwnProperty`, not a plain read: without it `getItem('getItem')`
      // would hand back a prototype method. `?? null` rather than `undefined`,
      // because callers branch on `=== null`.
      return Object.hasOwn(this, name) ? (this[name] as string) : null;
    }
    setItem(key: string, value: string) {
      // The spec coerces both. Storing a non-string and reading it back
      // unchanged is the difference that hides a `Boolean('false')` bug.
      Object.defineProperty(this, String(key), {
        value: String(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    removeItem(key: string) {
      delete this[String(key)];
    }
    clear() {
      for (const name of Object.keys(this)) delete this[name];
    }
  }

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
