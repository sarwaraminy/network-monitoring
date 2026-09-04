import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import type { ReactElement } from 'react';

export interface NavItem {
  label: string;
  /**
   * Hidden from anyone who is not an ADMIN.
   *
   * The convention already applied to controls inside pages — the account menu's
   * "Add user", and the delete button on the alerts table — and the nav had no
   * way to express it, so an ADMIN-only page would have advertised itself to
   * everybody and answered with a 403.
   */
  adminOnly?: boolean;
  to: string;
  /**
   * An optional second line under the label, for an entry whose name alone does
   * not distinguish it. Nothing needs one yet; the row variant exists so that
   * the day one does, it is a field rather than a component.
   */
  subtitle?: string;
}

export interface NavGroup {
  /** Stable key, independent of the label, so renaming a heading is not a re-key. */
  id: string;
  label: string;
  /**
   * The group's rail icon.
   *
   * On the ICON only — not on the items. That is the PRO 2.0 panel's anatomy
   * rather than an omission: an expanded item row is a text label at a 22px
   * indent, and the indent is what carries the hierarchy. Icons appear only in
   * the collapsed rail, where a section shrinks to exactly one of them.
   */
  icon: ReactElement;
  items: NavItem[];
}

/**
 * The navigation, grouped by what a page is FOR rather than by what it renders.
 *
 * This was one flat list of tabs, and the list is what forced the change: eight
 * tabs in a single strip is already past the point where the eye scans it rather
 * than reads it, and nothing about a flat list says which entries belong
 * together. Grouping is not decoration here — "Suppressions" only makes sense
 * next to "Security Alerts", and reading it under a Security heading is how
 * someone new to the tool learns that without being told.
 *
 * Order within a group follows the order of use, not the alphabet: alerts are
 * read first and suppressed second, so that is the order they sit in.
 *
 * A group with no visible items is not rendered at all — see `visibleNavGroups`.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <SpaceDashboardOutlinedIcon />,
    items: [{ label: 'Dashboard', to: '/dashboard' }],
  },
  {
    id: 'security',
    label: 'Security',
    icon: <GppMaybeOutlinedIcon />,
    items: [
      { label: 'Security Alerts', to: '/alerts' },
      // Next to the alerts, because it is read as part of triaging them: the
      // question "why am I seeing this every night" and the answer live together.
      { label: 'Suppressions', to: '/suppressions' },
      { label: 'Threat Intel', to: '/threat-intel' },
    ],
  },
  {
    id: 'capture',
    label: 'Capture',
    icon: <SettingsEthernetIcon />,
    items: [
      { label: 'Capture by Interface', to: '/capture-packets' },
      { label: 'Capture by IP', to: '/capture-packets-ip' },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    icon: <SettingsOutlinedIcon />,
    items: [
      // Both answer "what did this system do, and who told it to" rather than
      // "what is happening on the wire", which is why neither sits under Security.
      { label: 'Delivery', to: '/delivery' },
      // The route stays `/activity`: the label is what people read, and changing
      // the URL would break every bookmark and pasted link for a rename.
      { label: 'Audit Trail', to: '/activity', adminOnly: true },
    ],
  },
];

/**
 * The groups `role` should be offered, out of the ones given, with admin-only
 * entries removed and any group thereby emptied dropped with them.
 *
 * That last part is the reason this is a function rather than a `filter` inlined
 * at the call site: filtering items alone leaves a heading standing over nothing,
 * which reads as a section that failed to load rather than as one that does not
 * apply. Today no group in `NAV_GROUPS` can empty out — only Administration
 * could, and only if Delivery ever became admin-only — so the rule is here to
 * keep that a one-line change rather than a redesign.
 *
 * Takes the groups as an argument for exactly that reason: the rule cannot be
 * pinned down against a list where no group is ever empty, and a test asserting
 * it over `NAV_GROUPS` is a test that passes with the rule deleted. Callers in
 * the app want `visibleNavGroups` below.
 *
 * The server still enforces the access. This only stops offering a link that
 * would answer 403.
 */
export function visibleGroupsFor(groups: NavGroup[], role: string | undefined): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.adminOnly !== true || role === 'ADMIN'),
    }))
    .filter((group) => group.items.length > 0);
}

/** The application's own navigation, filtered for `role`. */
export function visibleNavGroups(role: string | undefined): NavGroup[] {
  return visibleGroupsFor(NAV_GROUPS, role);
}

/** The group holding a route, or undefined for a page not in the navigation. */
export function groupContaining(groups: NavGroup[], pathname: string): NavGroup | undefined {
  return groups.find((group) => group.items.some((item) => item.to === pathname));
}
