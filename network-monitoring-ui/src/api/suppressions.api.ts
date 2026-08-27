import type { SuppressionDraft, SuppressionListing, SuppressionPreview, SuppressionRule } from '../types';
import { api } from './client';

/**
 * Suppression rules.
 *
 * The preview call is the one worth explaining. Authoring a suppression is a
 * guess — "this covers the scanner" — and the cost of guessing wide is silence
 * rather than an error. `previewSuppression` turns the guess into a number
 * measured against alerts already stored, before the rule is saved, using the
 * server's own matching rather than a second implementation on this side.
 */
export async function fetchSuppressions(): Promise<SuppressionListing> {
  const { data } = await api.get<SuppressionListing>('/api/suppressions');
  return data;
}

/** Admin only. In force by the time this resolves. */
export async function createSuppression(draft: SuppressionDraft): Promise<SuppressionRule> {
  const { data } = await api.post<SuppressionRule>('/api/suppressions', draft);
  return data;
}

/**
 * Admin only. Partial: an omitted field is left alone, an explicit null clears it.
 *
 * Typed as a Partial so the callers that only toggle `enabled` do not have to
 * resend criteria they are not changing — resending them is how a concurrent edit
 * gets clobbered.
 */
export async function updateSuppression(
  id: number,
  patch: Partial<SuppressionDraft>,
): Promise<SuppressionRule> {
  const { data } = await api.patch<SuppressionRule>(`/api/suppressions/${id}`, patch);
  return data;
}

/** Admin only. Discards the match count with the rule — prefer disabling. */
export async function deleteSuppression(id: number): Promise<void> {
  await api.delete(`/api/suppressions/${id}`);
}

/** What this rule would have hidden. Changes nothing. */
export async function previewSuppression(
  draft: Pick<SuppressionDraft, 'kind' | 'sourceCidr' | 'targetCidr' | 'port'>,
): Promise<SuppressionPreview> {
  const { data } = await api.post<SuppressionPreview>('/api/suppressions/preview', draft);
  return data;
}
