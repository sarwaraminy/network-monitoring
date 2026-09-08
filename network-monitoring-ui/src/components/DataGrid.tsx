import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useColorScheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import {
  MaterialReactTable,
  type MRT_Cell,
  type MRT_ColumnDef,
  type MRT_RowData,
  type MRT_TableOptions,
  useMaterialReactTable,
} from 'material-react-table';
import { MRT_Localization_DE } from 'material-react-table/locales/de';
import { MRT_Localization_FA } from 'material-react-table/locales/fa';
import type { ReactNode } from 'react';
import { useLocale } from '../contexts/LocaleContext';
import useViewportFitHeight from '../hooks/useViewportFitHeight';
import { useFormatters } from '../i18n/format';
import { sharedTableOptions } from '../tableTheme';
import { GRID_METRICS, SURFACE } from '../theme';
import GridPagination from './GridPagination';

/**
 * The one table wrapper.
 *
 * The three tables here — alerts, packets, intelligence feeds — had each grown
 * their own copy of the same chrome: sticky header on, popover column filters,
 * `paginationDisplayMode: 'pages'`, a search placeholder, and a hand-picked
 * container `maxHeight`. Not identical copies, either, which is the problem: the
 * heights were `58vh`, `56vh` and `52vh`, and the density and page size differed
 * for no reason anyone could point at. This holds the parts that should not
 * differ, and takes `tableOptions` for the parts that legitimately do.
 *
 * What it fixes beyond the duplication:
 *
 *  - The height is measured rather than guessed. See `useViewportFitHeight`.
 *  - `muiTableContainerProps` merges instead of replacing. `tableTheme.ts` had
 *    a comment saying a rule there "would look applied and silently not be",
 *    because MRT options are plain objects and a caller's key overwrites the
 *    shared one wholesale. `mergeContainerProps` closes that.
 */

/**
 * Merge the caller's container props over ours, key by key.
 *
 * The naive `{ ...ours, ...theirs }` drops our `sx` entirely the moment a caller
 * sets one, so anything this wrapper puts on the container would go missing on
 * exactly the tables that customise it. (The measured height no longer travels
 * this way — it moved to the wrapper — but the flex rules that let the container
 * fill the bounded paper still do.) Two forms deliberately fall through:
 * a function (`({ table }) => props` — nothing to merge with statically) and an
 * array or callback `sx`. Both are rare, and in both the caller replaces ours.
 *
 * A plain object, not `sx`'s array form: MRT re-reads these options on every
 * render, and a fresh array identity each time puts it into a render loop.
 */
export function mergeContainerProps<T extends MRT_RowData>(
  ownSx: Record<string, unknown>,
  callerProps: MRT_TableOptions<T>['muiTableContainerProps'],
): MRT_TableOptions<T>['muiTableContainerProps'] {
  if (!callerProps || typeof callerProps === 'function') return callerProps ?? { sx: ownSx };

  const callerSx = callerProps.sx;
  const mergeable = callerSx && typeof callerSx === 'object' && !Array.isArray(callerSx);

  return {
    ...callerProps,
    sx: mergeable ? { ...ownSx, ...callerSx } : (callerSx ?? ownSx),
  };
}

/**
 * Mark a column as numeric: right-aligned, tabular figures, locale-grouped.
 *
 * Tabular figures matter in a column and nowhere else — they are what let the
 * eye compare 1,204 against 984 without reading either. Every numeric column
 * here was setting the same three properties by hand, and the threat-intel page
 * had already drifted into setting them per-cell rather than per-column.
 *
 * Deliberately not the accounting convention of parentheses for negatives: every
 * number in this app is a count of something observed — packets, bytes, ports,
 * indicators — and none of them can be negative. A format that only shows itself
 * on impossible input is a format nobody will ever see working.
 */
