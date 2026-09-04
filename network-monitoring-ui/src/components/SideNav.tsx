import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import KeyboardArrowDownOutlinedIcon from '@mui/icons-material/KeyboardArrowDownOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import type { Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV, RADIUS, SIDEBAR_METRICS, SURFACE } from '../theme';
import { groupContaining, type NavGroup } from './navItems';

/*
 * ===========================================================================
 * The PRO 2.0 sidebar panel, ported from the sibling `professional` project's
 * `sidebarChrome.tsx` (PRO20-2693).
 *
 * The five rules of that design, and where each is enforced here:
 *
 *   1. One border          — only `SidebarPanel` sets a border and radius.
 *                            Sections and items set neither, ever.
 *   2. Sections divide,    — `SidebarSection` draws a bottom divider; the LAST
 *      they don't stack      one does not, because the panel edge does that job.
 *   3. Children indent,    — items sit at a 22px indent in the same panel. No
 *      not nest              wrapper, no card, no second surface.
 *   4. The title is a      — `SidebarPanel` renders it as its first row, with a
 *      header row            divider under it, so nothing overlaps the sections.
 *   5. One active item     — the active row is the only tinted one. Section
 *                            headers never take an active state.
 *
 * Anatomy:
 *
 *   ┌───────────────────────────┐  290px, 1px cardBorder, radius 8, panelBg
 *   │ NAVIGATION             ‹  │  48px header row  ── heavier divider
 *   │ OVERVIEW               ⌄  │  38px section header, sectionBg
 *   ├───────────────────────────┤  1px nav.divider
 *   │ SECURITY               ⌃  │  38px, open
 *   │   Security Alerts         │  34px item, 22px indent
 *   │ ▎ Suppressions            │  34px active: fill + ink + 2px rule
 *   │   Threat Intel            │
 *   └───────────────────────────┘  no divider after the last section
 *
 * NOT ported: the superseded three-card sidebar this design replaced (a header
 * card, one card per group, and a third around expanded children). The source
 * still carries it for one screen that has not migrated, and says plainly that
 * doing so leaves the app with two sidebar visual languages. Copying the older
 * of the two into a new port would import that problem rather than the design.
 * ===========================================================================
 */

/**
 * A single chevron that points down when collapsed and rotates a full 180° when
 * expanded — never two different glyphs.
 *
 * Swapping the glyph makes the arrowhead teleport rather than turn, so the
 * control reads as two states of two different things. `aria-hidden` because
 * the state is already announced by `aria-expanded` on the button that owns it.
 */
function DisclosureCaret({ expanded }: Readonly<{ expanded: boolean }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        transition: 'transform 200ms ease',
        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
    >
      <KeyboardArrowDownOutlinedIcon sx={{ fontSize: 16 }} />
    </Box>
  );
}

/** The same rule on the other axis: one chevron, turned, for the rail toggle. */
function RailCollapseCaret({ collapsed }: Readonly<{ collapsed: boolean }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        transition: 'transform 200ms ease',
        transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
    >
      {/* Larger than the disclosure caret — it is a lone hit target. */}
      <ChevronLeftOutlinedIcon sx={{ fontSize: 18 }} />
    </Box>
  );
}

interface SidebarItemProps {
  label: string;
  to: string;
  /**
   * An optional second line under the label — a code, a qualifier, whatever
   * distinguishes two rows whose names read alike.
   *
   * Optional so a row without one stays exactly as it was. The variant is chosen
   * by whether a row HAS a subtitle, not by which screen renders it, so it is
   * not the per-screen override this design set out to remove. Nothing in this
   * navigation passes one today; the day an entry needs a second line, it gets
   * the treatment without a new component.
   */
  subtitle?: string;
  /** Called after a row is chosen, so the temporary drawer can close itself. */
  onNavigate?: () => void;
}

