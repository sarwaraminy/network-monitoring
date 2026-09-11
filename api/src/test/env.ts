/**
 * Making an environment variable absent, in a way that survives `dotenv`.
 *
 * `delete process.env.X` does not work in a test, and the reason is an ordering
 * that is invisible from the test file. `config/env.ts` calls
 * `dotenv.config({ path: api/.env })` at module load, and a test reaches that
 * load *later* than its own top-level statements — through
 * `openTestDatabase`, or through the dynamic `import()` in a `before` hook. So
 * the sequence is: the test deletes the variable, and then dotenv reads
 * `api/.env` and puts it straight back.
 *
 * On a machine with no `api/.env` — CI — the delete holds and the test passes.
 * On a developer's machine it does not, and the failure is not recognisable as an
 * environment leak: `adhoc-settings.routes.test.ts` reported `source:
 * 'environment'` where it expected `'default'`, and `adhoc-audit-force.test.ts`
 * reported that a setting "really did loosen" when it had not. Both files already
 * carried docblocks saying an environment leak would make the failure look like a
 * bug in the resolver, which is exactly what it did — for two years of `.env`
 * files nobody could see from the test.
 *
 * **A blank value is what "absent" is spelled as in this codebase**, so that is
 * what this writes. `env.ts`'s `int`, `bool` and the rest return their fallback
 * for a value that trims to empty, and `parseFieldValue` in
 * `adhoc-settings.ts` returns `undefined` for one — which is precisely "the
 * environment says nothing about this field", the state a three-layer resolver
 * needs in order to fall through to the stored row. The README and the user guide
 * both state the rule from the operator's side: `NOTIFY_ENABLED=` with nothing
 * after it is somebody who has not decided.
 *
 * And a blank key is still `in process.env`, which is the half that fixes the
 * ordering: dotenv's `populate` skips any key `hasOwnProperty` already reports,
 * empty string included, unless `override` is set. So this holds whenever it runs,
 * before or after the config module loads.
 *
 * Use it instead of `delete` for any variable a test needs unset. `delete` is
 * still right for a variable set by the test itself and being cleaned up within
 * one file, where no `.env` can be holding a value for it — `ADHOC_MAX_ROWS` in
 * `adhoc-settings.routes.test.ts` does that inside a single case.
 */
export function unsetForTest(...names: readonly string[]): void {
  for (const name of names) {
    process.env[name] = '';
  }
}
