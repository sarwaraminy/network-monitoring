// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
/**
 * Every sentence a detector can produce, in English.
 *
 * This file is the source of truth for the *keys*: the union is derived from it,
 * so a key deleted or renamed here is a compile error wherever a detector still
 * emits it, and a key added here is reported by the catalogue coverage test as
 * untranslated rather than breaking the build. See findings.ts for why the other
 * locales are `Partial`.
 *
 * Conventions, because getting these wrong is invisible until somebody reads the
 * interface in Dari:
 *
 * - **Identifiers interpolate as strings**, never as `{n, number}`. See the note
 *   on `MessagePrimitive` in ../message.ts: a port formatted as a number becomes
 *   ۴۴۵ under `fa-AF` and stops matching what the firewall shows.
 * - **Counts use `plural`.** English and German agree on two categories and Dari
 *   does not, which is the whole reason this is ICU MessageFormat rather than a
 *   lookup table.
 * - **Optional clauses use `{flag, select, true{...} other{...}}`** on an explicit
 *   boolean param rather than testing the value for emptiness, which ICU cannot
 *   do. The detector decides what is absent; the catalogue only decides how to
 *   say so.
 * - **Service names stay English** — "SMB file sharing", "Remote Desktop". They
 *   name a protocol, and an operator correlating with a firewall rule or a
 *   `nmap` report needs the string those print. Same rule as `kind` values; see
 *   the roadmap's "What deliberately stays in English".
 */

