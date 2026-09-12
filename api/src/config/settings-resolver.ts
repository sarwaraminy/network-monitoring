/**
 * The three-layer settings rule, written once.
 *
 * **Environment → stored row → code default, and the environment wins.** Three
 * features resolve their settings this way — delivery (#39), the query console
 * (#53) and flow collection (#63) — and each arrived with its own hand-written
 * copy, every one justified at the time by not wanting to disturb the ones before
 * it. That argument does not survive a fourth, and the roadmap said so.
 *
 * **What is shared here is the layer walk, not the parsing.** That distinction is
 * the whole design and it is worth being explicit about, because the obvious
 * extraction — one generic `parseFieldValue` with a `kind` switch — is the wrong
 * one. The three parsers disagree on four points, and every disagreement is
 * deliberate, documented, and load-bearing:
 *
 *  - **A blank string.** Adhoc and flow refuse it for every kind; delivery
 *    refuses it only for integers, because a blank string field there is a real
 *    empty value.
 *  - **An unrecognised boolean.** Delivery returns `false`; adhoc and flow return
 *    `undefined`. Delivery's is legacy compatibility with `env.ts`'s old `bool()`,
 *    so `NOTIFY_INCLUDE_EVIDENCE=maybe` keeps meaning false rather than falling
 *    through to a default of `true` — a behaviour flip for every boolean that
 *    defaults on.
 *  - **Integer bounds.** Adhoc and flow refuse out-of-range; delivery does not,
 *    deliberately, so a legacy `NOTIFY_MAX_PER_HOUR=-1` keeps behaving as it did.
 *  - **Trimming a string.** Delivery and flow trim; adhoc does not, because
 *    `ADHOC_DB_PASSWORD`'s whitespace is part of the password.
 *
 * Folding those into one function means four compatibility flags serving three
 * callers, which is harder to read than three explicit parsers and turns every
 * future edit into a chance to fix one domain and silently change another. So
 * each module keeps its parser, with its comments and the bugs they record, and
 * hands it to `createResolver` as a function.
 *
 * What that leaves genuinely common is the part that has actually broken: the
 * order of the layers, what counts as "the environment said nothing", and which
 * fields are therefore pinned. `compose-unpinned.test.ts` and
 * `env-defaults.test.ts` exist because the blank-is-unset rule was got wrong in
 * shipped Compose files twice and in both `.env` examples once. It is now one
 * implementation rather than three.
 */

/** Which layer decided a field's value. */
export type SettingSource = 'environment' | 'database' | 'default';

export interface ResolvedField<T = unknown> {
  value: T;
  source: SettingSource;
}

/**
 * What the resolver needs to know about a field.
 *
 * Each domain's own spec carries more — `kind`, `min`, `max`, `values`,
 * `httpsOnly` — and none of it is read here, because only that domain's parser
 * looks at it. Structural typing means a richer spec satisfies this one without
 * any declaration saying so.
 */