/**
 * Left inset for an item row. ONE value, for both variants.
 *
 * The active row gives up the rule's width from its inset, so the text sits on
 * the same optical line whether or not the row is active — that is what stops
 * the label jogging right as the user navigates. The source spends two constants
 * on that, 22px at rest and 20px active; here the rule is drawn on every row and
 * merely COLOURED when active, so the width comes off once, for everybody, and
 * only the resting indent needs to be a token.
 *
 * A two-line row insets the SAME 22px as a one-line one. The source uses its own
 * 12px horizontal padding here instead, which is right for a panel where every
 * row has a subtitle and wrong for this one, where almost none would: a
 * subtitled row would have sat 10px to the left of its neighbours, breaking the
 * indent that rule 3 relies on to carry the hierarchy. `itemTwoLinePaddingX` is
 * a padding token, not an indent, and is not copied for that reason.
 */
const itemPaddingLeft = () => `${SIDEBAR_METRICS.itemIndent - SIDEBAR_METRICS.activeRuleWidth}px`;

/**
 * The two stacked lines — the label, then its subtitle.
 *
 * Plain spans inside the caller's SAME link, so the row stays one click target
 * and one tab stop and hover / focus / active apply to the whole row rather than
 * to either line.
 *
 * `<span>` with `display: block` rather than `<div>`, and not as a matter of
 * taste: an anchor's content model is phrasing content, so a `<div>` inside one
 * is invalid even though every browser renders it. `<span>` is phrasing content,
 * so blocking it with CSS is the conforming way to stack two lines in a link.
 */
function SidebarItemLines({ label, subtitle }: Readonly<{ label: string; subtitle: string }>) {
  return (
    <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
      <Box component="span" sx={{ display: 'block' }}>
        {label}
      </Box>
      <Box
        component="span"
        className="SideNav-subtitle"
        sx={(theme) => ({
          display: 'block',
          mt: `${SIDEBAR_METRICS.itemCodeGap}px`,
          fontSize: SIDEBAR_METRICS.itemCodeFontSize,
          lineHeight: SIDEBAR_METRICS.itemCodeLineHeight,
          letterSpacing: SIDEBAR_METRICS.itemCodeTracking,
          // Never bold, even on the active row: the active weight belongs to the
          // label, so the subtitle stays the quieter half.
          fontWeight: 400,
          color: NAV.light.itemCodeInk,
          ...theme.applyStyles('dark', { color: NAV.dark.itemCodeInk }),
        })}
      >
        {subtitle}
      </Box>
    </Box>
  );
}

/**
 * One item row inside a section — rules 3 and 5.
 *
 * Active is fill + ink + a 2px rule, never a size change: the row height is the
 * same either way so the list does not shift as the user navigates.
 *
 * `NavLink` decides that state, so `aria-current="page"` comes with it rather
 * than being a second thing to remember.
 */
function SidebarItem({ label, to, subtitle, onNavigate }: Readonly<SidebarItemProps>) {
  const hasSubtitle = subtitle !== undefined;

  return (
    <Box
      component={NavLink}
      to={to}
      onClick={onNavigate}
      sx={(theme) => ({
        width: '100%',
        // A MINIMUM, not a fixed height: a one-line row is exactly 34px, and a
        // wrapped or two-line one takes the room it needs instead of clipping.
        minHeight: SIDEBAR_METRICS.itemRowHeight,
        display: 'flex',
        alignItems: 'center',
        // Rule 1: no border of its own, no radius, no card. A row.
        borderRadius: 0,
        textDecoration: 'none',
        cursor: 'pointer',
        fontSize: hasSubtitle ? SIDEBAR_METRICS.itemNameFontSize : SIDEBAR_METRICS.itemFontSize,
        fontWeight: 400,
        lineHeight: hasSubtitle ? SIDEBAR_METRICS.itemNameLineHeight : 1.35,
        pr: 1,
        py: hasSubtitle ? `${SIDEBAR_METRICS.itemTwoLinePaddingY}px` : 0.5,
        pl: itemPaddingLeft(),
        borderLeft: `${SIDEBAR_METRICS.activeRuleWidth}px solid transparent`,
        color: NAV.light.itemInk,
        // Long labels WRAP; they are not ellipsised. An ellipsis hides the very
        // part that distinguishes one capture page from the other, and a hover
        // tooltip is no answer for anyone reading without a pointer.
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        // A hovered row reads as "about to become a row like that section
        // header" — the same tint, deliberately.
        '&:hover': { bgcolor: NAV.light.sectionBg },
        // Rule 5: the active row is the only tinted one.
        '&.active': {
          borderLeftColor: NAV.light.activeRule,
          bgcolor: NAV.light.activeBg,
          color: NAV.light.activeInk,
          fontWeight: 600,
          '&:hover': { bgcolor: NAV.light.activeBg },
          '& .SideNav-subtitle': { color: NAV.light.activeCodeInk },
        },
        ...theme.applyStyles('dark', {
          color: NAV.dark.itemInk,
          '&:hover': { bgcolor: NAV.dark.sectionBg },
          '&.active': {
            borderLeftColor: NAV.dark.activeRule,
            bgcolor: NAV.dark.activeBg,
            color: NAV.dark.activeInk,
            '&:hover': { bgcolor: NAV.dark.activeBg },
            '& .SideNav-subtitle': { color: NAV.dark.activeCodeInk },
          },
        }),
      })}
    >
      {hasSubtitle ? <SidebarItemLines label={label} subtitle={subtitle} /> : label}
    </Box>
  );
}

