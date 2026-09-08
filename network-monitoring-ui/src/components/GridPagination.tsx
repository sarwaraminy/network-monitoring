import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import MuiPagination from '@mui/material/Pagination';
import PaginationItem from '@mui/material/PaginationItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import type { MRT_RowData, MRT_TableInstance } from 'material-react-table';
import { type Translate, useT } from '../i18n/ui';
import { SURFACE } from '../theme';

/**
 * The grid footer, ported from the PRO 2.0 pager in the sibling `professional`
 * project (its `Pagination.tsx`, PRO20-2504).
 *
 * Left: "Rows per page" and a size select. Right: the record range, then
 * first / prev / numbered / next / last, with the current page as a filled chip.
 *
 * This replaces MRT's own bottom toolbar rather than decorating it, because the
 * two things wanted here are on opposite sides of a choice MRT makes for you:
 * `paginationDisplayMode: 'pages'` draws numbered buttons and no range, and
 * `'default'` — MUI's `TablePagination` — draws a range and no numbers. The
 * source system resolved that by rendering its own bar, and so does this.
 *
 * The range is the part worth having. A page of rows cannot say where it sits in
 * the whole, and a filtered grid with no total reads as an empty database rather
 * than a narrow question.
 */

export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

export interface PageFacts {
  /** Rows after filtering — what the pager actually walks. */
  total: number;
  /** Rows before filtering, for the "filtered from" note. */
  unfiltered: number;
  /** 1-indexed, already clamped. */
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * The facts a footer needs, derived once and clamped once.
 *
 * Clamping here rather than at each use is what stops a stale page — the state
 * after a filter shrinks the row count, before MRT resets it — rendering an
 * inverted range like "41–33 of 33".
 */
export function pageFactsOf<T extends MRT_RowData>(table: MRT_TableInstance<T>): PageFacts {
  const { pagination } = table.getState();
  /*
   * CLIENT-side counts, which is what every grid in this app is.
   *
   * Under `manualPagination` these would be wrong in a specific way worth
   * naming: `getFilteredRowModel()` holds only the page the server sent, so
   * `total` would be the page size and the range would read "1–25 of 25" on
   * every page of a thousand. Nothing here paginates server-side today, and the
   * honest response to that is to say so rather than write a branch that has
   * never run — but if one ever does, this function is the place it has to be
   * taught, and `table.options.rowCount` is the value it should read.
   */
  const total = table.getFilteredRowModel().rows.length;
  const unfiltered = table.options.rowCount ?? table.getPreFilteredRowModel().rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));

  return {
    total,
    unfiltered,
    page: Math.min(Math.max(pagination.pageIndex + 1, 1), pageCount),
    pageSize: pagination.pageSize,
    pageCount,
  };
}

/**
 * "1–25 of 100", the source system's wording exactly.
 *
 * The filtered note is the one addition. `professional` shows the filtered count
 * alone because its grids carry a separate "Filtered: X of Y" label elsewhere;
 * ours do not, and a range against a total that silently shrank is the reading
 * that misleads.
 */
export function describePageRange({ total, unfiltered, page, pageSize }: PageFacts, t: Translate): string {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const range = t('grid.page_range', { start, end, total });

  return total < unfiltered ? t('grid.page_range_filtered', { range, unfiltered }) : range;
}

export default function GridPagination<T extends MRT_RowData>({
  table,
}: Readonly<{ table: MRT_TableInstance<T> }>) {
  const t = useT();
  const facts = pageFactsOf(table);
  const options = ROWS_PER_PAGE_OPTIONS.includes(facts.pageSize as (typeof ROWS_PER_PAGE_OPTIONS)[number])
    ? [...ROWS_PER_PAGE_OPTIONS]
    : // A caller's non-standard size is offered rather than dropped, or the
      // Select renders blank against a value it does not list.
      [...ROWS_PER_PAGE_OPTIONS, facts.pageSize].sort((a, b) => a - b);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: 'wrap',
        width: '100%',
        px: 1,
        py: 0.5,
        /*
         * The rule and the surface that `muiBottomToolbarProps` used to supply.
         *
         * `renderBottomToolbar` replaces `MRT_BottomToolbar` outright, and those
         * props are only read INSIDE that component — so overriding the toolbar
         * silently dropped the 1px hairline above the pager on every grid in the
         * app. A missing rule is exactly the kind of thing noticed weeks later
         * and blamed on something else, so the pager carries it itself and the
         * now-dead option is gone from `sharedTableOptions`.
         */
        backgroundColor: 'transparent',
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('common.rows_per_page')}
        </Typography>
        <Select
          size="small"
          value={facts.pageSize}
          onChange={(event) => {
            table.setPageSize(Number(event.target.value));
            // Back to the first page, or a size increase can land past the end.
            table.setPageIndex(0);
          }}
          // On the input, not the wrapper: the wrapper is a div, and a label
          // there names something no assistive technology treats as the control.
          inputProps={{ 'aria-label': 'Rows per page' }}
          sx={{ '& .MuiSelect-select': { py: 0.25 } }}
        >
          {options.map((size) => (
            <MenuItem key={size} value={size}>
              {size}
            </MenuItem>
          ))}
        </Select>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {/*
          A live region, because this app sets `positionToolbarAlertBanner:
          'none'`. MRT's banner is what would otherwise announce that what the
          grid is showing has changed; turning it off for being a surface with no
          counterpart here also removed that announcement, and plain text would
          leave a non-visual user no signal that a filter changed anything.
          `polite` — a row count is worth hearing at the next pause, never worth
          interrupting for.
        */}
        <Typography
          variant="caption"
          role="status"
          aria-live="polite"
          sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}
        >
          {describePageRange(facts, t)}
        </Typography>
        <MuiPagination
          count={facts.pageCount}
          page={facts.page}
          onChange={(_event, page) => table.setPageIndex(page - 1)}
          showFirstButton
          showLastButton
          siblingCount={1}
          boundaryCount={1}
          size="small"
          renderItem={(item) => (
            <PaginationItem
              {...item}
              sx={(theme) => ({
                /*
                 * The current page is the brand fill, not MUI's default
                 * `action.selected` — a low-alpha grey wash that reads as
                 * DISABLED rather than selected, which is the opposite of what
                 * it means. The source system made the same correction.
                 *
                 * Hover holds the fill and adds a ring rather than swapping to
                 * another fill: a swap would either be invisible or drop the
                 * label below contrast, and WCAG wants a focus indicator either
                 * way. The gap ring separates itself from the chip by putting
                 * the surface colour between them.
                 */
                '&.Mui-selected': {
                  backgroundColor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  fontWeight: 600,
                  '&:hover, &.Mui-focusVisible': {
                    backgroundColor: theme.palette.primary.main,
                    boxShadow: `0 0 0 2px ${SURFACE.light.gridOnCard}, 0 0 0 4px ${theme.palette.primary.main}`,
                    ...theme.applyStyles('dark', {
                      boxShadow: `0 0 0 2px ${SURFACE.dark.gridOnCard}, 0 0 0 4px ${theme.palette.primary.main}`,
                    }),
                  },
                },
              })}
            />
          )}
        />
      </Box>
    </Box>
  );
}
