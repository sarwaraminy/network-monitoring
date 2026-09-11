import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { createSuppression, previewSuppression, updateSuppression } from '../api/suppressions.api';
import { useFormatters } from '../i18n/format';
import { type Message, useMessageText } from '../i18n/message-state';
import { type Translate, useT } from '../i18n/ui';
import {
  ALERT_KINDS,
  type AlertKind,
  type Alert as AlertRecord,
  type SuppressionDraft,
  type SuppressionRule,
} from '../types';
import { KIND_LABEL } from './SeverityChip';

/**
 * The create/edit form for a suppression rule, shared by two callers.
 *
 * The "Check against recent alerts" button is the part that matters. Writing a
 * suppression is a guess about a range, and the cost of guessing wide is silence
 * rather than an error message — so the form offers to measure the guess against
 * alerts already stored before it is saved, using the server's own matching code
 * rather than a second copy living here.
 *
 * **Here rather than inside `SuppressionsPage` because there are now two ways in.**
 * An alert row offers "Suppress findings like this", which opens this form filled
 * from that finding — the obvious next touch on that page, and the reason a
 * suppression is usually written at all. A second copy of a form with a mandatory
 * reason, a preview and a criterion check would drift on the first change to
 * either, and the half nobody was looking at would be the wrong one — the same
 * argument `AdminSettingsMenu` makes about embedding the delivery form rather than
 * writing a second.
 */

const EMPTY_DRAFT: SuppressionDraft = {
  kind: null,
  sourceCidr: null,
  targetCidr: null,
  port: null,
  reason: '',
  enabled: true,
  expiresAt: null,
};

/**
 * A detector's name, as a person reads it.
 *
 * `KIND_LABEL` first — the same keyed map the alerts table renders, so no two
 * screens disagree about what `port_scan` is called. The mechanical un-snake-case
 * stays as the fallback for a kind the catalogue has not heard of, which keeps a
 * detector added later rendering as words rather than as an identifier.
 */