/**
 * The panel's search field.
 *
 * Height and radius are NOT set here — the panel's search row owns them, so a
 * field dropped into that row inherits the metrics whatever it is.
 */
function SidebarSearchField({
  placeholder,
  value,
  onChange,
}: Readonly<{ placeholder: string; value: string; onChange: (next: string) => void }>) {
  return (
    <TextField
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      fullWidth
      slotProps={{
        // On `htmlInput`, not on the field: `TextField` puts its own props on the
        // wrapping FormControl, so an `aria-label` passed at the top level names
        // a div nobody queries and leaves the input itself unnamed. The
        // placeholder is the only label this row has space for, and a placeholder
        // is not an accessible name.
        htmlInput: { 'aria-label': placeholder },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchOutlinedIcon sx={{ fontSize: 16 }} />
            </InputAdornment>
          ),
          // The clear button appears only with something to clear — an always-on
          // affordance that does nothing is noise in a 32px field.
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={() => onChange('')}
                aria-label="Clear search"
                sx={{ padding: '4px' }}
              >
                <CloseOutlinedIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </InputAdornment>
          ) : null,
        },
      }}
      sx={(theme) => ({
        '& .MuiInputBase-input': { fontSize: '13px' },
        '& .MuiInputBase-input::placeholder': { color: NAV.light.placeholder, opacity: 1 },
        ...theme.applyStyles('dark', {
          '& .MuiInputBase-input::placeholder': { color: NAV.dark.placeholder, opacity: 1 },
        }),
      })}
    />
  );
}

interface SidebarSectionProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** Rail mode: the section renders only its icon. */
  collapsed: boolean;
  icon: ReactNode;
  /** Opens the panel from the rail. See `openFromRail` below. */
  onExpandPanel?: () => void;
  /**
   * Take focus on mount.
   *
   * Set for the one section opened from the rail. The rail button that was
   * clicked unmounts as the panel expands, and focus would otherwise fall to
   * `<body>` — dumping a keyboard or screen-reader user at the top of the
   * document instead of into the section they just asked for.
   */
  autoFocus?: boolean;
  /** Called once `autoFocus` has been honoured, so the request is not repeated. */
  onFocused?: () => void;
  children: ReactNode;
}

/**
 * One section of the panel: a 38px header row and, when open, its items.
 *
 * The whole header row is the click target, not just the chevron — a 16px glyph
 * is a poor hit area, and the label is the thing people aim at anyway.
 */
