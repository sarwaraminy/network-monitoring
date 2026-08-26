import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  type MRT_RowData,
  type MRT_TableOptions,
  useMaterialReactTable,
} from 'material-react-table';
import type { ReactNode } from 'react';
import useViewportFitHeight from '../hooks/useViewportFitHeight';
import { sharedTableOptions } from '../tableTheme';

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
 * sets one — which is how the measured height would go missing on exactly the
 * tables that customise anything. Two forms deliberately fall through unmerged:
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
    Cell:
      column.Cell ??
      (({ cell }) => {
        const value = cell.getValue<unknown>();
        return typeof value === 'number' ? value.toLocaleString() : ((value as ReactNode) ?? '');
      }),
  };
}

/**
 * The generic boundary, and the only place this file stops checking itself.
 *
 * MRT's option types bottom out in a conditional on the row type — roughly
 * `unknown extends T ? string : T extends readonly any[] & IsTuple<T> ? … : …`.
 * While `T` is an unresolved type parameter TypeScript cannot reduce that, so
 * comparing any option whose signature mentions `MRT_TableInstance<T>` starts a
 * comparison it never finishes, and it gives up reporting one type as "two
 * different types with this name" that are "unrelated" — naming the same file,
 * twice. There is no second copy of the package; that message is what a runaway
 * conditional looks like from outside.
 *
 * Worth being straight about what this is: it was reported by an editor, and it
 * does NOT reproduce from the command line — not on TypeScript 5.6, 5.7, 5.8 or
 * 5.9, under either `bundler` or `node10` resolution, with or without this
 * helper. So this is not a fix for a demonstrated compiler failure; it makes the
 * comparison structurally impossible to start, whichever compiler is asking.
 *
 * `DataGrid` stays generic and every call site instantiates `T` concretely, so
 * columns and data are still fully checked there. What this gives up is the
 * final assignability check on four members that this file builds itself — and
 * `DEFAULT_INITIAL_STATE` below is pinned against a concrete row type so the
 * part worth checking still is. The design system this is ported from does the
 * same thing at the same boundary.
 */
const atGenericBoundary = <V,>(value: unknown): V => value as V;

/**
 * The shared starting state. One density and one page size across the app, so
 * moving between the alerts table and the packet table does not change the row
 * height under you.
 */
const DEFAULT_INITIAL_STATE = {
  density: 'comfortable',
  pagination: { pageIndex: 0, pageSize: 25 },
  showGlobalFilter: true,
  // Checked against a CONCRETE row type. `atGenericBoundary` stops the compiler
  // looking at these once `T` is involved, so without this a typo here —
  // `denisty`, a page size of `'25'` — would reach MRT unnoticed. Verified by
  // introducing one: it fails the build.
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
   * Escape hatch for what genuinely differs per table — row actions, detail
   * panels, per-row styling, a custom toolbar. Merged OVER the defaults below,
   * so a table can override any of them; the shared appearance from
   * `sharedTableOptions` still wins, so no table drifts on chrome.
   */
  tableOptions?: Partial<MRT_TableOptions<T>>;
}

export default function DataGrid<T extends MRT_RowData>({
  columns,
  data,
  isLoading = false,
  emptyMessage = 'Nothing to show.',
  disableFitHeight = false,
  fallbackMaxHeight = '55vh',
  tableOptions,
}: Readonly<DataGridProps<T>>) {
  const { ref, maxHeight } = useViewportFitHeight<HTMLDivElement>({
    enabled: !disableFitHeight,
    // Re-measure when the row count changes: an empty table and a full one put
    // the pagination bar in different places.
    deps: [data.length],
  });

  const containerSx = { maxHeight: maxHeight ? `${maxHeight}px` : fallbackMaxHeight };

  const table = useMaterialReactTable({
    // Defaults a caller may replace.
    enableStickyHeader: true,
    // Off deliberately. MRT draws a resize handle at the right edge of every
    // header cell, and on a table whose columns claim less width than the card
    // the last handle lands in empty space and reads as a divider belonging to a
    // column that is not there. The packet table had already opted out by hand.
    enableColumnResizing: false,
    enableDensityToggle: true,
    columnFilterDisplayMode: 'popover',
    paginationDisplayMode: 'pages',
    // MRT's selection banner is a surface with no counterpart anywhere else in
    // this app, and it pushes the table down as it appears.
    positionToolbarAlertBanner: 'none',
    ...tableOptions,

    // Resolved explicitly rather than by declaring the default above the spread
    // and letting a caller's key overwrite it — same outcome, the caller still
    // wins, but stated rather than left to key order in a spread.
    renderEmptyRowsFallback: atGenericBoundary<MRT_TableOptions<T>['renderEmptyRowsFallback']>(
      tableOptions?.renderEmptyRowsFallback ??
        (() => (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {emptyMessage}
            </Typography>
          </Box>
        )),
    ),

    // Not negotiable: identity, data, and the shared appearance.
    columns,
    data,
    // Merged one level down, not replaced. These are plain objects, so a caller
    // setting `initialState` at all would otherwise drop the shared density and
    // page size — the exact way the three tables drifted apart before, one
    // landing on `compact` and the others on `comfortable`.
    initialState: atGenericBoundary<MRT_TableOptions<T>['initialState']>({
      ...DEFAULT_INITIAL_STATE,
      ...tableOptions?.initialState,
    }),
    state: atGenericBoundary<MRT_TableOptions<T>['state']>({ isLoading, ...tableOptions?.state }),
    ...sharedTableOptions,
    // Last, because it has to merge with whatever the caller passed rather than
    // be replaced by it.
    muiTableContainerProps: atGenericBoundary<MRT_TableOptions<T>['muiTableContainerProps']>(
      mergeContainerProps<T>(containerSx, tableOptions?.muiTableContainerProps),
    ),
  });

  // The ref marks the table's top edge, which is what the height is measured
  // from — so it goes on a wrapper, not on the scroll container inside.
  return (
    <Box ref={ref} sx={{ minWidth: 0 }}>
      <MaterialReactTable table={table} />
    </Box>
  );
}
