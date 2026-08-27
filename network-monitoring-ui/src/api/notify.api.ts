import type {
  DeliverySettingsPatch,
  DeliverySettingsResponse,
  NotifyStatus,
  NotifyTestResult,
} from '../types';
import { api } from './client';

/**
 * Delivery status and a test send.
 *
 * The test endpoint is the reason this exists. Notification config fails
 * silently by nature — a wrong webhook URL, a wrong SMTP password, a syslog
 * target pointed at a collector that was decommissioned — and none of it
 * produces an error anyone sees until the night an alert does not arrive.
 * Proving delivery during setup is the difference between configured and
 * working.
 */
export async function fetchNotifyStatus(): Promise<NotifyStatus> {
  const { data } = await api.get<NotifyStatus>('/api/notify/status');
  return data;
}

/** Sends a test message to every configured channel. Admin only. */
export async function sendNotifyTest(): Promise<NotifyTestResult> {
  const { data } = await api.post<NotifyTestResult>('/api/notify/test');
  return data;
}

/**
 * Every delivery setting, with where each came from.
 *
 * The provenance is not decoration: `pinnedByEnvironment` is what tells the form
 * which controls to disable. Readable by any authenticated account, on the same
 * reasoning as the alert list — someone who can see every finding can see how
 * delivery is configured — and the two credentials are never included.
 */
export async function fetchDeliverySettings(): Promise<DeliverySettingsResponse> {
  const { data } = await api.get<DeliverySettingsResponse>('/api/notify/settings');
  return data;
}

/**
 * Changes stored settings. Admin only.
 *
 * Send only what changed. A field omitted is left alone, which is how a secret the
 * API never sent us stays untouched; a field sent as null is cleared back to the
 * environment or the default. Sending a field the environment pins is refused with a
 * 409, so the form does not offer to.
 */
export async function saveDeliverySettings(patch: DeliverySettingsPatch): Promise<DeliverySettingsResponse> {
  const { data } = await api.put<DeliverySettingsResponse>('/api/notify/settings', patch);
  return data;
}