function SidebarSection({
  label,
  expanded,
  onToggle,
  collapsed,
  icon,
  onExpandPanel,
  autoFocus = false,
  onFocused,
  children,
}: Readonly<SidebarSectionProps>) {
  const autoId = useId();
  const regionId = `sidebar-section-${autoId}`;
  const headerRef = useRef<HTMLButtonElement | null>(null);
  // Held in a ref so honouring the request does not depend on the caller
  // remembering `useCallback` — the effect below must not re-run on identity.
  const onFocusedRef = useRef(onFocused);
  onFocusedRef.current = onFocused;

  // Above the rail's early return, unconditionally: a hook placed after a
  // conditional return is a hook that stops being called when the panel folds.
  useEffect(() => {
    if (!autoFocus || collapsed) return;
    headerRef.current?.focus();
    onFocusedRef.current?.();
  }, [autoFocus, collapsed]);

  if (collapsed) {
    /*
     * In the rail there is no room for a label, a chevron or a divider — just
     * the affordance that gets the user back to this section.
     *
     * Clicking a rail icon means BOTH things: open the panel, and open the
     * section that was clicked. Neither half belongs to the caller, and in the
     * source this went wrong precisely when it was wired per screen.
     */
    const openFromRail = () => {
      onExpandPanel?.();
      if (!expanded) onToggle();
    };
    return (
      <Tooltip title={label} placement="right" disableInteractive>
        {/*
          No `aria-expanded`. There is no rendered list under this button and no
          `aria-controls` to point at one, so announcing "expanded" describes a
          region that is not there — and the state it would report is the
          panel's, which is not visible from the rail anyway. What this button
          does is "open the panel at this section", and `aria-label` says that.
        */}
        <IconButton size="small" onClick={openFromRail} aria-label={label}>
          {icon}
        </IconButton>
      </Tooltip>
    );
  }

  /*
   * Rule 2. Every section draws a divider; the panel switches off the last one,
   * because only the rendered DOM knows which that is once a search has filtered
   * some away.
   */
  const dividerSx = (theme: Theme) => ({
    borderBottom: `1px solid ${NAV.light.divider}`,
    ...theme.applyStyles('dark', { borderBottom: `1px solid ${NAV.dark.divider}` }),
  });

  return (
    <Box sx={dividerSx}>
      <Box
        component="button"
        type="button"
        ref={headerRef}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={regionId}
        sx={(theme) => ({
          // Rule 1: no border, no radius, no card. Just a tinted row.
          width: '100%',
          height: SIDEBAR_METRICS.sectionHeaderHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          border: 0,
          borderRadius: 0,
          cursor: 'pointer',
          font: 'inherit',
          fontSize: SIDEBAR_METRICS.sectionFontSize,
          fontWeight: SIDEBAR_METRICS.sectionFontWeight,
          letterSpacing: SIDEBAR_METRICS.sectionTracking,
          textTransform: 'uppercase',
          textAlign: 'left',
          bgcolor: NAV.light.sectionBg,
          color: NAV.light.sectionInk,
          ...theme.applyStyles('dark', {
            bgcolor: NAV.dark.sectionBg,
            color: NAV.dark.sectionInk,
          }),
        })}
      >
        {label}
        <Box
          sx={(theme) => ({
            display: 'flex',
            color: NAV.light.chevron,
            ...theme.applyStyles('dark', { color: NAV.dark.chevron }),
          })}
        >
          <DisclosureCaret expanded={expanded} />
        </Box>
      </Box>
      {/*
        The section owns its own disclosure. `Collapse` keeps the region in the
        DOM while closed, so `aria-controls` points at something real and the
        animation is the same on every section.
      */}
      <Collapse in={expanded} timeout={300} id={regionId}>
        {children}
      </Collapse>
    </Box>
  );
}

export interface SideNavProps {
  /** Already filtered for the signed-in role — see `visibleNavGroups`. */
  groups: NavGroup[];
  /** Rail mode. Omit the toggle below and this is a plain expanded panel. */
  collapsed?: boolean;
  /** Absent means the panel cannot be collapsed — the drawer's case. */
  onToggleCollapsed?: () => void;
  /** Called after a row is chosen, so the temporary drawer can close itself. */
  onNavigate?: () => void;
}

/** The panel title. Uppercased by the style, not by the string. */
const PANEL_TITLE = 'Navigation';

/** Placeholder, and the search field's accessible name. */
const SEARCH_PLACEHOLDER = 'Search navigation…';

/**
 * Groups reduced to what matches `term`, with any group left empty dropped.
 *
 * Three things match, and the third is the one that is easy to leave out: the
 * GROUP heading. Those headings are on screen while the user types, so a search
 * that cannot find "Administration" — a word the user is reading as they type it
 * — reads as a broken search rather than as a rule about what is searchable. A
 * heading that hits keeps its items whole, because the match is the group.
 *
 * Item subtitles match too. A row whose second line is the only thing
 * distinguishing it from its neighbour is exactly the row someone would look for
 * by that line.
 */
