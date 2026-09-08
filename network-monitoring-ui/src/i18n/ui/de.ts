import type { UiMessageKey } from './en';

/**
 * The interface's own strings, in German.
 *
 * Machine-drafted and pending review by a native speaker, like the other two
 * catalogues. Keys absent here fall back to the English string per key, so a
 * partial file is a working file.
 *
 * German runs roughly 30% longer than English, which shows first in the
 * navigation rail, the dashboard tiles and the settings dialog's two-column grid.
 * Labels here are kept as short as the sense allows for that reason.
 */
export const UI_DE: Readonly<Partial<Record<UiMessageKey, string>>> = {
  // --- Navigation ---

  'nav.main': 'Hauptbereich',
  'nav.panel_title': 'Navigation',
  'nav.search_placeholder': 'Navigation durchsuchen…',
  'nav.clear_search': 'Suche leeren',
  'nav.expand_panel': 'Navigation ausklappen',
  'nav.collapse_panel': 'Navigation einklappen',

  'nav.group.overview': 'Überblick',
  'nav.group.security': 'Sicherheit',
  'nav.group.capture': 'Mitschnitt',
  'nav.group.administration': 'Verwaltung',

  'nav.dashboard': 'Übersicht',
  'nav.alerts': 'Sicherheitsfunde',
  'nav.suppressions': 'Unterdrückungen',
  'nav.threat_intel': 'Bedrohungsdaten',
  'nav.capture_interface': 'Mitschnitt nach Schnittstelle',
  'nav.capture_ip': 'Mitschnitt nach IP',
  'nav.delivery': 'Zustellung',
  'nav.audit': 'Prüfprotokoll',
  'nav.adhoc': 'Ad-hoc-Abfrage',

  // --- Kontomenü ---

  'account.signed_in': 'Angemeldet',
  'account.add_user': 'Benutzer anlegen',
  'account.sign_out': 'Abmelden',
  'account.theme': 'Darstellung',
  'account.theme.light': 'Hell',
  'account.theme.dark': 'Dunkel',
  'account.theme.auto': 'Auto',
  'account.language': 'Sprache',

  // --- Funde ---

  'alerts.title': 'Sicherheitsfunde',
  'alerts.subtitle': 'Jeder Fund der Detektoren, neueste zuerst',
  'alerts.search_placeholder': 'Funde durchsuchen',
  'alerts.column.severity': 'Schweregrad',
  'alerts.column.sensor': 'Sensor',
  'alerts.column.detector': 'Detektor',
  'alerts.column.finding': 'Fund',
  'alerts.column.source': 'Quelle',
  'alerts.column.target': 'Ziel',
  'alerts.column.last_seen': 'Zuletzt gesehen',
  'alerts.column.status': 'Status',
  'alerts.acknowledge': 'Bestätigen',
  'alerts.reopen': 'Wieder öffnen',
  'alerts.open': 'Offen',
  'alerts.acknowledged': 'Bestätigt',
  'alerts.acknowledged_by': 'Bestätigt von {who}',
  'alerts.delete': 'Löschen — der Fund und seine Belege gehen mit',
  'alerts.unacknowledged_count': '{count, plural, one {# unbestätigt} other {# unbestätigt}}',
  'alerts.what_this_means': 'Was das bedeutet',
  'alerts.evidence': 'Belege',
  'alerts.no_evidence': 'Für diesen Fund wurden keine unterstützenden Angaben aufgezeichnet.',
  'alerts.first_seen': 'Zuerst gesehen',
  'alerts.occurrences': 'Vorkommen',
  'alerts.protocol': 'Protokoll',
  'alerts.source_mac': 'Quell-MAC',
  'alerts.target_mac': 'Ziel-MAC',
  'alerts.unknown_actor': 'unbekannt',

  // --- Anmeldung ---

  'app.name': 'Network Monitoring Tool',
  'login.subtitle': 'Melden Sie sich an, um Datenverkehr mitzuschneiden und auszuwerten',
  'login.email': 'E-Mail-Adresse',
  'login.password': 'Passwort',
  'login.sign_in': 'Anmelden',
  'login.signing_in': 'Wird angemeldet…',
  'login.no_accounts': 'Es gibt noch keine Konten.',
  'login.create_first_admin': 'Erstes Administratorkonto anlegen',
  'login.no_account': 'Noch kein Konto?',
  'login.register_here': 'Hier registrieren',

  // --- Registrierung ---

  'signup.title': 'Konto anlegen',
  'signup.subtitle': 'Einen Benutzer für das Network Monitoring Tool registrieren',
  'signup.bootstrap_subtitle':
    'Diese Installation hat noch keine Konten, dieses wird also zum Administratorkonto',
  'signup.restricted': 'Das Anlegen von Konten ist eingeschränkt',
  'signup.restricted_subtitle': 'Nur eine administrierende Person kann dieser Installation Konten hinzufügen',
  'signup.ask_admin':
    'Bitten Sie eine administrierende Person, Ihr Konto anzulegen. Wenn Sie diesen Server selbst ' +
    'einrichten, führen Sie aus',
  'signup.back_to_sign_in': 'Zurück zur Anmeldung',
  'signup.confirm_password': 'Passwort bestätigen',
  'signup.first_name': 'Vorname',
  'signup.last_name': 'Nachname',
  'signup.role': 'Rolle',
  'signup.role_helper': 'Sie sind Administrator, daher wird diese Wahl übernommen',
  'signup.submit': 'Registrieren',
  'signup.creating': 'Konto wird angelegt…',
  'signup.create_administrator': 'Administrator anlegen',
  'signup.back_to_app': 'Zurück zur Anwendung',
  'signup.have_account': 'Sie haben bereits ein Konto? Anmelden',

  'role.user': 'Benutzer',
  'role.administrator': 'Administrator',

  // --- Übersicht ---

  'dashboard.title': 'Übersicht',
  'dashboard.subtitle': 'Was die Detektoren gefunden haben, und welche Hosts immer wieder auftauchen',
  'dashboard.sensor': 'Sensor',
  'dashboard.period': 'Zeitraum',
  'dashboard.open_findings': 'Offene Funde',
  'dashboard.critical_high': 'Kritisch und hoch',
  'dashboard.needs_attention': 'Zuerst zu prüfen',
  'dashboard.capture': 'Mitschnitt',
  'dashboard.known_devices': 'Bekannte Geräte',
  'dashboard.macs_seen': 'Gesehene MAC-Adressen',
  'dashboard.over_time': 'Funde im Zeitverlauf',
  'dashboard.by_detector': 'Funde nach Detektor',
  'dashboard.which_firing': 'Welche Prüfungen anschlagen',
  'dashboard.top_sources': 'Am häufigsten beteiligte Quellen',
  'dashboard.top_sources_subtitle': 'Adressen, die in den meisten Funden vorkommen',
  'dashboard.severity_breakdown': 'Verteilung der Schweregrade',
  'dashboard.all_time': 'Alle Funde, gesamter Zeitraum',
  'dashboard.findings': 'Funde',
  'dashboard.no_findings': 'Noch keine Funde.',
  'dashboard.no_source_findings': 'Noch keine Funde mit Quelladresse.',

  // --- Prüfprotokoll ---

  'audit.title': 'Prüfprotokoll',
  'audit.subtitle': 'Wer etwas gelöscht, geändert oder umgeleitet hat — nur anfügend, und niemals bereinigt',
  'audit.when': 'Wann',
  'audit.who': 'Wer',
  'audit.what': 'Was',
  'audit.which': 'Welches',
  'audit.action': 'Aktion',
  'audit.subject': 'Betreff',
  'audit.detail': 'Detail',

  // --- Unterdrückungsregeln ---

  'suppressions.title': 'Unterdrückungsregeln',
  'suppressions.subtitle':
    'Funde, die Sie als erwartet erklärt haben. Ein passender Fund wird verworfen, bevor er ' +
    'gespeichert wird — nicht hinter einem Filter versteckt',
  'suppressions.rules': 'Regeln',
  'suppressions.rules_subtitle':
    'Von oben nach unten gelesen: Die erste Regel, die auf einen Fund passt, verwirft ihn',
  'suppressions.findings_hidden': 'Verworfene Funde',
  'suppressions.never_matched': 'Nie zugetroffen',
  'suppressions.expired': 'Abgelaufen',
  'suppressions.covers': 'Gilt für',
  'suppressions.why': 'Warum das erwartet ist',
  'suppressions.state': 'Zustand',
  'suppressions.hidden': 'Verworfen',
  'suppressions.expires': 'Läuft ab',
  'suppressions.no_expiry': 'Diese Regel gilt, bis jemand sie entfernt.',
  'suppressions.edit': 'Diese Regel bearbeiten',
  'suppressions.delete': 'Löschen — der Nachweis, was sie verworfen hat, geht mit',
  'suppressions.none': 'Keine Unterdrückungsregeln. Jeder Fund der Detektoren wird gespeichert.',
  'suppressions.kind': 'Art des Fundes',
  'suppressions.kind_helper': 'Jede Art, sofern Sie keine auswählen',
  'suppressions.source': 'Quelladresse oder -bereich',
  'suppressions.source_helper': 'Woher der Verkehr kam',
  'suppressions.target': 'Zieladresse oder -bereich',
  'suppressions.target_helper': 'Wohin er ging',
  'suppressions.port': 'Zielport',
  'suppressions.port_helper': 'Passt nur auf Funde zu einem einzelnen Port — nie auf einen Portscan',
  'suppressions.expires_helper': 'Leer bedeutet, sie läuft nie ab',
  'suppressions.reason': 'Warum ist das erwartet?',
  'suppressions.reason_helper':
    'Wer diese Liste in sechs Monaten liest, hat nur diese Zeile als Anhaltspunkt',
  'suppressions.in_force': 'In Kraft',

  // --- Bedrohungsdaten ---

  'intel.title': 'Bedrohungsdaten',
  'intel.subtitle':
    'Adressen und Domains, die gegen Indikator-Feeds geprüft werden — der einzige Detektor hier, ' +
    'der kein Schwellenwert ist',
  'intel.indicators_loaded': 'Geladene Indikatoren',
  'intel.feeds': 'Feeds',
  'intel.feeds_subtitle': 'Woher jede Quelle beim letzten Laden kam',
  'intel.no_feeds': 'Keine Feeds konfiguriert.',
  'intel.last_loaded': 'Zuletzt geladen',
  'intel.refused': 'Beim Laden abgewiesen',
  'intel.what_loaded': 'Was geladen ist',
  'intel.by_type': 'Nach Indikatortyp',
  'intel.ipv4': 'IPv4-Adressen',
  'intel.ipv4_cidr': 'IPv4-Bereiche (CIDR)',
  'intel.ipv6': 'IPv6-Adressen',
  'intel.domains': 'Domains',
  'intel.feed': 'Feed',
  'intel.source': 'Quelle',
  'intel.indicators': 'Indikatoren',
  'intel.skipped': 'Übersprungen',
  'intel.skipped_explain':
    'Zeilen, die keine brauchbaren Indikatoren waren: Kommentare, Leerzeilen und alles ' +
    'Fehlerhafte oder nicht Routbare.',

  // --- Zustellung ---

  'delivery.title': 'Zustellung von Funden',
  'delivery.subtitle': 'Wohin Funde gehen, und ob sie dort ankommen',
  'delivery.for_people': 'Für Menschen',
  'delivery.for_people_subtitle':
    'Gefiltert, gedrosselt und gebündelt, damit der Kanal nicht stummgeschaltet wird',
  'delivery.min_severity': 'Mindestschweregrad',
  'delivery.digest_window': 'Sammelzeitraum',
  'delivery.throttle': 'Drosselung je Fund',
  'delivery.hourly_ceiling': 'Obergrenze pro Stunde',
  'delivery.for_siem': 'Für ein SIEM',
  'delivery.for_siem_subtitle': 'Jeder Fund, ungefiltert',
  'delivery.protocol': 'Protokoll',
  'delivery.format': 'Format',
  'delivery.framing': 'Rahmung',
  'delivery.evidence': 'Belege',
  'delivery.right_now': 'Gerade jetzt',
  'delivery.right_now_subtitle': 'Was Warteschlange und Grenzen gerade tun',
  'delivery.queued': 'Für den nächsten Sammelversand vorgemerkt',
  'delivery.sent_last_hour': 'In der letzten Stunde gesendet',
  'delivery.throttled': 'Derzeit gedrosselte Funde',

  // --- Abfragekonsole ---

  'adhoc.subtitle':
    'Nur lesendes SQL gegen die Datenbank dieses Systems. Jede Abfrage wird im Prüfprotokoll ' +
    'festgehalten.',
  'adhoc.sql': 'SQL',

  // --- Mitschnitt ---

  'capture.interface.title': 'Mitschnitt von einer lokalen Schnittstelle',
  'capture.interface.subtitle': 'Pakete live von einem Adapter, Frame für Frame dekodiert',
  'capture.ip.title': 'Mitschnitt nach IP-Adresse gefiltert',
  'capture.ip.subtitle': 'Derselbe Mitschnitt, eingegrenzt auf Verkehr eines einzelnen Hosts',
  'capture.packets': 'Pakete',
  'capture.packets_subtitle': 'Neueste zuerst, direkt von der Leitung dekodiert',
  'capture.network_interface': 'Netzwerkschnittstelle',
  'capture.filter_ip': 'Nach IP-Adresse filtern',
  'capture.snapshot_length': 'Snapshot-Länge',
  'capture.timeout': 'Zeitlimit (ms)',

  'packets.source_ip': 'Quell-IP',
  'packets.source_mac': 'Quell-MAC',
  'packets.destination_ip': 'Ziel-IP',
  'packets.destination_mac': 'Ziel-MAC',
  'packets.ethertype': 'EtherType',
  'packets.llc_dsap': 'LLC DSAP',
  'packets.llc_ssap': 'LLC SSAP',
  'packets.llc_control': 'LLC Control',
  'packets.frame': 'Frame',
  'packets.pad': 'Füllbytes',

  // --- Schweregrad- und Detektornamen ---

  'dashboard.load_failed': 'Das Dashboard konnte nicht geladen werden',
  'dashboard.total_all_time': '{count} insgesamt, seit Beginn',
  'dashboard.capture_running': 'Läuft',
  'dashboard.capture_idle': 'Inaktiv',
  'dashboard.pcap_unavailable': 'pcap-Bibliothek nicht verfügbar',
  'dashboard.no_capture': 'Keine Aufzeichnung gestartet',
  'dashboard.per_hour': 'Nach Schweregrad, pro Stunde',
  'dashboard.per_day': 'Nach Schweregrad, pro Tag',
  'dashboard.hours_count': '{count, plural, one {# Stunde} other {# Stunden}}',
  'dashboard.days_count': '{count, plural, one {# Tag} other {# Tage}}',
  'dashboard.occurrences': '{count, plural, one {# Vorkommen} other {# Vorkommen}}',
  'common.never': 'nie',
  'suppressions.preview_none': 'Keine der letzten {examined} Meldungen entspricht dieser Regel.',
  'suppressions.preview_matched':
    'Hätte {matched} der letzten {examined} Meldungen ausgeblendet — {occurrences} Beobachtungen insgesamt.',
  'suppressions.preview_window': 'Untersucht von {from} bis {to}',

  'severity.critical': 'Kritisch',
  'severity.high': 'Hoch',
  'severity.medium': 'Mittel',
  'severity.low': 'Niedrig',
  'severity.info': 'Info',

  'kind.arp_spoofing': 'ARP-Spoofing',
  'kind.port_scan': 'Portscan',
  'kind.host_sweep': 'Host-Sweep',
  'kind.syn_flood': 'SYN-Flood',
  'kind.plaintext_credentials': 'Zugangsdaten im Klartext',
  'kind.dns_tunneling': 'DNS-Tunneling',
  'kind.new_device': 'Neues Gerät',
  'kind.threat_intel': 'Bedrohungsdaten',

  'kind.arp_spoofing.description':
    'Ein Host beansprucht eine IP-Adresse, die einem anderen Gerät gehört — die Grundlage der ' +
    'meisten Man-in-the-Middle-Angriffe im LAN.',
  'kind.port_scan.description':
    'Eine Quelle fragt viele Ports eines einzelnen Hosts ab und ermittelt, welche Dienste er anbietet.',
  'kind.host_sweep.description':
    'Eine Quelle fragt denselben Port auf vielen Hosts ab und sucht einen ausnutzbaren Dienst.',
  'kind.syn_flood.description':
    'Eine unplausible Rate an Verbindungsversuchen — Hinweis auf Denial of Service oder einen ' +
    'aggressiven Scanner.',
  'kind.plaintext_credentials.description':
    'Zugangsdaten oder Sitzungscookies, die unverschlüsselt über das Netzwerk gehen.',
  'kind.dns_tunneling.description':
    'DNS-Anfragen, die wie kodierte Daten aussehen statt wie Namensauflösungen — Hinweis auf ' +
    'Datenabfluss oder C2.',
  'kind.new_device.description': 'Eine MAC-Adresse, die in diesem Netzwerk noch nicht gesehen wurde.',
  'kind.threat_intel.description':
    'Eine Adresse oder Domain, die zu einem Indikator-Feed bekannter Bedrohungen passt — der ' +
    'einzige Detektor hier, der kein Schwellenwert ist.',

  'alerts.tile.all': 'Alle Funde',

  // --- Rahmen und Dialoge ---

  'nav.open': 'Navigation öffnen',
  'guide.title': 'Benutzerhandbuch',
  'guide.aria': 'Benutzerhandbuch (öffnet in einem neuen Tab)',
  'admin.settings': 'Verwaltungseinstellungen',
  'admin.settings_short': 'Einstellungen',

  'ipinfo.domain_name': 'Domainname',
  'ipinfo.geolocation': 'Geolokalisierung',
  'ipinfo.whois': 'WHOIS',
  'ipinfo.no_ptr': 'Kein PTR-Eintrag',
  'ipinfo.no_whois': 'Keine WHOIS-Antwort',

  'suppressions.hidden_caption': 'vor dem Speichern verworfen, gesamter Zeitraum',
  'suppressions.never_caption': 'in Kraft, hat aber nichts verworfen',
  'suppressions.expired_caption': 'unterdrückt nicht mehr',
  'suppressions.reason_placeholder': 'Autorisierter Nessus-Scanner, Ticket OPS-1421',

  'delivery.form_subtitle': 'Hier geändert, sofort in Kraft — keine Datei zu bearbeiten und kein Neustart',
  'delivery.form_loading': 'Die aktuelle Konfiguration wird geladen',

  'adhoc.result': 'Ergebnis',
  'adhoc.truncated': 'Gekürzt — es gibt weitere Zeilen',

  'capture.bpf_helper': "Wird als BPF-Filter host '<'ip> angewendet",
  'capture.snaplen_helper': 'Bytes pro Frame',
  'capture.timeout_helper': 'pcap-Lesezeitlimit',

  'intel.refused_caption': 'private Bereiche und fehlerhafte Einträge',

  // --- Seitenübergreifend ---

  'common.refresh': 'Aktualisieren',
  'common.close': 'Schließen',
  'common.cancel': 'Abbrechen',
  'common.save': 'Speichern',
  'common.delete': 'Löschen',
  'common.loading': 'Wird geladen…',
  'common.none': '—',
  'common.error_generic': 'Etwas ist schiefgelaufen',
};
