import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ADHOC_FIELDS } from '../services/adhoc-settings.js';
import { FLOW_FIELDS } from '../services/flow-settings.js';

/**
 * A setting editable in the browser must not be pinned by the file we ship.
 *
 * Every three-layer setting resolves environment → stored row → default, and the
 * environment wins. That rule is right, and it is what lets a deployment driven
 * by config management keep its guarantees. It becomes a bug the moment *our own*
 * Compose file supplies the value, because then every installation is pinned by a
 * file the customer was told not to edit — and a customer who bought this product
 * has no shell on the box at all.
 *
 * This has happened twice.
 *
 *  - **Delivery settings**, fixed in #53. Every one of the sixteen variables
 *    carried its code default here — `:-false`, `:-high`, `:-514` — so the page
 *    reported "16 settings are set in the environment and cannot be changed here"
 *    on every Compose deployment since it shipped. The whole feature was inert
 *    and nothing failed.
 *  - **Flow collection**, found while building its settings form and fixed in the
 *    same commit as this test. `FLOW_ENABLED`, `FLOW_PORT` and
 *    `FLOW_BIND_ADDRESS` each baked a default in, so three of the four fields
 *    would have shipped disabled on arrival.
 *
 * Both were invisible to every other test, because each half is individually
 * correct: the resolver does exactly what it says, and the Compose file supplies
 * a value that is exactly the code default. It is only the *combination* — a
 * correct rule applied to a value nobody chose — that makes the feature
 * unreachable. So the check is on the combination.
 *
 * **Blank is the fix, not absence.** `FLOW_PORT: ${FLOW_PORT:-}` still lets an
 * operator set `FLOW_PORT` in their `.env` and have it pin the field, which is the
 * guarantee worth keeping; it just stops being the default for everybody. `env.ts`
 * and `parseFieldValue` both treat a blank as "nobody has decided", which is what
 * makes this safe — see `test/env.ts`, which relies on the same rule.
 *
 * Only variables backing a setting with a *form* are checked. `INTEL_*` and
 * `CAPTURE_RESUME_ON_START` carry real defaults here on purpose: they have no
 * editable control, so nothing is disabled by their being set, and
 * `CAPTURE_RESUME_ON_START` is deliberately environment-only — starting a capture
 * with nobody present is a decision about the installation. Add a form for one of
 * those and it belongs in this list on the same day.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

/**
 * Every Compose file a customer is told to run, and what each may pin on purpose.
 *
 * The main file may pin nothing: it is what every deployment gets, and a value
 * there is a value nobody chose. The overlays are different — an override exists
 * precisely to decide something — so each is read with an exemption list that has
 * to be typed out next to its reason, the same shape `route-guards.test.ts` uses
 * for a route it deliberately leaves ungated.
 *
 * Reading only the main file was the first version's gap, and it missed the file
 * that matters most: `docker-compose.flow.yml` is the *only* deployment on which
 * flow collection works at all, so the fields it pins are the ones a customer
 * actually meets.
 */
const COMPOSE_FILES: { file: string; mayPin: Record<string, string> }[] = [
  { file: 'docker-compose.yml', mayPin: {} },
  {
    file: 'docker-compose.flow.yml',
    mayPin: {
      /*
       * The overlay exists to turn flow on. Its environment block and its
       * `ports:` publish belong together — one without the other is a published
       * port forwarding to nothing, or a listener nothing can reach — so the
       * switch it exists to set is the one thing it should decide. Switching
       * collection off means not running this overlay.
       */
      FLOW_ENABLED: 'the override exists to enable flow; its publish and its switch belong together',
      /*
       * The published host port and the container's port come from the same
       * variable — `${FLOW_PORT:-2055}:${FLOW_PORT:-2055}/udp` — so they cannot
       * be allowed to disagree. A port changed in the browser would rebind
       * inside the container while Docker forwarded the old one, and collection
       * would stop with every counter reading like a device that is not sending.
       * Pinning it puts that mistake out of reach, which is the belt to the
       * form's braces.
       */
      FLOW_PORT: 'the published host port is derived from the same variable and must not disagree',
      /*
       * Inside a container this has to be 0.0.0.0: a published port forwards to
       * the container's interface, not its loopback. `FLOW_BIND_ADDRESS=127.0.0.1`
       * looks like a reasonable hardening step and silently produces a collector
       * nothing can reach, with no error anywhere.
       */
      FLOW_BIND_ADDRESS: 'must be 0.0.0.0 inside a container, and a plausible wrong value fails silently',
    },
  },
];

/**
 * The one field no overlay may pin, stated as its own rule.
 *
 * `FLOW_EXPORTERS` is the allowlist, and the only flow setting that changes in
 * ordinary operation — a device is added and it has to be let in. It is also the
 * only access control this collector has, since NetFlow authenticates nothing. A
 * deployment that pinned it would leave an administrator unable to admit a new
 * exporter without a redeploy, on the file they cannot edit.
 */
const NEVER_PINNED = ['FLOW_EXPORTERS'];

/**
 * The variables a browser-editable setting resolves from.
 *
 * Read out of the field tables rather than listed here, so a field added to a
 * resolver is covered without anybody remembering to update this file — which is
 * the failure mode a hand-maintained list would have.
 */
