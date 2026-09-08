// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
import type { Locale } from '../locales';
import type { MessageParams } from '../message';
import { createRenderer, type Renderer } from '../render';
import { ERRORS_DE } from './errors.de';
import { ERRORS_EN, type ErrorMessageKey, type PartialErrorCatalog } from './errors.en';
import { ERRORS_FA_AF } from './errors.fa-AF';

/**
 * The error catalogue, in every language, and the renderer over it.
 *
 * A second catalogue rather than more keys in the finding one, because the two
 * have different lifetimes and different readers: a finding's text is persisted
 * and rendered months later, an error's is rendered once and thrown away. Sharing
 * a renderer is enough sharing.
 */
export type { ErrorMessageKey, PartialErrorCatalog };

export const ERROR_CATALOGS: Readonly<Record<Locale, PartialErrorCatalog>> = {
  en: ERRORS_EN,
  de: ERRORS_DE,
  'fa-AF': ERRORS_FA_AF,
};

export const errorMessages: Renderer = createRenderer(ERROR_CATALOGS);

export function renderError(key: string, params: MessageParams, locale: Locale): string {
  return errorMessages.render({ key, params }, locale);
}

/**
 * Whether this catalogue can turn `key` into a sentence.
 *
 * For the caller that has something better than a key to show when it cannot —
 * every error response carries an English `message` beside its `code`, and a
 * reader is better served by an English sentence than by `error.session_expired`.
 * Without this check the browser renders whatever identifier it was given, and
 * does it silently, because rendering "succeeded".
 *
 * The case is not exotic: a server that ships a new code reaches browsers holding
 * a bundle from before it, and during a rolling deploy both are live at once.
 */
export function knowsError(key: string): boolean {
  return errorMessages.has(key);
}
