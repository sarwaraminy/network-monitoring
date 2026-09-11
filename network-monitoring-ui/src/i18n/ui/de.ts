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
  'nav.flow': 'Flusserfassung',
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
  'alerts.suppress': 'Solche Funde unterdrücken — öffnet eine aus dieser Zeile gefüllte Regel',
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
  'suppressions.kind_only_warning':
    'Diese Regel hat keine Adresse und keinen Port, verwirft also jeden Fund vom Typ {kind} aus ' +
    'dem gesamten Netz — der Detektor meldet nichts mehr, bis die Regel entfernt wird. Grenzen ' +
    'Sie sie mit Quelle, Ziel oder Port ein, oder prüfen Sie sie zuerst gegen aktuelle Funde.',
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

  // --- Flusserfassung ---

  'flow.title': 'Flusserfassung',
  'flow.subtitle': 'Was von Ihren Routern und Switches eintrifft, und ob es dekodiert wird.',
  'flow.status_failed': 'Der Status der Flusserfassung konnte nicht gelesen werden',
  'flow.state.off': 'Aus',
  'flow.state.not_listening': 'Hört nicht zu',
  'flow.state.listening': 'Hört auf {address}:{port}',
  'flow.bind_failed': 'Die Flusserfassung ist an, aber der Socket ist nicht offen',
  'flow.bind_failed_note':
    'Der Kollektor sollte zuhören und konnte sich nicht binden. Entweder belegt ein anderer ' +
    'Prozess den Port, oder FLOW_BIND_ADDRESS nennt eine Adresse, die es auf diesem Host nicht ' +
    'gibt. Es wird nichts empfangen. Der Grund für die Ablehnung steht im API-Protokoll.',
  'flow.waiting': 'Hört zu, und es ist noch nichts eingetroffen',
  'flow.waiting_note':
    'Der Socket ist auf {address}:{port} offen, und kein Datagramm hat ihn erreicht. Richten Sie ' +
    'einen Exporter hierher, und prüfen Sie, ob auf dem Weg UDP verworfen wird.',
  'flow.all_refused':
    '{count, plural, one {# Datagramm wurde abgewiesen} other {# Datagramme wurden abgewiesen}} ' +
    'und nichts wurde angenommen',
  'flow.all_refused_note':
    'Alle bisherigen Datagramme kamen von einer Adresse, die FLOW_EXPORTERS nicht aufführt, und ' +
    'wurden vor dem Lesen verworfen. Vergleichen Sie den Absender unten mit der erlaubten Liste.',
  'flow.awaiting_templates': 'Empfang läuft, aber jeder Datensatz wartet auf eine Vorlage',
  'flow.awaiting_templates_note':
    '{count, plural, one {# Datensatz beschreibt} other {# Datensätze beschreiben}} Felder, deren ' +
    'Form dieser Kollektor nicht kennt. NetFlow v9 und IPFIX senden die Vorlage separat, und sie ' +
    'ist noch nicht gekommen — Geräte senden sie meist in Intervallen erneut, das klärt sich also ' +
    'oft von selbst. Wenn nicht, verkürzen Sie das Vorlagen-Intervall am Exporter.',
  'flow.unreadable_version': 'Ein Exporter sendet eine Version, die dieser Kollektor nicht lesen kann',
  'flow.unreadable_version_note':
    'Von {exporters}. Implementiert sind NetFlow v5, NetFlow v9 und IPFIX; sFlow und der Rest ' +
    'nicht. Stellen Sie das Gerät auf eine der drei um.',
  'flow.nothing_decoded': 'Datagramme treffen ein und keines wurde dekodiert',
  'flow.nothing_decoded_note':
    '{count, plural, one {# Datagramm} other {# Datagramme}} empfangen, keine Datensätze gelesen, ' +
    'und nichts abgewiesen oder auf eine Vorlage wartend — keine der üblichen Ursachen passt. Es ' +
    'bleiben die Zähler unten und das API-Protokoll.',
  'flow.healthy': 'Erfassung läuft',
  'flow.healthy_note':
    '{records, plural, one {# Datensatz} other {# Datensätze}} von ' +
    '{exporters, plural, one {# Exporter} other {# Exportern}}, ' +
    '{findings, plural, =0 {und nichts sah verdächtig aus} one {und # Fund gemeldet} ' +
    'other {und # Funde gemeldet}}.',
  'flow.tile.datagrams': 'Datagramme',
  'flow.tile.datagrams_note': 'Empfangene UDP-Pakete',
  'flow.tile.records': 'Flussdatensätze',
  'flow.tile.records_note': 'Dekodiert und geprüft',
  'flow.tile.pending': 'Warten auf Vorlagen',
  'flow.tile.pending_note': 'Noch nicht lesbare Datensätze',
  'flow.tile.findings': 'Funde',
  'flow.tile.findings_note': 'Aus Flussdaten gemeldet',
  'flow.exporters': 'Exporter',
  'flow.exporters_note': 'Aktivste zuerst — in echten Netzen dominiert ein Gerät.',
  'flow.no_exporters': 'Kein Exporter hat etwas gesendet',
  'flow.no_exporters_note':
    'Richten Sie einen Router oder Switch so ein, dass er NetFlow oder IPFIX an diesen Host auf ' +
    'Port {port} exportiert. Das Protokoll ist einseitig und ohne Authentifizierung: von hier aus ' +
    'wird kein Gerät angesprochen.',
  'flow.column.exporter': 'Exporter',
  'flow.column.protocol': 'Protokoll',
  'flow.column.datagrams': 'Datagramme',
  'flow.column.records': 'Datensätze',
  'flow.column.pending': 'Warten auf Vorlage',
  'flow.column.pending_hint':
    'Datensätze, die vor der Vorlage für ihre Felder eintrafen. Sie werden gezählt, aber nicht ' +
    'gelesen — dieser Exporter kann also beschäftigt wirken und nichts beitragen.',
  'flow.column.malformed': 'Fehlerhaft',
  'flow.column.last_seen': 'Zuletzt gesehen',
  'flow.protocol.netflow5': 'NetFlow v5',
  'flow.protocol.netflow9': 'NetFlow v9',
  'flow.protocol.ipfix': 'IPFIX',
  'flow.protocol.unsupported': 'Version {version}',
  'flow.protocol.unsupported_hint':
    'Kein Parser für diese Version. Implementiert sind NetFlow v5, NetFlow v9 und IPFIX.',
  'flow.ignored.title': '{count, plural, one {# Datagramm verworfen} other {# Datagramme verworfen}}',
  'flow.ignored.subtitle':
    'Verworfen, bevor etwas daraus gelesen wurde. Jede Ursache wird an anderer Stelle behoben.',
  'flow.ignored.not_allowed': 'Absender nicht erlaubt',
  'flow.ignored.not_allowed_hint':
    'Die Adresse steht nicht in FLOW_EXPORTERS, also wird von ihr nichts gelesen.',
  'flow.ignored.sflow': 'sFlow',
  'flow.ignored.sflow_hint':
    'Ein anderes Protokoll auf demselben Port. Stellen Sie das Gerät auf NetFlow oder IPFIX um.',
  'flow.ignored.unsupported': 'Version nicht implementiert',
  'flow.ignored.unsupported_hint': 'Für dieses Versionswort hat dieser Kollektor keinen Parser.',
  'flow.allowlist': 'Erlaubte Absender:',
  'flow.allowlist_empty':
    'FLOW_EXPORTERS ist leer und nimmt damit jeden Absender an — es hätte also nichts abgewiesen ' +
    'werden dürfen. Das ist einen Fehlerbericht wert.',
  'flow.off': 'Die Flusserfassung ist aus',
  'flow.off_note':
    'Flussdaten liefern die Verbindungen über Ihre Router, ohne SPAN-Port und ohne ' +
    'Mitschnitt-Treiber — die vorhandenen Geräte beobachten und senden Zusammenfassungen hierher. ' +
    'Pro Verbindung sieht das weniger als ein Mitschnitt und vom Netz sehr viel mehr.',
  'flow.enable_hint': 'Zum Einschalten dies hier ergänzen in',
  'flow.off_restart_note':
    'Eine administrierende Person kann es auch ohne Datei einschalten, unter ' +
    'Administrationseinstellungen → Einstellungen der Flusserfassung.',
  'flow.compose': 'Unter Docker Compose braucht der Port eine zweite Datei',
  'flow.compose_note':
    'Der UDP-Port wird von docker-compose.flow.yml veröffentlicht, nicht von der Hauptdatei — ' +
    'dort würde er 2055/udp bei jeder Bereitstellung öffnen. Ohne dieses Override bindet der ' +
    'Kollektor im Container, meldet sich als lauschend, und nichts kann ihn erreichen — was genau ' +
    'wie ein Gerät aussieht, das nicht sendet. Starten Sie den Stack mit beiden Dateien:',

  // --- Einstellungen der Flusserfassung ---

  'flow_settings.loading': 'Server wird abgefragt…',
  'flow_settings.read_failed': 'Die Flusseinstellungen konnten nicht gelesen werden',
  'flow_settings.save_failed': 'Die Flusseinstellungen konnten nicht gespeichert werden',
  'flow_settings.save': 'Änderungen speichern',
  'flow_settings.retry_bind': 'Erneut binden',
  'flow_settings.rebound_only':
    'Es war nichts zu ändern — die Einstellungen waren bereits richtig. Der Socket wurde neu ' +
    'geöffnet; ob es geklappt hat, sagt der Zustand unten.',
  'flow_settings.nothing_changed': 'Nichts geändert — diese Werte waren bereits gespeichert.',
  'flow_settings.saving': 'Wird gespeichert…',
  'flow_settings.saved': 'Gespeichert und in Kraft.',
  'flow_settings.saved_rebound':
    'Gespeichert. Der Socket wurde geschlossen und neu geöffnet; was in diesem Moment unterwegs ' +
    'war, wurde nicht erfasst.',
  'flow_settings.saved_not_listening':
    'Gespeichert, aber der Kollektor konnte sich nicht binden und hört NICHT zu. Der Port ist ' +
    'womöglich belegt, oder die Bindeadresse gibt es auf diesem Host nicht. Die Einstellung ist ' +
    'gespeichert und gilt beim nächsten Start; der Zustand unten ist der aktuelle.',
  'flow_settings.nothing_to_save': 'Es hat sich nichts geändert.',
  'flow_settings.pinned_note':
    'Durch {variable} in der Umgebung gesetzt. Entfernen Sie die Zeile und starten Sie die API ' +
    'neu, um dies hier zu verwalten.',
  'flow_settings.all_pinned': 'Jedes Feld hier ist in der Umgebung gesetzt',
  'flow_settings.all_pinned_note':
    'Diese Installation konfiguriert die Flusserfassung aus einer Datei, daher kann dieses ' +
    'Formular nichts ändern — genau die Garantie, für die es diese Anordnung gibt. Entfernen Sie ' +
    'die unter den Feldern genannten Variablen und starten Sie die API neu, um sie hier zu ' +
    'verwalten. Dabei geht nichts verloren: die Werte wurden beim ersten Start in die ' +
    'gespeicherten Einstellungen übernommen.',
  'flow_settings.group.everyday': 'Welche Absender angenommen werden',
  'flow_settings.group.socket': 'Der Socket',
  'flow_settings.group.socket_note':
    'Jede Änderung hier schließt den Socket und öffnet ihn neu; einige Sekunden werden dabei nicht ' +
    'erfasst. Die Liste oben braucht das nicht.',
  'flow_settings.exporters': 'Erlaubte Absender',
  'flow_settings.exporters_help':
    'Kommagetrennte Adressen. Leer nimmt jeden Absender an — für den ersten Lauf sinnvoll, um sie ' +
    'zu finden, danach nicht: NetFlow kennt keine Authentifizierung, diese Liste ist die einzige ' +
    'Zugangskontrolle, und ein gefälschtes Datagramm fälscht einen Fund. Gilt sofort, ohne ' +
    'Neubindung.',
  'flow_settings.enabled': 'Flussdaten erfassen',
  'flow_settings.port': 'UDP-Port',
  'flow_settings.port_help': '2055 ist der De-facto-NetFlow-Port; 4739 ist der IANA-Port für IPFIX.',
  'flow_settings.bind_address': 'Bindeadresse',
  'flow_settings.bind_address_help':
    '0.0.0.0 hört auf allen Schnittstellen. Im Container muss es das sein — ein veröffentlichter ' +
    'Port wird auf die Schnittstelle des Containers geleitet, nicht auf sein Loopback.',
  'flow_settings.port_published': 'Unter Docker liegt der veröffentlichte Port in einer eigenen Datei',
  'flow_settings.port_published_note':
    'Eine Änderung hier bindet den Socket im Container neu. Sie ändert nicht, was Docker ' +
    'weiterleitet — das veröffentlicht docker-compose.flow.yml — die Erfassung würde also aufhören, ' +
    'und jeder Zähler läse sich genau wie ein Gerät, das nicht sendet. Ändern Sie stattdessen ' +
    'FLOW_PORT für den Stack und deployen Sie neu. Ob Sie unter Docker laufen, kann dieser Hinweis ' +
    'nicht wissen; wenn nicht, ist der Port hier die ganze Geschichte.',

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
  'dashboard.total_all_time': '{count, number} insgesamt, seit Beginn',
  'dashboard.capture_running': 'Läuft',
  'dashboard.capture_idle': 'Inaktiv',
  'dashboard.pcap_unavailable': 'pcap-Bibliothek nicht verfügbar',
  'dashboard.no_capture': 'Keine Aufzeichnung gestartet',
  'dashboard.per_hour': 'Nach Schweregrad, pro Stunde',
  'dashboard.per_day': 'Nach Schweregrad, pro Tag',
  'dashboard.per_week': 'Nach Schweregrad, pro Woche',
  'dashboard.per_month': 'Nach Schweregrad, pro Monat',
  'dashboard.hours_count': '{count, plural, one {# Stunde} other {# Stunden}}',
  'dashboard.days_count': '{count, plural, one {# Tag} other {# Tage}}',
  'dashboard.weeks_count': '{count, plural, one {# Woche} other {# Wochen}}',
  'dashboard.months_count': '{count, plural, one {# Monat} other {# Monate}}',
  'dashboard.occurrences': '{count, plural, one {# Vorkommen} other {# Vorkommen}}',
  'common.never': 'nie',
  'suppressions.preview_none': 'Keine der letzten {examined, number} Meldungen entspricht dieser Regel.',
  'suppressions.preview_matched':
    'Hätte {matched, number} der letzten {examined, number} Meldungen ausgeblendet — {occurrences, number} Beobachtungen insgesamt.',
  'suppressions.preview_window': 'Untersucht von {from} bis {to}',

  'capture.resume': 'Fortsetzen',
  'capture.interrupted_note_auto':
    'Der Mitschnitt auf {interface} endete unerwartet. Der Dienst hatte ihn um {at} ' +
    'automatisch fortgesetzt; er läuft derzeit nicht.',
  'capture.interrupted_note_anon':
    'Der Mitschnitt auf {interface} endete unerwartet. Er wurde um {at} gestartet und läuft ' +
    'derzeit nicht.',
  'capture.interrupted_note':
    'Der Mitschnitt auf {interface} endete unerwartet. Er wurde von {by} um {at} gestartet ' +
    'und läuft derzeit nicht.',
  'capture.unavailable_note':
    'Live-Aufzeichnung ist auf dem Server nicht verfügbar: Die Paketaufzeichnungsbibliothek konnte ' +
    'nicht geladen werden. Installieren Sie Npcap (Windows) oder libpcap (Linux/macOS) und starten ' +
    'Sie die API neu. Alles andere auf dieser Seite funktioniert weiterhin.',
  'capture.dropped': '{count, number} ältere Pakete aus dem Puffer verworfen',
  'packets.non_ip_hidden': '{count, number} Nicht-IP ausgeblendet',
  'capture.loading_interfaces': 'Schnittstellen werden geladen…',
  'capture.no_interfaces': 'Der Server meldet keine Schnittstellen',
  'capture.hide_settings': 'Aufzeichnungseinstellungen ausblenden',
  'capture.show_settings': 'Aufzeichnungseinstellungen anzeigen',
  'capture.link_type': 'Verbindung: {type}',
  'intel.reloading': 'Wird neu geladen…',
  'intel.reload_feeds': 'Quellen neu laden',
  'intel.origin.network': 'Live',
  'intel.origin.network_hint': 'Beim letzten Aktualisieren heruntergeladen — diese Quelle ist aktuell.',
  'intel.origin.cache': 'Zwischengespeichert',
  'intel.origin.cache_hint':
    'Der Download ist fehlgeschlagen, daher wurde die zuletzt gespeicherte Kopie verwendet. Die ' +
    'Erkennung funktioniert weiterhin, aber diese Indikatoren sind so alt wie der letzte ' +
    'erfolgreiche Abruf.',
  'intel.origin.file': 'Lokale Datei',
  'intel.origin.file_hint':
    'Von der Festplatte gelesen. Die Aktualität hängt von Ihrem eigenen Verfahren ab.',
  'intel.origin.failed': 'Fehlgeschlagen',
  'intel.origin.failed_hint':
    'Aus dieser Quelle konnte nichts geladen werden. Ihre Indikatoren werden überhaupt nicht ' +
    'abgeglichen.',
  'intel.subdomain_note':
    'Ein Domain-Indikator deckt auch seine Subdomains ab. Private und reservierte Adressen werden ' +
    'beim Laden abgelehnt, was eine Quelle auch behauptet — eine falsch gelistete würde bei jedem ' +
    'Host zugleich Alarm auslösen.',
  'intel.enable_hint': 'Zum Einschalten hinzufügen zu',
  'intel.off_note':
    'Es wird nichts gegen bekannt bösartige Adressen oder Domains abgeglichen. Standardmäßig ' +
    'ausgeschaltet, weil die Entscheidung, welchen Daten zu trauen ist, Ihnen gehört — und ein ' +
    'Sicherheitswerkzeug sollte nicht von sich aus Anfragen an eine Liste stellen, die niemand ' +
    'gewählt hat.',
  'intel.local_file_note':
    'Ein lokaler Dateipfad funktioniert ebenfalls und ist die richtige Wahl, wenn dieser Host keinen ' +
    'ausgehenden Internetzugang hat.',

  // --- Unterdrückungsregeln, Zustellungsstatus und Quellenzustand ---

  'suppressions.state.active': 'Aktiv',
  'suppressions.state.active_hint':
    'Funde, die dieser Regel entsprechen, werden verworfen, bevor sie gespeichert werden.',
  'suppressions.state.disabled': 'Aus',
  'suppressions.state.disabled_hint':
    'Ausgeschaltet. Passende Funde werden normal gespeichert und zugestellt.',
  'suppressions.state.expired': 'Abgelaufen',
  'suppressions.state.expired_hint':
    'Der Ablauf ist überschritten, daher unterdrückt diese Regel nichts mehr. Verlängern oder ' +
    'löschen Sie sie.',
  'suppressions.state.invalid': 'Ungültig',
  'suppressions.state.invalid_hint':
    'Der Server konnte den Adressbereich dieser Regel nicht auswerten, daher trifft sie auf nichts ' +
    'zu. Korrigieren Sie den Bereich — Funde, die Sie für unterdrückt halten, sind es nicht.',
  'suppressions.enabled_toast': 'Regel #{id} ist an. Passende Funde werden verworfen.',
  'suppressions.disabled_toast': 'Regel #{id} ist aus. Passende Funde werden wieder gespeichert.',
  'suppressions.update_failed': 'Die Regel konnte nicht aktualisiert werden',
  'suppressions.deleted_toast': 'Regel gelöscht.',
  'suppressions.delete_failed': 'Die Regel konnte nicht gelöscht werden',
  'suppressions.confirm_delete':
    'Regel #{id} löschen? Ihr Nachweis über {count, number} ausgeblendete Funde geht mit. Ausschalten ' +
    'behält beides.',
  'suppressions.read_failed': 'Die Unterdrückungsregeln konnten nicht gelesen werden',
  'suppressions.invalid_warning':
    '{count, plural, one {# Regel kann} other {# Regeln können}} auf nichts zutreffen, daher werden ' +
    'Funde, die Sie für unterdrückt halten, nicht unterdrückt:',
  'suppressions.created_toast': 'Regel #{id} erstellt und in Kraft.',
  'suppressions.updated_toast': 'Regel #{id} aktualisiert.',
  'suppressions.added_by': ' · hinzugefügt von ',
  'suppressions.edit_rule': 'Regel {id} bearbeiten',
  'suppressions.switch_off_hint': 'Ausschalten — passende Funde kehren zurück',
  'suppressions.switch_on_hint': 'Einschalten',
  'suppressions.toggle_rule': 'Regel {id} {enabled, select, true {deaktivieren} other {aktivieren}}',
  'suppressions.delete_rule': 'Regel {id} löschen',
  'suppressions.in_force_count': '{count} in Kraft',
  'suppressions.search': 'Regeln durchsuchen',
  'suppressions.check_failed': 'Die Regel konnte nicht geprüft werden',
  'suppressions.save_failed': 'Die Regel konnte nicht gespeichert werden',
  'suppressions.edit_title': 'Regel #{id} bearbeiten',
  'suppressions.new_title': 'Neue Unterdrückungsregel',
  'suppressions.dialog_note':
    'Ein Fund wird unterdrückt, wenn er jedem ausgefüllten Feld entspricht. Ein leeres Feld ' +
    'bedeutet „beliebig“. Unterdrückte Funde werden verworfen, sodass nachgelagert nichts — weder ' +
    'die Meldungsliste noch der Webhook noch der SIEM-Datenstrom — sie je zu sehen bekommt.',
  'suppressions.cidr_placeholder': '10.20.30.40 oder 10.20.30.0/24',
  'suppressions.checking': 'Wird geprüft…',
  'suppressions.check_against': 'Gegen aktuelle Meldungen prüfen',
  'suppressions.unknown_source': 'unbekannt',
  'suppressions.saving': 'Wird gespeichert…',
  'suppressions.save_changes': 'Änderungen speichern',
  'suppressions.create_rule': 'Regel erstellen',

  'delivery.gate.throttle_note':
    'Derselbe Fund löst innerhalb dieses Zeitraums keine weitere Benachrichtigung aus.',
  'delivery.gate.ceiling_note':
    'Eine harte Obergrenze für Nachrichten pro Stunde, unabhängig von der Erkennung.',
  'delivery.test_partial': 'An {delivered} zugestellt. Fehlgeschlagen: {failures}',
  'delivery.test_ok': 'An {delivered} Kanal/Kanäle zugestellt. Prüfen Sie, ob jeder davon angekommen ist.',
  'delivery.test_failed': 'Testversand fehlgeschlagen',
  'delivery.sending': 'Wird gesendet…',
  'delivery.send_test': 'Test senden',
  'delivery.status_failed': 'Der Zustellungsstatus konnte nicht gelesen werden',
  'delivery.nothing_configured':
    'Nichts ist konfiguriert, daher werden Funde aufgezeichnet und niemand wird benachrichtigt.',
  'delivery.nothing_configured_admin':
    ' Legen Sie unter dem Einstellungs-Zahnrad einen Collector-Host, eine Webhook-URL oder einen ' +
    'SMTP-Host mit Empfängern fest — keine Datei zu bearbeiten und kein Neustart.',
  'delivery.nothing_configured_user':
    ' Eine Administratorin oder ein Administrator kann einen Webhook, E-Mail oder einen ' +
    'Syslog-Collector einrichten.',
  'delivery.switched_off':
    'Kanäle sind konfiguriert, aber die Zustellung ist ausgeschaltet, daher wird keine Meldung ' +
    'gesendet.',
  'delivery.switched_off_admin': ' Schalten Sie „Alarme zustellen“ unter dem Einstellungs-Zahnrad ein.',
  'delivery.test_still_works':
    ' Ein Testversand funktioniert weiterhin — er umgeht dies absichtlich, denn die Frage, die er ' +
    'beantwortet, ist, ob die Zustellung Sie überhaupt erreicht.',
  'delivery.syslog_unaffected': ' Syslog ist davon unberührt: Es ist von diesem Schalter unabhängig.',
  'delivery.channel.webhook': 'Webhook',
  'delivery.channel.webhook_hint': 'Slack, Teams, Discord oder einfaches JSON',
  'delivery.channel.webhook_format': 'Format {format}',
  'delivery.channel.email': 'E-Mail',
  'delivery.channel.email_hint': 'SMTP-Host, Absender und mindestens ein Empfänger',
  'delivery.channel.recipients': '{count, plural, one {# Empfänger} other {# Empfänger}}',
  'delivery.channel.syslog': 'Syslog',
  'delivery.channel.syslog_hint': 'Setzen Sie SYSLOG_HOST, um es einzuschalten',
  'delivery.four_limits':
    'Vier Grenzen greifen, bevor etwas gesendet wird. Jede davon ist auch ein Grund, warum eine ' +
    'erwartete Meldung nicht ankam — deshalb stehen sie hier und nicht vergraben in einer ' +
    'Konfigurationsdatei.',
  'delivery.siem_note':
    'Keine der Grenzen links gilt hier. Ein SIEM korreliert und dedupliziert selbst, und tut das ' +
    'unter der Annahme, den vollständigen Ereignisstrom zu haben — eine Bündelung lässt jede Regel, ' +
    'die Ereignisse über ein Zeitfenster zählt, stillschweigend zu wenig melden und macht ' +
    'unterdrückte Ereignisse zu scheinbar ruhigen Phasen.',
  'delivery.included': 'enthalten',
  'delivery.omitted': 'weggelassen',
  'delivery.configured': 'Konfiguriert',
  'delivery.off': 'Aus',
  'delivery.saved': 'Gespeichert. Die Änderung ist bereits in Kraft — kein Neustart nötig.',
  'delivery.save_failed': 'Die Einstellungen konnten nicht gespeichert werden',
  'delivery.tls_587':
    'Port 587 mit implizitem TLS hängt, bis die Verbindung abläuft: 587 erwartet STARTTLS. ' +
    'Verwenden Sie Port 465 oder schalten Sie implizites TLS aus.',
  'delivery.tls_465':
    'Port 465 erwartet implizites TLS ab dem ersten Byte. Schalten Sie implizites TLS ein oder ' +
    'verwenden Sie Port 587.',
  'delivery.all_pinned_note':
    'Jedes geänderte Feld ist jetzt in der Umgebung gesetzt und kann nicht gespeichert werden. ' +
    'Verwerfen Sie, um diese Änderungen zu löschen.',
  'delivery.unsaved': '{count} nicht gespeichert',
  'delivery.saving': 'Wird gespeichert…',
  'delivery.save_changes': 'Änderungen speichern',
  'delivery.pinned_note':
    '{count, plural, one {# Einstellung ist} other {# Einstellungen sind}} in der Umgebung gesetzt ' +
    'und können hier nicht geändert werden. Entfernen Sie die Variable aus api/.env (oder Ihrer ' +
    'Compose-Datei), um sie von dieser Seite aus zu verwalten.',
  'delivery.secret_stored_unused': 'gespeichert und von der aktuellen Methode nicht verwendet',
  'delivery.secret_configured': 'konfiguriert — tippen zum Ersetzen',
  'delivery.secret_unset': 'nicht konfiguriert',
  'delivery.secret_unused_note':
    'Die aktuelle Authentifizierungsmethode verwendet dies nicht. Es ist weiterhin gespeichert — ' +
    'löschen Sie es, sofern Sie nicht zurückwechseln wollen.',
  'delivery.set_not_set': 'Nicht gesetzt',
  'delivery.pinned_by': 'Durch {name} gesetzt. Entfernen Sie es aus api/.env, um es hier zu bearbeiten.',
  'delivery.the_environment': 'die Umgebung',
  'delivery.environment': 'Umgebung',

  'intel.health_failing': '{count} fehlgeschlagen',
  'intel.health_stale': '{count} auf einer zwischengespeicherten Kopie',
  'intel.health_ok': 'alle geladen',
  'intel.reloaded_toast': '{count, number} Indikatoren aus {feeds} Quelle(n) neu geladen.',
  'intel.reload_failed': 'Neuladen fehlgeschlagen',
  'intel.status_failed': 'Der Status der Bedrohungsdaten konnte nicht gelesen werden',
  'intel.no_feeds_body':
    'Bedrohungsdaten sind eingeschaltet, aber es sind keine Quellen konfiguriert, daher wird nichts ' +
    'abgeglichen. Setzen Sie',
  'intel.no_feeds_tail': 'auf ein oder mehrere name=ort-Paare.',
  'intel.failed_feeds':
    '{count, plural, one {# Quelle konnte} other {# Quellen konnten}} überhaupt nicht geladen ' +
    'werden: {names}. Deren Indikatoren werden nicht abgeglichen.',
  'intel.stale_feeds':
    '{count, plural, one {# Quelle ist} other {# Quellen sind}} auf eine zwischengespeicherte Kopie ' +
    'zurückgefallen: {names}. Die Erkennung funktioniert weiterhin, aber diese Indikatoren sind nur ' +
    'so aktuell wie der letzte erfolgreiche Download.',
  'intel.search': 'Quellen durchsuchen',

  // --- Prüfprotokoll, Meldungen und Konsole ---

  'audit.empty_failed':
    'Das Protokoll konnte nicht gelesen werden — das ist also keine Aussage darüber, dass nichts ' +
    'geschehen ist.',
  'audit.empty_none':
    'Es wurde noch nichts gelöscht, geändert oder umgeleitet. Einträge erscheinen hier, sobald es ' +
    'so weit ist.',
  'audit.empty_for_action': 'Keine Einträge für diese Aktion.',
  'audit.admin_only':
    'Das Prüfprotokoll ist für Administratoren sichtbar. Es hält fest, wer etwas gelöscht, ' +
    'geändert oder umgeleitet hat, und nennt Konten.',
  'audit.filter_by_action': 'Nach Aktion filtern',
  'audit.load_failed': 'Das Prüfprotokoll konnte nicht geladen werden',
  'audit.actions_failed':
    'Die Aktionsliste konnte nicht geladen werden — das Filtern nach Aktion ist nicht verfügbar',
  'audit.loading_more': 'Wird geladen…',
  'audit.load_older': 'Ältere Einträge laden',

  'alerts.load_failed': 'Die Meldungen konnten nicht geladen werden',
  'alerts.summary_failed': 'Die Meldungsübersicht konnte nicht geladen werden',
  'alerts.update_failed': 'Die Meldung konnte nicht aktualisiert werden',
  'alerts.delete_failed': 'Die Meldung konnte nicht gelöscht werden',
  'alerts.delete_finding': 'Fund {id} löschen',
  'alerts.suppress_finding': 'Funde wie Fund {id} unterdrücken',
  'alerts.suppressed_toast':
    'Regel {id} gilt ab jetzt für neue Funde. An dieser Liste ändert sich nichts — eine ' +
    'Unterdrückung verwirft einen Fund beim Erfassen, Gespeichertes bleibt. Was sie ab jetzt ' +
    'abfängt, zählt die Seite Unterdrückungen.',
  'alerts.this_sensor': ' (dieser)',
  'alerts.empty_body':
    'Keine Funde entsprechen diesen Filtern. Eine leere Liste während einer Aufzeichnung bedeutet, ' +
    'dass die Prüfungen nichts Verdächtiges gesehen haben — das erwartete Ergebnis in einem ' +
    'gesunden Netz.',
  'alerts.yes': 'ja',
  'alerts.no': 'nein',
  'alerts.evidence_more': '{shown} und {count} weitere',

  'adhoc.admin_only': 'Die Abfragekonsole steht nur Administratoren zur Verfügung.',
  'adhoc.availability_failed':
    'Der Server konnte nicht gefragt werden, ob die Abfragekonsole verfügbar ist. {detail}',
  'adhoc.hide_query': 'Abfrage ausblenden',
  'adhoc.show_query': 'Abfrage anzeigen',
  'adhoc.running': 'Läuft',
  'adhoc.run': 'Ausführen',
  'adhoc.shortcut_note':
    'Strg/Cmd + Enter führt ebenfalls aus. Schreibzugriffe und die Spalten mit Geheimnissen werden ' +
    'von der Datenbank abgelehnt, nicht von dieser Seite.',
  'adhoc.rows_affected': '{command} — {count, plural, one {# Zeile} other {# Zeilen}} betroffen in {ms} ms',
  'adhoc.rows_in': '{count, plural, one {# Zeile} other {# Zeilen}} in {ms} ms',

  'packets.search': 'Pakete durchsuchen',
  'packets.frame_data': 'Frame-Daten ({bytes} Bytes)',
  'packets.no_frame_data': 'Keine Frame-Daten aufgezeichnet',
  'packets.padding': 'Ethernet-Auffüllung ({bytes} Bytes)',
  'packets.no_padding': 'Keine Auffüllung in diesem Frame',
  'packets.waiting': 'Warte auf Pakete…',
  'packets.none_yet':
    'Noch keine Pakete aufgezeichnet. Wählen Sie eine Schnittstelle und starten Sie eine ' + 'Aufzeichnung.',
  'capture.start_failed': 'Die Aufzeichnung konnte nicht gestartet werden',
  'capture.stop_failed': 'Die Aufzeichnung konnte nicht gestoppt werden',
  'capture.clear_failed': 'Die aufgezeichneten Pakete konnten nicht geleert werden',
  'capture.interfaces_failed': 'Die Netzwerkschnittstellen konnten nicht geladen werden',
  'capture.packets_failed': 'Die aufgezeichneten Pakete konnten nicht abgerufen werden',
  'capture.filter_chip': 'Filter: {filter}',
  'capture.findings_chip': '{count, plural, one {# Fund} other {# Funde}} — Meldungen ansehen',

  'ipinfo.postal_code': 'Postleitzahl',
  'ipinfo.timezone': 'Zeitzone',
  'ipinfo.isp': 'ISP',
  'ipinfo.organization': 'Organisation',
  'ipinfo.lookup_of_failed': '{ipAddress} konnte nicht abgefragt werden',
  'login.failed': 'Anmeldung fehlgeschlagen',
  'signup.create_failed': 'Das Konto konnte nicht erstellt werden',
  'signup.min_length': 'Mindestens {count} Zeichen',
  'signup.mismatch': 'Die Passwörter stimmen nicht überein',
  'signup.on_the_server': 'auf dem Server.',
  'common.account': 'Konto',
  'common.nothing_to_show': 'Nichts anzuzeigen.',
  'common.something_wrong': 'Etwas ist schiefgelaufen',

  // --- Administrationsmenü ---

  'admin.group.database': 'Datenbank',
  'admin.group.notifications': 'Benachrichtigungen',
  'admin.group.accounts': 'Konten',
  'admin.tool.console_settings': 'Einstellungen der Abfragekonsole',
  'admin.tool.console_settings_desc': 'Ein- oder ausschalten und ihre Grenzen setzen, ohne Neustart.',
  'admin.tool.delivery': 'Zustellungseinstellungen',
  'admin.tool.delivery_desc': 'Wohin Funde gehen und wie oft. Beim Speichern in Kraft.',
  'admin.group.collection': 'Erfassung',
  'admin.tool.flow': 'Einstellungen der Flusserfassung',
  'admin.tool.flow_desc': 'Welche Absender angenommen werden, und der Socket. Gilt ab Speichern.',
  'admin.group.sensors': 'Sensoren',
  'admin.tool.decommission': 'Sensor außer Betrieb nehmen',
  'admin.tool.decommission_desc':
    'Alles löschen, was ein stillgelegter Sensor erfasst hat. Unumkehrbar und protokolliert.',
  'admin.tool.users': 'Benutzer und Rollen',
  'admin.tool.users_desc': 'Wer Administrator ist. Im Prüfprotokoll festgehalten.',

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
  'period.5y': 'Letzte 5 Jahre',
  'period.all': 'Gesamter Zeitraum',
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
  'packets.shown': '{count, number} angezeigt',
  'common.clear': 'Leeren',
  'grid.page_range': '{start, number}–{end, number} von {total, number}',
  'grid.page_range_filtered': '{range}, gefiltert aus {unfiltered, number}',
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
  'chart.detail_from_here': 'Details ab hier gespeichert',
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

  // --- Sensor außer Betrieb nehmen ---

  'sensors.loading': 'Server wird abgefragt…',
  'sensors.load_failed': 'Die Sensoren konnten nicht gelesen werden',
  'sensors.retire_failed': 'Der Sensor konnte nicht außer Betrieb genommen werden',
  'sensors.none':
    'Kein anderer Sensor hat etwas in diese Datenbank geschrieben. Diese Installation steht nicht ' +
    'in der Liste, weil sie weiterhin schreibt — eine Außerbetriebnahme würde Tabellen leeren, ' +
    'die sich sofort wieder füllen.',
  'sensors.col_sensor': 'Sensor',
  'sensors.col_findings': 'Funde',
  'sensors.col_devices': 'Geräte',
  'sensors.col_history': 'Aggregierte Tage',
  'sensors.col_last_seen': 'Zuletzt gesehen',
  'sensors.last_seen_never': 'nie',
  'sensors.active': 'schreibt noch',
  'sensors.active_hint':
    'Unter diesem Namen schreibt noch etwas. Eine Außerbetriebnahme würde Tabellen leeren, die ' +
    'sich wieder füllen, und eine geleerte Geräteliste meldet jedes Gerät in seinem Segment ' +
    'erneut als neu. Halten Sie diesen Sensor an, oder warten Sie, bis er ruhig ist.',
  'sensors.retire': 'Außer Betrieb nehmen',
  'sensors.retire_sensor': 'Sensor {sensor} außer Betrieb nehmen',
  'sensors.confirm_retire': 'Ja, alles löschen',
  'sensors.confirm_body':
    'Dies löscht dauerhaft {alerts, plural, one {# Fund} other {# Funde}}, ' +
    '{devices, plural, one {# Gerät} other {# Geräte}} und ' +
    '{buckets, plural, one {# aggregierten Tag} other {# aggregierte Tage}}, die unter {sensor} ' +
    'erfasst wurden, samt seiner Mitschnitt-Sitzung. Es gibt kein Zurück: der Protokolleintrag ' +
    'ist, was bleibt.',
  'sensors.retired_toast':
    '{sensor} ist außer Betrieb: {alerts, plural, one {# Fund} other {# Funde}}, ' +
    '{devices, plural, one {# Gerät} other {# Geräte}} und ' +
    '{buckets, plural, one {# aggregierter Tag} other {# aggregierte Tage}} entfernt.',
  'sensors.audit_note':
    'Im Prüfprotokoll erfasst, mit der ausführenden Person und der entfernten Menge. Dieser ' +
    'Eintrag ist danach der einzige Nachweis, dass der Sensor existiert hat, und das Protokoll ' +
    'lässt sich nicht bereinigen.',

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
};
