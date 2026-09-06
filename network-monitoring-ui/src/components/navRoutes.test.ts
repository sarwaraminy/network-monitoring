import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from './navItems';

/**
 * Every navigation entry points at a route that exists.
 *
 * This exists because it just did not, and the failure is a nasty one to spot:
 * `App.tsx` ends with `<Route path="*" element={<Navigate to="/" replace />} />`,
 * so an entry whose `to` matches no route does not 404 — it silently redirects to
 * the index, which redirects to the dashboard. The user clicks "Ad Hoc Query" and
 * lands on the dashboard, and nothing anywhere reports a problem: no error, no
 * warning, no failing test. It reads as a page that has not been built yet rather
 * than as a link wired to nothing.
 *
 * That is exactly what shipped from an edit that added the nav entry and did not
 * add the route, and every other test stayed green because each half is
 * individually correct — `navItems.test.ts` asserts the entry exists, and the
 * route table is valid without it.
 *
 * `App.tsx` is read as TEXT rather than rendered. Mounting the real router would
 * pull in every lazy page, the auth context and a query client to assert a fact
 * about a static table — and the assertion would then depend on all of them
 * working, which is a lot of ways for this guard to start failing for reasons
 * that are not this guard's subject.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(HERE, '..', 'App.tsx'), 'utf8');

/** Every `path="..."` in the route table, normalised to a leading slash. */
const declaredPaths = new Set(
  [...APP.matchAll(/<Route\s[^>]*path="([^"]+)"/g)].map((match) => {
    const path = match[1]!;
    return path.startsWith('/') ? path : `/${path}`;
  }),
);

describe('navigation targets', () => {
  it.each(NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.label, item.to] as const)))(
    '%s routes somewhere real',
    (label, to) => {
      expect(
        declaredPaths.has(to),
        `"${label}" points at ${to}, which App.tsx does not declare — the catch-all route will send it to the dashboard instead`,
      ).toBe(true);
    },
  );

  it('found a route table to check against', () => {
    // If the regex ever stops matching — a formatting change, a move to a
    // route-object array — every assertion above would pass vacuously by finding
    // nothing to contradict. This is the tripwire for that.
    expect(declaredPaths.size).toBeGreaterThan(5);
    expect(declaredPaths.has('/dashboard')).toBe(true);
  });
});