export interface FieldSpec<T = unknown> {
  /** The environment variable that pins this field. */
  env: string;
  /**
   * A credential: reported as configured-or-not, never returned.
   *
   * Read by the API views rather than by the walk, and declared here so the three
   * of them share one spelling of "do not send this to a browser" — a second
   * vocabulary for that is how one of them eventually gets it wrong.
   */
  secret?: boolean;
  /**
   * What a CLEARED stored value resolves to, for a field where clearing is a
   * decision rather than a gap.
   *
   * Present on flow's `exporters` and nothing else so far: an administrator who
   * empties the allowlist means "accept any sender", and treating that as
   * "nobody has decided" would silently reinstate whatever the environment said,
   * undoing a list somebody had deliberately emptied.
   *
   * A blank in the ENVIRONMENT still means unset, for every field including this
   * one, because that is how an unset Compose variable arrives — see `resolve`.
   * The two blanks look identical and mean opposite things, which is why this is
   * declared on the field rather than hidden inside a parser: a parser is not
   * told which layer it is reading.
   *
   * **A value rather than a boolean, and that is the point.** As a flag this read
   * `blankStoredIsValue`, and `resolve` tested the flag instead of the value —
   * so every stored string on such a field bypassed the parser, not just a blank
   * one. Harmless for `exporters`, whose parser only trims, and a trap for the
   * obvious next adopter: a comma-separated list field would resolve to the raw
   * string instead of the array, and the string's length would be reported as
   * the recipient count. Naming the cleared value also settles what "empty" means
   * for a field whose values are not strings — `''` here, `[]` for a list.
   *
   * **Typed as the field's own value**, so `clearedValue: []` on a string field
   * is refused at the table rather than surfacing wherever the value is finally
   * consumed. It was `unknown` when the rename landed, which left exactly the
   * hole `ExactFields` had just closed for keys: the shared surface is generic
   * enough for three domains, and per-domain type safety became an `unknown`.
   *
   * **`undefined` is not a cleared value**, and `resolve` tests the value rather
   * than the key for that reason. Declaring it would resolve the field to
   * `{ value: undefined, source: 'database' }` — no value at all, while claiming
   * the row decided it, and skipping the default layer that would have supplied
   * one. No settings type has `undefined` in it, so nothing is lost by refusing.
   */
  clearedValue?: T;
}

/**
 * A field table: one spec per setting, each typed to its own field's value.
 *
 * The per-field typing is what makes `clearedValue` checkable where it is
 * written, which is the only place the author can act on it.
 */
export type FieldTable<S> = { [K in keyof S]: FieldSpec<S[K]> };

/** A resolution: every field of `S`, with the layer that decided it. */
export type Resolution<S> = { [K in keyof S]: ResolvedField<S[K]> };

/** A stored row, before parsing: every field optional and of unknown shape. */
export type StoredSettings<S> = Partial<Record<keyof S, unknown>>;

/** The variables, as `process.env` hands them over. */
export type EnvironmentSource = Record<string, string | undefined>;

/**
 * A field table with no keys the settings type does not have.
 *
 * `Record<keyof S, FieldSpec>` is the obvious spelling and it only constrains
 * which keys must be PRESENT — extras pass, and the excess-property check does
 * not save it either, because every call site passes a table by name rather than
 * as a fresh literal. A stray entry then resolves to
 * `{ value: undefined, source: 'default' }` and reaches the admin form as an
 * empty control that saves nothing and reads back nothing.
 *
 * The per-domain versions could not reach that: each indexed its own `DEFAULTS`
 * directly, so a missing counterpart was a type error at the table. Centralising
 * the walk is what loosened it, and this is what puts it back.
 *
 * The mapped form `{ [K in keyof S]: FieldSpec }` does NOT fix it — it is the
 * same type as `Record` and accepts extras identically, which I checked rather
 * than assumed.
 */
type ExactFields<F, S> = F & Record<Exclude<keyof F, keyof S>, never>;

export interface ResolverOptions<S extends object, F> {
  fields: ExactFields<F, S>;
  /** The last layer. Must match what `env.ts` applies, or removing a line changes behaviour. */
  defaults: S;
  /**
   * This domain's parser: a raw value from any layer, or `undefined` if it
   * offered nothing usable. See the module docblock for why this is a parameter.
   */
  parse: (field: keyof S & string, raw: unknown) => unknown;
}

export interface Resolver<S extends object> {
  resolve(environmentSource: EnvironmentSource, stored?: StoredSettings<S>): Resolution<S>;
  /** The values alone, for code that does not care which layer won. */
  effective(resolution: Resolution<S>): S;
  /** Fields the environment has pinned, which an interface must not offer to edit. */
  pinned(resolution: Resolution<S>): (keyof S & string)[];
  /** Variables that are set to something unusable, so it can be said out loud. */
  invalidEnvironment(environmentSource: EnvironmentSource): string[];
  /** The variables a patch would be fighting, named so the reader can act on it. */
  conflicts(resolution: Resolution<S>, patch: StoredSettings<S>): string[];
  /** Whether a field is a credential. */
  isSecret(field: keyof S & string): boolean;
}