async function editableVariables(): Promise<string[]> {
  // Imported lazily: `notify/settings.ts` is pulled in by modules that construct
  // the connection pool at load, and this test has no database.
  const { DELIVERY_FIELDS } = await import('../notify/settings.js');

  return [
    ...Object.values(DELIVERY_FIELDS).map((field) => field.env),
    ...Object.values(ADHOC_FIELDS).map((field) => field.env),
    ...Object.values(FLOW_FIELDS).map((field) => field.env),
  ];
}

/** `NAME: ${NAME:-default}` → the default, or null where the line sets nothing. */
function composeDefaultFor(compose: string, name: string): string | null | undefined {
  const line = new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm').exec(compose);
  if (!line) return undefined;

  const value = line[1]!.trim();
  const interpolated = new RegExp(`^\\$\\{${name}:-(.*)\\}$`).exec(value);
  // Not an interpolation at all — a hard-coded value, which pins unconditionally.
  if (!interpolated) return value;
  const fallback = interpolated[1]!;
  return fallback === '' ? null : fallback;
}

describe('the shipped Compose files pin no editable setting by accident', () => {
  const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');

  for (const { file, mayPin } of COMPOSE_FILES) {
    it(`passes every browser-editable variable in ${file} through blank, or says why not`, async () => {
      const contents = readFileSync(join(ROOT, file), 'utf8');
      const pinned: string[] = [];

      for (const name of await editableVariables()) {
        const fallback = composeDefaultFor(contents, name);
        // Absent is fine: the variable is simply not offered to the container, so
        // nothing is pinned. Only a non-blank default is a problem.
        if (fallback === undefined || fallback === null) continue;
        if (name in mayPin) continue;
        pinned.push(`${name} (defaults to "${fallback}")`);
      }

      assert.deepEqual(
        pinned.sort(),
        [],
        `these are editable in the interface and pinned by ${file}, so the control renders ` +
          'disabled on that deployment and the customer has no way to reach it. Pass them through ' +
          'blank — the code default is the same value — or, if the file has a reason to decide ' +
          'this one, add it to `mayPin` next to the reason',
      );
    });

    it(`does not claim a reason in ${file} for a field it no longer pins`, () => {
      // An exemption that stops matching survives silently, and the next value to
      // land on that variable inherits a waiver nobody granted it. The same
      // staleness check `route-guards.test.ts` makes about its own list.
      const contents = readFileSync(join(ROOT, file), 'utf8');
      const stale = Object.keys(mayPin).filter((name) => {
        const fallback = composeDefaultFor(contents, name);
        return fallback === undefined || fallback === null;
      });

      assert.deepEqual(stale, [], `${file} no longer pins these, so the exemptions should go`);
    });
  }

  it('never pins the allowlist, on any file', () => {
    /*
     * The one field an override must leave alone, checked across all of them
     * rather than left to each file's own list. A device added to the network
     * has to be admitted without a redeploy, and this is the only access control
     * flow has.
     */
    for (const { file } of COMPOSE_FILES) {
      const contents = readFileSync(join(ROOT, file), 'utf8');
      for (const name of NEVER_PINNED) {
        const fallback = composeDefaultFor(contents, name);
        assert.ok(
          fallback === undefined || fallback === null,
          `${file} pins ${name}, which an administrator has to be able to change from the browser`,
        );
      }
    }
  });

  it('recognises a baked-in default, so the check above can fail', () => {
    // The check on the check. A parser that returned `null` for everything would
    // report a clean file no matter what it contained, which is precisely how the
    // delivery bug survived: nothing was looking.
    const sample = [
      // biome-ignore-start lint/suspicious/noTemplateCurlyInString: Compose
      // interpolation, which is the syntax under test. A template literal here
      // would make JavaScript substitute a variable that does not exist.
      '      FLOW_PORT: ${FLOW_PORT:-2055}',
      '      NOTIFY_ENABLED: ${NOTIFY_ENABLED:-}',
      // biome-ignore-end lint/suspicious/noTemplateCurlyInString: as above
      '      HARD_CODED: 7',
    ].join('\n');

    assert.equal(composeDefaultFor(sample, 'FLOW_PORT'), '2055');
    assert.equal(composeDefaultFor(sample, 'NOTIFY_ENABLED'), null);
    assert.equal(composeDefaultFor(sample, 'HARD_CODED'), '7');
    assert.equal(composeDefaultFor(sample, 'ABSENT'), undefined);
  });

  it('still lets an operator pin a field deliberately', () => {
    /*
     * The half this rule must not break. `${NOTIFY_ENABLED:-}` is not "ignore
     * this variable" — it is "no default", so a value in the operator's own
     * `.env` still reaches the container and still wins over the stored row.
     *
     * Asserted against the file rather than reasoned about, because the whole
     * point of the blank form is that it keeps the guarantee while removing the
     * default, and a future cleanup that deleted these lines as pointless would
     * quietly take the guarantee with them.
     */
    for (const name of ['NOTIFY_ENABLED', 'ADHOC_ENABLED']) {
      assert.equal(
        composeDefaultFor(compose, name),
        null,
        `${name} should be passed through with an empty default, not removed`,
      );
    }
  });
});
