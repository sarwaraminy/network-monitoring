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

  // --- Feldnamen der Belege ---

  'evidence.feed': 'Quelle',
  'evidence.feedNote': 'Quellenhinweis',
  'evidence.exporter': 'Exporter',
  'evidence.direction': 'Richtung',
  'evidence.indicator': 'Indikator',
  'evidence.indicatorType': 'Indikatortyp',
  'evidence.matchedAddress': 'Getroffene Adresse',
  'evidence.observedVia': 'Beobachtet über',
  'evidence.flowBytes': 'Flow-Bytes',
  'evidence.flowPackets': 'Flow-Pakete',
  'evidence.destinationPort': 'Zielport',
  'evidence.port': 'Port',
  'evidence.count': 'Anzahl',
  'evidence.seconds': 'Sekunden',
  'evidence.scanner': 'Scanner',
  'evidence.service': 'Dienst',
  'evidence.hasService': 'Dienst vorhanden',
  'evidence.sampleHosts': 'Beispiel-Hosts',
  'evidence.distinctPortsProbed': 'Verschiedene geprüfte Ports',
  'evidence.distinctHostsProbed': 'Verschiedene geprüfte Hosts',
  'evidence.distinctTargets': 'Verschiedene Ziele',
  'evidence.attemptsInWindow': 'Versuche im Zeitfenster',
  'evidence.username': 'Benutzername',
  'evidence.passwordLength': 'Passwortlänge',
  'evidence.passwordRecorded': 'Passwort aufgezeichnet',
  'evidence.previousMac': 'Vorherige MAC',
  'evidence.knownDevicesBefore': 'Bekannte Geräte zuvor',
  'evidence.vendor': 'Hersteller',

  // --- Zeiträume und übrige Bedienelemente ---

  'period.1h': 'Letzte Stunde',
  'period.12m': 'Letzte 12 Monate',
  'period.24h': 'Letzte 24 Stunden',
  'period.7d': 'Letzte 7 Tage',
  'period.30d': 'Letzte 30 Tage',
  'period.90d': 'Letzte 90 Tage',
  'period.1y': 'Letztes Jahr',
  'period.5y': 'Letzte 5 Jahre',
  'period.all': 'Gesamter Zeitraum',
  'grid.actions': 'Aktionen',
  'ipinfo.looking_up': 'Reverse-DNS-, WHOIS- und Geolokalisierungsabfragen laufen…',
  'ipinfo.lookup_failed': 'Abfrage fehlgeschlagen: {reason}',
  'ipinfo.no_geo': 'Keine Geolokalisierungsdaten',
  'suppressions.any_finding': 'Beliebiger Fund',
  'suppressions.rule_from': 'von {cidr}',
  'suppressions.rule_to': 'nach {cidr}',
  'suppressions.rule_port': 'auf Port {port}',
  'intel.matched_on_all': 'wird auf jedes Paket und jeden Flow angewendet',
  'intel.is_off': 'Bedrohungsdaten sind ausgeschaltet',
  'intel.refreshes_every': 'aktualisiert alle {hours} h',

  // --- Gemeinsame Bedienelemente ---

  'common.refresh': 'Aktualisieren',
  'common.cancel': 'Abbrechen',
  'common.close': 'Schließen',
  'common.discard': 'Verwerfen',
  'delivery.settings_title': 'Einstellungen',
  'delivery.read_failed': 'Die Zustellungseinstellungen konnten nicht gelesen werden',
  'delivery.moved_note':
    'Die Zustellungseinstellungen sind zu den Administrationseinstellungen umgezogen — dem Zahnrad in der Kopfzeile — damit es eine Stelle zum Ändern gibt statt zwei. Diese Seite behält, was sonst nirgends steht: ob die Zustellung funktioniert, und den Testversand.',
  'login.admin_required': 'Für das Aufzeichnen von Datenverkehr ist eine Administratorsitzung nötig',
  'packets.captured': 'Aufgezeichnete Pakete',
  'packets.shown': '{count} angezeigt',
  'common.clear': 'Leeren',
  'common.rows_per_page': 'Zeilen pro Seite',
  'common.all_sensors': 'Alle Sensoren',
  'common.all_detectors': 'Alle Prüfungen',
  'common.all_actions': 'Alle Aktionen',
  'common.any_kind': 'Beliebige Art',
  'common.open_only': 'Nur offene',
  'common.no_error_message': 'Es wurde keine Fehlermeldung übermittelt.',
  'common.try_again': 'Erneut versuchen',
  'common.reload_app': 'Anwendung neu laden',
  'common.render_failed': 'Beim Darstellen dieser Seite ist etwas fehlgeschlagen',
  'capture.start': 'Aufzeichnung starten',
  'capture.stop': 'Stoppen',
  'capture.capturing': 'Zeichnet auf',
  'capture.idle': 'Inaktiv',
  'ipinfo.title': 'IP-Informationen',
  'ipinfo.country': 'Land',
  'ipinfo.region': 'Region',
  'ipinfo.city': 'Stadt',
  'ipinfo.coordinates': 'Koordinaten',
  'alerts.nothing_to_report': 'Nichts zu melden',
  'chart.no_findings_period': 'Keine Funde in diesem Zeitraum.',
  'suppressions.new_rule': 'Neue Regel',
  'adhoc.no_rows': 'Die Abfrage lief und lieferte keine Zeilen.',
  'intel.off': 'Bedrohungsdaten sind ausgeschaltet',
  'intel.licence_note': 'Prüfen Sie die Lizenz jeder Quelle, bevor Sie sich kommerziell darauf verlassen.',

  // --- Alarmzustellung ---

  'delivery.section.0': 'Filter',
  'delivery.section.0_subtitle': 'Gilt für die Kanäle, die ein Mensch liest, nie für den SIEM-Datenstrom',
  'delivery.field.enabled': 'Alarme zustellen',
  'delivery.field.enabled_help':
    'Aus bedeutet: Funde werden aufgezeichnet und niemand wird benachrichtigt. Syslog bleibt davon ' +
    'unberührt.',
  'delivery.field.minSeverity': 'Mindest-Schweregrad',
  'delivery.field.digestSeconds': 'Sammelfenster (s)',
  'delivery.field.digestSeconds_help':
    'Funde werden so lange gebündelt, sodass ein Ausbruch eine Nachricht ergibt. Null bedeutet ' +
    'keine Bündelung.',
  'delivery.field.throttleSeconds': 'Sperrzeit je Fund (s)',
  'delivery.field.throttleSeconds_help':
    'Derselbe Fund löst innerhalb dieses Zeitraums keine weitere Benachrichtigung aus.',
  'delivery.field.maxPerHour': 'Maximale Nachrichten pro Stunde',
  'delivery.field.maxPerHour_help': 'Eine harte Obergrenze, unabhängig von der Erkennung.',
  'delivery.field.includeEvidence': 'Belege einschließen',
  'delivery.field.includeEvidence_help':
    'Belege enthalten nie Passwörter oder Nutzdaten, wohl aber interne Adressen und ' +
    'Benutzernamen — die ein fremder Chat-Dienst dann vorhält.',
  'delivery.field.dashboardUrl': 'Dashboard-Link',
  'delivery.field.dashboardUrl_help':
    'Wird in jeder Nachricht verlinkt, z. B. https://nmt.example.com/alerts',
  'delivery.section.1': 'Webhook',
  'delivery.section.1_subtitle': 'Slack, Teams, Discord oder alles, was JSON annimmt',
  'delivery.field.webhookUrl': 'Webhook-URL',
  'delivery.field.webhookUrl_help':
    'Für Teams einen Workflows-Webhook anlegen — seine URL liegt auf logic.azure.com. Wird als ' +
    'Anmeldedaten behandelt und nie zurückgegeben.',
  'delivery.field.webhookFormat': 'Nutzdatenformat',
  'delivery.field.webhookFormat_help':
    '„auto“ liest den Host und wählt die passende Form, einschließlich des eingestellten ' +
    'Office-365-Connectors für eine webhook.office.com-URL.',
  'delivery.section.2': 'E-Mail',
  'delivery.section.2_subtitle':
    'Ein internes Relay braucht keine Anmeldedaten und ist die richtige Wahl für einen Sensor vor Ort',
  'delivery.field.emailHost': 'SMTP-Host',
  'delivery.field.emailPort': 'Port',
  'delivery.field.emailSecure': 'Implizites TLS',
  'delivery.field.emailSecure_help':
    'Nur für Port 465 zutreffend. Auf 587 ausgeschaltet lassen — dort wird stattdessen STARTTLS ' +
    'ausgehandelt, und ein Einschalten hier hängt, bis die Verbindung abläuft.',
  'delivery.field.emailFrom': 'Absenderadresse',
  'delivery.field.emailTo': 'Empfänger',
  'delivery.field.emailTo_help': 'Eine pro Zeile oder durch Komma getrennt.',
  'delivery.field.emailAuthMethod': 'Authentifizierung',
  'delivery.field.emailAuthMethod_help':
    'OAuth2 ist XOAUTH2 mit einem Refresh-Token, für einen Microsoft-365- oder Google-Mandanten, ' +
    'der nichts anderes zulässt.',
  'delivery.field.emailUser': 'Benutzername',
  'delivery.field.emailUser_help':
    'Für ein Relay ohne Authentifizierung leer lassen. Unter OAuth2 ist dies das sendende Postfach ' +
    'und erforderlich.',
  'delivery.field.emailPassword': 'Passwort',
  'delivery.field.emailPassword_help':
    'Microsoft 365 und Google deaktivieren einfaches SMTP AUTH standardmäßig, daher kann auch ein ' +
    'richtiges Passwort abgelehnt werden.',
  'delivery.field.emailOauthTokenUrl': 'Token-Endpunkt',
  'delivery.field.emailOauthTokenUrl_help':
    'Microsoft: https://login.microsoftonline.com/[tenant]/oauth2/v2.0/token — Google: ' +
    'https://oauth2.googleapis.com/token',
  'delivery.field.emailOauthClientId': 'Client-ID',
  'delivery.field.emailOauthClientSecret': 'Client-Secret',
  'delivery.field.emailOauthRefreshToken': 'Refresh-Token',
  'delivery.field.emailOauthRefreshToken_help':
    'Einmalig durch Zustimmung zur App-Registrierung erhalten. Nodemailer tauscht es gegen ein ' +
    'Access-Token und erneuert dieses selbst.',
  'delivery.field.emailOauthScope': 'Scope',
  'delivery.field.emailOauthScope_help':
    'Optional. Google ignoriert ihn; manche Microsoft-Mandanten brauchen ' +
    'https://outlook.office.com/SMTP.Send offline_access.',
  'delivery.section.3': 'Syslog / SIEM',
  'delivery.section.3_subtitle':
    'Absichtlich ungefiltert: Ein SIEM korreliert selbst und braucht den vollständigen Datenstrom',
  'delivery.field.syslogHost': 'Collector-Host',
  'delivery.field.syslogPort': 'Port',
  'delivery.field.syslogProtocol': 'Protokoll',
  'delivery.field.syslogFormat': 'Format',
  'delivery.field.syslogRfc': 'RFC',
  'delivery.field.syslogRfc_help': '3164 hat weder Jahr noch Zeitzone im Zeitstempel; 5424 ist vorzuziehen.',
  'delivery.field.syslogFacility': 'Facility',
  'delivery.field.syslogFacility_help': '16–23 sind die Facilities zur lokalen Verwendung; 16 ist local0.',
  'delivery.field.syslogAppName': 'App-Name',
  'delivery.field.syslogIncludeEvidence': 'Belege einschließen',
  'delivery.field.syslogIncludeEvidence_help':
    'Hier standardmäßig an, anders als bei den Chat-Kanälen: Das Offenlegungsargument gilt nicht ' +
    'für einen Collector im eigenen Netz.',

  // --- Konten und Rollen ---

  'users.loading': 'Server wird abgefragt…',
  'users.load_failed': 'Die Konten konnten nicht gelesen werden',
  'users.change_failed': 'Die Rolle konnte nicht geändert werden',
  'users.role_changed': '{account} ist jetzt {role}.',
  'users.that_account': 'Dieses Konto',
  'users.blocked_self':
    'Sie können Ihre eigene Rolle nicht ändern. Fragen Sie eine andere Administratorin oder einen anderen Administrator.',
  'users.blocked_last_admin': 'Das einzige Administratorkonto. Befördern Sie zuerst ein weiteres Konto.',
  'users.single_admin':
    'Nur ein Administratorkonto. Ein zweites zu befördern ist das, was dieses Konto ' +
    'wiederherstellbar macht — mit nur einem bedeutet ein vergessenes Passwort, die Datenbank von ' +
    'Hand zu bearbeiten.',
  'users.col_account': 'Konto',
  'users.col_name': 'Name',
  'users.col_role': 'Rolle',
  'users.you': 'Sie',
  'users.account_n': 'Konto {id}',
  'users.role_for': 'Rolle für {account}',
  'users.audit_note':
    'Jede Änderung wird im Prüfprotokoll festgehalten — wer sie vorgenommen hat und in welche ' +
    'Richtung die Rolle geändert wurde.',

  // --- Abfragekonsole: Diagnose ---

  'console.loading': 'Server wird abgefragt…',
  'console.status_failed': 'Der Status der Konsole konnte nicht gelesen werden',
  'console.running': 'Die Konsole läuft',
  'console.running_note':
    'Abfragen werden als Postgres-Rolle ausgeführt, deren Rechte entscheiden, was möglich ist — ' +
    'nicht als der Datenbankbenutzer dieser Anwendung.',
  'console.mode_write': 'Lesen und schreiben',
  'console.mode_read': 'Nur lesen',
  'console.write_warning':
    'Der Schreibmodus ist aktiv: Die Konsole meldet sich als Lese-/Schreibrolle an und kann die ' +
    'Betriebstabellen mit UPDATE, INSERT und DELETE verändern. Das Prüfprotokoll, die Spalten mit ' +
    'Geheimnissen, Konten und Zustellungseinstellungen bleiben unerreichbar.',
  'console.password_logged': 'Das Konsolenpasswort steht möglicherweise im Postgres-Protokoll',
  'console.password_logged_note':
    'Der Datenbankeigentümer ist kein Superuser, daher konnte die Anweisungsprotokollierung beim ' +
    'Setzen des Passworts nicht unterdrückt werden. Unter {ddl} oder {all} wurde es im Klartext ' +
    'geschrieben. Behandeln Sie das Konsolenpasswort als einen Wert, den der Datenbankserver ' +
    'aufgezeichnet haben könnte — unabhängig davon, wo es gesetzt wurde.',
  'console.unavailable': 'Die Konsole ist nicht verfügbar',
  'console.env_lines': 'In der API-Umgebung:',
  'console.db_said': 'Was die Datenbank gemeldet hat',
  'console.recheck_failed': 'Die erneute Prüfung konnte nicht ausgeführt werden',
  'console.checking': 'Wird geprüft…',
  'console.check_again': 'Erneut prüfen',
  'console.recheck_note':
    'Führt die Startprüfung gegen die aktuelle Umgebung erneut aus. Die Konsole kann damit nicht ' +
    'eingeschaltet werden.',
  'console.remedy.disabled.title': 'Die Konsole wurde nicht eingeschaltet',
  'console.remedy.disabled.note':
    'Schalten Sie sie unter „Einstellungen der Abfragekonsole“ ein — der nächsten Zeile in diesem ' +
    'Menü — und setzen Sie dort ein Konsolenpasswort. Kein Neustart nötig. Das ist der ' +
    'Standardzustand, kein Fehler.',
  'console.remedy.no_password.title': 'Eingeschaltet, aber es gibt kein Passwort zum Installieren',
  'console.remedy.no_password.note':
    'Die Konsole wurde angefordert, aber die Rolle, als die sie sich anmeldet, hat keine ' +
    'Anmeldedaten, und der Server erfindet keine. Setzen Sie eines unter „Einstellungen der ' +
    'Abfragekonsole“, der nächsten Zeile in diesem Menü.',
  'console.remedy.sandbox_failed.title': 'Die Datenbank hat die Isolierung der Konsole nicht bestätigt',
  'console.remedy.sandbox_failed.note':
    'Die Konsole ist konfiguriert, und der Server hat den Start verweigert, weil er nicht ' +
    'nachweisen konnte, dass die Rolle weder Superuser ist noch schreiben kann. Prüfen Sie, ob die ' +
    'Migrationen gelaufen sind und ob niemand die Rolle von Hand neu angelegt hat. Beheben Sie das ' +
    'und prüfen Sie erneut — kein Neustart nötig.',

  // --- Abfragekonsole: Einstellungen ---

  'console_settings.saved': 'Gespeichert. Die Änderung ist bereits in Kraft — kein Neustart nötig.',
  'console_settings.save_failed': 'Die Einstellungen konnten nicht gespeichert werden',
  'console_settings.read_failed': 'Die Einstellungen konnten nicht gelesen werden',
  'console_settings.all_pinned': 'Jedes geänderte Feld ist jetzt in der Umgebung gesetzt.',
  'console_settings.no_password': 'Es ist kein Konsolenpasswort gesetzt',
  'console_settings.no_password_pinned_before':
    'Die Konsole kann erst starten, wenn eines gesetzt ist, und es ist festgelegt durch',
  'console_settings.no_password_pinned_after':
    'in der API-Umgebung — die derzeit leer ist. Setzen Sie dort einen Wert und starten Sie die API ' +
    'neu, oder entfernen Sie die Zeile, um es stattdessen hier zu setzen.',
  'console_settings.no_password_here':
    'Die Konsole kann erst starten, wenn eines gesetzt ist — unabhängig von den Schaltern hier. Es ' +
    'sind die Anmeldedaten, die auf ihrer Postgres-Rolle installiert werden. Setzen Sie eines unter ' +
    '„Passwort der Konsolenrolle“ weiter unten.',
  'console_settings.pinned_note':
    'Durch {variable} in der Umgebung gesetzt. Entfernen Sie diese Zeile und starten Sie die API ' +
    'neu, um den Wert hier zu verwalten.',
  'console_settings.password_set': 'Gesetzt — leer lassen, um es beizubehalten',
  'console_settings.password_unset': 'Nicht gesetzt',
  'console_settings.clear_password': 'Passwort löschen',
  'console_settings.will_clear':
    'Wird beim Speichern gelöscht. Die Konsole stoppt daraufhin sofort — ohne Passwort kann sie ' +
    'sich nicht anmelden.',
  'console_settings.saving': 'Wird gespeichert…',
  'console_settings.save': 'Änderungen speichern',
  'console_settings.unsaved': '{count} nicht gespeichert',
  'console_settings.field.enabled': 'Abfragekonsole',
  'console_settings.field.enabled_help':
    'Betreibt die Konsole. Sie braucht weiterhin ein Konsolenpasswort — unten zu setzen — und ' +
    'startet weiterhin nur, wenn die Datenbank bestätigt, dass ihre Rolle isoliert ist.',
  'console_settings.field.writeEnabled': 'Schreiben erlauben',
  'console_settings.field.writeEnabled_help':
    'Meldet sich als andere Postgres-Rolle an — eine, der V12 UPDATE, INSERT und DELETE auf den ' +
    'Betriebstabellen gewährt. Keine Prüfung in der Anwendung: Ausschalten verbindet als Rolle, die ' +
    'überhaupt nicht schreiben kann.',
  'console_settings.field.timeoutMs': 'Anweisungs-Zeitlimit (ms)',
  'console_settings.field.maxRows': 'Zeilenobergrenze',
  'console_settings.field.maxQueryLength': 'Maximale Abfragelänge',
  'console_settings.field.audit': 'Prüfprotokoll',
  'console_settings.field.audit_help':
    'Was ins Prüfprotokoll gelangt. Wird auf „all“ erzwungen, solange Schreiben erlaubt ist — eine ' +
    'Konsole, die DELETE kann, und ein Protokoll, das nichts davon festhält, ist die eine ' +
    'Kombination, die es nicht geben darf.',
  'console_settings.field.dbPassword': 'Passwort der Konsolenrolle',
  'console_settings.field.dbPassword_help':
    'Wird beim Start auf der Postgres-Rolle der Konsole installiert. Wird nie zurückgegeben — der ' +
    'Server meldet nur, ob eines gesetzt ist. Beim Speichern verbindet sich die Konsole neu, weil ' +
    'die Anmeldedaten beim Start installiert werden und sonst erst beim nächsten Neustart wirken.',

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

  'common.save': 'Speichern',
  'common.delete': 'Löschen',
  'common.loading': 'Wird geladen…',
  'common.none': '—',
  'common.error_generic': 'Etwas ist schiefgelaufen',
};
