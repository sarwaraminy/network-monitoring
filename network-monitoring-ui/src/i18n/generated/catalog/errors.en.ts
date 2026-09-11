// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
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
  'error.suppression_not_found': 'No suppression rule with id {id}',
  'error.account_not_found': 'No such account.',
  'error.device_not_found': 'No known device {mac}',
  'error.sensor_not_found':
    'Nothing is recorded under sensor {sensor}: no findings, no devices and no aggregated ' +
    'history. There is nothing to decommission.',
  'error.device_not_on_sensor': 'No known device {mac} on sensor {sensor}. It is known to: {sensors}.',
  'error.interface_not_found': 'No such interface found: {name}',

  // --- Conflicts ---

  'error.device_ambiguous':
    '{mac} is known to more than one sensor ({sensors}). Add ?sensor= to say which one should ' +
    'forget it.',
  'error.last_administrator': 'This is the only administrator left; promote another account first.',
  // Refused rather than performed, and the message says why: the rows come back.
  // See `decommissionSensor`.
  // Another installation that is evidently still writing. `lastSeen` is an ISO
  // instant rather than a phrase: the reader's locale formats it, and a server
  // that guessed at "3 minutes ago" would be guessing in the wrong timezone.
  'error.sensor_still_active':
    '{sensor} was last heard from at {lastSeen}, so something is still writing under that name. ' +
    'Decommissioning it would empty tables that refill, and emptying its device list would ' +
    'report every machine on its segment as new. Stop that sensor first, or wait until it has ' +
    'gone quiet.',
  'error.sensor_decommission_busy':
    'The retention sweep is running and holds the lock this needs, so {sensor} was left alone. ' +
    'Nothing has changed; try again in a few minutes.',
  'error.sensor_is_self':
    '{sensor} is this installation, which is still writing findings and devices, so ' +
    'decommissioning it would empty tables that immediately refill — and emptying the ' +
    'device list re-reports every machine on the network as new. Decommission a sensor that ' +
    'has been retired, or clear the findings instead.',
  'error.capture_already_starting':
    'A capture is already starting on this interface. Wait for it to settle, then check the capture status.',
  'error.email_in_use': 'Email is already in use.',
  'error.cannot_demote_self':
    'You cannot remove your own administrator role. Ask another administrator to do it.',
  // The variable names are the useful half of this 409, so they are the parameter
  // rather than being summarised away.
  'error.flow_pinned':
    'Set in the environment and cannot be changed here: {variables}. Remove the variable and ' +
    'restart the API to manage it from this page.',
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

  'error.invalid_credentials': 'Invalid email or password.',
  'error.missing_authorization': 'Missing Authorization header.',
  'error.not_authenticated': 'Not authenticated.',
  'error.insufficient_permissions': 'Insufficient permissions.',
  'error.too_many_logins': 'Too many failed attempts. Wait a minute and try again.',
  'error.too_many_capture': 'Too many capture control requests. Slow down.',
  'error.too_many_lookups': 'Too many lookup requests. Slow down.',
  'error.too_many_requests': 'Too many requests. Slow down.',
  'error.adhoc_disabled': 'The query console is not enabled on this server.',
  'error.adhoc_sql_type': 'Send the query as a `sql` string.',
  'error.adhoc_sql_empty': 'Enter a query to run.',
  'error.adhoc_sql_too_long': 'Queries are limited to {max} characters.',
  'error.adhoc_one_statement': 'Run one statement at a time — the query contains more than one.',
  'error.adhoc_timeout': 'The query ran longer than {ms} ms and was stopped. Narrow it, or add a LIMIT.',
  'error.adhoc_busy':
    'The query console is busy — it runs a small number of queries at a time. Try again in a moment.',
  'error.adhoc_denied_write':
    '{detail} — the query console writes only the operational tables, and cannot touch the audit ' +
    'trail, the accounts or the columns holding secrets.',
  'error.adhoc_denied_read':
    '{detail} — the query console is read-only and cannot read columns holding secrets.',
  'error.adhoc_passthrough': '{detail}',
  'error.adhoc_failed': 'The query could not be run.',
  'error.permission_denied': 'Permission denied.',
  'error.capture_enumerate': 'Could not enumerate network interfaces: {detail}',
  'error.capture_open': 'Could not open {name}: {detail}',
  'error.capture_filter': 'Could not apply the capture filter: {detail}',
  'error.intel_reload_running':
    'A reload is already in progress; the indicators below are from the previous load.',
  'error.intel_reload_kept':
    'Reload did not produce a usable set. The previously loaded indicators are still in use.',
  'error.guide_sign_in': 'Sign in to read the user guide.',
  'error.token_invalid': 'Invalid or expired token.',
  'error.account_gone': 'Account no longer exists.',
  'error.signup_admin_only': 'Only an administrator can create accounts.',
  'error.signup_token_required':
    'Account creation requires an administrator token. Use `npm run user -- create` on the ' +
    'server, or sign in as an administrator.',

  // --- Capture ---

  /*
   * Two keys rather than one, and each with words of its own.
   *
   * This was `'error.capture_unavailable': '{detail}'`, where `{detail}` was
   * `PcapUnavailableError.message` — a sentence this repository writes in
   * English, carrying the install instruction. So the response had a code, the
   * renderer rendered it, and the result was byte-identical English in all three
   * languages: exactly the defect `toHttpError` describes removing one line up,
   * and the more visible half of it, because the install instruction is the part
   * a reader who does not have English most needs.
   *
   * Split on platform because the platform branch is prose we choose. `{detail}`
   * is now only the loader's own words — a `dlopen` failure — which is not ours
   * to translate and is kept verbatim for whoever has to search for it.
   */
  'error.capture_install_npcap':
    'Could not load the packet capture library. Install Npcap from ' +
    'https://npcap.com/#download. ({detail})',
  'error.capture_install_libpcap':
    'Could not load the packet capture library. Install libpcap (for example ' +
    '`sudo apt install libpcap0.8`). ({detail})',

  // --- Delivery ---

  /*
   * Was `res.status(400).json({ message: … })` in `notify.routes.ts` — the one
   * 4xx body in the API written without a code, so `describeError` fell through
   * to `data.message` and printed English into an otherwise translated page.
   */
  'error.no_delivery_channel':
    'No delivery channel is configured. Set a webhook URL, a syslog host, or an SMTP host ' +
    'with recipients — on this page, or in api/.env.',
  /*
   * The more specific answer when it applies, kept rather than collapsed into the
   * one above: with nothing else configured and a half-filled OAuth2 mailbox, "no
   * channel is configured" is true and useless. `emailBlockedReason` still holds
   * the same sentence in English for the status DTO, which is read on the
   * delivery page and is a separate conversion.
   */
  'error.email_oauth_incomplete':
    'Email is set to OAuth2 but {settings} {count, plural, one {is} other {are}} not set, so ' +
    'the mailbox cannot authenticate. Fill those in on this page, or set the authentication ' +
    'method back to password.',

  // --- Last resort ---

  // Raised in the browser, not by the server: axios could not reach the API at
  // all, so there is no response to take a code from. It lives here because it is
  // read in exactly the same place as the server's own errors.
  'error.network_unreachable': 'Cannot reach the API server. Is it running?',
  'error.internal': 'Internal server error',
} as const;

export type ErrorMessageKey = keyof typeof ERRORS_EN;

/** A locale other than English. Partial for the reason findings.ts gives. */
export type PartialErrorCatalog = Readonly<Partial<Record<ErrorMessageKey, string>>>;
