import { type Prefix, parsePrefix, prefixContains } from '../net/prefix.js';
import { ALERT_KINDS } from '../packet/detect/types.js';

/**
 * Suppression rules: the operator's answer to "yes, I know, that one is expected".
 *
 * This is the difference between a tool that survives its second month and one
 * that gets switched off. An authorised vulnerability scanner sweeping the estate
 * every night raises a `high` port-scan finding every night, correctly, forever.
 * Without a way to say "that source, that kind, expected", the alert table fills
 * with known-good noise, the real findings sit underneath it, and the person on
 * call learns that the alerts do not mean anything.
 *
 * A suppressed finding is DROPPED, not stored-and-hidden. That is a deliberate
 * trade and it is the risky half of this feature, so it is stated plainly here
 * and again in the migration: a rule broader than its author realised discards
 * real findings and leaves nothing behind to notice. Three things exist to make
 * that visible rather than silent:
 *
 *  - Every rule carries a `reason`, required, so a rule nobody can justify later
 *    is obvious as soon as anyone reads the list.
 *  - Every rule counts its matches and records when it last fired, so "this rule
 *    is quietly eating 4,000 findings a day" is a number on the screen rather
 *    than a discovery during an incident.
 *  - Every rule can carry an expiry, so "suppress while the pen test runs" does
 *    not become a permanent blind spot because somebody forgot.
 *
 * Matching is pure and lives here, apart from the database and the cache, so the
 * semantics below can be pinned exhaustively by tests. Everything a rule can say
 * is a conjunction: each criterion that is set must match, and a criterion left
 * unset matches anything. There is deliberately no OR, no negation and no
 * expression language — see the roadmap's cut list. A rule you cannot read at a
 * glance is a rule you cannot audit.
 */

/**
 * The parts of a rule that decide whether it matches.
 *
 * A subset of the stored row on purpose: this module must not import the schema,
 * so it stays testable without a database. The Drizzle row satisfies it
 * structurally.
 */
export interface SuppressionCriteria {
  id: number;
  /** Detector kind, e.g. `port_scan`. Null matches every kind. */
  kind: string | null;
  /** CIDR or bare address the finding's source must fall inside. Null matches any. */
  sourceCidr: string | null;
  /** Same, for the finding's target. */
  targetCidr: string | null;
  /** Destination port. Null matches any — see `SuppressibleEvent.port`. */
  port: number | null;
  enabled: boolean;
  /** Null never expires. */
  expiresAt: Date | null;
}

/**
 * What a rule is matched against.
 *
 * Both a `Finding` on its way to being stored and a stored `AlertRow` satisfy
 * this, which is what lets the preview endpoint answer "how many of my recent
 * alerts would this rule have dropped?" through the same code path that does the
 * dropping. A preview that reimplemented the matching would be a preview of
 * something else.
 */
export interface SuppressibleEvent {
  kind: string;
  sourceIp?: string | null;
  targetIp?: string | null;
  /**
   * The single destination port this event is about, or null.
   *
   * Null for most kinds, and that is not an omission. A port scan's defining
   * property is that it touched *many* ports, so no one port describes it, and
   * attaching the last one observed would make a port criterion behave like a
   * lottery. A port criterion therefore only ever matches findings that name
   * exactly one port — a sweep of a single service, a cleartext login on a known
   * service port.
   */
  port?: number | null;
}

/**
 * Kinds a detector can actually raise.
 *
 * Checked at compile time as well as at the API boundary, and the reason is a
 * rename rather than a typo — `z.enum(ALERT_KINDS)` already stops anyone typing
 * an unknown kind in. If a detector kind is ever renamed, every stored rule naming
 * the old one compiles perfectly and then matches nothing, with no flag anywhere.
 * Catching it here makes that rename fail visibly instead of quietly restoring the
 * noise somebody had suppressed months earlier.
 */
const KNOWN_KINDS = new Set<string>(ALERT_KINDS);

/** A stored rule that cannot match anything, and why. */
export interface UnusableRule {
  id: number;
  /** Plain enough to act on: shown on the page and written to the log. */
  reason: string;
}

interface CompiledRule {
  id: number;
  kind: string | null;
  source: Prefix | null;
  target: Prefix | null;
  port: number | null;
  /** Epoch ms, so the comparison is a number rather than a Date allocation per finding. */
  expiresAt: number | null;
}

/**
 * A compiled, ready-to-evaluate set of rules.
 *
 * Built once when rules are loaded and then consulted for every finding, because
 * `AlertSink.record` is on the hot path — one packet burst can produce thousands
 * of findings, and re-parsing a CIDR for each is not acceptable.
 */
