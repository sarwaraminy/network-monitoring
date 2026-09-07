import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Every link, image and script in the user guide resolves to a file.
 *
 * The guide is hand-written HTML with no build step, which is what keeps it
 * editable by whoever edits it — and means nothing checks it. A topic that
 * references a screenshot nobody captured renders as a broken image; a `href`
 * with a typo is a dead link; a topic added to `nav.js` but never written is a
 * 404 from the table of contents. None of it fails a test, none of it fails a
 * build, and all of it is visible to the customer rather than to us.
 *
 * This file exists because adding the administration-settings topic referenced a
 * screenshot that did not exist yet, and nothing anywhere would have said so.
 *
 * Read as TEXT rather than parsed with a DOM. The assertions are about paths, and
 * pulling in a parser to answer "does this file exist" would make the guard
 * depend on the parser.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GUIDE = resolve(HERE, '..', '..', '..', 'user-guide');

/** Every .html under the guide, including the index. */
function guidePages(): string[] {
  const pages = [join(GUIDE, 'index.html')];
  for (const name of readdirSync(join(GUIDE, 'topics'))) {
    if (name.endsWith('.html')) pages.push(join(GUIDE, 'topics', name));
  }
  return pages;
}

/**
 * Local references worth checking: `href`, `src`.
 *
 * External URLs, in-page anchors and `mailto:` are skipped — there is no file to
 * find. A reference with a `#fragment` is checked as the path before it, since
 * the anchor is a position inside a file rather than a different file.
 */
function localReferences(html: string): string[] {
  const found: string[] = [];
  /*
   * Comments stripped first. A browser does not fetch what is commented out, so
   * neither should this — and the guide uses a commented-out `<figure>` to record
   * a screenshot that has been specified but not captured yet, which is a note to
   * whoever captures it rather than a broken reference.
   */
  const live = html.replace(/<!--[\s\S]*?-->/g, '');

  /*
   * `poster` counts as much as `href` and `src`. The index page embeds the
   * product tour, and a video whose poster has gone missing renders as a black
   * rectangle a reader has to click to discover is not broken — the same class
   * of customer-visible rot this file was written to catch.
   */
  for (const match of live.matchAll(/(?:href|src|poster)="([^"]+)"/g)) {
    const raw = match[1] ?? '';
    if (raw === '' || raw.startsWith('#')) continue;
    if (/^(?:https?:|mailto:|data:|javascript:)/i.test(raw)) continue;
    found.push((raw.split('#')[0] ?? '').trim());
  }

  return found.filter((reference) => reference !== '');
}

describe('the user guide', () => {
  it('has pages to check, so a pass means something', () => {
    // Guards the discovery: if the layout moves and nothing is found, every
    // assertion below passes vacuously and this file quietly stops working —
    // which is the same shape as the bug it was written for.
    const pages = guidePages();

    assert.ok(pages.length > 10, `found only ${pages.length} guide pages under ${GUIDE}`);
    assert.ok(existsSync(join(GUIDE, 'assets', 'nav.js')), 'nav.js is not where this expects');
  });

  it('references no file that does not exist', () => {
    const broken: string[] = [];

    for (const page of guidePages()) {
      const html = readFileSync(page, 'utf8');
      for (const reference of localReferences(html)) {
        // Relative to the page that names it, which is how a browser resolves it.
        if (!existsSync(resolve(dirname(page), reference))) {
          broken.push(`${page.slice(GUIDE.length + 1)} -> ${reference}`);
        }
      }
    }

    assert.deepEqual(
      broken,
      [],
      `the guide references files that are not there:\n  ${broken.join('\n  ')}\n` +
        'A missing screenshot renders as a broken image and a missing topic is a dead link; ' +
        'both are visible to whoever reads the guide.',
    );
  });

  it('loads the sign-out guard on every page', () => {
    /*
     * `guard.js` is the cross-tab sign-out layer: it notices that the session
     * ended elsewhere and returns the tab to `/login`. A page that omits it stays
     * open and readable until the cookie expires — up to twelve hours — which for
     * this guide means the delivery destinations and the SQL console's
     * configuration are on screen for whoever next sits down at the machine.
     *
     * The administration-settings topic shipped without it: one page out of
     * seventeen, and the worst one to miss, because it carries exactly those two
     * screenshots. Nothing failed, because a missing `<script>` is not an error —
     * it is a feature that silently does not run, which is the second defect of
     * that shape in this guide.
     *
     * Asserted over every page including the index, not a hardcoded list, so the
     * next topic added is covered by writing it.
     */
    const unguarded = guidePages()
      .filter((page) => !readFileSync(page, 'utf8').includes('assets/guard.js'))
      .map((page) => page.slice(GUIDE.length + 1));

    assert.deepEqual(
      unguarded,
      [],
      `these guide pages do not load assets/guard.js: ${unguarded.join(', ')}. ` +
        'Without it a signed-out reader keeps the page, and its screenshots, until the cookie expires.',
    );
  });

  it('lists only topics that exist, and every topic it lists', () => {
    /*
     * `nav.js` is the table of contents, written by hand alongside the topics. A
     * topic added to one and not the other is invisible in both directions: an
     * entry with no file is a dead link, and a file with no entry is a page
     * nobody can navigate to — which reads as a topic that was never written.
     */
    const nav = readFileSync(join(GUIDE, 'assets', 'nav.js'), 'utf8');
    const listed = [...nav.matchAll(/href:\s*'([^']+\.html)'/g)].map((match) => match[1] ?? '');
    assert.ok(listed.length > 10, `parsed only ${listed.length} entries from nav.js`);

    const missing = listed.filter((href) => !existsSync(join(GUIDE, 'topics', href)));
    assert.deepEqual(missing, [], `listed in nav.js but not written: ${missing.join(', ')}`);

    const onDisk = readdirSync(join(GUIDE, 'topics')).filter((name) => name.endsWith('.html'));
    const unlisted = onDisk.filter((name) => !listed.includes(name));
    assert.deepEqual(
      unlisted,
      [],
      `written but not in nav.js, so nothing links to them: ${unlisted.join(', ')}`,
    );
  });
});
