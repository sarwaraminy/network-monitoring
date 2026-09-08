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
  'error.log_not_found': 'Kein Protokolleintrag mit der id {id}',
  'error.suppression_not_found': 'Keine Unterdrückungsregel mit der id {id}',
  'error.account_not_found': 'Kein solches Konto.',
  'error.device_not_found': 'Kein bekanntes Gerät {mac}',
  'error.device_not_on_sensor':
    'Kein bekanntes Gerät {mac} auf Sensor {sensor}. Bekannt ist es auf: {sensors}.',
  'error.interface_not_found': 'Keine solche Schnittstelle gefunden: {name}',

  // --- Konflikte ---

  'error.device_ambiguous':
    '{mac} ist mehr als einem Sensor bekannt ({sensors}). Geben Sie mit ?sensor= an, welcher es ' +
    'vergessen soll.',
  'error.last_administrator':
    'Dies ist die letzte administrierende Person; ernennen Sie zuerst ein anderes Konto.',
  'error.email_in_use': 'Die E-Mail-Adresse wird bereits verwendet.',
  'error.cannot_demote_self':
    'Sie können sich Ihre eigene Administratorrolle nicht entziehen. Bitten Sie eine andere ' +
    'administrierende Person darum.',
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

  'error.invalid_credentials': 'E-Mail-Adresse oder Passwort ist falsch',
  'error.missing_authorization': 'Authorization-Header fehlt.',
  'error.not_authenticated': 'Nicht angemeldet.',
  'error.insufficient_permissions': 'Unzureichende Berechtigungen.',
  'error.too_many_logins':
    'Zu viele fehlgeschlagene Versuche. Warten Sie eine Minute und versuchen Sie es erneut.',
  'error.too_many_capture': 'Zu viele Steuerungsanfragen für die Aufzeichnung. Langsamer.',
  'error.too_many_lookups': 'Zu viele Abfrageanfragen. Langsamer.',
  'error.too_many_requests': 'Zu viele Anfragen. Langsamer.',
  'error.token_invalid': 'Token ungültig oder abgelaufen.',
  'error.account_gone': 'Das Konto existiert nicht mehr.',
  'error.signup_admin_only': 'Nur eine administrierende Person kann Konten anlegen.',
  'error.signup_token_required':
    'Zum Anlegen eines Kontos ist ein Administrator-Token nötig. Verwenden Sie ' +
    '`npm run user -- create` auf dem Server, oder melden Sie sich als Administrator an.',

  // --- Mitschnitt ---

  'error.capture_unavailable': '{detail}',
  'error.capture_failed': '{context}: {detail}',

  // --- Letzte Instanz ---

  'error.network_unreachable': 'Der API-Server ist nicht erreichbar. Läuft er?',
  'error.internal': 'Interner Serverfehler',
  'error.unexpected': 'Unerwarteter Fehler',
};