export class SuppressionSet {
  private readonly compiled: CompiledRule[] = [];
  /**
   * Rules dropped because they cannot match anything, with the reason. Reported,
   * never silent — a rule that quietly does nothing is the worst state here.
   */
  readonly unusable: UnusableRule[] = [];

  constructor(rules: readonly SuppressionCriteria[]) {
    for (const rule of rules) {
      if (!rule.enabled) continue;

      // Checked before the ranges, because a kind nobody raises makes the rest of
      // the rule irrelevant, and the reason should name the real problem.
      if (rule.kind !== null && !KNOWN_KINDS.has(rule.kind)) {
        this.unusable.push({ id: rule.id, reason: `no detector raises the kind "${rule.kind}"` });
        continue;
      }

      const source = rule.sourceCidr === null ? null : parsePrefix(rule.sourceCidr);
      const target = rule.targetCidr === null ? null : parsePrefix(rule.targetCidr);

      // A rule whose range will not parse is discarded rather than compiled with
      // a null, which is what "matches anything" is spelled as two lines below.
      // The failure direction matters: dropping the rule lets findings through,
      // and an alert that should have been suppressed is a nuisance, whereas a
      // suppression nobody intended is a blind spot.
      if (rule.sourceCidr !== null && !source) {
        this.unusable.push({
          id: rule.id,
          reason: `source "${rule.sourceCidr}" is not an address or CIDR range`,
        });
        continue;
      }
      if (rule.targetCidr !== null && !target) {
        this.unusable.push({
          id: rule.id,
          reason: `target "${rule.targetCidr}" is not an address or CIDR range`,
        });
        continue;
      }

      this.compiled.push({
        id: rule.id,
        kind: rule.kind,
        source,
        target,
        port: rule.port,
        expiresAt: rule.expiresAt === null ? null : rule.expiresAt.getTime(),
      });
    }
  }

  get size(): number {
    return this.compiled.length;
  }

  /**
   * The id of the first rule that suppresses `event`, or null to let it through.
   *
   * `now` is wall-clock time, deliberately not the finding's own timestamp. Flow
   * exporters batch and delay, so a finding can describe traffic from a minute
   * ago; "this rule expires at 17:00" is a statement about real time, and an
   * expiry evaluated against a delayed capture timestamp would go on suppressing
   * after it lapsed.
   *
   * First match wins, and the match is attributed to that one rule. Two
   * overlapping rules covering the same finding count it once, against the lower
   * id — so the counters add up to findings suppressed, not to rules that would
   * have suppressed something.
   */
  match(event: SuppressibleEvent, now = Date.now()): number | null {
    for (const rule of this.compiled) {
      if (rule.expiresAt !== null && rule.expiresAt <= now) continue;
      if (rule.kind !== null && rule.kind !== event.kind) continue;

      // A rule naming an address range does not match a finding with no address
      // to compare: `prefixContains` is false for null, so a sourceless finding
      // (an ARP MAC-sprawl report, say) survives a rule about 10.0.0.0/8 rather
      // than being swept up by it.
      if (rule.source !== null && !prefixContains(rule.source, event.sourceIp)) continue;
      if (rule.target !== null && !prefixContains(rule.target, event.targetIp)) continue;

      if (rule.port !== null && rule.port !== (event.port ?? null)) continue;

      return rule.id;
    }

    return null;
  }
}

/** The set in force before any load, and the one a failed load leaves untouched. */
export const NO_SUPPRESSIONS = new SuppressionSet([]);

/**
 * Any criterion at all. A rule with none matches every finding on the network.
 *
 * Lives here, not in validation.ts, because the check cannot run on a create
 * payload alone either: `suppression.service.ts`'s `updateSuppression` has to
 * run it against a patch merged onto the row it just locked, inside the same
 * transaction — a merge validation.ts has no business doing. Both the create
 * schema's `.refine` and the service import this one definition.
 */
export function hasSuppressionCriterion(values: {
  kind?: string | null;
  sourceCidr?: string | null;
  targetCidr?: string | null;
  port?: number | null;
}): boolean {
  return (
    (values.kind ?? null) !== null ||
    (values.sourceCidr ?? null) !== null ||
    (values.targetCidr ?? null) !== null ||
    (values.port ?? null) !== null
  );
}

export const NO_CRITERIA =
  'A suppression rule needs at least one of kind, source, target or port. ' +
  'A rule with none would drop every finding on the network.';
