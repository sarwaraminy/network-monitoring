import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import Box from '@mui/material/Box';
import ListItemIcon from '@mui/material/ListItemIcon';
import { useColorScheme } from '@mui/material/styles';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';

/**
 * Light / dark / auto switch, laid out as one row for the account menu.
 *
 * A segmented control rather than a submenu: with only three options, showing
 * all of them and which is active costs one row, whereas a nested menu hides the
 * current setting behind a click.
 *
 * "Auto" is the default and a real option, not a fallback — it follows
 * `prefers-color-scheme`, so the app matches the OS without the user choosing.
 * MUI persists an explicit choice, so it survives a reload.
 *
 * Deliberately not a `MenuItem`: clicking a MenuItem closes the menu, and the
 * point of switching theme in place is watching it change.
 */
export default function ColorSchemeToggle() {
  const { mode, setMode } = useColorScheme();

  return (
    // Padding matches MenuItem's, and the icon slot is the same width, so this
    // row lines up with Sign out beneath it.
    <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 0.75, gap: 1 }}>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <PaletteOutlinedIcon fontSize="small" />
      </ListItemIcon>

      <Typography variant="body2" sx={{ flexGrow: 1, mr: 2 }}>
        Theme
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        // Undefined until MUI has read the stored preference.
        value={mode ?? 'system'}
        onChange={(_event, value: 'light' | 'dark' | 'system' | null) => {
          // Exclusive groups emit null when the active button is clicked again.
          // Without this guard that would clear the theme rather than keep it.
          if (value !== null) setMode(value);
        }}
        aria-label="Theme"
        sx={{
          '& .MuiToggleButton-root': {
            px: 1.25,
            py: 0.25,
            border: 0,
            borderRadius: 1,
            textTransform: 'none',
            fontWeight: 600,
            lineHeight: 1.6,
            '&.Mui-selected': {
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': { bgcolor: 'primary.dark' },
            },
          },
        }}
      >
        <ToggleButton value="light">Light</ToggleButton>
        <ToggleButton value="dark">Dark</ToggleButton>
        <ToggleButton value="system">Auto</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