export const FINDINGS_EN = {
  // --- ARP spoofing ---

  'arp_spoofing.configured.title': 'ARP spoofing: {ip} claimed by {mac}',
  'arp_spoofing.configured.description':
    '{mac} sent an ARP {operation} claiming {ip}, but that address is configured to ' +
    '{configuredMac}. A host on the network is impersonating {ip}, which lets it intercept ' +
    'traffic intended for that address.',

  'arp_spoofing.conflict.title': 'ARP spoofing: {ip} moved from {previousMac} to {mac}',
  'arp_spoofing.conflict.description':
    '{ip} was consistently answered by {previousMac} ({observations, plural, one {# observation} ' +
    'other {# observations}}) and is now claimed by {mac}. ' +
    '{flipping, select, ' +
    'true {The two addresses are alternating, which is the signature of an active ARP poisoning ' +
    "attack: the attacker repeatedly overwrites the victim's ARP cache to keep traffic flowing " +
    'through itself.} ' +
    'other {This can be a replaced device or a DHCP change, but it is also how a man-in-the-middle ' +
    'inserts itself. Confirm the new address belongs to expected hardware.}}',

  'arp_spoofing.sprawl.title':
    '{mac} is claiming {count, plural, one {# different IP address} other {# different IP addresses}}',
  'arp_spoofing.sprawl.description':
    '{mac} has sent ARP messages claiming {count, plural, one {# distinct address} ' +
    'other {# distinct addresses}}. A normal host answers for its own address only. Answering for ' +
    'many is how an attacker poisons the ARP caches of an entire subnet at once.',

  // --- Port scan ---
  //
  // One pair per pipeline, and the two titles are deliberately identical rather
  // than shared under one key. Every `message_key` names exactly one title and one
  // description, with no fallback rule in the renderer for the case where a
  // variant has only a description — and the descriptions genuinely differ: the
  // packet pipeline sees connection attempts, the flow pipeline sees attempts the
  // exporter recorded as unanswered, and names the exporter because a flow finding
  // is second-hand evidence. The titles are free to follow them apart later.

  'port_scan.packet.title':
    'Port scan: {source} probed {count, plural, one {# port} other {# ports}} on {target}',
  'port_scan.packet.description':
    '{source} attempted connections to {count, plural, one {# different port} ' +
    'other {# different ports}} on {target} within {seconds, plural, one {# second} ' +
    'other {# seconds}}. Legitimate clients connect to one or two known ports; sweeping a range is ' +
    'how an attacker maps which services a host exposes, and it usually precedes an exploitation ' +
    'attempt.',
  'port_scan.flow.title':
    'Port scan: {source} probed {count, plural, one {# port} other {# ports}} on {target}',
  'port_scan.flow.description':
    '{source} opened unanswered connections to {count, plural, one {# different port} ' +
    'other {# different ports}} on {target} within {seconds, plural, one {# second} ' +
    'other {# seconds}}, as reported by the flow exporter at {exporter}. None of those connections ' +
    'were acknowledged, so nothing was listening or a firewall dropped them — the signature of ' +
    'mapping which services a host exposes, which usually precedes an exploitation attempt.',

  // --- Host sweep ---

  'host_sweep.packet.title':
    'Host sweep: {source} probed port {port} on {count, plural, one {# host} other {# hosts}}',
  'host_sweep.packet.description':
    '{source} attempted connections to port {port} on {count, plural, one {# different host} ' +
    'other {# different hosts}} within {seconds, plural, one {# second} other {# seconds}}. ' +
    'Sweeping one service across a subnet is how an attacker or worm finds every machine running ' +
    'it. Port {port}{hasService, select, true { ({service})} other {}} is a common target for ' +
    'lateral movement.',
  'host_sweep.flow.title':
    'Host sweep: {source} probed port {port} on {count, plural, one {# host} other {# hosts}}',
  'host_sweep.flow.description':
    '{source} opened unanswered connections to port {port}{hasService, select, true { ({service})} ' +
    'other {}} on {count, plural, one {# different host} other {# different hosts}} within ' +
    '{seconds, plural, one {# second} other {# seconds}}. Sweeping one service across a subnet is ' +
    'how an attacker or a worm finds every machine running it, and is a strong indicator of lateral ' +
    'movement rather than ordinary client traffic.',

  // --- Connection flood ---

  'syn_flood.packet.title':
    'SYN flood: {count, plural, one {# connection attempt} other {# connection attempts}} from ' +
    '{source} in {seconds}s',
  'syn_flood.packet.description':
    '{source} made {count, plural, one {# TCP connection attempt} other {# TCP connection attempts}} ' +
    'in {seconds, plural, one {# second} other {# seconds}} without completing handshakes. At this ' +
    'rate the traffic is either a denial-of-service attempt, which exhausts the target’s ' +
    'connection table, or an aggressive automated scanner.',

  'syn_flood.flow.title':
    'Connection flood: {count, plural, one {# unanswered attempt} other {# unanswered attempts}} ' +
    'from {source} in {seconds}s',
  'syn_flood.flow.description':
    '{source} opened {count, plural, one {# TCP connection} other {# TCP connections}} in ' +
    '{seconds, plural, one {# second} other {# seconds}} that were never acknowledged. At this rate ' +
    'the traffic is either a denial-of-service attempt, which exhausts the target’s connection ' +
    'table, or an aggressive automated scanner.',

  // --- DNS tunnelling ---
  //
  // The reasons are separate entries interpolated as a list: the detector requires
  // two of them before it reports at all, and which two it found is the substance
  // of the finding. `Intl.ListFormat` joins them, so the separator is the locale's
  // rather than a hardcoded comma.

  'dns_tunneling.detected.title':
    'Possible DNS tunnelling to {domain} from {hasSource, select, true {{source}} ' + 'other {unknown host}}',
  'dns_tunneling.detected.description':
    'DNS queries to {domain} do not look like ordinary name lookups: {reasons}. This pattern is ' +
    'characteristic of data being smuggled out through DNS, or of malware using DNS for ' +
    'command-and-control, because DNS is usually allowed out even when other traffic is blocked. ' +
    'Confirm whether this domain is expected — some security and CDN products legitimately use ' +
    'encoded subdomains.',
  'dns_tunneling.reason.length':
    'the full name is {length, plural, one {# character} other {# characters}} long',
  // `entropy` carries a skeleton so the decimal separator follows the locale — it
  // is a measurement in prose, not an identifier, so 3,42 is right in German.
  'dns_tunneling.reason.encoded':
    'a {length}-character label looks encoded rather than named ' +
    '(entropy {entropy, number, ::.00} bits/char, {digitPercent}% digits, {vowelPercent}% vowels)',
  'dns_tunneling.reason.subdomains':
    '{count, plural, one {# distinct subdomain} other {# distinct subdomains}} of {domain} ' +
    '{count, plural, one {was} other {were}} queried',

  // --- New device ---

  'new_device.discovered.title': 'New device on the network: {mac}{hasIp, select, true { ({ip})} other {}}',
  'new_device.discovered.description':
    '{mac} has not been seen on this network before{hasIp, select, true {, and is currently using ' +
    '{ip}} other {}}. An unrecognised device may be a visitor, a newly provisioned machine, or an ' +
    'unauthorised connection. The vendor prefix is {vendorPrefix}, which can help identify the ' +
    'hardware.',

  // --- Cleartext credentials ---

  'plaintext_credentials.http_basic.title': 'Cleartext HTTP credentials for "{username}" to {target}',
  'plaintext_credentials.http_basic.description':
    'An HTTP Basic "Authorization" header was captured in the clear on port {port}. The username is ' +
    '"{username}" and the password was recovered from the same header (it is deliberately not ' +
    'recorded here). Anyone positioned on this network path — including the operator of any ' +
    'intermediate switch, router or Wi-Fi access point — can read this password directly. Move the ' +
    'service to HTTPS and rotate the credential.',

  'plaintext_credentials.http_form.title': 'Password submitted over unencrypted HTTP to {target}',
  'plaintext_credentials.http_form.description':
    'A form field named "{fieldName}" was sent over plain HTTP on port {port}. The value is readable ' +
    'by anyone on the network path and is not recorded here. Any login form must be served and ' +
    'submitted over HTTPS.',

  'plaintext_credentials.http_cookie.title': 'Session cookie sent over unencrypted HTTP to {target}',
  'plaintext_credentials.http_cookie.description':
    'A cookie that looks like a session identifier was sent over plain HTTP. Capturing it allows an ' +
    'attacker to hijack the session without ever knowing the password. The cookie value is not ' +
    'recorded here. Serve the site over HTTPS and set the Secure and HttpOnly flags.',

  'plaintext_credentials.ftp.title':
    '{hasUsername, select, true {Cleartext FTP login for "{username}" to {target}} ' +
    'other {Cleartext FTP password sent to {target}}}',
  'plaintext_credentials.ftp.description':
    'FTP transmits its credentials as plain text by design. {hasPassword, select, ' +
    'true {A PASS command was captured; the value is not recorded here. } other {}}Replace this ' +
    'service with SFTP or FTPS, and treat the credential as compromised.',

  'plaintext_credentials.telnet.title': 'Unencrypted Telnet session to {target}',
  'plaintext_credentials.telnet.description':
    'Telnet sends everything — credentials, commands and output — as plain text. Any device on the ' +
    'path can read and modify the session. Replace it with SSH; there is no configuration that makes ' +
    'Telnet safe.',

  // `protocol` is POP3 or IMAP, and stays English for the same reason the service
  // names do.
  'plaintext_credentials.mailbox.title':
    '{hasUsername, select, true {Cleartext {protocol} login for "{username}" to {target}} ' +
    'other {Cleartext {protocol} password sent to {target}}}',
  'plaintext_credentials.mailbox.description':
    'A {protocol} login was sent without encryption on port {port}. Mail passwords are high value ' +
    'because mailbox access enables password resets on other services. The password is not recorded ' +
    'here. Use {protocol} over TLS (port {securePort}) instead.',

  'plaintext_credentials.smtp.title':
    '{hasUsername, select, true {Cleartext SMTP login for "{username}" to {target}} ' +
    'other {Cleartext SMTP authentication to {target}}}',
  'plaintext_credentials.smtp.description':
    'SMTP authentication was sent without STARTTLS, so the credential crossed the network in a ' +
    'trivially decodable form (base64 is encoding, not encryption). A stolen SMTP credential is ' +
    'typically used to send phishing mail from your domain. The password is not recorded here.',

  // --- Threat intelligence ---
  //
  // `attribution` and `via` are interpolated as nested references rather than as
  // pre-joined strings, because both are prose: "NetFlow v9 from 10.0.0.1" has a
  // preposition in it, and a German or Dari sentence does not put it where an
  // English one does.

  'threat_intel.attribution': '{hasNote, select, true {{source}: {note}} other {{source}}}',
  'threat_intel.via.packet_capture': 'packet capture',
  'threat_intel.via.dns_query': 'DNS query',
  'threat_intel.via.flow_export': '{version} from {exporter}',

  'threat_intel.domain.title': 'Known-malicious domain queried: {observed}',
  'threat_intel.domain.description':
    '{hasLocalIp, select, true {{localIp}} other {A host on the network}} looked up {observed}, ' +
    'which matches the indicator {indicator} from {attribution}. A lookup is usually the first thing ' +
    'an implant does, and it happens even when the connection that follows is blocked — so this is ' +
    'often the only trace left. Treat the querying host as suspect until you can account for what ' +
    'asked.',

  'threat_intel.outbound.title': 'Outbound connection to known-malicious address {observed}',
  'threat_intel.outbound.description':
    '{hasLocalIp, select, true {{localIp}} other {A host on the network}} connected out to ' +
    '{observed}, which matches {indicator} from {attribution}, seen via {via}. Something inside the ' +
    'network chose to contact this address, which points at a compromised host or software nobody ' +
    'sanctioned. This is materially more serious than being scanned from a listed address, and worth ' +
    'investigating now.',

  'threat_intel.inbound.title': 'Inbound traffic from known-malicious address {observed}',
  'threat_intel.inbound.description':
    '{observed} contacted {hasLocalIp, select, true {{localIp}} other {a host on the network}} and ' +
    'matches {indicator} from {attribution}, seen via {via}. Unsolicited inbound traffic from listed ' +
    'addresses is constant on any internet-facing network and is usually background scanning. It ' +
    'matters if the host answered or if it repeats against one target, so check what was exposed ' +
    'rather than treating this alone as a compromise.',

  'threat_intel.unknown.title': 'Traffic involving known-malicious address {observed}',
  'threat_intel.unknown.description':
    'Traffic between {hasLocalIp, select, true {{localIp}} other {unknown}} and ' +
    '{hasRemoteIp, select, true {{remoteIp}} other {unknown}} involves {observed}, matching ' +
    '{indicator} from {attribution}, seen via {via}. The direction could not be determined from the ' +
    'addresses, so establish which side initiated before drawing a conclusion.',

  // --- Not a finding ---
  //
  // The deliberate test send. It is not something a detector produces, but it
  // travels as a `NotifiableFinding` and reaches the same channels, so it needs a
  // key for the same reason they do: the CEF and syslog exports render their text
  // in English regardless of what the human channels are set to, and they render
  // it from a key. Kept here rather than in a catalogue of its own because one
  // more entry is cheaper than a second catalogue and a second renderer.
  'notification.test.title': 'Test notification from Network Monitoring',
  'notification.test.description':
    'If you are reading this, alert delivery is configured correctly. No finding was involved.',
} as const;

/**
 * Every key a finding can name. Derived from the English catalogue rather than
 * declared separately, so the two cannot drift.
 */
export type FindingMessageKey = keyof typeof FINDINGS_EN;

/**
 * A locale other than English. `Partial` on purpose — see findings.ts: a
 * translation lands key by key and a half-finished one must not break the build,
 * because the renderer falls back to the English pattern per key.
 */
export type PartialFindingCatalog = Readonly<Partial<Record<FindingMessageKey, string>>>;

/**
 * The half of a key that a detector actually names.
 *
 * `message_key` on the alert row is `arp_spoofing.sprawl`, not
 * `arp_spoofing.sprawl.title` — the pair is derived from it at render time. Since
 * the pairing test guarantees both halves exist, taking the titles and stripping
 * the suffix enumerates exactly the variants a detector may emit, so naming one
 * that was never written is a compile error rather than a row that renders its
 * own key.
 */
export type FindingMessageBase = typeof FINDINGS_EN extends infer C
  ? { [K in keyof C]: K extends `${infer Base}.title` ? Base : never }[keyof C]
  : never;
