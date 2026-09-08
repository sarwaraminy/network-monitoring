import { describe, expect, it } from 'vitest';
import type { NavGroup } from './navItems';
import { NAV_GROUPS, visibleGroupsFor, visibleNavGroups } from './navItems';

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
  groups.flatMap((group) => group.items.map((item) => item.labelKey));

/** Stand-in for a group's rail icon; nothing here renders. */
const ICON = null as unknown as NavGroup['icon'];

describe('visibleNavGroups', () => {
  it('offers an administrator every entry', () => {
    expect(labelsOf(visibleNavGroups('ADMIN'))).toContain('nav.audit');
    expect(labelsOf(visibleNavGroups('ADMIN'))).toContain('nav.adhoc');
  });

  it('withholds an admin-only entry from a plain user', () => {
    // Asserted from both sides, so this cannot pass because the entry was
    // renamed or dropped for everybody.
    expect(labelsOf(visibleNavGroups('USER'))).not.toContain('nav.audit');
    // The console reads the database directly, so offering the link to someone
    // the server would refuse is worse here than for an ordinary admin page.
    expect(labelsOf(visibleNavGroups('USER'))).not.toContain('nav.adhoc');
  });

  it('withholds admin-only entries before the role is known', () => {
    // The auth query is in flight on first paint. Showing the entry and taking
    // it away a moment later is worse than showing it late.
    expect(labelsOf(visibleNavGroups(undefined))).not.toContain('nav.audit');
  });

  it('keeps everything that is not admin-only', () => {
    // The other half: filtering by role must not quietly remove the rest of the
    // navigation from a non-admin.
    const labels = labelsOf(visibleNavGroups('USER'));
    // Delivery is deliberately not in this list any more: its settings moved
    // under the administration gear and the entry became admin-only. Anything
    // still here is a page a plain user is meant to reach.
    // Catalogue keys rather than words: what a plain user may reach is a fact
    // about the navigation, not about the language it is read in. The words
    // themselves are covered by the catalogue coverage test.
    for (const key of [
      'nav.dashboard',
      'nav.alerts',
      'nav.suppressions',
      'nav.threat_intel',
      'nav.capture_interface',
    ]) {
      expect(labels).toContain(key);
    }
  });

  it('drops the real Administration group for a plain user, heading and all', () => {
    /*
     * Every entry under Administration is admin-only now that Delivery joined
     * them, so this group empties out for a plain user — which makes the
     * empty-group rule below live rather than theoretical for the first time.
     * Asserted over the REAL navigation, because that is the case an operator
     * would see: a heading standing over nothing reads as a section that failed
     * to load.
     */
    const groups = visibleNavGroups('USER');

    expect(groups.map((group) => group.labelKey)).not.toContain('nav.group.administration');
    // And an administrator still gets it, so this cannot pass by the group
    // having been deleted.
    expect(visibleNavGroups('ADMIN').map((group) => group.labelKey)).toContain('nav.group.administration');
  });

  it('drops a group left empty by the filtering, rather than leaving a bare heading', () => {
    /*
     * A heading standing over nothing reads as a section that failed to load.
     *
     * Asserted against a CONSTRUCTED group, because no group in `NAV_GROUPS` can
     * empty out today — so the same assertion made over the real navigation is
     * one that passes with the rule deleted. That is what the earlier version of
     * this test did, and it covered nothing at all.
     */
    const groups: NavGroup[] = [
      /*
       * Any key will do — this group is constructed, and the rule under test is
       * about emptiness, not about words. `nav.dashboard` is used rather than an
       * invented key so the fixture stays inside the catalogue's type.
       */
      {
        id: 'kept',
        labelKey: 'nav.dashboard',
        icon: ICON,
        items: [{ labelKey: 'nav.dashboard', to: '/open' }],
      },
      {
        id: 'emptied',
        labelKey: 'nav.alerts',
        icon: ICON,
        items: [{ labelKey: 'nav.alerts', to: '/restricted', adminOnly: true }],
      },
    ];

    expect(visibleGroupsFor(groups, 'USER').map((group) => group.id)).toEqual(['kept']);
    // And it is only the emptying that drops it — an admin still gets both.
    expect(visibleGroupsFor(groups, 'ADMIN').map((group) => group.id)).toEqual(['kept', 'emptied']);
  });

  it('does not mutate the source groups', () => {
    // `visibleNavGroups` runs on every role change; a filter that edited
    // NAV_GROUPS in place would remove the admin entry permanently the first
    // time a non-admin signed in.
    const before = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.labelKey));
    visibleNavGroups('USER');
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.labelKey))).toEqual(before);
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
