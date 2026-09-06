import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewportFitHeight } from './useViewportFitHeight';

/**
 * The measurement, and specifically that it re-runs when something MOVES the
 * element without resizing it.
 *
 * That case is the one the observer cannot see. `ResizeObserver` fires on size,
 * and a panel collapsing above a table changes nothing about the table's own
 * box — its top edge simply rises. Every grid under a collapsible section
 * depends on `deps` to notice, so this is where that contract is pinned; the
 * pages themselves cannot assert it, because jsdom has no layout and the global
 * `getBoundingClientRect` stub in test/setup.ts returns a constant.
 *
 * So the element's position is controlled directly here, which is the only way
 * to make "the table moved up" a thing a test can express.
 */

let top = 500;

/** An element on the page whose top edge this test decides. */
function anchor(): HTMLDivElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top,
      bottom: top,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
  top = 500;
});

describe('useViewportFitHeight', () => {
  it('re-measures when a dep changes, even though nothing resized', () => {
    const element = anchor();

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => useViewportFitHeight<HTMLDivElement>({ deps: [tick] }),
      { initialProps: { tick: 0 } },
    );

    act(() => {
      result.current.ref.current = element;
    });
    rerender({ tick: 1 });
    const whenLow = result.current.maxHeight;

    // The panel above collapses: the element moves UP by 300px and does not
    // change size, so no observer fires. Only the dep can carry this.
    act(() => {
      top = 200;
    });
    rerender({ tick: 2 });

    expect(whenLow).toBeDefined();
    expect(result.current.maxHeight).toBeGreaterThan(whenLow!);
    // The 300px the element rose by, give or take the chrome the hook subtracts.
    expect(result.current.maxHeight! - whenLow!).toBe(300);
  });

  it('does not re-measure without a dep change', () => {
    const element = anchor();
    const { result, rerender } = renderHook(() => useViewportFitHeight<HTMLDivElement>({ deps: [] }));

    act(() => {
      result.current.ref.current = element;
    });
    rerender();
    const before = result.current.maxHeight;

    act(() => {
      top = 100;
    });
    rerender();

    // The point of the failing case, stated as a test: moving the element with
    // nothing telling the hook leaves the old height in place. This is why
    // `fitHeightDeps` exists rather than being belt-and-braces.
    expect(result.current.maxHeight).toBe(before);
  });
});