export function numericColumn<T extends MRT_RowData>(column: MRT_ColumnDef<T>): MRT_ColumnDef<T> {
  // Both props accept a callback form as well as an object. A column passing a
  // callback is deciding per row, so it passes through untouched — merging into
  // it is not possible, and half-applying the alignment would be worse than
  // leaving it. An object gets ours underneath, so the column still wins.
  const { muiTableHeadCellProps: head, muiTableBodyCellProps: body } = column;
  const bodySx = typeof body === 'function' ? undefined : body?.sx;

  return {
    ...column,
    muiTableHeadCellProps: typeof head === 'function' ? head : { align: 'right', ...head },
    muiTableBodyCellProps:
      typeof body === 'function'
        ? body
        : {
            align: 'right',
            ...body,
            sx:
              bodySx && typeof bodySx === 'object' && !Array.isArray(bodySx)
                ? { fontVariantNumeric: 'tabular-nums', ...bodySx }
                : (bodySx ?? { fontVariantNumeric: 'tabular-nums' }),
          },
    Cell: column.Cell ?? (NumericCell as MRT_ColumnDef<T>['Cell']),
  };
}

/**
 * The default renderer for a numeric column.
 *
 * A named component rather than an inline arrow, because MRT renders `Cell` as a
 * component and that is what lets it hold the formatter hook. It used to call
 * `value.toLocaleString()`, which takes the BROWSER's locale — so a German
 * reader saw `1,240` in a grid cell and `1.240` in the caption beneath it, from
 * the same card.
 */
function NumericCell({ cell }: { cell: MRT_Cell<MRT_RowData> }): ReactNode {
  const fmt = useFormatters();
  const value = cell.getValue<unknown>();
  return typeof value === 'number' ? fmt.number(value) : ((value as ReactNode) ?? '');
}

/**
 * Merge the caller's row props over ours, including the `sx`.
 *
 * Same failure as `mergeContainerProps`, for a different option, and it had
 * already bitten: the row height was declared above the `...tableOptions` spread,
 * so the two tables that style their rows — alerts and intelligence feeds — threw
 * it away wholesale and ran at MRT's default. Only the packet table, the one that
 * does not style rows, ever got it. The two it missed are the two anyone spends
 * time in.
 *
 * The caller's props win on every key, so a per-row `borderLeft` or `opacity`
 * still applies; ours only supply what they did not mention.
 *
 * One fall-through, and it is the more surprising of the two this file has: an
 * array or callback `sx` cannot be merged into, so the caller replaces ours
 * outright and the row height goes with it. That loses a shared design-system
 * metric rather than a per-table layout rule, which is why it is stated here.
 * Both call sites pass an object.
 */
export function mergeRowProps<P extends { sx?: SxProps<Theme> }>(
  ownSx: Record<string, unknown>,
  callerProps: P | undefined,
): P {
  if (!callerProps) return { sx: ownSx } as P;

  const callerSx = callerProps.sx;
  const mergeable = callerSx && typeof callerSx === 'object' && !Array.isArray(callerSx);

  return {
    ...callerProps,
    sx: mergeable ? { ...ownSx, ...(callerSx as Record<string, unknown>) } : (callerSx ?? ownSx),
  } as P;
}

/**
 * The shared starting state. One density and one page size across the app, so
 * moving between the alerts table and the packet table does not change the row
 * height under you.
 */
const DEFAULT_INITIAL_STATE = {
  density: 'comfortable',
  pagination: { pageIndex: 0, pageSize: 25 },
  showGlobalFilter: true,
  // Pinned against a CONCRETE row type. Inside the generic component the
  // compiler has a much harder time with MRT's option types, so checking the
  // shape here — where `T` is not involved — is what catches a `denisty` typo
  // or a page size of `'25'`. Verified by introducing one: it fails the build.
} as const satisfies MRT_TableOptions<MRT_RowData>['initialState'];

export interface DataGridProps<T extends MRT_RowData> {
  columns: MRT_ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  /** Shown in place of rows when there are none. A blank table reads as broken. */
  emptyMessage?: ReactNode;
  /**
   * Skip the measured height and let the table size itself — for a table inside
   * a dialog or any other container sized by its own content, where measuring
   * would shrink the host on every pass. See `useViewportFitHeight`.
   */
  disableFitHeight?: boolean;
  /** Fallback height until the first measurement lands. */
  fallbackMaxHeight?: string;
  /**
   * Extra values that should force the height to be re-measured.
   *
   * The measurement observes this element and its parent for RESIZE, which is
   * blind to anything that only moves the table. A panel collapsing above it is
   * exactly that: nothing here changes size, the top edge simply rises, and the
   * table keeps the height it was given when it sat lower — leaving a gap under
   * it. Pass the state that moved it (`[expanded]`) and the measurement follows.
   */
  fitHeightDeps?: readonly unknown[];
  /**
   * Escape hatch for what genuinely differs per table — row actions, detail
   * panels, per-row styling, a custom toolbar. Merged OVER the defaults below,
   * so a table can override any of them; the shared appearance from
   * `sharedTableOptions` still wins, so no table drifts on chrome.
   */
  tableOptions?: Partial<MRT_TableOptions<T>>;
}

