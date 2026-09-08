import { describe, expect, it } from 'vitest';
import { createFormatters } from '../i18n/format';
import { translate } from '../i18n/ui';
import { describePageRange, type PageFacts } from './GridPagination';

/**
 * The footer's record range, pinned as a pure function.
 *
 * Rendering a Material React Table to assert one line of text would be testing
 * MRT, slowly. What is worth pinning is the sentence: which of the several
 * numbers in play is shown, and the boundaries where a range is easy to state
 * wrongly — the last page, an empty result, a filter that shrank the total.
 */

/*
 * The sentence is assembled from catalogue keys now, so the test supplies the
 * same two things the component does. English deliberately: these assertions are
 * about which numbers appear and where the boundaries fall, not about the German
 * wording — the catalogue's own suite covers whether a key exists in each locale.
 */
const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate('en', key, params);
const fmt = createFormatters('en');

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  total: 100,
  unfiltered: 100,
  page: 1,
  pageSize: 25,
  pageCount: 4,
  ...over,
});

describe('describePageRange', () => {
  it('reads as the source system does', () => {
    expect(describePageRange(facts(), t, fmt)).toBe('1–25 of 100');
  });

  it('follows the page', () => {
    expect(describePageRange(facts({ page: 3 }), t, fmt)).toBe('51–75 of 100');
  });

  it('does not run the last page past the end', () => {
    // 90 rows in pages of 25: the fourth holds 15, not 25.
    expect(describePageRange(facts({ total: 90, unfiltered: 90, page: 4 }), t, fmt)).toBe('76–90 of 90');
  });

  it('starts at zero when there is nothing', () => {
    // "1–0 of 0" is the arithmetic answer and a nonsense sentence.
    expect(describePageRange(facts({ total: 0, unfiltered: 0, pageCount: 1 }), t, fmt)).toBe('0–0 of 0');
  });

  it('says how much a filter is hiding', () => {
    // Without the original total a narrow filter reads as an empty database
    // rather than as a narrow question.
    expect(describePageRange(facts({ total: 12, unfiltered: 340, pageCount: 1 }), t, fmt)).toBe(
      '1–12 of 12, filtered from 340',
    );
  });

  it('says nothing about filtering when nothing is filtered', () => {
    expect(describePageRange(facts({ total: 100, unfiltered: 100 }), t, fmt)).not.toMatch(/filtered/);
  });

  it('groups thousands, so a large count is readable at a glance', () => {
    expect(
      describePageRange(facts({ total: 12_450, unfiltered: 12_450, page: 101, pageCount: 498 }), t, fmt),
    ).toBe('2,501–2,525 of 12,450');
  });
});
