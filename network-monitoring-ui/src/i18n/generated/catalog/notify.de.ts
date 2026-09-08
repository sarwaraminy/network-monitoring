// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
import type { PartialNotifyCatalog } from './notify.en';

/**
 * The outbound notification wrapper in German.
 *
 * Machine-drafted and pending review by a native speaker, like the other two.
 * Keys absent here fall back to the English pattern per key.
 */
export const NOTIFY_DE: PartialNotifyCatalog = {
  'notify.subject_one': '{prefix}[{severity}] {title}',
  'notify.subject_many': '{prefix}{count, number} Netzwerkfunde — {breakdown}',
  'notify.subject_fallback': 'Netzwerkfund',
  'notify.summary_one': 'Network Monitoring hat 1 Fund der Stufe {severity} gemeldet.',
  'notify.summary_many': 'Network Monitoring hat {count, number} Funde gemeldet: {breakdown}.',
  'notify.severity.critical': 'kritisch',
  'notify.severity.high': 'hoch',
  'notify.severity.medium': 'mittel',
  'notify.severity.low': 'niedrig',
  'notify.severity.info': 'Information',
  'notify.label_sensor': 'Sensor',
  'notify.label_source': 'Quelle',
  'notify.label_target': 'Ziel',
  'notify.label_occurrences': 'Vorkommen',
  'notify.label_last_seen': 'Zuletzt gesehen',
  'notify.label_evidence': 'Nachweis',
  'notify.severity_count': '{count, number} {severity}',
  'notify.test_banner_text':
    'Dies ist eine Testbenachrichtigung von Network Monitoring. Es sind keine Funde beteiligt.',
  'notify.test_banner_html': 'Dies ist eine Testbenachrichtigung. Es sind keine Funde beteiligt.',
  'notify.meta_sensor': 'Sensor {sensor}',
  'notify.meta_source': 'Quelle {source}',
  'notify.meta_target': 'Ziel {target}',
  'notify.meta_occurrences': '{count, plural, one {# Vorkommen} other {# Vorkommen}}',
  'notify.meta_last_seen': 'zuletzt gesehen {at} UTC',
  'notify.evidence_prefix': 'Belege: {evidence}',
  'notify.and_more_text':
    '…und {count, number} weitere. Öffnen Sie das Dashboard für die vollständige Liste.',
  'notify.and_more': '…und {count, number} weitere.',
  'notify.open_dashboard': 'Dashboard öffnen',
  'notify.open_dashboard_short': 'Dashboard öffnen',
};
