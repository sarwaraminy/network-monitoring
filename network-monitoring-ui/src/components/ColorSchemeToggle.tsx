import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useColorScheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { useState } from 'react';

/**
 * Light / dark / system switch.
 *
 * "System" is the default and a real option, not a fallback: it follows
 * `prefers-color-scheme`, so the app matches the OS without the user choosing.
 * MUI persists the explicit choice, so it survives a reload.
 */
export default function ColorSchemeToggle() {
  const { mode, setMode, systemMode } = useColorScheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // `mode` is 'system' until the user picks; systemMode resolves what that means.
  const effective = mode === 'system' ? systemMode : mode;

  const options = [
    { value: 'light' as const, label: 'Light', icon: <LightModeOutlinedIcon fontSize="small" /> },
    { value: 'dark' as const, label: 'Dark', icon: <DarkModeOutlinedIcon fontSize="small" /> },
    { value: 'system' as const, label: 'Match system', icon: <SettingsBrightnessIcon fontSize="small" /> },
  ];

  return (
    <>
      <Tooltip title={`Theme: ${mode === 'system' ? 'match system' : mode}`}>
        <IconButton
          color="inherit"
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-label="Change theme"
        >
          {effective === 'dark' ? <DarkModeOutlinedIcon /> : <LightModeOutlinedIcon />}
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            selected={mode === option.value}
            onClick={() => {
              setMode(option.value);
              setAnchor(null);
            }}
          >
            <ListItemIcon>{option.icon}</ListItemIcon>
            <ListItemText>{option.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