/**
 * The public component: generic, so every call site checks its own columns and
 * data against its own row type.
 *
 * It does nothing but erase the generic and hand off. That is the point.
 *
 * MRT's option types bottom out in a conditional on the row type — roughly
 * `unknown extends T ? string : T extends readonly any[] & IsTuple<T> ? … : …`.
 * TypeScript cannot reduce that while `T` is an unresolved type parameter, so
 * anything inside a generic component that touches an option mentioning
 * `MRT_TableInstance<T>` starts a comparison that never terminates, and the
 * compiler gives up reporting one type as "two different types with this name"
 * that are "unrelated" — naming the same file twice, with only one copy of the
 * package installed.
 *
 * Below this line `T` is `MRT_RowData`, a concrete type. The conditional reduces
 * on sight and the comparison never begins. Nothing is silenced and no option is
 * cast: the erasure happens once, here, where the row type stops being useful
 * anyway — `DataGrid` never reads a field off a row, it only forwards columns
 * and data that the caller already type-checked.
 */
export default function DataGrid<T extends MRT_RowData>(props: Readonly<DataGridProps<T>>) {
  return <DataGridBase {...(props as unknown as DataGridProps<MRT_RowData>)} />;
}

/**
 * The table's own chrome, in the reader's language.
 *
 * MRT owns a surprising amount of visible text — the column menu (Sort, Hide,
 * Group by), the row-actions header, the pagination labels, the search
 * placeholder, the no-results line — and none of it goes through this
 * application's catalogue, so it stayed English while everything around it
 * translated. These are the package's own bundles.
 *
 * `fa` for Dari, with the caveat: it is Iranian Persian, and the two differ. It
 * is used here and not for dates, which is where the difference actually bites —
 * see i18n/format.ts on Afghan versus Iranian month names. "Sortieren"/"مرتب‌سازی"
 * carries no calendar, so the shared vocabulary is right; a Solar Hijri month
 * would not be.
 */
const GRID_LOCALIZATION = {
  en: undefined,
  de: MRT_Localization_DE,
  'fa-AF': MRT_Localization_FA,
} as const;

