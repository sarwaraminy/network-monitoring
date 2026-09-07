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
  label: string;
  kind: 'switch' | 'number' | 'select' | 'password';
  help?: string;
  options?: readonly string[];
  min?: number;
  max?: number;
}

const FIELDS: readonly FieldDef[] = [
  {
    key: 'enabled',
    label: 'Query console',
    kind: 'switch',
    help: 'Runs the console. It still needs ADHOC_DB_PASSWORD in the environment, and still refuses to start unless the database confirms its role is sandboxed.',
  },
  {
    key: 'writeEnabled',
    label: 'Allow writes',
    kind: 'switch',
    help: 'Authenticates as a different Postgres role — one V12 grants UPDATE, INSERT and DELETE on the operational tables. Not an application check: turning this off connects as a role that cannot write at all.',
  },
  { key: 'timeoutMs', label: 'Statement timeout (ms)', kind: 'number', min: 100, max: 600_000 },
  { key: 'maxRows', label: 'Row cap', kind: 'number', min: 1, max: 100_000 },
  { key: 'maxQueryLength', label: 'Maximum query length', kind: 'number', min: 1, max: 1_000_000 },
  {
    key: 'audit',
    label: 'Audit',
    kind: 'select',
    options: ['all', 'refused', 'off'],
    help: 'What reaches the audit trail. Forced to "all" while writes are allowed — a console that can DELETE and a trail that records none of it is the one combination this must not offer.',
  },
  {
    key: 'dbPassword',
    label: 'Console role password',
    kind: 'password',
    help: 'Installed on the console’s Postgres role when it starts. Never shown back — the server reports only whether one is set. Saving a change reconnects the console, because the credential is installed at startup and would otherwise not take effect until the next restart.',
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

export default function QueryConsoleSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['adhoc', 'settings'], queryFn: fetchAdhocSettings });
  const [draft, setDraft] = useState<AdhocSettingsPatch>({});
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const save = useMutation({
    mutationFn: (patch: AdhocSettingsPatch) => saveAdhocSettings(patch),
    onSuccess: () => {
      setDraft({});
      setMessage({ severity: 'success', text: 'Saved. The change is already in force — no restart needed.' });
      void queryClient.invalidateQueries({ queryKey: ['adhoc', 'settings'] });
      // The console's own status changes with these: enabling it starts the pool,
      // and the diagnostics panel and the console page both read that.
      void queryClient.invalidateQueries({ queryKey: ['adhoc', 'status'] });
    },
    onError: (error) => {
      // The server's message is the useful one — it names the environment
      // variable that pinned the field, which is what somebody can go and remove.
      setMessage({ severity: 'error', text: describeError(error, 'Could not save the settings') });
    },
  });

  if (settings.isPending) return <Typography variant="body2">Asking the server…</Typography>;
  if (settings.isError) {
    return <Alert severity="error">{describeError(settings.error, 'Could not read the settings')}</Alert>;
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
  const isNoOp = (key: string) => SECRET_KEYS.has(key) && draft[key] === '';
  const changed = Object.keys(draft).filter((key) => !isNoOp(key));

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
      if (!isPinned(key)) patch[key] = draft[key] ?? null;
    }
    if (Object.keys(patch).length === 0) {
      setMessage({ severity: 'error', text: 'Every changed field is now set in the environment.' });
      return;
    }
    setMessage(null);
    save.mutate(patch);
  };

  return (
    <Stack spacing={2}>
      {!current.passwordConfigured && (
        <Alert severity="warning">
          <AlertTitle>No console password is set</AlertTitle>
          {/*
           * The warning has to name the remedy, and since V15 the remedy is on
           * this page. It used to end with "set it in the environment and
           * restart the API", which was a dead end for the person reading it:
           * an administrator without server access could do nothing with that
           * sentence, and the switch above it looked like it should work.
           */}
          {isPinned('dbPassword') ? (
            <>
              The console cannot start until one is set, and it is pinned to{' '}
              <Box component="code" sx={monoSx}>
                {current.settings.dbPassword?.env}
              </Box>{' '}
              in the API environment — which is currently empty. Set a value there and restart the API, or
              remove the line to set one here instead.
            </>
          ) : (
            <>
              The console cannot start until one is set, whatever the switches here say — it is the credential
              installed on its Postgres role. Set one in <strong>Console role password</strong> below.
            </>
          )}
        </Alert>
      )}

      {message && <Alert severity={message.severity}>{message.text}</Alert>}

      {FIELDS.map((field) => {
        const pinned = isPinned(field.key);
        const pinnedNote = pinned
          ? `Set by ${current.settings[field.key]?.env} in the environment. Remove that line and restart the API to manage it here.`
          : undefined;
        const helper = pinnedNote ?? field.help;

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
                      slotProps={{ input: { 'aria-label': field.label } }}
                    />
                  }
                  label={field.label}
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
                  label={field.label}
                  value={typed}
                  disabled={pinned || save.isPending}
                  /*
                   * The placeholder carries the only cue there is. The server
                   * never returns the value, so a configured password and an
                   * empty box look identical — and without this, the safe
                   * reading ("leave it alone") and the destructive one ("clear
                   * it") are indistinguishable to the reader.
                   */
                  placeholder={configured ? 'Set — leave blank to keep it' : 'Not set'}
                  helperText={pinnedNote ?? field.help}
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
                    Clear password
                  </Button>
                )}
              </Stack>
              {draft[field.key] === null && (
                <Typography variant="caption" sx={{ color: 'warning.main', display: 'block' }}>
                  Will be cleared on save. The console stops as soon as it is — it cannot authenticate without
                  a password.
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
              label={field.label}
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
            label={field.label}
            value={String(valueFor(field.key) ?? '')}
            disabled={pinned || save.isPending}
            helperText={helper}
            slotProps={{ htmlInput: { min: field.min, max: field.max } }}
            onChange={(event) => setDraft((now) => ({ ...now, [field.key]: Number(event.target.value) }))}
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
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
        {changed.length > 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {changed.length} unsaved
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
