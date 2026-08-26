import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import type { ElementType, ReactNode } from 'react';
import { CARD_METRICS, RADIUS, SURFACE } from '../theme';

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
 *
 * The system this is ported from also has a `fill` mode, where the last card on a
 * page stretches to the bottom so no page background shows beneath it. That is
 * deliberately NOT here. It works there because their grid expands with the card;
 * ours is capped by a measured height (see useViewportFitHeight), so a stretched
 * card and the table inside it disagree — the card grew, the table did not, and
 * the difference showed up as a tall empty slab under the pagination bar with the
 * card's real bottom edge somewhere off past the fold. A card that hugs its
 * content and lets the page background show below is the honest version.
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
          // swallows content instead of letting the card grow to hold it. The
          // header strip carries its own top-corner radii below, which is all the
          // clipping the rounded corner actually needed.
          overflow: 'visible',
          ...(embedded && { backgroundColor: 'transparent', border: 'none', borderRadius: 0 }),
          // Size to content and hold it. Nothing here shrinks a card below what
          // it contains, which is what produces a second scrollbar.
          flexShrink: 0,
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
            padding: `${CARD_METRICS.headerPaddingBlock}px ${CARD_METRICS.headerPaddingInline}px`,
            ...(embedded
              ? { paddingInline: 0 }
              : {
                  backgroundColor: SURFACE.light.cardHeader,
                  borderBottomColor: SURFACE.light.cardBorder,
                  ...theme.applyStyles('dark', {
                    backgroundColor: SURFACE.dark.cardHeader,
                    borderBottomColor: SURFACE.dark.cardBorder,
                  }),
                  borderBottom: `${CARD_METRICS.borderWidth}px solid`,
                  // Follow the card's rounded top so the tinted strip does not
                  // square off the corners. Inset by the hairline so the fill
                  // sits inside the border rather than under it.
                  borderTopLeftRadius: RADIUS.card - CARD_METRICS.borderWidth,
                  borderTopRightRadius: RADIUS.card - CARD_METRICS.borderWidth,
                }),
          })}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {title && (
              <Typography
                component={titleComponent}
                variant={titleVariant}
                sx={(theme) => ({
                  // A panel header is 13px/700 in the card-header ink; the page
                  // title band keeps `h5`'s own size and only takes the ink.
                  color: SURFACE.light.cardHeaderInk,
                  ...theme.applyStyles('dark', { color: SURFACE.dark.cardHeaderInk }),
                  ...(titleVariant === 'subtitle1' && {
                    fontSize: CARD_METRICS.headerFontSize,
                    fontWeight: CARD_METRICS.headerFontWeight,
                  }),
                  lineHeight: 1.4,
                })}
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
              ...(bodyVariant === 'default' && { padding: `${CARD_METRICS.bodyPadding}px` }),
              ...(bodyVariant === 'grid' && {
                /*
                 * Both depths, deliberately. DataGrid wraps its table in a Box so
                 * the height can be measured from the top edge, which puts MRT's
                 * Paper one level further down than a bare table — and a `> `
                 * selector then silently stops matching, leaving the table on its
                 * own surface inside this one. Two hairlines and two fills of the
                 * same colour, which is invisible until it isn't.
                 *
                 * Not a bare descendant selector: a detail panel may legitimately
                 * render a Paper of its own, and that one should keep its surface.
                 */
                padding: `${CARD_METRICS.bodyPadding}px`,
                '& > .MuiPaper-root, & > * > .MuiPaper-root': {
                  boxShadow: 'none',
                  backgroundImage: 'none',
                  // The nested-grid pair, not the card tint. Stacking the two
                  // reads as a rendering fault; recessing the grid to the canvas
                  // colour makes it read as punched through the card to the page.
                  backgroundColor: SURFACE.light.gridOnCard,
                  border: `${CARD_METRICS.borderWidth}px solid ${SURFACE.light.gridOnCardOutline}`,
                  borderRadius: `${RADIUS.sm}px`,
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