function DataGridBase({
  columns,
  data,
  isLoading = false,
  emptyMessage = 'Nothing to show.',
  disableFitHeight = false,
  fallbackMaxHeight = '55vh',
  fitHeightDeps = [],
  tableOptions,
}: Readonly<DataGridProps<MRT_RowData>>) {
  /*
   * Which scheme is live, resolved here rather than read off `palette.mode`.
   *
   * MRT derives its own base colour as
   * `palette.mode === 'dark' ? lighten(background.default) : background.default`.
   * Under this app's `cssVariables` theme `palette.mode` is STATIC — switching
   * schemes swaps CSS custom properties, it does not hand MRT a different theme
   * object — so MRT read the light value and painted every body row #FFFFFF in
   * dark mode, while the paper and header around them switched correctly.
   *
   * It cannot be handed a CSS variable either: MRT runs `lighten()` over this to
   * derive its menu colour, and that throws on `var(...)`. So it gets a real hex
   * for the scheme that is actually showing.
   */
  const { locale } = useLocale();
  const { mode, systemMode } = useColorScheme();
  const resolved = mode === 'system' ? systemMode : mode;
  const scheme = resolved === 'dark' ? 'dark' : 'light';

  const { ref, maxHeight } = useViewportFitHeight<HTMLDivElement>({
    enabled: !disableFitHeight,
    // Re-measure when the row count changes: an empty table and a full one put
    // the pagination bar in different places. Plus whatever the caller says moves
    // it — see `fitHeightDeps`.
    deps: [data.length, ...fitHeightDeps],
  });

  /*
   * The measured height bounds the whole PAPER, not the scroll container.
   *
   * MRT renders its top toolbar above the container and its pager below it, both
   * inside the paper but outside the thing being capped. Putting the measurement
   * on the container therefore reserved the right amount of room and then hung
   * roughly a toolbar plus a pager below it — which is what put a second, page
   * level scrollbar on the capture pages on top of the grid's own.
   *
   * So the wrapper takes the cap and becomes a flex column; the paper fills it,
   * and the container is the flex child that absorbs what is left after the two
   * toolbars have taken theirs.
   */
  const containerSx = { flex: 1, minHeight: 0 };

  const table = useMaterialReactTable({
    // English is MRT's own default, so it is left unset rather than restated.
    ...(GRID_LOCALIZATION[locale] ? { localization: GRID_LOCALIZATION[locale] } : {}),
    // Defaults a caller may replace.
    enableStickyHeader: true,
    // Off deliberately. MRT draws a resize handle at the right edge of every
    // header cell, and on a table whose columns claim less width than the card
    // the last handle lands in empty space and reads as a divider belonging to a
    // column that is not there. The packet table had already opted out by hand.
    enableColumnResizing: false,
    enableDensityToggle: true,
    columnFilterDisplayMode: 'popover',
    /*
     * Our own footer, replacing MRT's bottom toolbar outright.
     *
     * MRT makes the two halves mutually exclusive: `paginationDisplayMode:
     * 'pages'` gives numbered buttons and no record range, `'default'` gives a
     * range and no numbers. Both are wanted, so the bar is rendered here — the
     * same resolution the PRO 2.0 grid reached. See GridPagination.
     *
     * Before the spread, so a caller can still replace it.
     */
    renderBottomToolbar: ({ table }) => <GridPagination table={table} />,
    // MRT's selection banner is a surface with no counterpart anywhere else in
    // this app, and it pushes the table down as it appears.
    positionToolbarAlertBanner: 'none',
    // The grid surface IS the canvas in both schemes, which is what makes a
    // table read as punched through the card back to the page.
    mrtTheme: { baseBackgroundColor: SURFACE[scheme].gridOnCard },
    ...tableOptions,

    /*
     * 48px rows, 40px dense — the standardised read-grid rhythm, applied under
     * whatever the caller sets rather than declared above the spread where a
     * caller's own row props would replace it.
     *
     * Read from the live density rather than pinned, because `enableDensityToggle`
     * is on: a fixed height held every row at 48px through every density, leaving
     * the toggle able to change padding and nothing else.
     */
    muiTableBodyRowProps: (props) => {
      const caller =
        typeof tableOptions?.muiTableBodyRowProps === 'function'
          ? tableOptions.muiTableBodyRowProps(props)
          : tableOptions?.muiTableBodyRowProps;

      const dense = props.table.getState().density === 'compact';
      const height = dense ? GRID_METRICS.denseRowHeight : GRID_METRICS.rowHeight;

      return mergeRowProps({ height }, caller);
    },

    // Resolved explicitly rather than by declaring the default above the spread
    // and letting a caller's key overwrite it — same outcome, the caller still
    // wins, but stated rather than left to key order in a spread.
    renderEmptyRowsFallback:
      tableOptions?.renderEmptyRowsFallback ??
      (() => (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {emptyMessage}
          </Typography>
        </Box>
      )),

    // Not negotiable: identity, data, and the shared appearance.
    columns,
    data,
    // Merged one level down, not replaced. These are plain objects, so a caller
    // setting `initialState` at all would otherwise drop the shared density and
    // page size — the exact way the three tables drifted apart before, one
    // landing on `compact` and the others on `comfortable`.
    initialState: { ...DEFAULT_INITIAL_STATE, ...tableOptions?.initialState },
    state: { isLoading, ...tableOptions?.state },
    ...sharedTableOptions,
    // Last, because it has to merge with whatever the caller passed rather than
    // be replaced by it.
    muiTableContainerProps: mergeContainerProps(containerSx, tableOptions?.muiTableContainerProps),
  });

  // The ref marks the table's top edge, which is what the height is measured
  // from — so it goes on a wrapper, not on the scroll container inside.
  return (
    <Box
      ref={ref}
      sx={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        maxHeight: maxHeight ? `${maxHeight}px` : fallbackMaxHeight,
        // The paper fills the capped wrapper and lays its three parts out in a
        // column, so the pager stays inside the bound rather than below it.
        '& > .MuiPaper-root': {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <MaterialReactTable table={table} />
    </Box>
  );
}
