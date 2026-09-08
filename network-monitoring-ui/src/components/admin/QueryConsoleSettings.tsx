import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type AdhocSettingsPatch, fetchAdhocSettings, saveAdhocSettings } from '../../api/adhoc.api';
import { describeError } from '../../api/client';
import { type Message, useMessageText } from '../../i18n/message-state';
import { type UiMessageKey, useT } from '../../i18n/ui';
import { monoSx } from '../../theme';

/**
 * The query console's settings, editable by an administrator.
 *
 * The layering is the whole design, and it is the same as the delivery settings:
 * **environment → stored row → default, and the environment wins.** A deployment
 * that pins `ADHOC_ENABLED=false` in its Compose file cannot be contradicted from
 * here, and a pinned field renders disabled with the variable named rather than
 * accepting an edit that changes nothing.
 *
 * The password is here too, since V15. It used to be environment-only, on the
 * argument that it was what kept the decision to *have* a SQL prompt on the
 * production database with whoever installed the server — an accurate
 * description of what changed, and the trade was made deliberately so an
 * administrator can provision the console without server access.
 *
 * It behaves unlike every other field, because a credential the server never
 * returns cannot be prefilled: an empty box means "leave it as it is", not
 * "clear it". Clearing is its own button, so the destructive reading of an empty
 * field is never the one that happens by accident.
 */

interface FieldDef {
  key: string;
  /**
   * Catalogue keys rather than sentences.
   *
   * This table is module-level, so it is built once at import time — before any
   * locale is known and outside every component that could react to one
   * changing. Holding English here would have made the labels untranslatable
   * without also making the table a hook.
   */
  labelKey: UiMessageKey;
  kind: 'switch' | 'number' | 'select' | 'password';
  helpKey?: UiMessageKey;
  options?: readonly string[];
  min?: number;
  max?: number;
}

const FIELDS: readonly FieldDef[] = [
  {
    key: 'enabled',
    labelKey: 'console_settings.field.enabled',
    kind: 'switch',
    helpKey: 'console_settings.field.enabled_help',
  },
  {
    key: 'writeEnabled',
    labelKey: 'console_settings.field.writeEnabled',
    kind: 'switch',
    helpKey: 'console_settings.field.writeEnabled_help',
  },
  { key: 'timeoutMs', labelKey: 'console_settings.field.timeoutMs', kind: 'number', min: 100, max: 600_000 },
  { key: 'maxRows', labelKey: 'console_settings.field.maxRows', kind: 'number', min: 1, max: 100_000 },
  {
    key: 'maxQueryLength',
    labelKey: 'console_settings.field.maxQueryLength',
    kind: 'number',
    min: 1,
    max: 1_000_000,
  },
  {
    key: 'audit',
    labelKey: 'console_settings.field.audit',
    kind: 'select',
    options: ['all', 'refused', 'off'],
    helpKey: 'console_settings.field.audit_help',
  },
  {
    key: 'dbPassword',
    labelKey: 'console_settings.field.dbPassword',
    kind: 'password',
    helpKey: 'console_settings.field.dbPassword_help',
  },
];

/**
 * Fields the server never returns, so the form cannot prefill them.
 *
 * Derived from the registry rather than written twice, so a second credential
 * added to `FIELDS` gets the empty-means-unchanged rule without anybody
 * remembering to add it here.
 */
const SECRET_KEYS = new Set(FIELDS.filter((field) => field.kind === 'password').map((field) => field.key));
const NUMBER_KEYS = new Set(FIELDS.filter((field) => field.kind === 'number').map((field) => field.key));

/**
 * A draft value as the API wants it, with an emptied field spelled `null`.
 *
 * `null` is how this API and V14 spell "stop deciding this here, fall back to
 * the environment or the default", and it has to be reachable from the form or
 * the whole nullable-column design is unusable from the one place that uses it.
 *
 * Number fields keep their raw text in the draft precisely so this can tell an
 * emptied box from a typed zero — `Number('')` is `0`, which is what made the
 * two indistinguishable before. Mirrors `DeliverySettingsForm.toPatchValue`.
 */
function toPatchValue(key: string, raw: boolean | number | string | null | undefined) {
  if (raw === null || raw === undefined) return null;
  if (!NUMBER_KEYS.has(key)) return raw;

  const text = String(raw).trim();
  return text === '' ? null : Number(text);
}