export function createResolver<S extends object, F extends FieldTable<S>>(
  options: ResolverOptions<S, F>,
): Resolver<S> {
  const { defaults, parse } = options;
  const fields = options.fields as FieldTable<S>;
  const names = () => Object.keys(fields) as (keyof S & string)[];

  return {
    resolve(environmentSource, stored = {}) {
      const resolution = {} as Resolution<S>;

      for (const field of names()) {
        const spec = fields[field];

        /*
         * The environment, where blank counts as unset.
         *
         * Checked here rather than left to each parser, because it is the
         * property the shipped deployment files depend on:
         * `FLOW_PORT: ${FLOW_PORT:-}` arrives as an empty string, and if that
         * counted as a value then every Compose deployment would be pinned by a
         * file the customer cannot edit. That bug shipped twice — see
         * `compose-unpinned.test.ts` — which is reason enough for it to have one
         * implementation.
         */
        const rawEnvironment = environmentSource[spec.env];
        if (rawEnvironment !== undefined && rawEnvironment.trim() !== '') {
          const fromEnvironment = parse(field, rawEnvironment);
          if (fromEnvironment !== undefined) {
            resolution[field] = { value: fromEnvironment, source: 'environment' } as never;
            continue;
          }
          // Set but unusable falls through rather than pinning nonsense: pinning
          // a field to a value that can never apply would disable the control
          // and change nothing, which is the worst of both. `invalidEnvironment`
          // is what stops that happening in silence.
        }

        const rawStored = stored[field];

        /*
         * A cleared value, for a field that says what clearing means.
         *
         * Tested against the VALUE on both sides. The stored value must actually
         * be blank — anything else goes to the parser like every other stored
         * value, so a field whose parser builds a list still gets a list. And
         * `clearedValue` must actually be set: `undefined` is not a cleared
         * value, because resolving to it would report `source: 'database'` over
         * no value at all and skip the default that would have supplied one.
         */
        if (spec.clearedValue !== undefined && typeof rawStored === 'string' && rawStored.trim() === '') {
          resolution[field] = { value: spec.clearedValue, source: 'database' } as never;
          continue;
        }

        const fromStored = parse(field, rawStored);

        if (fromStored !== undefined) {
          resolution[field] = { value: fromStored, source: 'database' } as never;
          continue;
        }

        resolution[field] = { value: defaults[field], source: 'default' } as never;
      }

      return resolution;
    },

    effective(resolution) {
      const settings = {} as Record<string, unknown>;
      for (const field of names()) settings[field] = resolution[field].value;
      return settings as S;
    },

    pinned(resolution) {
      return names().filter((field) => resolution[field].source === 'environment');
    },

    /**
     * Variables set to something this cannot use.
     *
     * An unusable value falls through to the next layer, which is right. What was
     * missing in every copy of this until it was added to each in turn is that it
     * happened in silence — and every piece of evidence then points the wrong
     * way: the variable is there in the operator's file, the process is running,
     * and the form shows the field as editable rather than pinned, because a
     * rejected value does not pin. `FLOW_PORT=514` leaves the collector on 2055
     * with nothing anywhere connecting the two.
     *
     * Absent and blank are "nobody decided" rather than "this is wrong", so
     * neither is reported: warning about them would put a line in the log of
     * every deployment that uses the forms.
     */
    invalidEnvironment(environmentSource) {
      const invalid: string[] = [];

      for (const field of names()) {
        const { env } = fields[field];
        const raw = environmentSource[env];
        if (raw === undefined || raw.trim() === '') continue;
        if (parse(field, raw) === undefined) invalid.push(env);
      }

      return invalid;
    },

    /**
     * The pinned fields a patch is trying to change, as variable names.
     *
     * Names rather than field keys, because the remedy is to remove a line from a
     * file and that is what the reader has in front of them.
     */
    conflicts(resolution, patch) {
      return names()
        .filter((field) => field in patch && resolution[field].source === 'environment')
        .map((field) => fields[field].env);
    },

    isSecret(field) {
      return fields[field].secret === true;
    },
  };
}
