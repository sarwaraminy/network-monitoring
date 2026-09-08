/**
 * The shape a translatable message takes once it has left the detector.
 *
 * A finding is stored as a *key plus params*, never as prose — see
 * V17__Finding_message_keys.sql. Prose written at detection time can only ever
 * be read back in the language the sensor happened to be running in, and no
 * later translation can recover the structure that was interpolated away.
 */

/**
 * A value a message may interpolate.
 *
 * `string` and `number` are not interchangeable here, and choosing wrongly is a
 * visible bug rather than a style question:
 *
 * - **Identifiers pass as strings.** An IP address, MAC, port, byte count or
 *   hostname must render as the operator will see it in `tcpdump`, the switch
 *   and the firewall. ICU formats a `number` argument through
 *   `Intl.NumberFormat`, which in `fa-AF` yields Eastern Arabic-Indic digits
 *   (۴۴۵ for 445) and grouping separators — a port nobody can paste and no
 *   `grep` will match.
 * - **Counts pass as numbers**, because they are the arguments of `plural` and
 *   because localised digits are correct for prose ("۳ یافته").
 *
 * `boolean` exists for the conditional clauses several descriptions carry; ICU
 * reaches them with `{flag, select, true{...} other{...}}`.
 */
export type MessagePrimitive = string | number | boolean | null;

/**
 * A reference to another catalogue entry, interpolated into this one.
 *
 * Needed because some findings compose: the threat-intel description names how
 * the match was observed ("via packet capture", "via NetFlow v9 from 10.0.0.1"),
 * and the DNS tunnelling description lists the reasons the name looked encoded.
 * Those fragments are prose and so must themselves be translatable, which a
 * plain string param cannot be.
 */
export interface MessageRef<K extends string = string> {
  readonly key: K;
  readonly params?: MessageParams<K>;
}

export type MessageValue<K extends string = string> =
  | MessagePrimitive
  | MessageRef<K>
  | readonly MessageRef<K>[];

export type MessageParams<K extends string = string> = Readonly<Record<string, MessageValue<K>>>;

/** A `MessageRef` that has been read back out of `jsonb` and not yet validated. */
export type UnknownMessageRef = { key: string; params?: Record<string, unknown> };

function isRef(value: unknown): value is UnknownMessageRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { key?: unknown }).key === 'string'
  );
}

/**
 * Validates params read back from the database.
 *
 * `message_params` is `jsonb`, so by the time it reaches a renderer its type is a
 * promise rather than a fact — the row may predate a catalogue change, or have
 * been written by a sensor running a different version against the same shared
 * database, which V16 established is a supported deployment. Anything that is
 * not a value this renderer understands is dropped rather than passed to ICU,
 * which would otherwise throw mid-render and cost the whole alert list.
 */
export function parseMessageParams(raw: unknown): MessageParams {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  const out: Record<string, MessageValue> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parseValue(value);
    if (parsed !== undefined) out[name] = parsed;
  }
  return out;
}

function parseValue(value: unknown): MessageValue | undefined {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value as string | boolean;
  // Rejects NaN and the infinities: ICU renders them, and "∞ ports" is worse
  // than the parameter going missing.
  if (type === 'number') return Number.isFinite(value) ? (value as number) : undefined;

  if (Array.isArray(value)) {
    const refs = value.filter(isRef).map(parseRef);
    // An array of anything other than refs is not a shape this renderer has a
    // rule for, so it is dropped rather than guessed at.
    return refs.length === value.length ? refs : undefined;
  }

  if (isRef(value)) return parseRef(value);
  return undefined;
}

function parseRef(value: UnknownMessageRef): MessageRef {
  return value.params === undefined
    ? { key: value.key }
    : { key: value.key, params: parseMessageParams(value.params) };
}
