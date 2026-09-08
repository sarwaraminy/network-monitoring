import type { Locale } from '../locales.js';
import type { MessageParams } from '../message.js';
import { createRenderer, type Renderer } from '../render.js';
import { ERRORS_DE } from './errors.de.js';
import { ERRORS_EN, type ErrorMessageKey, type PartialErrorCatalog } from './errors.en.js';
import { ERRORS_FA_AF } from './errors.fa-AF.js';

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