function filterGroups(groups: NavGroup[], term: string): NavGroup[] {
  const needle = term.trim().toLowerCase();
  if (needle === '') return groups;

  return groups
    .map((group) => {
      if (group.label.toLowerCase().includes(needle)) return group;
      return {
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLowerCase().includes(needle) ||
            (item.subtitle?.toLowerCase().includes(needle) ?? false),
        ),
      };
    })
    .filter((group) => group.items.length > 0);
}

/**
 * The navigation panel — rules 1 and 4, and the only bordered element here.
 *
 * One component for both mountings, the permanent panel from `md` up and the
 * temporary drawer below it, because two copies of a navigation is how a link
 * ends up reachable on the desktop and missing on a phone.
 *
 * Collapsed it becomes a 56px rail carrying the toggle and one icon per
 * section, so the user can always get back.
 */
export default function SideNav({
  groups,
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: Readonly<SideNavProps>) {
  const { pathname } = useLocation();

  /*
   * Sections start open — all of them.
   *
   * The source opens only the first, which suits a list of dozens where most of
   * it is noise on any given visit. Eight entries all fit, so opening them is
   * the state that needs no interaction to be useful, and closing one is then a
   * choice rather than a chore.
   */
  const [closedIds, setClosedIds] = useState<ReadonlySet<string>>(() => new Set());
  /*
   * What the user has closed DURING a search, kept apart from `closedIds`.
   *
   * A search opens every surviving section, which is right — a result nobody can
   * see is not a result. But it must not make the header rows lie: forcing
   * `expanded` open while still routing the click into `closedIds` gave a header
   * that visibly did nothing, silently recorded the toggle, and collapsed the
   * section later when the field was cleared. Whether it ended up open depended
   * on a click parity the user had no way to see.
   *
   * So a search gets its own, empty disclosure state. Closing a section during
   * one closes it there and then; clearing the field discards that state and
   * hands back exactly what the user had before searching.
   */
  const [searchClosedIds, setSearchClosedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [searchTerm, setSearchTerm] = useState('');

  /*
   * The term actually in force, derived during RENDER rather than left to the
   * effect below.
   *
   * A rail has no search field, so it must not be filtered by one. Clearing the
   * term in an effect alone still let the rail paint one frame with the old term
   * applied — long enough to show the "No pages match" paragraph wrapped inside
   * 56px, which is the exact symptom that clearing exists to prevent. Deriving
   * it here closes the window: there is no frame in which a collapsed panel is
   * filtered. The effect still runs, so the term is genuinely gone when the panel
   * comes back rather than reappearing with it.
   *
   * Note that no test can catch the regression — RTL flushes effects, so the bad
   * frame never reaches an assertion. Only a browser shows it.
   */
  const effectiveTerm = collapsed ? '' : searchTerm;
  const searching = effectiveTerm.trim() !== '';
  const shownGroups = useMemo(() => filterGroups(groups, effectiveTerm), [groups, effectiveTerm]);

  const changeSearch = (next: string) => {
    setSearchTerm(next);
    /*
     * Every change, not only a clear.
     *
     * Resetting only on empty meant a term REPLACED in place — select all,
     * type over it — never passed through `''` and so inherited the previous
     * search's closures. The one match could then render inside a section the
     * user had closed two searches ago: "a result nobody can see is not a
     * result", which is the failure this pair of sets exists to prevent, coming
     * back through the door the test did not cover.
     *
     * Each search is its own disclosure scope. That does mean typing another
     * character reopens a section closed a moment earlier, which is the right
     * trade: the results have changed, and no match may be left hidden.
     */
    setSearchClosedIds(new Set());
  };

  /*
   * Collapsing to the rail clears the search state for when the panel returns.
   * What the rail RENDERS is already handled by `effectiveTerm` above.
   */
  useEffect(() => {
    if (!collapsed) return;
    setSearchTerm('');
    setSearchClosedIds(new Set());
  }, [collapsed]);

  /*
   * Whatever else is closed, the section holding the CURRENT page is open.
   *
   * Otherwise arriving by deep link, by the post-login redirect, or by the
   * browser's back button can land on a page whose row is folded away, and the
   * panel shows no indication of where you are. Only ever opens: it does not
   * re-close anything the user opened by hand.
   *
   * BOTH sets, because either can be the one in force when the route changes.
   * Reaching only into `closedIds` left the invariant unhonoured for exactly the
   * case a search is running — close a section, navigate into it, and the
   * current page stayed folded away. Clearing both needs no branch on the mode
   * and cannot go stale if that mode is read a render late: an entry removed
   * from the set that is not in force costs nothing, since `searchClosedIds` is
   * discarded at the next keystroke anyway.
   */
  const activeGroupId = groupContaining(groups, pathname)?.id;
  useEffect(() => {
    if (activeGroupId === undefined) return;
    const open = (closed: ReadonlySet<string>) => {
      if (!closed.has(activeGroupId)) return closed;
      const next = new Set(closed);
      next.delete(activeGroupId);
      return next;
    };
    setClosedIds(open);
    setSearchClosedIds(open);
  }, [activeGroupId]);

  /*
   * The section a rail click asked to be focused, cleared once that has happened.
   *
   * The click unmounts the rail button it came from, so without this focus falls
   * to `<body>` and a keyboard user is dropped at the top of the document rather
   * than into the section they just opened.
   */
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null);

  // Whichever disclosure state is the live one. A click always moves the set the
  // header row is currently reading, so the row can never record a change it did
  // not also show.
  const setClosedFor = searching ? setSearchClosedIds : setClosedIds;
  const toggleSection = (id: string) =>
    setClosedFor((closed) => {
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const isExpanded = (id: string) => (searching ? !searchClosedIds.has(id) : !closedIds.has(id));

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={(theme) => ({
        // Rule 1 — the one border in the sidebar.
        width: collapsed ? SIDEBAR_METRICS.railWidth : SIDEBAR_METRICS.panelWidth,
        flexShrink: 0,
        /*
         * Margin on three sides, and NONE on the right.
         *
         * The source panel takes the same margin all round because the content
         * beside it has no padding of its own. Ours does — the page canvas sets
         * 16px inline — so a right margin here stacked on top of it and the
         * channel between the panel and the first card came out at 30px, wide
         * enough to read as a missing column. The page's own padding is the gap
         * now, which also keeps the panel aligned to the same 16px gutter the
         * cards use rather than to a second one 14px further in.
         */
        mt: `${SIDEBAR_METRICS.panelMargin}px`,
        mb: `${SIDEBAR_METRICS.panelMargin}px`,
        ml: `${SIDEBAR_METRICS.panelMargin}px`,
        border: '1px solid',
        borderColor: SURFACE.light.cardBorder,
        borderRadius: `${RADIUS.md}px`,
        bgcolor: NAV.light.panelBg,
        overflow: 'hidden',
        // A flex column with a bounded height, or the scroll region below has
        // nothing to scroll within and the panel just grows past the viewport.
        display: 'flex',
        flexDirection: 'column',
        maxHeight: `calc(100% - ${SIDEBAR_METRICS.panelMargin * 2}px)`,
        // Only the width. Transitioning `all` here also animates the colour swap
        // on a theme change, which turns an instant switch into a smear down one
        // edge of the app. A 290px pane sliding across is exactly the kind of
        // movement the reduced-motion preference exists for.
        transition: 'width 0.3s ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        ...theme.applyStyles('dark', {
          borderColor: SURFACE.dark.cardBorder,
          bgcolor: NAV.dark.panelBg,
        }),
      })}
    >
      {/*
        Rule 4 — a header ROW, with its own divider, so nothing overlaps the
        sections below. The divider here is the heavier card border, not the
        lighter between-sections one.
      */}
      <Box
        sx={(theme) => ({
          height: SIDEBAR_METRICS.headerRowHeight,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          px: collapsed ? 0 : 1.5,
          borderBottom: '1px solid',
          borderColor: SURFACE.light.cardBorder,
          color: NAV.light.titleInk,
          fontSize: SIDEBAR_METRICS.headerFontSize,
          fontWeight: SIDEBAR_METRICS.sectionFontWeight,
          letterSpacing: SIDEBAR_METRICS.headerTracking,
          textTransform: 'uppercase',
          ...theme.applyStyles('dark', {
            borderColor: SURFACE.dark.cardBorder,
            color: NAV.dark.titleInk,
          }),
        })}
      >
        {!collapsed && PANEL_TITLE}
        {onToggleCollapsed && (
          // The caret is a glyph, not a control — it needs a real button around
          // it. Collapsed, this is the only thing in the rail that is not a
          // section, so it has to stay reachable or the panel cannot come back.
          <IconButton
            size="small"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? `Expand ${PANEL_TITLE}` : `Collapse ${PANEL_TITLE}`}
            aria-expanded={!collapsed}
            sx={{ color: 'inherit' }}
          >
            <RailCollapseCaret collapsed={collapsed} />
          </IconButton>
        )}
      </Box>

      {!collapsed && (
        <Box
          sx={(theme) => ({
            height: SIDEBAR_METRICS.searchRowHeight,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            px: 1.5,
            borderBottom: '1px solid',
            borderColor: SURFACE.light.cardBorder,
            /*
             * The ROW owns the field's height and radius, not the field.
             * Otherwise every caller styles its own and they drift — in the
             * source one screen wrapped its input in a second padded box inside
             * this fixed row and set a different radius. A bare TextField
             * dropped in here comes out right.
             */
            '& .MuiInputBase-root': {
              height: SIDEBAR_METRICS.searchFieldHeight,
              borderRadius: `${SIDEBAR_METRICS.searchFieldRadius}px`,
            },
            '& .MuiTextField-root': { width: '100%' },
            ...theme.applyStyles('dark', { borderColor: SURFACE.dark.cardBorder }),
          })}
        >
          <SidebarSearchField placeholder={SEARCH_PLACEHOLDER} value={searchTerm} onChange={changeSearch} />
        </Box>
      )}

      {/*
        The section list scrolls INSIDE the panel: the panel clips, which is what
        gives it its radius, so without this a tall list is simply lost.
      */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          // In the rail each section is a bare icon button, so this container
          // has to say it is a vertical strip — the sections have no box of
          // their own to say it with.
          ...(collapsed && {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
            pt: 0.5,
          }),
          // Rule 2's "the last section has no divider", decided here rather than
          // by counting: a `:last-child` rule reads the rendered DOM, which is
          // the only thing that knows which section actually rendered once the
          // role filter has dropped one.
          '& > *:last-child': { borderBottom: 0 },
        }}
      >
        {shownGroups.map((group) => (
          <SidebarSection
            key={group.id}
            label={group.label}
            icon={group.icon}
            /*
             * A search starts every surviving section open — a result the user
             * cannot see is not a result — but closing one still works, and
             * still shows. See `searchClosedIds`.
             */
            expanded={isExpanded(group.id)}
            onToggle={() => toggleSection(group.id)}
            collapsed={collapsed}
            onExpandPanel={
              onToggleCollapsed &&
              (() => {
                onToggleCollapsed();
                setFocusSectionId(group.id);
              })
            }
            autoFocus={focusSectionId === group.id}
            onFocused={() => setFocusSectionId(null)}
          >
            {group.items.map((item) => (
              <SidebarItem
                key={item.to}
                label={item.label}
                to={item.to}
                subtitle={item.subtitle}
                onNavigate={onNavigate}
              />
            ))}
          </SidebarSection>
        ))}
        {/*
          A search matching nothing. The source leaves this case blank, which
          reads as a panel that failed to load rather than as a search that found
          nothing — and the field is at the top of an otherwise empty box, so
          there is no other clue about what happened.
        */}
        {searching && shownGroups.length === 0 && (
          <Box
            sx={(theme) => ({
              px: 1.5,
              py: 2,
              fontSize: SIDEBAR_METRICS.itemFontSize,
              color: NAV.light.itemCodeInk,
              ...theme.applyStyles('dark', { color: NAV.dark.itemCodeInk }),
            })}
          >
            No pages match “{effectiveTerm.trim()}”.
          </Box>
        )}
      </Box>
    </Box>
  );
}
