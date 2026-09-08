import TranslateOutlinedIcon from '@mui/icons-material/TranslateOutlined';
import Box from '@mui/material/Box';
import ListItemIcon from '@mui/material/ListItemIcon';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useLocale } from '../contexts/LocaleContext';
import { LOCALES, type Locale } from '../i18n/generated/locales';
import { ENDONYMS, useT } from '../i18n/ui';

/**
 * Language switch, laid out to match `ColorSchemeToggle` in the account menu.
 *
 * A segmented control for the same reason that one is: three options fit in a row,
 * and a submenu would hide which one is active behind a click. Deliberately not a
 * `MenuItem` — clicking one closes the menu, and the point of switching language
 * in place is watching the page change, which for Dari includes watching it flip
 * to right-to-left.
 *
 * The labels come from `ENDONYMS`, shared with the sign-up form; see the note
 * there for why each language is named in itself.
 */

export default function LanguageToggle() {
  const t = useT();
  const { locale, setLocale } = useLocale();

  return (
    // Padding and icon width match MenuItem's, so this row lines up with the ones
    // above and below it.
    <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 0.75, gap: 1 }}>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <TranslateOutlinedIcon fontSize="small" />
      </ListItemIcon>

      <Typography variant="body2" sx={{ flexGrow: 1, mr: 2 }}>
        {t('account.language')}
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={locale}
        onChange={(_event, value: Locale | null) => {
          // Exclusive groups emit null when the active button is clicked again,
          // which would otherwise clear the choice rather than keep it.
          if (value !== null) setLocale(value);
        }}
        aria-label={t('account.language')}
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
        {LOCALES.map((option) => (
          <ToggleButton key={option} value={option} lang={option}>
            {ENDONYMS[option]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
