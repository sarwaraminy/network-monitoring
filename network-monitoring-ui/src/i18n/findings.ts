import { useLocale } from '../contexts/LocaleContext';
import { type RenderedFinding, renderFinding } from './generated/catalog/findings';
import type { Locale } from './generated/locales';
import { parseMessageParams } from './generated/message';

/**
 * The two sentences a finding is displayed as.
 *
 * Every alert on screen goes through here, and the branch is the migration: rows
 * written since V17 carry a message key and its parameters and are rendered in the
 * reader's language, and rows written before it carry the English sentence the
 * detector produced and are shown as they are.
 *
 * Deliberately not "render the key, and if that produces nothing use the prose".
 * The key is authoritative whenever it is present — a row that has both is one the
 * upsert has since rewritten, and preferring the stale sentence would show the
 * reader a description of an earlier occurrence of the same finding.
 */
export interface DisplayableFinding {
  messageKey: string | null;
  messageParams: unknown;
  /** Pre-V17 prose. Null on everything written since. */
  title: string | null;
  description: string | null;
}

export function findingText(finding: DisplayableFinding, locale: Locale): RenderedFinding {
  if (finding.messageKey !== null && finding.messageKey !== '') {
    return renderFinding(finding.messageKey, parseMessageParams(finding.messageParams), locale);
  }
  // The CHECK constraint makes "neither" impossible in the database, but this
  // renders whatever the API hands it — including, one day, a row from a version
  // that has moved on again. An empty string beats a crash in a list.
  return { title: finding.title ?? '', description: finding.description ?? '' };
}

export function useFindingText(finding: DisplayableFinding): RenderedFinding {
  const { locale } = useLocale();
  return findingText(finding, locale);
}
