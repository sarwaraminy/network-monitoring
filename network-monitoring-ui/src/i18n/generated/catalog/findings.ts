// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
import type { Locale } from '../locales';
import type { MessageParams, MessageRef } from '../message';
import { createRenderer, type Renderer } from '../render';
import { FINDINGS_DE } from './findings.de';
import { FINDINGS_EN, type FindingMessageKey, type PartialFindingCatalog } from './findings.en';
import { FINDINGS_FA_AF } from './findings.fa-AF';

/**
 * The finding catalogue, in every language, and the renderer over it.
 *
 * English is the authored locale and defines the key union; the others are
 * `Partial` on purpose. A translation lands key by key, and a half-finished one
 * must not break the build — the renderer falls back to the English pattern for
 * any key a locale is missing, which leaves the operator reading one English
 * sentence rather than a raw key. Completeness is a *test* rather than a type,
 * so the gap is reported as a list of the keys still to translate instead of as
 * a wall of TS2739. See findings-catalog.test.ts.
 */
export type { FindingMessageKey, PartialFindingCatalog };

export const FINDING_CATALOGS: Readonly<Record<Locale, PartialFindingCatalog>> = {
  en: FINDINGS_EN,
  de: FINDINGS_DE,
  'fa-AF': FINDINGS_FA_AF,
};

export const findingMessages: Renderer = createRenderer(FINDING_CATALOGS);

/** A reference to a finding message, narrowed to keys that exist. */
export type FindingRef = MessageRef<FindingMessageKey>;

/**
 * The two sentences a stored finding renders to.
 *
 * `message_key` names the *pair* — `arp_spoofing.sprawl`, from which
 * `arp_spoofing.sprawl.title` and `.description` are derived — rather than the
 * two being stored separately. They always co-occur and are always emitted from
 * the same branch of the same detector, so one key and one params object cannot
 * drift apart the way two of each could. The title interpolating only some of the
 * params is deliberate and costs nothing.
 */
export interface RenderedFinding {
  title: string;
  description: string;
}

export function renderFinding(key: string, params: MessageParams, locale: Locale): RenderedFinding {
  return {
    title: findingMessages.render({ key: `${key}.title`, params }, locale),
    description: findingMessages.render({ key: `${key}.description`, params }, locale),
  };
}
