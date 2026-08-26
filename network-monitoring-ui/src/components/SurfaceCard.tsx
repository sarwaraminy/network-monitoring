import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import type { ElementType, ReactNode } from 'react';
import { CARD_METRICS, HEAD_SURFACE } from '../theme';

/**
 * The one container every panel in the app sits in.
 *
 * Before this, each page hand-rolled its own surface: the capture toolbar was a
 * bare outlined `Paper`, the dashboard and threat-intel panels were MUI `Card`s
 * with a hand-written title and caption inside `CardContent`, the two tables
 * were whatever `sharedTableOptions` painted, and every page opened with an `h5`
 * floating on the page background with nothing under it. Five arrangements of
 * the same three parts, so no two pages lined up.
 *
 * Anatomy:
 *
 *   ┌─────────────────────────────────────────┐  1px divider, theme radius
 *   │ Title                        [actions]  │  HEAD_SURFACE tint
 *   │ subtitle                                │
 *   ├─────────────────────────────────────────┤
 *   │ body                                    │  background.paper
 *   └─────────────────────────────────────────┘
 *
 * Rules baked in here so callers cannot drift:
 *
 *  - The header strip is tinted with the same token as the table heads, not with
 *    `background.paper`. A header pixel-identical to its own body reads as one
 *    undifferentiated block, and the tint is already this app's vocabulary for
 *    "chrome, not data".
 *  - A table nested in a card must NOT bring its own surface. Two stacked
 *    hairlines and two stacked fills read as a rendering fault, which is exactly
 *    what wrapping an MRT table — it paints its own outlined `Paper` — in a card
 *    body would produce. `bodyVariant="grid"` strips the child's chrome so the
 *    card's own hairline is the only one, and drops the body padding so the
 *    table meets the border. Never wrap a table in the default variant.
 *  - `children` is optional. A header-only card is the page title band: this app
 *    puts page titles on the page rather than in the app bar, so the title needs
 *    a surface like everything else.
 *  - `fill` makes the card consume the remaining column height with its body as
 *    the flex child, so the last card on a short page reaches the bottom instead
 *    of leaving the page background showing under it.
 */
export interface SurfaceCardProps {
  /** Header title. Omit, with no `subtitle` or `headerActions`, for a card with no header strip. */
  title?: ReactNode;
  /**
   * Semantic element for the title. Visual size is fixed by `titleVariant`; this
   * only controls heading order. The page title band passes `h1`, panels below
   * it default to `h2`.
   */
  titleComponent?: ElementType;
  /** `h5` for a page title band, `subtitle1` for a panel. */
  titleVariant?: 'h5' | 'subtitle1';
  /** One line under the title, on what this panel answers. */
  subtitle?: ReactNode;
  /** Right-aligned slot in the header strip — filters, refresh, counts. Wraps under at narrow widths. */
  headerActions?: ReactNode;
  children?: ReactNode;
  /** Stretch to fill the remaining height of a flex column. Use on the last card of a page. */
  fill?: boolean;
  /**
   * Body treatment:
   *  - `default` — padded `background.paper`, for prose, forms and controls.
   *  - `grid`    — unpadded, with the nested table's own surface stripped so it
   *                does not double up on this card's.
   */
  bodyVariant?: 'default' | 'grid';
  /** Render without the card's own surface, border and radius — for a card already inside chrome. */
  embedded?: boolean;
  /** Escape hatch, merged last onto the root. */
  sx?: SxProps<Theme>;
  /** Escape hatch for the body element. */
  bodySx?: SxProps<Theme>;
}

export default function SurfaceCard({
  title,
  titleComponent = 'h2',
  titleVariant = 'subtitle1',
  subtitle,
  headerActions,
  children,
  fill = false,
  bodyVariant = 'default',
  embedded = false,
  sx,
  bodySx,
}: Readonly<SurfaceCardProps>) {
  const hasHeader = Boolean(title || subtitle || headerActions);

  return (
    <Paper
      variant={embedded ? undefined : 'outlined'}
      elevation={0}
      sx={[
        {
          display: 'flex',
          flexDirection: 'column',
          // Deliberately not `overflow: hidden`: clipping here looks harmless but
          // swallows a `fill` card's overflow instead of letting it grow. The
          // header strip carries its own top-corner radii below, which is all the
          // clipping the rounded corner actually needed.
          overflow: 'visible',
          ...(embedded && { backgroundColor: 'transparent', border: 'none', borderRadius: 0 }),
          // Grow into the column's slack, never shrink below content — a
          // shrinking fill card is what produces a second scrollbar.
          ...(fill
            ? { flex: '1 0 auto', ...(!embedded && { minHeight: CARD_METRICS.fillMinHeight }) }
            : { flexShrink: 0 }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {hasHeader && (
        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            // Actions wrap under the title rather than overflowing the strip.
            flexWrap: 'wrap',
            gap: 1.5,
            flexShrink: 0,
            py: CARD_METRICS.headerPaddingBlock,
            px: CARD_METRICS.headerPaddingInline,
            ...(embedded
              ? { px: 0 }
              : {
                  backgroundColor: HEAD_SURFACE.light,
                  ...theme.applyStyles('dark', { backgroundColor: HEAD_SURFACE.dark }),
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  // Follow the card's rounded top so the tinted strip does not
                  // square off the corners. Inset by the hairline so the fill
                  // sits inside the border rather than under it.
                  borderTopLeftRadius: 'calc(var(--mui-shape-borderRadius) - 1px)',
                  borderTopRightRadius: 'calc(var(--mui-shape-borderRadius) - 1px)',
                }),
          })}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {title && (
              <Typography
                component={titleComponent}
                variant={titleVariant}
                sx={{ fontWeight: 650, lineHeight: 1.3 }}
              >
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {headerActions && (
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              {headerActions}
            </Box>
          )}
        </Box>
      )}

      {children && (
        <Box
          sx={[
            {
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              // The body absorbs a fill card's extra height.
              ...(fill && { flex: 1 }),
              ...(bodyVariant === 'default' && { p: CARD_METRICS.bodyPadding }),
              ...(bodyVariant === 'grid' && {
                // The nested table keeps its own layout but gives up its surface,
                // so this card's hairline is the only one on screen.
                '& > .MuiPaper-root': {
                  border: 'none',
                  borderRadius: 0,
                  boxShadow: 'none',
                  backgroundColor: 'transparent',
                  backgroundImage: 'none',
                },
              }),
            },
            ...(Array.isArray(bodySx) ? bodySx : [bodySx]),
          ]}
        >
          {children}
        </Box>
      )}
    </Paper>
  );
}
