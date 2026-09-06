import KeyboardArrowDownOutlinedIcon from '@mui/icons-material/KeyboardArrowDownOutlined';
import Box from '@mui/material/Box';

/**
 * The one expand/collapse caret.
 *
 * A single chevron rotated 180°, never two different glyphs. Swapping the glyph
 * makes the arrowhead teleport rather than turn, so the control reads as two
 * states of two different things instead of one thing changing state.
 *
 * Shared rather than duplicated because that is exactly how the sibling PRO 2.0
 * codebase ended up with three disclosure toggles at 15px, 16px and 20px, two of
 * them swapping glyphs. One file, one size, one behaviour.
 *
 * No size or colour prop, deliberately. The glyph inherits `color` from whatever
 * row owns it — tint the row, not the caret — and a caret that needs to be a
 * different size is a signal that a new variant belongs in this file rather than
 * a prop on this one.
 *
 * `aria-hidden` throughout: the state is already announced by the `aria-expanded`
 * on the control that owns this caret, and saying it twice is noise.
 */
export function DisclosureCaret({ expanded }: Readonly<{ expanded: boolean }>) {
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

export default DisclosureCaret;
