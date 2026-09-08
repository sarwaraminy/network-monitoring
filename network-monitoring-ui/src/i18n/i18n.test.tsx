import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import Identifier from '../components/Identifier';
import LanguageToggle from '../components/LanguageToggle';
import { CRITICAL_ALERT, HIGH_ALERT } from '../test/fixtures';
import { renderApp } from '../test/render';
import { findingText } from './findings';
import { createFormatters } from './format';

/**
 * The browser half of internationalisation.
 *
 * Everything asserted here fails silently to a reader of English: a date in the
 * wrong calendar still looks like a date, an unisolated IP address still looks
 * like an address, and a page that did not flip to right-to-left still renders.
 * The whole category is "wrong only to the people who cannot report it", which is
 * the argument for pinning it rather than eyeballing it once.
 */

describe('formatting dates and numbers', () => {
  const AT = '2026-09-07T14:30:00.000Z';

  it('follows the application locale, not the browser', () => {
    // The bug this replaces: every one of these call sites was a bare
    // `toLocaleString()`, which reads the browser's locale. German prose around
    // American dates is the visible half; the invisible half is below.
    expect(createFormatters('en').dateTime(AT)).toMatch(/Sep/);
    expect(createFormatters('de').dateTime(AT)).toMatch(/07\.09\.2026/);
  });

  /*
   * Afghanistan uses the Solar Hijri calendar, and `fa-AF` selects it in CLDR
   * without an adapter or a date library — with the *Afghan* month names (سنبله)
   * rather than the Iranian ones (شهریور), which is the distinction a generic
   * Persian locale would have got subtly wrong.
   */
  it('uses the Solar Hijri calendar with Afghan month names in Dari', () => {
    const rendered = createFormatters('fa-AF').dateTime(AT);
    expect(rendered).toContain('سنبله');
    expect(rendered).not.toContain('شهریور');
    // 2026 in the Gregorian calendar is 1405 in the Solar Hijri one.
    expect(rendered).toContain('۱۴۰۵');
  });

  it('shapes digits in a count, because a count is prose', () => {
    expect(createFormatters('fa-AF').number(12345)).toBe('۱۲٬۳۴۵');
    expect(createFormatters('en').number(12345)).toBe('12,345');
  });
});

describe('identifiers survive a right-to-left layout', () => {
  /*
   * The failure this prevents is not cosmetic. Inside a right-to-left context the
   * bidirectional algorithm reorders a value's runs against the paragraph
   * direction, and an operator reads an address that is not the one in the
   * finding — then acts on it.
   */
  it('isolates and pins the direction of the value', async () => {
    renderApp(<Identifier>192.168.1.10</Identifier>);
    const element = await screen.findByText('192.168.1.10');
    expect(element).toHaveAttribute('dir', 'ltr');
    expect(element).toHaveStyle({ unicodeBidi: 'isolate' });
  });
});

describe('a finding renders in the reader’s language', () => {
  it('renders a post-V17 row from its message key', () => {
    const english = findingText(CRITICAL_ALERT, 'en');
    expect(english.title).toBe('Cleartext HTTP credentials for "alice" to 10.0.0.50');

    const german = findingText(CRITICAL_ALERT, 'de');
    expect(german.title).toContain('HTTP-Zugangsdaten im Klartext');
    expect(german.title).toContain('alice');
  });

  /*
   * Retention windows are months, so an installation that upgrades has both row
   * shapes in one table for as long as the older rows survive. The pre-V17 row
   * keeps the English sentence it was written with — untranslatable, but readable,
   * which is the better of the two failures.
   */
  it('shows a pre-V17 row’s stored prose, in every language', () => {
    for (const locale of ['en', 'de', 'fa-AF'] as const) {
      expect(findingText(HIGH_ALERT, locale).title).toBe('Port scan: 10.0.0.66 probed 22 ports on 10.0.0.89');
    }
  });

  /*
   * An identifier interpolated into a right-to-left sentence is isolated by the
   * renderer rather than at the call site — the same rule `Identifier` applies to
   * the values that never pass through a message at all.
   */
  it('isolates what it interpolates when the sentence is right-to-left', () => {
    const dari = findingText(CRITICAL_ALERT, 'fa-AF');
    expect(dari.title).toContain('⁨alice⁩');
    expect(dari.title).toContain('⁨10.0.0.50⁩');
  });
});

describe('the language switch', () => {
  /*
   * The labels are the one part of the interface deliberately left untranslated:
   * somebody who has landed in a language they cannot read finds their own by its
   * own name, which is the single word they can be relied on to recognise.
   */
  it('names each language in itself', async () => {
    renderApp(<LanguageToggle />);
    expect(await screen.findByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deutsch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دری' })).toBeInTheDocument();
  });

  it('turns the document right-to-left when Dari is chosen', async () => {
    renderApp(<LanguageToggle />);
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');

    await userEvent.click(await screen.findByRole('button', { name: 'دری' }));

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'fa-AF');
  });
});
