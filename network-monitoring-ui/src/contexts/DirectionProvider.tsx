import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider } from '@mui/material/styles';
import { type ReactNode, useEffect, useMemo } from 'react';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import { createAppTheme } from '../theme';
import { useLocale } from './LocaleContext';

/**
 * Lays the application out in the direction the current language is written.
 *
 * Three separate mechanisms, none of which does the others' job:
 *
 *  1. **The theme's `direction`** tells MUI's own components which way round they
 *     are — which edge a drawer opens from, which side a chip's delete icon sits.
 *  2. **The emotion cache's RTL plugin** flips the CSS *this application* writes.
 *     MUI's `direction` does nothing for a `sx={{ marginLeft: 2 }}` written here,
 *     and there are hundreds of those; the plugin rewrites physical properties as
 *     they are compiled.
 *  3. **`dir` and `lang` on the document element** are what the browser's own
 *     bidirectional algorithm reads. Without `dir` the page is laid out
 *     left-to-right no matter what the components think, and without `lang` the
 *     browser picks the wrong font and the wrong hyphenation for Perso-Arabic
 *     text.
 *
 * Sits inside `LocaleProvider` and outside everything that renders.
 */

/*
 * One cache per direction, created once at module scope.
 *
 * Emotion caches compiled styles by key, so building a new one on each render
 * would recompile every style in the application on every render and leak a
 * `<style>` element per pass. `key` differs between the two so their rules cannot
 * collide in the document.
 */
const ltrCache = createCache({ key: 'nm', stylisPlugins: [prefixer] });
const rtlCache = createCache({ key: 'nm-rtl', stylisPlugins: [prefixer, rtlPlugin] });

export default function DirectionProvider({ children }: { children: ReactNode }) {
  const { locale, dir } = useLocale();

  const theme = useMemo(() => createAppTheme(dir), [dir]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('dir', dir);
    root.setAttribute('lang', locale);
  }, [dir, locale]);

  return (
    <CacheProvider value={dir === 'rtl' ? rtlCache : ltrCache}>
      <ThemeProvider theme={theme} defaultMode="system">
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
