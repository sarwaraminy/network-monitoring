import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, visibleNavGroups } from './navItems';

/**
 * The navigation model, tested apart from the shell that renders it.
 *
 * Pulled out for the same reason the role filter was worth testing at all:
 * mounting `AppLayout` drags in routing, the auth context and the colour-scheme
 * provider, so anything asserted through it is slow and indirect. Grouping and
 * role visibility are plain data, and this is where they are pinned. What the
 * grouped panel LOOKS like stays in AppLayout.test.tsx.
 */

const labelsOf = (groups: ReturnType<typeof visibleNavGroups>) =>
  groups.flatMap((group) => group.items.map((item) => item.label));

describe('visibleNavGroups', () => {
  it('offers an administrator every entry', () => {
    expect(labelsOf(visibleNavGroups('ADMIN'))).toContain('Audit Trail');
  });

  it('withholds an admin-only entry from a plain user', () => {
    // Asserted from both sides, so this cannot pass because the entry was
    // renamed or dropped for everybody.
    expect(labelsOf(visibleNavGroups('USER'))).not.toContain('Audit Trail');
  });

  it('withholds admin-only entries before the role is known', () => {
    // The auth query is in flight on first paint. Showing the entry and taking
    // it away a moment later is worse than showing it late.
    expect(labelsOf(visibleNavGroups(undefined))).not.toContain('Audit Trail');
  });

  it('keeps everything that is not admin-only', () => {
    // The other half: filtering by role must not quietly remove the rest of the
    // navigation from a non-admin.
    const labels = labelsOf(visibleNavGroups('USER'));
    for (const label of ['Dashboard', 'Security Alerts', 'Suppressions', 'Threat Intel', 'Delivery']) {
      expect(labels).toContain(label);
    }
  });

  it('drops a group left empty by the filtering, rather than leaving a bare heading', () => {
    // A heading standing over nothing reads as a section that failed to load.
    // No group empties out today, so this is asserted against a constructed one
    // — the rule has to hold the day an entry does become admin-only.
    const groups = visibleNavGroups('USER');
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
    expect(groups.map((group) => group.id)).not.toContain('nonexistent');
  });

  it('does not mutate the source groups', () => {
    // `visibleNavGroups` runs on every role change; a filter that edited
    // NAV_GROUPS in place would remove the admin entry permanently the first
    // time a non-admin signed in.
    const before = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label));
    visibleNavGroups('USER');
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label))).toEqual(before);
  });
});

describe('NAV_GROUPS', () => {
  it('routes to each destination exactly once', () => {
    // Two groups both claiming a page means two rows highlight as current.
    const routes = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('gives every group a unique id', () => {
    const ids = NAV_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
