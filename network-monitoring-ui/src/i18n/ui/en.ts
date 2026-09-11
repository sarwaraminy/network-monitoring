/**
 * The interface's own strings, in English.
 *
 * The source of truth for the keys, exactly as the finding catalogue is for its
 * own: the union is derived from this object, so a key renamed here is a compile
 * error at every call site, and a key added here is reported by the coverage test
 * as untranslated rather than breaking the build.
 *
 * Ordered by where the reader meets it — the shell first, then the pages, then
 * the words shared between them. Grouping by feature rather than alphabetically
 * is deliberate: the question asked of this file is almost always "what else does
 * this screen say", never "what does this key say".
 *
 * The conventions are the finding catalogue's, and for the same reasons:
 * identifiers interpolate as strings, counts as numbers and drive `plural`,
 * optional clauses use `select` on an explicit boolean. See
 * api/src/i18n/catalog/findings.en.ts.
 */
export const UI_EN = {
  // --- Navigation ---

  'nav.main': 'Main',
  'nav.panel_title': 'Navigation',
  'nav.search_placeholder': 'Search navigation…',
  'nav.clear_search': 'Clear search',
  'nav.expand_panel': 'Expand Navigation',
  'nav.collapse_panel': 'Collapse Navigation',

  'nav.group.overview': 'Overview',
  'nav.group.security': 'Security',
  'nav.group.capture': 'Capture',
  'nav.group.administration': 'Administration',

  'nav.dashboard': 'Dashboard',
  'nav.alerts': 'Security Alerts',
  'nav.suppressions': 'Suppressions',
  'nav.threat_intel': 'Threat Intel',
  'nav.capture_interface': 'Capture by Interface',
  'nav.capture_ip': 'Capture by IP',
  'nav.delivery': 'Delivery',
  'nav.audit': 'Audit Trail',
  'nav.adhoc': 'Ad Hoc Query',

  // --- The account menu ---

  'account.signed_in': 'Signed in',
  'account.add_user': 'Add user',
  'account.sign_out': 'Sign out',
  'account.theme': 'Theme',
  'account.theme.light': 'Light',
  'account.theme.dark': 'Dark',
  'account.theme.auto': 'Auto',
  'account.language': 'Language',

  // --- Alerts ---

  'alerts.title': 'Security alerts',
  'alerts.subtitle': 'Every finding the detectors raised, newest first',
  'alerts.search_placeholder': 'Search findings',
  'alerts.column.severity': 'Severity',
  'alerts.column.sensor': 'Sensor',
  'alerts.column.detector': 'Detector',
  'alerts.column.finding': 'Finding',
  'alerts.column.source': 'Source',
  'alerts.column.target': 'Target',
  'alerts.column.last_seen': 'Last seen',
  'alerts.column.status': 'Status',
  'alerts.acknowledge': 'Acknowledge',
  'alerts.reopen': 'Reopen',
  'alerts.open': 'Open',
  'alerts.acknowledged': 'Acknowledged',
  'alerts.acknowledged_by': 'Acknowledged by {who}',
  'alerts.suppress': 'Suppress findings like this — opens a rule filled in from this row',
  'alerts.delete': 'Delete — the finding and its evidence go with it',
  'alerts.unacknowledged_count': '{count, plural, one {# unacknowledged} other {# unacknowledged}}',
  'alerts.what_this_means': 'What this means',
  'alerts.evidence': 'Evidence',
  'alerts.no_evidence': 'No supporting detail was recorded for this finding.',
  'alerts.first_seen': 'First seen',
  'alerts.occurrences': 'Occurrences',
  'alerts.protocol': 'Protocol',
  'alerts.source_mac': 'Source MAC',
  'alerts.target_mac': 'Target MAC',
  'alerts.unknown_actor': 'unknown',

  // --- Sign in ---

  'app.name': 'Network Monitoring Tool',
  'login.subtitle': 'Sign in to capture and analyse traffic',
  'login.email': 'Email address',
  'login.password': 'Password',
  'login.sign_in': 'Sign in',
  'login.signing_in': 'Signing in…',
  'login.no_accounts': 'No accounts exist yet.',
  'login.create_first_admin': 'Create the first administrator',
  'login.no_account': 'Don’t have an account?',
  'login.register_here': 'Register here',

  // --- Sign up ---

  'signup.title': 'Create an account',
  'signup.subtitle': 'Register a user for the Network Monitoring Tool',
  'signup.bootstrap_subtitle': 'This installation has no accounts yet, so this one becomes an administrator',
  'signup.restricted': 'Account creation is restricted',
  'signup.restricted_subtitle': 'Only an administrator can add accounts to this installation',
  'signup.ask_admin':
    'Ask an administrator to create your account. If you are setting this server up yourself, run',
  'signup.back_to_sign_in': 'Back to sign in',
  'signup.confirm_password': 'Confirm password',
  'signup.first_name': 'First name',
  'signup.last_name': 'Last name',
  'signup.role': 'Role',
  'signup.role_helper': 'You are an administrator, so this choice is honoured',
  'signup.submit': 'Sign up',
  'signup.creating': 'Creating account…',
  'signup.create_administrator': 'Create administrator',
  'signup.back_to_app': 'Back to the app',
  'signup.have_account': 'Already have an account? Sign in',

  'role.user': 'User',
  'role.administrator': 'Administrator',

  // --- Dashboard ---

  'dashboard.title': 'Dashboard',
  'dashboard.subtitle': 'What the detectors have found, and which hosts keep appearing',
  'dashboard.sensor': 'Sensor',
  'dashboard.period': 'Period',
  'dashboard.open_findings': 'Open findings',
  'dashboard.critical_high': 'Critical and high',
  'dashboard.needs_attention': 'Needs attention first',
  'dashboard.capture': 'Capture',
  'dashboard.known_devices': 'Known devices',
  'dashboard.macs_seen': 'MAC addresses seen',
  'dashboard.over_time': 'Findings over time',
  'dashboard.by_detector': 'Findings by detector',
  'dashboard.which_firing': 'Which checks are firing',
  'dashboard.top_sources': 'Most implicated sources',
  'dashboard.top_sources_subtitle': 'Addresses appearing in the most findings',
  'dashboard.severity_breakdown': 'Severity breakdown',
  'dashboard.all_time': 'All findings, all time',
  'dashboard.findings': 'Findings',
  'dashboard.no_findings': 'No findings yet.',
  'dashboard.no_source_findings': 'No findings with a source address yet.',

  // --- Audit trail ---

  'audit.title': 'Audit Trail',
  'audit.subtitle': 'Who deleted, changed or redirected something — append-only, and never pruned',
  'audit.when': 'When',
  'audit.who': 'Who',
  'audit.what': 'What',
  'audit.which': 'Which',
  'audit.action': 'Action',
  'audit.detail': 'Detail',

  // --- Suppression rules ---

  'suppressions.title': 'Suppression rules',
  'suppressions.subtitle':
    'Findings you have declared expected. A matching finding is dropped before it is stored — not ' +
    'hidden behind a filter',
  'suppressions.rules': 'Rules',
  'suppressions.rules_subtitle':
    'Read top to bottom: the first rule that matches a finding is the one that drops it',
  'suppressions.findings_hidden': 'Findings hidden',
  'suppressions.never_matched': 'Never matched',
  'suppressions.expired': 'Expired',
  'suppressions.covers': 'Covers',
  'suppressions.why': 'Why it is expected',
  'suppressions.state': 'State',
  'suppressions.hidden': 'Hidden',
  'suppressions.expires': 'Expires',
  'suppressions.no_expiry': 'This rule stays in force until somebody removes it.',
  'suppressions.edit': 'Edit this rule',
  'suppressions.delete': 'Delete — the record of what it hid goes too',
  'suppressions.none': 'No suppression rules. Every finding the detectors raise is being stored.',
  'suppressions.kind': 'Finding kind',
  'suppressions.kind_only_warning':
    'This rule has no address and no port, so it discards every {kind} finding from anywhere on ' +
    'the network — the detector stops reporting until the rule is removed. Add a source, a ' +
    'target or a port to narrow it, or check it against recent alerts first.',
  'suppressions.kind_helper': 'Any kind, unless you pick one',
  'suppressions.source': 'Source address or range',
  'suppressions.source_helper': 'Where the traffic came from',
  'suppressions.target': 'Target address or range',
  'suppressions.target_helper': 'Where it was going',
  'suppressions.port': 'Destination port',
  'suppressions.port_helper': 'Only matches findings about a single port — never a port scan',
  'suppressions.expires_helper': 'Empty means it never expires',
  'suppressions.reason': 'Why is this expected?',
  'suppressions.reason_helper': 'Whoever reads this list in six months will only have this line to go on',
  'suppressions.in_force': 'In force',

  // --- Threat intelligence ---

  'intel.title': 'Threat intelligence',
  'intel.subtitle':
    'Addresses and domains matched against indicator feeds — the one detector here that is not a ' +
    'threshold',
  'intel.indicators_loaded': 'Indicators loaded',
  'intel.feeds': 'Feeds',
  'intel.feeds_subtitle': 'Where each source came from on the last load',
  'intel.no_feeds': 'No feeds configured.',
  'intel.last_loaded': 'Last loaded',
  'intel.refused': 'Refused on load',
  'intel.what_loaded': 'What is loaded',
  'intel.by_type': 'By indicator type',
  'intel.ipv4': 'IPv4 addresses',
  'intel.ipv4_cidr': 'IPv4 ranges (CIDR)',
  'intel.ipv6': 'IPv6 addresses',
  'intel.domains': 'Domains',
  'intel.feed': 'Feed',
  'intel.source': 'Source',
  'intel.indicators': 'Indicators',
  'intel.skipped': 'Skipped',
  'intel.skipped_explain':
    'Lines that were not usable indicators: comments, blanks, and anything malformed or ' + 'non-routable.',

  // --- Delivery ---

  'delivery.title': 'Alert delivery',
  'delivery.subtitle': 'Where findings go, and whether they are getting there',
  'delivery.for_people': 'For people',
  'delivery.for_people_subtitle': 'Gated, throttled and batched, so the channel does not get muted',
  'delivery.min_severity': 'Minimum severity',
  'delivery.digest_window': 'Digest window',
  'delivery.throttle': 'Per-finding throttle',
  'delivery.hourly_ceiling': 'Hourly ceiling',
  'delivery.for_siem': 'For a SIEM',
  'delivery.for_siem_subtitle': 'Every finding, ungated',
  'delivery.protocol': 'Protocol',
  'delivery.format': 'Format',
  'delivery.framing': 'Framing',
  'delivery.evidence': 'Evidence',
  'delivery.right_now': 'Right now',
  'delivery.right_now_subtitle': 'What the queue and the limits are doing',
  'delivery.queued': 'Queued for the next digest',
  'delivery.sent_last_hour': 'Sent in the last hour',
  'delivery.throttled': 'Findings currently throttled',

  // --- Query console ---

  'adhoc.subtitle':
    'Read-only SQL against this system’s database. Every query is recorded in the audit trail.',
  'adhoc.sql': 'SQL',

  // --- Capture ---
  //
  // The packet table's headers name protocol fields — EtherType, LLC DSAP — which
  // stay as they are for the reason every other protocol identifier does: they are
  // what a specification and a packet analyser print.

  'capture.interface.title': 'Capture from a local interface',
  'capture.interface.subtitle': 'Live packets from one adapter, decoded frame by frame',
  'capture.ip.title': 'Capture filtered by IP address',
  'capture.ip.subtitle': 'The same capture, narrowed to traffic involving one host',
  'capture.packets': 'Packets',
  'capture.packets_subtitle': 'Newest first, decoded from the wire',
  'capture.network_interface': 'Network interface',
  'capture.filter_ip': 'Filter by IP address',
  'capture.snapshot_length': 'Snapshot length',
  'capture.timeout': 'Timeout (ms)',

  'packets.source_ip': 'Source IP',
  'packets.source_mac': 'Source MAC',
  'packets.destination_ip': 'Destination IP',
  'packets.destination_mac': 'Destination MAC',
  'packets.ethertype': 'EtherType',
  'packets.llc_dsap': 'LLC DSAP',
  'packets.llc_ssap': 'LLC SSAP',
  'packets.llc_control': 'LLC Control',
  'packets.frame': 'Frame',
  'packets.pad': 'Pad',

  // --- Severity and detector names ---
  //
  // The `kind` and `severity` values themselves stay English wherever they are
  // stored, exported or matched on — they are identifiers that happen to be
  // readable, and a SIEM rule keys on them. These are the labels, which are the
  // half a person reads.

  'dashboard.load_failed': 'Could not load the dashboard',
  'dashboard.total_all_time': '{count, number} total, all time',
  'dashboard.capture_running': 'Running',
  'dashboard.capture_idle': 'Idle',
  'dashboard.pcap_unavailable': 'pcap library unavailable',
  'dashboard.no_capture': 'No capture started',
  'dashboard.per_hour': 'By severity, per hour',
  'dashboard.per_day': 'By severity, per day',
  'dashboard.per_week': 'By severity, per week',
  'dashboard.per_month': 'By severity, per month',
  'dashboard.hours_count': '{count, plural, one {# hour} other {# hours}}',
  'dashboard.days_count': '{count, plural, one {# day} other {# days}}',
  'dashboard.weeks_count': '{count, plural, one {# week} other {# weeks}}',
  'dashboard.months_count': '{count, plural, one {# month} other {# months}}',
  'dashboard.occurrences': '{count, plural, one {# occurrence} other {# occurrences}}',
  'common.never': 'never',
  'suppressions.preview_none': 'Nothing among the last {examined, number} alerts matches this rule.',
  'suppressions.preview_matched':
    'Would have hidden {matched, number} of the last {examined, number} alerts — {occurrences, number} observations in total.',
  'suppressions.preview_window': 'Examined {from} to {to}',

  'capture.resume': 'Resume',
  // The service resumed this one itself, so there is nobody to name. The
  // operator who started the original capture stays on the notice about it.
  'capture.interrupted_note_auto':
    'Capture on {interface} stopped unexpectedly. The service had resumed it automatically at ' +
    '{at}, and it is not running now.',
  'capture.interrupted_note_anon':
    'Capture on {interface} stopped unexpectedly. It was started at {at} and is not running now.',
  'capture.interrupted_note':
    'Capture on {interface} stopped unexpectedly. It was started by {by} at {at} and is not ' +
    'running now.',
  'capture.unavailable_note':
    'Live capture is unavailable on the server: the packet capture library could not be loaded. ' +
    'Install Npcap (Windows) or libpcap (Linux/macOS) and restart the API. Everything else on this ' +
    'page still works.',
  'capture.dropped': '{count, number} older packets dropped from the buffer',
  'packets.non_ip_hidden': '{count, number} non-IP hidden',
  'capture.loading_interfaces': 'Loading interfaces…',
  'capture.no_interfaces': 'No interfaces reported by the server',
  'capture.hide_settings': 'Hide capture settings',
  'capture.show_settings': 'Show capture settings',
  'capture.link_type': 'Link: {type}',
  'intel.reloading': 'Reloading…',
  'intel.reload_feeds': 'Reload feeds',
  'intel.origin.network': 'Live',
  'intel.origin.network_hint': 'Downloaded on the last refresh — this feed is current.',
  'intel.origin.cache': 'Cached',
  'intel.origin.cache_hint':
    'The download failed and the last saved copy was used instead. Detection still works, but these ' +
    'indicators are as old as the last successful fetch.',
  'intel.origin.file': 'Local file',
  'intel.origin.file_hint': 'Read from disk. Freshness is whatever your own process makes it.',
  'intel.origin.failed': 'Failed',
  'intel.origin.failed_hint':
    'Nothing could be loaded from this source. Its indicators are not being matched at all.',
  'intel.subdomain_note':
    'A domain indicator also covers its subdomains. Private and reserved addresses are refused on ' +
    'load, whatever a feed says — one wrongly listed would alert on every host at once.',
  'intel.enable_hint': 'To enable it, add to',
  'intel.off_note':
    'Nothing is being matched against known-malicious addresses or domains. It is off by default ' +
    'because which intelligence to trust is your decision, and a security tool should not start ' +
    'making outbound requests to a list nobody chose.',
  'intel.local_file_note':
    'A local file path works too, and is the right choice where this host has no outbound internet.',

  // --- Suppression rules, delivery status and feed health ---

  'suppressions.state.active': 'Active',
  'suppressions.state.active_hint': 'Findings matching this rule are being dropped before they are stored.',
  'suppressions.state.disabled': 'Off',
  'suppressions.state.disabled_hint': 'Switched off. Findings that match are stored and delivered as normal.',
  'suppressions.state.expired': 'Expired',
  'suppressions.state.expired_hint':
    'The expiry has passed, so this rule no longer suppresses anything. Extend it or delete it.',
  'suppressions.state.invalid': 'Invalid',
  'suppressions.state.invalid_hint':
    'The server could not parse this rule’s address range, so it matches nothing at all. Edit the ' +
    'range — findings you believe are suppressed are not.',
  'suppressions.enabled_toast': 'Rule #{id} is on. Matching findings are being dropped.',
  'suppressions.disabled_toast': 'Rule #{id} is off. Matching findings will be stored again.',
  'suppressions.update_failed': 'Could not update the rule',
  'suppressions.deleted_toast': 'Rule deleted.',
  'suppressions.delete_failed': 'Could not delete the rule',
  'suppressions.confirm_delete':
    'Delete rule #{id}? Its record of {count, number} hidden findings goes with it. Switching it off keeps ' +
    'both.',
  'suppressions.read_failed': 'Could not read the suppression rules',
  'suppressions.invalid_warning':
    '{count, plural, one {# rule} other {# rules}} cannot match anything, so findings you believe ' +
    'are suppressed are not being suppressed:',
  'suppressions.created_toast': 'Rule #{id} created and in force.',
  'suppressions.updated_toast': 'Rule #{id} updated.',
  'suppressions.added_by': ' · added by ',
  'suppressions.edit_rule': 'Edit rule {id}',
  'suppressions.switch_off_hint': 'Switch off — matching findings return',
  'suppressions.switch_on_hint': 'Switch on',
  'suppressions.toggle_rule': '{enabled, select, true {Disable} other {Enable}} rule {id}',
  'suppressions.delete_rule': 'Delete rule {id}',
  'suppressions.in_force_count': '{count} in force',
  'suppressions.search': 'Search rules',
  'suppressions.check_failed': 'Could not check the rule',
  'suppressions.save_failed': 'Could not save the rule',
  'suppressions.edit_title': 'Edit rule #{id}',
  'suppressions.new_title': 'New suppression rule',
  'suppressions.dialog_note':
    'A finding is suppressed when it matches every field you fill in. Leave a field empty to mean ' +
    '"any". Suppressed findings are dropped, so nothing downstream — the alert list, the webhook, ' +
    'the SIEM feed — will ever see them.',
  'suppressions.cidr_placeholder': '10.20.30.40 or 10.20.30.0/24',
  'suppressions.checking': 'Checking…',
  'suppressions.check_against': 'Check against recent alerts',
  'suppressions.unknown_source': 'unknown',
  'suppressions.saving': 'Saving…',
  'suppressions.save_changes': 'Save changes',
  'suppressions.create_rule': 'Create rule',

  'delivery.gate.throttle_note': 'The same finding will not notify again inside this window.',
  'delivery.gate.ceiling_note': 'A hard limit on messages per hour, whatever detection does.',
  'delivery.test_partial': 'Delivered to {delivered}. Failed: {failures}',
  'delivery.test_ok': 'Delivered to {delivered} channel(s). Check that each one arrived.',
  'delivery.test_failed': 'Test send failed',
  'delivery.sending': 'Sending…',
  'delivery.send_test': 'Send test',
  'delivery.status_failed': 'Could not read delivery status',
  'delivery.nothing_configured': 'Nothing is configured, so findings are recorded and nobody is told.',
  'delivery.nothing_configured_admin':
    ' Set a collector host, a webhook URL, or an SMTP host with recipients under the settings gear ' +
    '— no file to edit and no restart.',
  'delivery.nothing_configured_user':
    ' An administrator can configure a webhook, email or a syslog collector.',
  'delivery.switched_off': 'Channels are configured but delivery is switched off, so no alert will be sent.',
  'delivery.switched_off_admin': ' Turn on "Deliver alerts" under the settings gear.',
  'delivery.test_still_works':
    ' A test send still works — it deliberately bypasses this, since the question it answers is ' +
    'whether delivery reaches you at all.',
  'delivery.syslog_unaffected': ' Syslog is unaffected: it is independent of this switch.',
  'delivery.channel.webhook': 'Webhook',
  'delivery.channel.webhook_hint': 'Slack, Teams, Discord or plain JSON',
  'delivery.channel.webhook_format': '{format} format',
  'delivery.channel.email': 'Email',
  'delivery.channel.email_hint': 'SMTP host, sender and at least one recipient',
  'delivery.channel.recipients': '{count, plural, one {# recipient} other {# recipients}}',
  'delivery.channel.syslog': 'Syslog',
  'delivery.channel.syslog_hint': 'Set SYSLOG_HOST to switch it on',
  'delivery.four_limits':
    'Four limits apply before anything is sent. Each one is also a reason an alert you expected did ' +
    'not arrive, which is why they are here rather than buried in a config file.',
  'delivery.siem_note':
    'None of the limits on the left apply here. A SIEM correlates and deduplicates itself, and it ' +
    'does so assuming it holds the complete event stream — a digest makes every rule that counts ' +
    'events over a window silently under-report, and turns suppressed events into what look like ' +
    'quiet periods.',
  'delivery.included': 'included',
  'delivery.omitted': 'omitted',
  'delivery.configured': 'Configured',
  'delivery.off': 'Off',
  'delivery.saved': 'Saved. The change is already in force — no restart needed.',
  'delivery.save_failed': 'Could not save the settings',
  'delivery.tls_587':
    'Port 587 with implicit TLS on will hang until the socket times out: 587 expects STARTTLS. Use ' +
    'port 465, or turn implicit TLS off.',
  'delivery.tls_465':
    'Port 465 expects implicit TLS from the first byte. Turn implicit TLS on, or use port 587.',
  'delivery.all_pinned_note':
    'Every changed field is now set in the environment and cannot be saved. Discard to clear these ' +
    'edits.',
  'delivery.unsaved': '{count} unsaved',
  'delivery.saving': 'Saving…',
  'delivery.save_changes': 'Save changes',
  'delivery.pinned_note':
    '{count, plural, one {# setting is} other {# settings are}} set in the environment and cannot ' +
    'be changed here. Remove the variable from api/.env (or your Compose file) to manage it from ' +
    'this page.',
  'delivery.secret_stored_unused': 'stored, and not used by the current method',
  'delivery.secret_configured': 'configured — type to replace',
  'delivery.secret_unset': 'not configured',
  'delivery.secret_unused_note':
    'The current authentication method does not use this. It is still stored — clear it unless you ' +
    'plan to switch back.',
  'delivery.set_not_set': 'Not set',
  'delivery.pinned_by': 'Set by {name}. Remove it from api/.env to edit this here.',
  'delivery.the_environment': 'the environment',
  'delivery.environment': 'environment',

  'intel.health_failing': '{count} failing',
  'intel.health_stale': '{count} on a cached copy',
  'intel.health_ok': 'all loaded',
  'intel.reloaded_toast': 'Reloaded {count, number} indicators from {feeds} feed(s).',
  'intel.reload_failed': 'Reload failed',
  'intel.status_failed': 'Could not read threat-intelligence status',
  'intel.no_feeds_body':
    'Threat intelligence is enabled but no feeds are configured, so nothing is being matched. Set',
  'intel.no_feeds_tail': 'to one or more name=location pairs.',
  'intel.failed_feeds':
    '{count, plural, one {# feed} other {# feeds}} could not be loaded at all: {names}. Those ' +
    'indicators are not being matched.',
  'intel.stale_feeds':
    '{count, plural, one {# feed} other {# feeds}} fell back to a cached copy: {names}. Detection ' +
    'still works, but these indicators are only as fresh as the last successful download.',
  'intel.search': 'Search feeds',

  // --- Audit trail, alerts and console: the last prose ---

  'audit.empty_failed': 'The trail could not be read, so this is not a statement that nothing happened.',
  'audit.empty_none':
    'Nothing has been deleted, changed or redirected yet. Entries appear here as soon as ' + 'something is.',
  'audit.empty_for_action': 'No entries for this action.',
  'audit.admin_only':
    'The audit trail is visible to administrators. It records who deleted, changed or redirected ' +
    'things, and it names accounts.',
  'audit.filter_by_action': 'Filter by action',
  'audit.load_failed': 'Could not load the audit trail',
  'audit.actions_failed': 'Could not load the list of actions — filtering by action is unavailable',
  'audit.loading_more': 'Loading…',
  'audit.load_older': 'Load older entries',

  'alerts.load_failed': 'Could not load alerts',
  'alerts.summary_failed': 'Could not load the alert summary',
  'alerts.update_failed': 'Could not update the alert',
  'alerts.delete_failed': 'Could not delete the alert',
  'alerts.delete_finding': 'Delete finding {id}',
  'alerts.suppress_finding': 'Suppress findings like finding {id}',
  // A suppression is applied when a finding is WRITTEN, so it changes what
  // arrives from now on and nothing already stored. Saying "this list will get
  // shorter" promised a table that cannot change, over a table that visibly did
  // not.
  'alerts.suppressed_toast':
    'Rule {id} is in force for findings from now on. Nothing already in this list changes — ' +
    'suppression drops a finding as it is recorded, so what is stored stays. The Suppressions ' +
    'page counts what it starts catching.',
  'alerts.this_sensor': ' (this one)',
  'alerts.empty_body':
    'No findings match these filters. An empty list during a capture means the detectors saw ' +
    'nothing suspicious — which is the expected result on a healthy network.',
  'alerts.yes': 'yes',
  'alerts.no': 'no',
  'alerts.evidence_more': '{shown}, and {count} more',

  'adhoc.admin_only': 'The query console is available to administrators only.',
  'adhoc.availability_failed':
    'The server could not be asked whether the query console is available. {detail}',
  'adhoc.hide_query': 'Hide the query',
  'adhoc.show_query': 'Show the query',
  'adhoc.running': 'Running',
  'adhoc.run': 'Run',
  'adhoc.shortcut_note':
    'Ctrl/Cmd + Enter also runs. Writes and the columns holding secrets are refused by the ' +
    'database, not by this page.',
  'adhoc.rows_affected': '{command} — {count, plural, one {# row} other {# rows}} affected in {ms} ms',
  'adhoc.rows_in': '{count, plural, one {# row} other {# rows}} in {ms} ms',

  'packets.search': 'Search packets',
  'packets.frame_data': 'Frame data ({bytes} bytes)',
  'packets.no_frame_data': 'No frame data captured',
  'packets.padding': 'Ethernet padding ({bytes} bytes)',
  'packets.no_padding': 'No padding on this frame',
  'packets.waiting': 'Waiting for packets…',
  'packets.none_yet': 'No packets captured yet. Choose an interface and start a capture.',
  'capture.start_failed': 'Could not start the capture',
  'capture.stop_failed': 'Could not stop the capture',
  'capture.clear_failed': 'Could not clear the captured packets',
  'capture.interfaces_failed': 'Could not load network interfaces',
  'capture.packets_failed': 'Could not fetch captured packets',
  'capture.filter_chip': 'Filter: {filter}',
  'capture.findings_chip': '{count, plural, one {# finding} other {# findings}} — view alerts',

  'ipinfo.postal_code': 'Postal code',
  'ipinfo.timezone': 'Timezone',
  'ipinfo.isp': 'ISP',
  'ipinfo.organization': 'Organization',
  'ipinfo.lookup_of_failed': 'Could not look up {ipAddress}',
  'login.failed': 'Login failed',
  'signup.create_failed': 'Could not create the account',
  'signup.min_length': 'At least {count} characters',
  'signup.mismatch': 'Passwords do not match',
  'signup.on_the_server': 'on the server.',
  'common.account': 'Account',
  'common.nothing_to_show': 'Nothing to show.',
  'common.something_wrong': 'Something went wrong',

  // --- Administration menu (the dialog's own list) ---

  'admin.group.database': 'Database',
  'admin.group.notifications': 'Notifications',
  'admin.group.accounts': 'Accounts',
  'admin.tool.console': 'Query console',
  'admin.tool.console_desc': 'Whether the ad hoc SQL console can start, and why not.',
  'admin.tool.console_settings': 'Query console settings',
  'admin.tool.console_settings_desc': 'Switch it on or off, and set its limits, without a restart.',
  'admin.tool.delivery': 'Delivery settings',
  'admin.tool.delivery_desc': 'Where findings go, and how often. In force on save.',
  'admin.group.sensors': 'Sensors',
  'admin.tool.decommission': 'Decommission a sensor',
  'admin.tool.decommission_desc': 'Drop everything a retired sensor recorded. Irreversible, and audited.',
  'admin.tool.users': 'Users and roles',
  'admin.tool.users_desc': 'Who is an administrator. Recorded in the audit trail.',

  // --- Evidence field names ---
  //
  // Keyed by the evidence property the detectors emit. `humanizeKey` used to turn
  // `feedNote` into "Feed note" mechanically, which is correct English and was
  // never translatable — so the one part of an alert that says what was actually
  // observed stayed in English in every language.

  'evidence.feed': 'Feed',
  'evidence.feedNote': 'Feed note',
  'evidence.exporter': 'Exporter',
  'evidence.direction': 'Direction',
  'evidence.indicator': 'Indicator',
  'evidence.indicatorType': 'Indicator type',
  'evidence.matchedAddress': 'Matched address',
  'evidence.observedVia': 'Observed via',
  'evidence.flowBytes': 'Flow bytes',
  'evidence.flowPackets': 'Flow packets',
  'evidence.destinationPort': 'Destination port',
  'evidence.port': 'Port',
  'evidence.count': 'Count',
  'evidence.seconds': 'Seconds',
  'evidence.scanner': 'Scanner',
  'evidence.service': 'Service',
  'evidence.hasService': 'Has service',
  'evidence.sampleHosts': 'Sample hosts',
  'evidence.distinctPortsProbed': 'Distinct ports probed',
  'evidence.distinctHostsProbed': 'Distinct hosts probed',
  'evidence.distinctTargets': 'Distinct targets',
  'evidence.attemptsInWindow': 'Attempts in window',
  'evidence.username': 'Username',
  'evidence.passwordLength': 'Password length',
  'evidence.passwordRecorded': 'Password recorded',
  'evidence.previousMac': 'Previous MAC',
  'evidence.knownDevicesBefore': 'Known devices before',
  'evidence.vendor': 'Vendor',

  // --- Periods, and the rest of the chrome ---

  'period.1h': 'Last hour',
  'period.12m': 'Last 12 months',
  'period.24h': 'Last 24 hours',
  'period.7d': 'Last 7 days',
  'period.30d': 'Last 30 days',
  'period.90d': 'Last 90 days',
  'period.5y': 'Last 5 years',
  'period.all': 'All time',
  'ipinfo.looking_up': 'Running reverse DNS, WHOIS and geolocation lookups…',
  'ipinfo.lookup_failed': 'Lookup failed: {reason}',
  'ipinfo.no_geo': 'No geolocation data',
  'suppressions.any_finding': 'Any finding',
  'suppressions.rule_from': 'from {cidr}',
  'suppressions.rule_to': 'to {cidr}',
  'suppressions.rule_port': 'on port {port}',
  'intel.matched_on_all': 'matched on every packet and flow',
  'intel.is_off': 'threat intelligence is off',
  'intel.refreshes_every': 'refreshes every {hours}h',

  // --- Shared controls and chrome ---

  'common.refresh': 'Refresh',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.discard': 'Discard',
  'delivery.settings_title': 'Settings',
  'delivery.read_failed': 'Could not read the delivery settings',
  'delivery.moved_note':
    'Delivery settings moved to Administration settings — the gear in the header — so there is one place to change them rather than two. This page keeps what nothing else has: whether delivery is working, and the test send.',
  'login.admin_required': 'Capturing traffic requires an administrator session',
  'packets.captured': 'Captured packets',
  'packets.shown': '{count, number} shown',
  'common.clear': 'Clear',
  'grid.page_range': '{start, number}–{end, number} of {total, number}',
  'grid.page_range_filtered': '{range}, filtered from {unfiltered, number}',
  'common.rows_per_page': 'Rows per page',
  'common.all_sensors': 'All sensors',
  'common.all_detectors': 'All detectors',
  'common.all_actions': 'All actions',
  'common.any_kind': 'Any kind',
  'common.open_only': 'Open only',
  'common.no_error_message': 'No error message was provided.',
  'common.try_again': 'Try again',
  'common.reload_app': 'Reload the app',
  'common.render_failed': 'Something broke while rendering this page',
  'capture.start': 'Start capture',
  'capture.stop': 'Stop',
  'capture.capturing': 'Capturing',
  'capture.idle': 'Idle',
  'ipinfo.title': 'IP information',
  'ipinfo.country': 'Country',
  'ipinfo.region': 'Region',
  'ipinfo.city': 'City',
  'ipinfo.coordinates': 'Coordinates',
  'alerts.nothing_to_report': 'Nothing to report',
  'chart.no_findings_period': 'No findings in this period.',
  'chart.detail_from_here': 'Detail kept from here',
  'suppressions.new_rule': 'New rule',
  'adhoc.no_rows': 'The query ran and returned no rows.',
  'intel.off': 'Threat intelligence is off',
  'intel.licence_note': "Check each feed's licence before relying on it commercially.",

  // --- Alert delivery ---

  'delivery.section.0': 'Gates',
  'delivery.section.0_subtitle': 'Applied to the channels a person reads, never to the SIEM feed',
  'delivery.field.enabled': 'Deliver alerts',
  'delivery.field.enabled_help': 'Off means findings are recorded and nobody is told. Syslog is unaffected.',
  'delivery.field.minSeverity': 'Minimum severity',
  'delivery.field.digestSeconds': 'Digest window (s)',
  'delivery.field.digestSeconds_help':
    'Findings are batched for this long, so one burst is one message. Zero means no batching.',
  'delivery.field.throttleSeconds': 'Per-finding throttle (s)',
  'delivery.field.throttleSeconds_help': 'The same finding will not notify again inside this window.',
  'delivery.field.maxPerHour': 'Max messages per hour',
  'delivery.field.maxPerHour_help': 'A hard ceiling, whatever detection does.',
  'delivery.field.includeEvidence': 'Include evidence',
  'delivery.field.includeEvidence_help':
    'Evidence never contains passwords or payloads, but it does contain internal addresses and ' +
    'usernames — which a third-party chat service would then hold.',
  'delivery.field.dashboardUrl': 'Dashboard link',
  'delivery.field.dashboardUrl_help': 'Linked from every message, e.g. https://nmt.example.com/alerts',
  'delivery.section.1': 'Webhook',
  'delivery.section.1_subtitle': 'Slack, Teams, Discord, or anything accepting JSON',
  'delivery.field.webhookUrl': 'Webhook URL',
  'delivery.field.webhookUrl_help':
    'For Teams, create a Workflows webhook — its URL is on logic.azure.com. Treated as a ' +
    'credential and never shown back.',
  'delivery.field.webhookFormat': 'Payload format',
  'delivery.field.webhookFormat_help':
    '`auto` reads the host and picks the right shape, including the retired Office 365 connector ' +
    'for a webhook.office.com URL.',
  'delivery.section.2': 'Email',
  'delivery.section.2_subtitle':
    'An internal relay needs no credentials and is the right answer for an on-prem sensor',
  'delivery.field.emailHost': 'SMTP host',
  'delivery.field.emailPort': 'Port',
  'delivery.field.emailSecure': 'Implicit TLS',
  'delivery.field.emailSecure_help':
    'True only for port 465. On 587 leave this off — STARTTLS is negotiated instead, and setting ' +
    'it here hangs until the socket times out.',
  'delivery.field.emailFrom': 'From address',
  'delivery.field.emailTo': 'Recipients',
  'delivery.field.emailTo_help': 'One per line, or comma-separated.',
  'delivery.field.emailAuthMethod': 'Authentication',
  'delivery.field.emailAuthMethod_help':
    'OAuth2 is XOAUTH2 with a refresh token, for a Microsoft 365 or Google tenant that permits ' +
    'nothing else.',
  'delivery.field.emailUser': 'Username',
  'delivery.field.emailUser_help':
    'Leave empty for a relay that needs no authentication. Under OAuth2 this is the mailbox being ' +
    'sent from, and is required.',
  'delivery.field.emailPassword': 'Password',
  'delivery.field.emailPassword_help':
    'Microsoft 365 and Google disable basic SMTP AUTH by default, so a correct password can still ' +
    'be rejected.',
  'delivery.field.emailOauthTokenUrl': 'Token endpoint',
  'delivery.field.emailOauthTokenUrl_help':
    'Microsoft: https://login.microsoftonline.com/[tenant]/oauth2/v2.0/token — Google: ' +
    'https://oauth2.googleapis.com/token',
  'delivery.field.emailOauthClientId': 'Client ID',
  'delivery.field.emailOauthClientSecret': 'Client secret',
  'delivery.field.emailOauthRefreshToken': 'Refresh token',
  'delivery.field.emailOauthRefreshToken_help':
    'Obtained once, by consenting to the app registration. Nodemailer exchanges it for an access ' +
    'token and renews that on its own.',
  'delivery.field.emailOauthScope': 'Scope',
  'delivery.field.emailOauthScope_help':
    'Optional. Google ignores it; some Microsoft tenants need ' +
    'https://outlook.office.com/SMTP.Send offline_access.',
  'delivery.section.3': 'Syslog / SIEM',
  'delivery.section.3_subtitle':
    'Ungated on purpose: a SIEM correlates for itself and needs the complete stream',
  'delivery.field.syslogHost': 'Collector host',
  'delivery.field.syslogPort': 'Port',
  'delivery.field.syslogProtocol': 'Protocol',
  'delivery.field.syslogFormat': 'Format',
  'delivery.field.syslogRfc': 'RFC',
  'delivery.field.syslogRfc_help': '3164 has no year and no timezone in its timestamp; prefer 5424.',
  'delivery.field.syslogFacility': 'Facility',
  'delivery.field.syslogFacility_help': '16–23 are the local-use facilities; 16 is local0.',
  'delivery.field.syslogAppName': 'App name',
  'delivery.field.syslogIncludeEvidence': 'Include evidence',
  'delivery.field.syslogIncludeEvidence_help':
    'On by default here, unlike the chat channels: the disclosure argument does not apply to a ' +
    'collector inside your own network.',

  // --- Accounts and roles ---

  'users.loading': 'Asking the server…',
  'users.load_failed': 'Could not read the accounts',
  'users.change_failed': 'Could not change the role',
  'users.role_changed': '{account} is now {role}.',
  'users.that_account': 'That account',
  'users.blocked_self': 'You cannot change your own role. Ask another administrator.',
  'users.blocked_last_admin': 'The only administrator. Promote another account before changing this one.',
  'users.single_admin':
    'One administrator. Promoting a second is what makes this account recoverable — with only one, ' +
    'a forgotten password means editing the database by hand.',
  'users.col_account': 'Account',
  'users.col_name': 'Name',
  'users.col_role': 'Role',
  'users.you': 'you',
  'users.account_n': 'account {id}',
  'users.role_for': 'Role for {account}',
  'users.audit_note':
    'Every change is recorded in the audit trail, with who made it and which way the role moved.',

  // --- Decommissioning a sensor ---

  'sensors.loading': 'Asking the server…',
  'sensors.load_failed': 'Could not read the sensors',
  'sensors.retire_failed': 'Could not decommission the sensor',
  'sensors.none':
    'No other sensor has written anything to this database. This installation is not listed, ' +
    'because it is still writing — decommissioning it would empty tables that immediately refill.',
  'sensors.col_sensor': 'Sensor',
  'sensors.col_findings': 'Findings',
  'sensors.col_devices': 'Devices',
  'sensors.col_history': 'Aggregated days',
  'sensors.col_last_seen': 'Last seen',
  'sensors.last_seen_never': 'never',
  'sensors.active': 'still writing',
  'sensors.active_hint':
    'Something is still writing under this name. Decommissioning it would empty tables that ' +
    'refill, and emptying its device list would report every machine on its segment as new. ' +
    'Stop that sensor, or wait until it has gone quiet.',
  'sensors.retire': 'Decommission',
  'sensors.retire_sensor': 'Decommission sensor {sensor}',
  'sensors.confirm_retire': 'Yes, delete it all',
  'sensors.confirm_body':
    'This permanently deletes {alerts, plural, one {# finding} other {# findings}}, ' +
    '{devices, plural, one {# device} other {# devices}} and ' +
    '{buckets, plural, one {# aggregated day} other {# aggregated days}} recorded under {sensor}, ' +
    'along with its capture session. There is nothing to undo it: the audit entry is what will be ' +
    'left.',
  'sensors.retired_toast':
    '{sensor} is decommissioned: {alerts, plural, one {# finding} other {# findings}}, ' +
    '{devices, plural, one {# device} other {# devices}} and ' +
    '{buckets, plural, one {# aggregated day} other {# aggregated days}} removed.',
  'sensors.audit_note':
    'Recorded in the audit trail with who did it and how much was removed. That entry is the only ' +
    'record that the sensor existed once this is done, and the trail cannot be pruned.',

  // --- Query console: diagnosis ---

  'console.loading': 'Asking the server…',
  'console.status_failed': 'Could not read the console status',
  'console.running': 'The console is running',
  'console.running_note':
    'Queries are executed as a Postgres role whose grants decide what is possible — not as this ' +
    "application's own database user.",
  'console.mode_write': 'Read and write',
  'console.mode_read': 'Read only',
  'console.write_warning':
    'Write mode is on, so the console authenticates as the read-write role and can UPDATE, INSERT ' +
    'and DELETE the operational tables. It still cannot touch the audit trail, the secret columns, ' +
    'accounts or delivery settings.',
  'console.password_logged': 'The console password may be in the Postgres log',
  'console.password_logged_note':
    'The database owner is not a superuser, so statement logging could not be suppressed while the ' +
    'password was set. Under {ddl} or {all} it will have been written in cleartext. Treat the ' +
    'console password as a value the database server may have recorded — wherever it was set from, ' +
    'since it reaches the role the same way either way.',
  'console.unavailable': 'The console is not available',
  'console.env_lines': 'In the API environment:',
  'console.db_said': 'What the database said',
  'console.recheck_failed': 'The re-check could not be run',
  'console.checking': 'Checking…',
  'console.check_again': 'Check again',
  'console.recheck_note':
    'Re-runs the startup check against the current environment. It cannot switch the console on.',
  'console.remedy.disabled.title': 'The console has not been switched on',
  'console.remedy.disabled.note':
    'Switch it on in Query console settings, the next row in this menu, and set a console password ' +
    'there. No restart needed. This is the default state, not a fault.',
  'console.remedy.no_password.title': 'Switched on, but there is no password to install',
  'console.remedy.no_password.note':
    'The console was asked for, but the role it authenticates as has no credential and the server ' +
    'will not invent one. Set one in Query console settings, the next row in this menu.',
  'console.remedy.sandbox_failed.title': 'The database would not confirm the console is sandboxed',
  'console.remedy.sandbox_failed.note':
    'The console is configured, and the server refused to start it because it could not prove the ' +
    'role is neither a superuser nor able to write. Check that the migrations have run, and that ' +
    'nobody has recreated the role by hand. Fix it and check again — no restart needed.',

  // --- Query console: settings ---

  'console_settings.saved': 'Saved. The change is already in force — no restart needed.',
  'console_settings.save_failed': 'Could not save the settings',
  'console_settings.read_failed': 'Could not read the settings',
  'console_settings.all_pinned': 'Every changed field is now set in the environment.',
  'console_settings.no_password': 'No console password is set',
  'console_settings.no_password_pinned_before':
    'The console cannot start until one is set, and it is pinned to',
  'console_settings.no_password_pinned_after':
    'in the API environment — which is currently empty. Set a value there and restart the API, or ' +
    'remove the line to set one here instead.',
  'console_settings.no_password_here':
    'The console cannot start until one is set, whatever the switches here say — it is the ' +
    'credential installed on its Postgres role. Set one in Console role password below.',
  'console_settings.pinned_note':
    'Set by {variable} in the environment. Remove that line and restart the API to manage it here.',
  'console_settings.password_set': 'Set — leave blank to keep it',
  'console_settings.password_unset': 'Not set',
  'console_settings.clear_password': 'Clear password',
  'console_settings.will_clear':
    'Will be cleared on save. The console stops as soon as it is — it cannot authenticate without a ' +
    'password.',
  'console_settings.saving': 'Saving…',
  'console_settings.save': 'Save changes',
  'console_settings.unsaved': '{count} unsaved',
  'console_settings.field.enabled': 'Query console',
  'console_settings.field.enabled_help':
    'Runs the console. It still needs a console password — set one below — and still refuses to ' +
    'start unless the database confirms its role is sandboxed.',
  'console_settings.field.writeEnabled': 'Allow writes',
  'console_settings.field.writeEnabled_help':
    'Authenticates as a different Postgres role — one V12 grants UPDATE, INSERT and DELETE on the ' +
    'operational tables. Not an application check: turning this off connects as a role that cannot ' +
    'write at all.',
  'console_settings.field.timeoutMs': 'Statement timeout (ms)',
  'console_settings.field.maxRows': 'Row cap',
  'console_settings.field.maxQueryLength': 'Maximum query length',
  'console_settings.field.audit': 'Audit',
  'console_settings.field.audit_help':
    'What reaches the audit trail. Forced to "all" while writes are allowed — a console that can ' +
    'DELETE and a trail that records none of it is the one combination this must not offer.',
  'console_settings.field.dbPassword': 'Console role password',
  'console_settings.field.dbPassword_help':
    'Installed on the console’s Postgres role when it starts. Never shown back — the server reports ' +
    'only whether one is set. Saving a change reconnects the console, because the credential is ' +
    'installed at startup and would otherwise not take effect until the next restart.',

  'severity.critical': 'Critical',
  'severity.high': 'High',
  'severity.medium': 'Medium',
  'severity.low': 'Low',
  'severity.info': 'Info',

  'kind.arp_spoofing': 'ARP spoofing',
  'kind.port_scan': 'Port scan',
  'kind.host_sweep': 'Host sweep',
  'kind.syn_flood': 'SYN flood',
  'kind.plaintext_credentials': 'Cleartext credentials',
  'kind.dns_tunneling': 'DNS tunnelling',
  'kind.new_device': 'New device',
  'kind.threat_intel': 'Threat intelligence',

  'kind.arp_spoofing.description':
    'A host claiming an IP address that belongs to another device — the basis of most LAN ' +
    'man-in-the-middle attacks.',
  'kind.port_scan.description':
    'One source probing many ports on a single host, mapping which services it exposes.',
  'kind.host_sweep.description':
    'One source probing the same port across many hosts, hunting for a service to exploit.',
  'kind.syn_flood.description':
    'An implausible rate of connection attempts, indicating denial of service or an aggressive ' + 'scanner.',
  'kind.plaintext_credentials.description':
    'Credentials or session cookies crossing the network without encryption.',
  'kind.dns_tunneling.description':
    'DNS queries shaped like encoded data rather than name lookups, suggesting exfiltration or C2.',
  'kind.new_device.description': 'A MAC address not seen on this network before.',
  'kind.threat_intel.description':
    'An address or domain matching a known-malicious indicator feed — the one detector here that ' +
    'is not a threshold.',

  'alerts.tile.all': 'All alerts',

  // --- Shell and dialogs ---

  'nav.open': 'Open navigation',
  'guide.title': 'User guide',
  'guide.aria': 'User guide (opens in a new tab)',
  'admin.settings': 'Administration settings',

  'ipinfo.domain_name': 'Domain name',
  'ipinfo.geolocation': 'Geolocation',
  'ipinfo.whois': 'WHOIS',
  'ipinfo.no_ptr': 'No PTR record',
  'ipinfo.no_whois': 'No WHOIS response',

  'suppressions.hidden_caption': 'dropped before storage, all time',
  'suppressions.never_caption': 'in force but has hidden nothing',
  'suppressions.expired_caption': 'no longer suppressing',
  'suppressions.reason_placeholder': 'Authorised Nessus scanner, ticket OPS-1421',

  'delivery.form_subtitle': 'Changed here, in force immediately — no file to edit and no restart',
  'delivery.form_loading': 'Loading the current configuration',

  'adhoc.result': 'Result',
  'adhoc.truncated': 'Truncated — there are more rows',

  // `'<'` is ICU's escape: an unescaped `<` starts a rich-text tag and the
  // whole pattern fails to parse.
  'capture.bpf_helper': "Applied as the BPF filter host '<'ip>",
  'capture.snaplen_helper': 'Bytes per frame',
  'capture.timeout_helper': 'pcap read timeout',

  'intel.refused_caption': 'private ranges and malformed entries',

  // --- Shared across pages ---
} as const;

export type UiMessageKey = keyof typeof UI_EN;
