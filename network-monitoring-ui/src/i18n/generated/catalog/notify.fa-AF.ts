// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
import type { PartialNotifyCatalog } from './notify.en';

/**
 * The outbound notification wrapper in Dari.
 *
 * Machine-drafted and pending review by a native speaker — more urgently than the
 * German, since nobody on the team reads it. Keys absent here fall back to the
 * English pattern per key.
 *
 * Interpolated identifiers are bidi-isolated by the renderer rather than here.
 */
export const NOTIFY_FA_AF: PartialNotifyCatalog = {
  'notify.subject_one': '{prefix}[{severity}] {title}',
  'notify.subject_many': '{prefix}{count, number} یافتهٔ شبکه — {breakdown}',
  'notify.subject_fallback': 'یافتهٔ شبکه',
  'notify.summary_one': 'Network Monitoring یک یافتهٔ {severity} ثبت کرد.',
  'notify.summary_many': 'Network Monitoring {count, number} یافته ثبت کرد: {breakdown}.',
  'notify.severity.critical': 'بحرانی',
  'notify.severity.high': 'زیاد',
  'notify.severity.medium': 'متوسط',
  'notify.severity.low': 'کم',
  'notify.severity.info': 'اطلاعی',
  'notify.label_sensor': 'حسگر',
  'notify.label_source': 'مبدأ',
  'notify.label_target': 'مقصد',
  'notify.label_occurrences': 'دفعات',
  'notify.label_last_seen': 'آخرین مشاهده',
  'notify.label_evidence': 'شواهد',
  'notify.severity_count': '{count, number} {severity}',
  'notify.test_banner_text': 'این یک اطلاع‌رسانی آزمایشی از Network Monitoring است. هیچ یافته‌ای در کار نیست.',
  'notify.test_banner_html': 'این یک اطلاع‌رسانی آزمایشی است. هیچ یافته‌ای در کار نیست.',
  'notify.meta_sensor': 'حسگر {sensor}',
  'notify.meta_source': 'مبدأ {source}',
  'notify.meta_target': 'مقصد {target}',
  'notify.meta_occurrences': '{count, plural, one {# رخداد} other {# رخداد}}',
  'notify.meta_last_seen': 'آخرین مشاهده {at} UTC',
  'notify.evidence_prefix': 'شواهد: {evidence}',
  'notify.and_more_text': '…و {count, number} مورد دیگر. برای فهرست کامل داشبورد را باز کنید.',
  'notify.and_more': '…و {count, number} مورد دیگر.',
  'notify.open_dashboard': 'باز کردن داشبورد',
  'notify.open_dashboard_short': 'باز کردن داشبورد',
};
