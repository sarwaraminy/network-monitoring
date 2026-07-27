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
