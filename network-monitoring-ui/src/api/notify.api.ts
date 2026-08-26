import type { NotifyStatus, NotifyTestResult } from '../types';
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
