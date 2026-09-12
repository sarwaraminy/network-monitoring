// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
import type { PartialErrorCatalog } from './errors.en';

/**
 * The error catalogue in German.
 *
 * Machine-drafted and pending review by a native speaker, like the finding
 * catalogue. Keys absent here fall back to the English pattern per key.
 *
 * `error.validation`'s `detail` stays English on purpose — it is the joined output
 * of the zod schemas. See the note in errors.en.ts.
 */
export const ERRORS_DE: PartialErrorCatalog = {
  // --- Validierung ---

  'error.validation': 'Die Anfrage ist ungültig: {detail}',
  'error.invalid_id': 'id muss eine positive ganze Zahl sein',
  'error.invalid_account_id': 'Das ist keine Konto-ID.',
  'error.invalid_mac': 'mac muss eine MAC-Adresse sein',
  'error.invalid_ip': 'Keine gültige IP-Adresse: {value}',
  'error.ip_required': 'ipAddress ist erforderlich',
  'error.interface_required': 'interfaceName ist erforderlich',
  'error.since_unparseable':
    '„since“ konnte nicht gelesen werden: Verwenden Sie ein ISO-Datum oder einen Zeitraum wie 24h',
  'error.body_not_json': 'Der Anfragetext ist kein gültiges JSON',
  'error.no_route': 'Keine Route für {method} {path}',

  // --- Nicht gefunden ---

  'error.alert_not_found': 'Kein Fund mit der id {id}',
  'error.suppression_not_found': 'Keine Unterdrückungsregel mit der id {id}',
  'error.account_not_found': 'Kein solches Konto.',
  'error.device_not_found': 'Kein bekanntes Gerät {mac}',
  'error.sensor_not_found':
    'Unter Sensor {sensor} ist nichts erfasst: keine Funde, keine Geräte und keine ' +
    'aggregierte Historie. Es gibt nichts außer Betrieb zu nehmen.',
  'error.device_not_on_sensor':
    'Kein bekanntes Gerät {mac} auf Sensor {sensor}. Bekannt ist es auf: {sensors}.',
  'error.interface_not_found': 'Keine solche Schnittstelle gefunden: {name}',

  // --- Konflikte ---

  'error.device_ambiguous':
    '{mac} ist mehr als einem Sensor bekannt ({sensors}). Geben Sie mit ?sensor= an, welcher es ' +
    'vergessen soll.',
  'error.last_administrator':
    'Dies ist die letzte administrierende Person; ernennen Sie zuerst ein anderes Konto.',
  'error.sensor_still_active':
    '{sensor} wurde zuletzt um {lastSeen} gehört; unter diesem Namen schreibt also noch etwas. ' +
    'Eine Außerbetriebnahme würde Tabellen leeren, die sich wieder füllen, und eine geleerte ' +
    'Geräteliste meldet jedes Gerät in seinem Segment erneut als neu. Halten Sie diesen Sensor ' +
    'zuerst an, oder warten Sie, bis er ruhig ist.',
  'error.sensor_decommission_busy':
    'Der Aufbewahrungslauf läuft und hält die benötigte Sperre, daher wurde {sensor} nicht ' +
    'angetastet. Es hat sich nichts geändert; versuchen Sie es in einigen Minuten erneut.',
  'error.sensor_is_self':
    '{sensor} ist diese Installation; sie schreibt weiterhin Funde und Geräte. Eine ' +
    'Außerbetriebnahme würde Tabellen leeren, die sich sofort wieder füllen — und eine ' +
    'geleerte Geräteliste meldet jedes Gerät im Netz erneut als neu. Nehmen Sie einen ' +
    'stillgelegten Sensor außer Betrieb, oder löschen Sie stattdessen die Funde.',
  'error.capture_already_starting':
    'Auf dieser Schnittstelle startet bereits ein Mitschnitt. Warten Sie, bis er läuft, und prüfen Sie dann den Status.',
  'error.email_in_use': 'Die E-Mail-Adresse wird bereits verwendet.',
  'error.cannot_demote_self':
    'Sie können sich Ihre eigene Administratorrolle nicht entziehen. Bitten Sie eine andere ' +
    'administrierende Person darum.',
  'error.flow_saved_not_applied':
    'Die Einstellung wurde gespeichert und wird beim nächsten Start der API verwendet, konnte ' +
    'aber nicht auf den laufenden Kollektor angewendet werden. Die Erfassung läuft mit den ' +
    'bisherigen Einstellungen weiter.',
  'error.flow_pinned':
    'In der Umgebung gesetzt und hier nicht änderbar: {variables}. Entfernen Sie die Variable ' +
    'und starten Sie die API neu, um dies hier zu verwalten.',
  'error.adhoc_pinned':
    'In der Umgebung gesetzt und hier nicht änderbar: {variables}. Entfernen Sie die Variable und ' +
    'starten Sie die API neu, um sie auf dieser Seite zu verwalten.',
  'error.delivery_pinned':
    'In der Umgebung gesetzt und hier nicht änderbar: {variables}. Entfernen Sie die Variable aus ' +
    'api/.env (oder Ihrer Compose-Datei), um sie auf dieser Seite zu verwalten.',
  'error.no_suppression_criterion':
    'Eine Unterdrückungsregel braucht mindestens eines von Art, Quelle, Ziel oder Port. Eine Regel ' +
    'ohne jedes davon würde jeden Fund im Netzwerk verwerfen.',

  // --- Authentifizierung und Berechtigung ---

  'error.invalid_credentials': 'E-Mail-Adresse oder Passwort ist falsch.',
  'error.missing_authorization': 'Authorization-Header fehlt.',
  'error.not_authenticated': 'Nicht angemeldet.',
  'error.insufficient_permissions': 'Unzureichende Berechtigungen.',
  'error.too_many_logins':
    'Zu viele fehlgeschlagene Versuche. Warten Sie eine Minute und versuchen Sie es erneut.',
  'error.too_many_capture': 'Zu viele Steuerungsanfragen für die Aufzeichnung. Langsamer.',
  'error.too_many_lookups': 'Zu viele Abfrageanfragen. Langsamer.',
  'error.too_many_requests': 'Zu viele Anfragen. Langsamer.',
  'error.adhoc_disabled': 'Die Abfragekonsole ist auf diesem Server nicht aktiviert.',
  'error.adhoc_sql_type': 'Senden Sie die Abfrage als `sql`-Zeichenkette.',
  'error.adhoc_sql_empty': 'Geben Sie eine Abfrage ein.',
  'error.adhoc_sql_too_long': 'Abfragen sind auf {max} Zeichen begrenzt.',
  'error.adhoc_one_statement':
    'Führen Sie eine Anweisung nach der anderen aus — die Abfrage enthält mehr als eine.',
  'error.adhoc_timeout':
    'Die Abfrage lief länger als {ms} ms und wurde gestoppt. Grenzen Sie sie ein oder fügen Sie ein ' +
    'LIMIT hinzu.',
  'error.adhoc_busy':
    'Die Abfragekonsole ist ausgelastet — sie führt nur wenige Abfragen gleichzeitig aus. Versuchen ' +
    'Sie es gleich noch einmal.',
  'error.adhoc_denied_write':
    '{detail} — die Abfragekonsole schreibt nur die Betriebstabellen und kann weder das ' +
    'Prüfprotokoll noch die Konten noch die Spalten mit Geheimnissen berühren.',
  'error.adhoc_denied_read':
    '{detail} — die Abfragekonsole ist schreibgeschützt und kann keine Spalten mit Geheimnissen ' + 'lesen.',
  'error.adhoc_passthrough': '{detail}',
  'error.adhoc_failed': 'Die Abfrage konnte nicht ausgeführt werden.',
  'error.permission_denied': 'Zugriff verweigert.',
  'error.capture_enumerate': 'Die Netzwerkschnittstellen konnten nicht aufgelistet werden: {detail}',
  'error.capture_open': '{name} konnte nicht geöffnet werden: {detail}',
  'error.capture_filter': 'Der Aufzeichnungsfilter konnte nicht angewendet werden: {detail}',
  'error.intel_reload_running':
    'Ein Neuladen läuft bereits; die Indikatoren unten stammen aus dem vorherigen Ladevorgang.',
  'error.intel_reload_kept':
    'Das Neuladen ergab keinen brauchbaren Satz. Die zuvor geladenen Indikatoren bleiben in ' + 'Verwendung.',
  'error.guide_sign_in': 'Melden Sie sich an, um das Benutzerhandbuch zu lesen.',
  'error.token_invalid': 'Token ungültig oder abgelaufen.',
  'error.account_gone': 'Das Konto existiert nicht mehr.',
  'error.signup_admin_only': 'Nur eine administrierende Person kann Konten anlegen.',
  'error.signup_token_required':
    'Zum Anlegen eines Kontos ist ein Administrator-Token nötig. Verwenden Sie ' +
    '`npm run user -- create` auf dem Server, oder melden Sie sich als Administrator an.',

  // --- Mitschnitt ---

  'error.capture_install_npcap':
    'Die Paketmitschnitt-Bibliothek konnte nicht geladen werden. Installieren Sie Npcap von ' +
    'https://npcap.com/#download. ({detail})',
  'error.capture_install_libpcap':
    'Die Paketmitschnitt-Bibliothek konnte nicht geladen werden. Installieren Sie libpcap ' +
    '(zum Beispiel `sudo apt install libpcap0.8`). ({detail})',
  'error.no_delivery_channel':
    'Es ist kein Zustellkanal konfiguriert. Legen Sie eine Webhook-URL, einen Syslog-Host ' +
    'oder einen SMTP-Host mit Empfängern fest — auf dieser Seite oder in api/.env.',
  'error.email_oauth_incomplete':
    'E-Mail ist auf OAuth2 eingestellt, aber {settings} {count, plural, one {ist} other {sind}} ' +
    'nicht gesetzt, sodass sich das Postfach nicht anmelden kann. Ergänzen Sie diese Angaben ' +
    'auf dieser Seite, oder stellen Sie die Authentifizierung zurück auf Passwort.',

  // --- Letzte Instanz ---

  'error.network_unreachable': 'Der API-Server ist nicht erreichbar. Läuft er?',
  'error.internal': 'Interner Serverfehler',
};
