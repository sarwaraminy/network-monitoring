// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
import type { Locale } from '../locales';
import type { MessageParams } from '../message';
import { createRenderer, type Renderer } from '../render';
import { NOTIFY_DE } from './notify.de';
import { NOTIFY_EN, type NotifyMessageKey, type PartialNotifyCatalog } from './notify.en';
import { NOTIFY_FA_AF } from './notify.fa-AF';

/**
 * The outbound-notification catalogue, in every language, and its renderer.
 *
 * Third alongside findings and errors, for the reason `errors.ts` gives about
 * being second: a different reader and a different lifetime. This text is
 * written into an email or a chat message in the language the *installation*
 * chose — see `OUTBOUND_LOCALE` — rather than in a browser that knows who is
 * looking.
 */
export type { NotifyMessageKey, PartialNotifyCatalog };

export const NOTIFY_CATALOGS: Readonly<Record<Locale, PartialNotifyCatalog>> = {
  en: NOTIFY_EN,
  de: NOTIFY_DE,
  'fa-AF': NOTIFY_FA_AF,
};

export const notifyMessages: Renderer = createRenderer(NOTIFY_CATALOGS);

export function renderNotify(key: NotifyMessageKey, params: MessageParams, locale: Locale): string {
  return notifyMessages.render({ key, params }, locale);
}