export function kindLabel(kind: string, t: Translate): string {
  const keyed = KIND_LABEL[kind as AlertKind];
  if (keyed) return t(keyed);

  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The rule a finding suggests, as a starting point for the form.
 *
 * Three criteria and not four. `kind`, the source and the port identify the class
 * of activity; the **target is left blank on purpose**, because it is the
 * criterion most likely to vary — a scan sweeps targets by definition, so pinning
 * the one that happened to be observed writes a rule that stops covering the same
 * activity tomorrow. Wider in that one respect, and visible: the operator can
 * type a target in, and the preview says what the rule as it stands would have
 * hidden.
 *
 * The source goes in as the bare address rather than `/32`. `parsePrefix` reads a
 * bare address as a full-length prefix and normalises it, so what is stored is the
 * same either way — and a field showing `10.0.0.7` is what the operator recognises
 * from the row they clicked.
 *
 * `reason` stays empty although it is mandatory. That is the point: a suppression
 * needs a reason somebody wrote, and prefilling "suppressed from the alerts page"
 * would satisfy the constraint while defeating it.
 *
 * ARP and device findings carry no source IP — they identify the actor by MAC —
 * and there is no MAC criterion, so those prefill the kind and nothing else. The
 * form is then a rule about a whole detector, which the operator has to narrow
 * themselves; offering it is still better than making them retype the kind.
 */
export function draftFromAlert(alert: AlertRecord): SuppressionDraft {
  return {
    ...EMPTY_DRAFT,
    kind: alert.kind,
    sourceCidr: alert.sourceIp,
    port: alert.port,
  };
}

export interface SuppressionRuleDialogProps {
  /** Null creates. */
  rule: SuppressionRule | null;
  /**
   * What a new rule starts as. Ignored when `rule` is set, which already has
   * values of its own.
   *
   * `draftFromAlert` is what builds one from a finding. Optional, so the
   * suppressions page's own New rule button opens the form empty, as it did.
   */
  draft?: SuppressionDraft;
  onClose: () => void;
  onSaved: (saved: SuppressionRule, created: boolean) => void;
}

export default function SuppressionRuleDialog({
  rule,
  draft: initialDraft,
  onClose,
  onSaved,
}: Readonly<SuppressionRuleDialogProps>) {
  const t = useT();
  const fmt = useFormatters();
  const [draft, setDraft] = useState<SuppressionDraft>(() =>
    rule
      ? {
          kind: rule.kind,
          sourceCidr: rule.sourceCidr,
          targetCidr: rule.targetCidr,
          port: rule.port,
          reason: rule.reason,
          enabled: rule.enabled,
          expiresAt: rule.expiresAt,
        }
      : (initialDraft ?? EMPTY_DRAFT),
  );
  const [error, setError] = useState<Message | null>(null);
  const errorText = useMessageText();

  const set = <K extends keyof SuppressionDraft>(key: K, value: SuppressionDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const hasCriterion =
    draft.kind !== null || draft.sourceCidr !== null || draft.targetCidr !== null || draft.port !== null;

  /**
   * A rule whose only criterion is the detector.
   *
   * Legal, occasionally what somebody means, and the widest rule this form can
   * produce: every finding of that kind, from every address, until the rule is
   * removed. It passes the "at least one criterion" check that exists to stop a
   * single rule swallowing everything, because it swallows everything *of one
   * kind* instead.
   *
   * It is also one click away now. `draftFromAlert` fills in the source and the
   * port from the finding, but ARP and device findings identify the actor by MAC
   * and carry neither — so suppressing one of those from a row opens this form
   * with the detector alone, three characters of reason away from silencing that
   * detector network-wide. Said out loud rather than prevented: an operator who
   * means it has no other way to write it, and the preview below will report how
   * much it covers if they ask.
   */
  const kindOnly =
    draft.kind !== null && draft.sourceCidr === null && draft.targetCidr === null && draft.port === null;

  const preview = useMutation({
    mutationFn: () =>
      previewSuppression({
        kind: draft.kind,
        sourceCidr: draft.sourceCidr,
        targetCidr: draft.targetCidr,
        port: draft.port,
      }),
    onError: (mutationError) => setError({ error: mutationError, fallbackKey: 'suppressions.check_failed' }),
  });

  const save = useMutation({
    mutationFn: () => (rule ? updateSuppression(rule.id, draft) : createSuppression(draft)),
    onSuccess: (saved) => onSaved(saved, rule === null),
    // Server-side messages are the useful ones here — they name the field and say
    // how to write a range — so they are shown verbatim rather than replaced.
    onError: (mutationError) => setError({ error: mutationError, fallbackKey: 'suppressions.save_failed' }),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {rule ? t('suppressions.edit_title', { id: rule.id }) : t('suppressions.new_title')}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {/* One key rather than fragments around the <strong>: splitting a
              sentence to keep emphasis freezes English word order into every
              other language. */}
          {t('suppressions.dialog_note')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorText(error)}
          </Alert>
        )}

        <Stack spacing={2}>
          <TextField
            select
            label={t('suppressions.kind')}
            size="small"
            value={draft.kind ?? ''}
            onChange={(event) => set('kind', (event.target.value || null) as AlertKind | null)}
            helperText={t('suppressions.kind_helper')}
          >
            <MenuItem value="">{t('common.any_kind')}</MenuItem>
            {ALERT_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {kindLabel(kind, t)}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('suppressions.source')}
              size="small"
              fullWidth
              value={draft.sourceCidr ?? ''}
              onChange={(event) => set('sourceCidr', event.target.value.trim() || null)}
              placeholder={t('suppressions.cidr_placeholder')}
              helperText={t('suppressions.source_helper')}
            />
            <TextField
              label={t('suppressions.target')}
              size="small"
              fullWidth
              value={draft.targetCidr ?? ''}
              onChange={(event) => set('targetCidr', event.target.value.trim() || null)}
              placeholder="192.168.1.0/24"
              helperText={t('suppressions.target_helper')}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('suppressions.port')}
              size="small"
              fullWidth
              type="number"
              value={draft.port ?? ''}
              onChange={(event) => set('port', event.target.value === '' ? null : Number(event.target.value))}
              // The honest caveat, next to the field rather than in documentation
              // nobody reads: a port scan names no single port, so a rule with a
              // port will never match one.
              helperText={t('suppressions.port_helper')}
            />
            <TextField
              label={t('suppressions.expires')}
              size="small"
              fullWidth
              type="datetime-local"
              value={toLocalInput(draft.expiresAt)}
              onChange={(event) => set('expiresAt', fromLocalInput(event.target.value))}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText={t('suppressions.expires_helper')}
            />
          </Stack>

          <TextField
            label={t('suppressions.reason')}
            size="small"
            required
            multiline
            minRows={2}
            value={draft.reason}
            onChange={(event) => set('reason', event.target.value)}
            placeholder={t('suppressions.reason_placeholder')}
            helperText={t('suppressions.reason_helper')}
          />

          <FormControlLabel
            control={
              <Switch checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} />
            }
            label={t('suppressions.in_force')}
          />

          {kindOnly && (
            <Alert severity="warning">
              {t('suppressions.kind_only_warning', { kind: kindLabel(draft.kind ?? '', t) })}
            </Alert>
          )}

          <Box>
            <Button
              size="small"
              variant="text"
              disabled={!hasCriterion || preview.isPending}
              onClick={() => preview.mutate()}
            >
              {preview.isPending ? t('suppressions.checking') : t('suppressions.check_against')}
            </Button>

            {preview.data && (
              <Alert
                // Nothing matched is a warning, not a success: the usual cause is a
                // range that does not cover what the operator thinks it does.
                severity={preview.data.matched === 0 ? 'warning' : 'info'}
                sx={{ mt: 1 }}
              >
                <Typography variant="body2">
                  {preview.data.matched === 0
                    ? t('suppressions.preview_none', {
                        examined: preview.data.examined,
                      })
                    : t('suppressions.preview_matched', {
                        matched: preview.data.matched,
                        examined: preview.data.examined,
                        occurrences: preview.data.occurrences,
                      })}
                </Typography>
                {preview.data.window && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                    {t('suppressions.preview_window', {
                      from: fmt.dateTime(preview.data.window.from),
                      to: fmt.dateTime(preview.data.window.to),
                    })}
                  </Typography>
                )}
                {preview.data.samples.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    {preview.data.samples.slice(0, 5).map((sample) => (
                      <Typography key={sample.id} variant="caption" sx={{ display: 'block' }}>
                        {kindLabel(sample.kind, t)} · {sample.sourceIp ?? t('suppressions.unknown_source')}
                        {sample.targetIp ? ` → ${sample.targetIp}` : ''} · {fmt.number(sample.occurrences)}×
                      </Typography>
                    ))}
                  </Box>
                )}
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          // Both conditions are enforced by the server too; disabling here is so
          // the operator is not told off after typing a reason.
          disabled={save.isPending || !hasCriterion || draft.reason.trim().length < 3}
        >
          {save.isPending
            ? t('suppressions.saving')
            : rule
              ? t('suppressions.save_changes')
              : t('suppressions.create_rule')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * ISO to the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants, in local time.
 *
 * Slicing the ISO string would be shorter and wrong: it is UTC, so an operator in
 * any other zone would see a time that is not the one they set.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The inverse. Empty clears the expiry rather than sending an Invalid Date. */
function fromLocalInput(value: string): string | null {
  if (value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
