import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** Never return a height so small the table becomes unusable. */
const MIN_HEIGHT = 180;

const px = (value: string) => Number.parseFloat(value || '0') || 0;
const scrolls = (style: CSSStyleDeclaration) => /auto|scroll|overlay/.test(style.overflowY);

/**
 * Walk outwards from `element`, accumulating the chrome that sits BELOW it —
 * each ancestor's bottom padding, border and margin — and stop at the first
 * ancestor that scrolls, which is the real bottom boundary.
 *
 * Returns that boundary (null meaning "the viewport") and the chrome total.
 */
function resolveBoundary(element: HTMLElement) {
  let chrome = 0;
  let node = element.parentElement;

  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (scrolls(style)) return { boundary: node, chrome };
    chrome += px(style.paddingBottom) + px(style.borderBottomWidth) + Math.max(0, px(style.marginBottom));
    node = node.parentElement;
  }

  return { boundary: null as HTMLElement | null, chrome };
}

/**
 * A table height measured from where the table actually is.
 *
 * The three tables here each carried a hand-picked `maxHeight` — `58vh`,
 * `56vh`, `52vh` — and the spread is the tell: nobody derived those, they were
 * nudged until they looked right on one window at one zoom level. A viewport
 * fraction cannot be right in general, because it ignores everything above the
 * table. The alerts table sits under a title band, an error alert and six
 * summary tiles; the packet table sits under a toolbar whose height changes as
 * the interface dropdown wraps. Same `vh`, different amount of room left.
 *
 * So measure instead: from the element's top edge down to the bottom of
 * whatever bounds it, recomputed whenever anything moves.
 *
 * The bottom is the nearest SCROLLING ancestor's content edge, not the viewport,
 * minus the chrome between the two — card body padding, the card's hairline,
 * the page container's padding. Measuring to the viewport and ignoring that
 * chrome is what makes a table overrun the card it lives in: the table fits the
 * window, but the card wrapping it does not fit the page, so the card's bottom
 * edge gets pushed under the fold. That became a live concern here the moment
 * the tables moved inside SurfaceCard.
 *
 * `maxHeight` is undefined until the first measurement, so callers must keep a
 * static fallback for the initial render.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS MUST NOT BE USED
 *
 * The measurement is stable only when the boundary's height does not depend on
 * the element being measured. If the nearest scrolling ancestor is sized by its
 * own content — a dialog paper, a popover, an auto-height panel — then setting
 * this height moves the boundary, the observer fires, and each pass loses
 * another `gap`:
 *
 *     element shrinks -> boundary shrinks -> boundary bottom rises
 *       -> available drops by `gap` -> observer fires -> repeat
 *
 * It converges on MIN_HEIGHT rather than oscillating, so it looks like a panel
 * slowly shrinking rather than a hang — nothing throws, nothing spins, and it
 * is easy to mistake for a styling bug. Pass `enabled: false` inside a dialog
 * and let the host size the table.
 */
export function useViewportFitHeight<T extends HTMLElement>(
  options: {
    /** Gap in px to leave below the element. */
    gap?: number;
    /** Floor for the measured top offset, guarding against an odd mid-scroll measurement. */
    minTop?: number;
    /** When false, no measurement happens and `maxHeight` stays undefined. */
    enabled?: boolean;
    /** Extra values that should force a re-measure — a row count, a loading flag. */
    deps?: readonly unknown[];
  } = {},
): { ref: RefObject<T | null>; maxHeight: number | undefined } {
  const { gap = 16, minTop = 120, enabled = true, deps = [] } = options;

  const ref = useRef<T | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    const top = Math.max(element.getBoundingClientRect().top, 0);
    const { boundary, chrome } = resolveBoundary(element);
    const bottom = boundary ? boundary.getBoundingClientRect().bottom : window.innerHeight;

    // Clamping the top guards a measurement taken mid-scroll, where the element
    // can report a negative or tiny offset and the table would size itself far
    // taller than the space it actually has.
    const available = bottom - Math.max(top, Math.min(minTop, top)) - chrome - gap;
    setMaxHeight(Math.max(MIN_HEIGHT, Math.round(available)));
  }, [gap, minTop]);

  useEffect(() => {
    if (!enabled) {
      setMaxHeight(undefined);
      return;
    }

    const element = ref.current;
    if (!element) return;

    measure();

    // The window is not enough on its own: the toolbar above the table wraps at
    // narrow widths and the summary tiles reflow, both of which move the table's
    // top edge without the window changing size.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, measure, ...deps]);

  return { ref, maxHeight };
}

export default useViewportFitHeight;