export default function QueryConsoleSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['adhoc', 'settings'], queryFn: fetchAdhocSettings });
  const [draft, setDraft] = useState<AdhocSettingsPatch>({});
  // Held as a key, rendered on display — see i18n/message-state.ts.
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; body: Message } | null>(null);
  const messageText = useMessageText();

  const save = useMutation({
    mutationFn: (patch: AdhocSettingsPatch) => saveAdhocSettings(patch),
    onSuccess: () => {
      setDraft({});
      setMessage({ severity: 'success', body: { key: 'console_settings.saved' } });
      void queryClient.invalidateQueries({ queryKey: ['adhoc', 'settings'] });
      // The console's own status changes with these: enabling it starts the pool,
      // and the diagnostics panel and the console page both read that.
      void queryClient.invalidateQueries({ queryKey: ['adhoc', 'status'] });
    },
    onError: (error) => {
      // The server's message is the useful one — it names the environment
      // variable that pinned the field, which is what somebody can go and remove.
      setMessage({ severity: 'error', body: { error, fallbackKey: 'console_settings.save_failed' } });
    },
  });

  if (settings.isPending) return <Typography variant="body2">{t('console.loading')}</Typography>;
  if (settings.isError) {
    return <Alert severity="error">{describeError(settings.error, t('console_settings.read_failed'))}</Alert>;
  }

  const current = settings.data;
  const valueFor = (key: string) => (key in draft ? draft[key] : current.settings[key]?.value);
  const isPinned = (key: string) => current.settings[key]?.source === 'environment';

  /*
   * An empty secret box is "leave it alone", not "clear it".
   *
   * The server never returns a credential, so a configured password and an
   * emptied box are the same three characters on screen. Typing into the field
   * and deleting it again would otherwise submit `''`, which the resolver reads
   * as unset — silently clearing the credential and stopping the console,
   * because the reader changed their mind about editing it. Clearing has its own
   * button, which sets `null`.
   */
  /**
   * Whether a drafted key differs from what is stored.
   *
   * Membership in `draft` is not this check, and using it meant the panel
   * reported changes that had not happened: toggling "Allow writes" on and back
   * off left `draft.writeEnabled === false`, which is what was already stored,
   * yet the panel showed "1 unsaved", enabled Save, and on click announced
   * "Saved. The change is already in force". Same for clicking into a number
   * field and retyping the value that was there.
   *
   * `saveAdhocSettings` diffs server-side, so nothing was written and no audit
   * row appeared — the database was never wrong. What was wrong is the panel
   * claiming a change on the one form where "did that actually take effect?" is
   * the question being asked, and where the answer decides whether a browser can
   * run SQL. `DeliverySettingsForm` compares against `savedValue` for the same
   * reason.
   *
   * A secret is always "unchanged" while its box is empty: the server never
   * sends the value, so there is nothing to compare and an empty box means leave
   * it alone. Clearing it sets `null`, which differs from a configured secret
   * and so counts.
   */
  const differsFromStored = (key: string) => {
    const drafted = draft[key];
    if (SECRET_KEYS.has(key)) return drafted !== '';

    const stored = current.settings[key]?.value;
    // Compared as text, because a number field's draft holds what was typed —
    // `'25'` against a stored `25` is not a change.
    return String(drafted ?? '') !== String(stored ?? '');
  };

  const changed = Object.keys(draft).filter(differsFromStored);

  /*
   * Only the fields that moved, and never a pinned one.
   *
   * A pinned field is disabled, so it should not be in `draft` at all — filtered
   * anyway, because a background refetch can pin a field between typing into it
   * and pressing Save, and sending it would earn a 409 for something the reader
   * did nothing wrong to cause.
   */
  const submit = () => {
    const patch: AdhocSettingsPatch = {};
    for (const key of changed) {
      if (!isPinned(key)) patch[key] = toPatchValue(key, draft[key]);
    }
    if (Object.keys(patch).length === 0) {
      setMessage({ severity: 'error', body: { key: 'console_settings.all_pinned' } });
      return;
    }
    setMessage(null);
    save.mutate(patch);
  };

  return (
    <Stack spacing={2}>
      {!current.passwordConfigured && (
        <Alert severity="warning">
          <AlertTitle>{t('console_settings.no_password')}</AlertTitle>
          {/*
           * The warning has to name the remedy, and since V15 the remedy is on
           * this page. It used to end with "set it in the environment and
           * restart the API", which was a dead end for the person reading it:
           * an administrator without server access could do nothing with that
           * sentence, and the switch above it looked like it should work.
           */}
          {isPinned('dbPassword') ? (
            <>
              {t('console_settings.no_password_pinned_before')}{' '}
              <Box component="code" sx={monoSx}>
                {current.settings.dbPassword?.env}
              </Box>{' '}
              {t('console_settings.no_password_pinned_after')}
            </>
          ) : (
            t('console_settings.no_password_here')
          )}
        </Alert>
      )}

      {message && <Alert severity={message.severity}>{messageText(message.body)}</Alert>}

      {FIELDS.map((field) => {
        const pinned = isPinned(field.key);
        const pinnedNote = pinned
          ? t('console_settings.pinned_note', { variable: current.settings[field.key]?.env ?? '' })
          : undefined;
        const helper = pinnedNote ?? (field.helpKey ? t(field.helpKey) : undefined);

        if (field.kind === 'switch') {
          return (
            <Box key={field.key}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={valueFor(field.key) === true}
                      disabled={pinned || save.isPending}
                      onChange={(event) => setDraft((now) => ({ ...now, [field.key]: event.target.checked }))}
                      slotProps={{ input: { 'aria-label': t(field.labelKey) } }}
                    />
                  }
                  label={t(field.labelKey)}
                />
                {pinned && <Chip size="small" variant="outlined" label={current.settings[field.key]?.env} />}
              </Stack>
              {helper && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {helper}
                </Typography>
              )}
            </Box>
          );
        }

        if (field.kind === 'password') {
          const configured = current.settings[field.key]?.configured === true;
          const typed = typeof draft[field.key] === 'string' ? (draft[field.key] as string) : '';

          return (
            <Box key={field.key}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  label={t(field.labelKey)}
                  value={typed}
                  disabled={pinned || save.isPending}
                  /*
                   * The placeholder carries the only cue there is. The server
                   * never returns the value, so a configured password and an
                   * empty box look identical — and without this, the safe
                   * reading ("leave it alone") and the destructive one ("clear
                   * it") are indistinguishable to the reader.
                   */
                  placeholder={
                    configured ? t('console_settings.password_set') : t('console_settings.password_unset')
                  }
                  helperText={helper}
                  autoComplete="new-password"
                  onChange={(event) => setDraft((now) => ({ ...now, [field.key]: event.target.value }))}
                />
                {configured && !pinned && (
                  <Button
                    size="small"
                    color="warning"
                    disabled={save.isPending}
                    // Its own control, so clearing is never what an empty box
                    // means by accident. Named for the field, because every
                    // secret on the Delivery page shares the accessible name
                    // "Clear" and that is already one ambiguity too many.
                    onClick={() => setDraft((now) => ({ ...now, [field.key]: null }))}
                  >
                    {t('console_settings.clear_password')}
                  </Button>
                )}
              </Stack>
              {draft[field.key] === null && (
                <Typography variant="caption" sx={{ color: 'warning.main', display: 'block' }}>
                  {t('console_settings.will_clear')}
                </Typography>
              )}
            </Box>
          );
        }

        if (field.kind === 'select') {
          return (
            <TextField
              key={field.key}
              select
              size="small"
              label={t(field.labelKey)}
              value={String(valueFor(field.key) ?? '')}
              disabled={pinned || save.isPending}
              helperText={helper}
              onChange={(event) => setDraft((now) => ({ ...now, [field.key]: event.target.value }))}
            >
              {(field.options ?? []).map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
          );
        }

        return (
          <TextField
            key={field.key}
            size="small"
            type="number"
            label={t(field.labelKey)}
            value={String(valueFor(field.key) ?? '')}
            disabled={pinned || save.isPending}
            helperText={helper}
            slotProps={{ htmlInput: { min: field.min, max: field.max } }}
            /*
             * The RAW text, not `Number(...)`. `Number('')` is `0`, so emptying
             * the box used to store zero — which made the `?? null` fallback
             * below unreachable, snapped the field to `0` mid-edit, and earned a
             * 400 against the schema's `min` bound on save. So "unset this and
             * fall back to the environment or the default" was expressible in
             * the migration, the schema and the route, and from nowhere in the
             * only interface that reaches them. Converted in `submit` instead,
             * the way `DeliverySettingsForm.toPatchValue` already does it.
             */
            onChange={(event) => setDraft((now) => ({ ...now, [field.key]: event.target.value }))}
          />
        );
      })}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          variant="contained"
          onClick={submit}
          disabled={changed.length === 0 || save.isPending}
        >
          {save.isPending ? t('console_settings.saving') : t('console_settings.save')}
        </Button>
        {changed.length > 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('console_settings.unsaved', { count: changed.length })}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
