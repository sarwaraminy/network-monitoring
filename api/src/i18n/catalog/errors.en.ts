/**
 * Every error the API reports to a person, in English.
 *
 * These are translated **in the browser, from a code**, rather than on the server
 * from the caller's `lang_code`. Three reasons, and the first is the one that
 * settles it:
 *
 * - **The same endpoints are read by scripts and by CI.** A 409 whose body changes
 *   language depending on who asked is one no script can branch on.
 * - **A localised error is one nobody can search for.** An operator pasting an
 *   error into an issue, or grepping the server log for it, needs a string that is
 *   the same everywhere.
 * - It keeps `Accept-Language` out of the API contract entirely.
 *
 * So the response carries both: `message` is always the English rendering — which
 * is what every existing client already reads, and what stays in the log — and
 * `code` plus `params` are what the interface translates. A client that knows
 * nothing about codes is unaffected.
 *
 * The same conventions apply as to the finding catalogue: identifiers interpolate
 * as strings, counts as numbers, optional clauses use `select` on an explicit
 * boolean. See findings.en.ts.
 */

export const ERRORS_EN = {
  // --- Validation ---
  //
  // `error.validation` is the one that carries English through untranslated, on
  // purpose. Its `detail` is the joined output of the zod schemas, whose messages
  // are written at each schema and are themselves English prose; translating them
  // would mean a catalogue entry per field per rule, which buys far less than the
  // rest of this file and would go stale silently. The sentence around the detail
  // is translated, so the reader at least knows what kind of failure it was.
  'error.validation': 'The request is not valid: {detail}',
  'error.invalid_id': 'id must be a positive integer',
  'error.invalid_account_id': 'That is not an account id.',
  'error.invalid_mac': 'mac must be a MAC address',
  'error.invalid_ip': 'Not a valid IP address: {value}',
  'error.ip_required': 'ipAddress is required',
  'error.interface_required': 'interfaceName is required',
  'error.since_unparseable': 'Could not parse "since": use an ISO date or a window like 24h',
  'error.body_not_json': 'Request body is not valid JSON',
  'error.no_route': 'No route for {method} {path}',

  // --- Not found ---

  'error.alert_not_found': 'No alert with id {id}',
  'error.log_not_found': 'No log with id {id}',
  'error.suppression_not_found': 'No suppression rule with id {id}',
  'error.account_not_found': 'No such account.',
  'error.device_not_found': 'No known device {mac}',
  'error.device_not_on_sensor': 'No known device {mac} on sensor {sensor}. It is known to: {sensors}.',
  'error.interface_not_found': 'No such interface found: {name}',

  // --- Conflicts ---

  'error.device_ambiguous':
    '{mac} is known to more than one sensor ({sensors}). Add ?sensor= to say which one should ' +
    'forget it.',
  'error.last_administrator': 'This is the only administrator left; promote another account first.',
  'error.email_in_use': 'Email is already in use.',
  'error.cannot_demote_self':
    'You cannot remove your own administrator role. Ask another administrator to do it.',
  // The variable names are the useful half of this 409, so they are the parameter
  // rather than being summarised away.
  'error.adhoc_pinned':
    'Set in the environment and cannot be changed here: {variables}. Remove the variable and ' +
    'restart the API to manage it from this page.',
  'error.delivery_pinned':
    'Set in the environment and not editable here: {variables}. Remove the variable from ' +
    'api/.env (or your Compose file) to manage it from this page.',
  'error.no_suppression_criterion':
    'A suppression rule needs at least one of kind, source, target or port. A rule with none ' +
    'would drop every finding on the network.',

  // --- Authentication and authorisation ---

  'error.invalid_credentials': 'Invalid email or password',
  'error.token_invalid': 'Invalid or expired token.',
  'error.account_gone': 'Account no longer exists.',
  'error.signup_admin_only': 'Only an administrator can create accounts.',
  'error.signup_token_required':
    'Account creation requires an administrator token. Use `npm run user -- create` on the ' +
    'server, or sign in as an administrator.',

  // --- Capture ---

  'error.capture_unavailable': '{detail}',
  'error.capture_failed': '{context}: {detail}',

  // --- Last resort ---

  // Raised in the browser, not by the server: axios could not reach the API at
  // all, so there is no response to take a code from. It lives here because it is
  // read in exactly the same place as the server's own errors.
  'error.network_unreachable': 'Cannot reach the API server. Is it running?',
  'error.internal': 'Internal server error',
  'error.unexpected': 'Unexpected error',
} as const;

export type ErrorMessageKey = keyof typeof ERRORS_EN;

/** A locale other than English. Partial for the reason findings.ts gives. */
export type PartialErrorCatalog = Readonly<Partial<Record<ErrorMessageKey, string>>>;
