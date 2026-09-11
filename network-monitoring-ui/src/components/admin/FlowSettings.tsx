import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { describeError } from '../../api/client';
import { type FlowSettingsPatch, fetchFlowSettings, saveFlowSettings } from '../../api/flow.api';
import { type Message, useMessageText } from '../../i18n/message-state';
import { useT } from '../../i18n/ui';
import { monoSx } from '../../theme';
import FlowStatusPanel from '../FlowStatusPanel';

/**
 * Flow collection settings, for an administrator with no shell on the server.
 *
 * The three-layer rule delivery (#39) and the query console (#53) both use —
 * environment → stored row → default, and the environment wins — applied to the
 * four variables that were read once at boot and changeable no other way. A
 * restart on a monitoring server drops a live packet capture, so "edit a file and
 * restart" is a real cost; and a customer who bought this product has no file to
 * edit at all.
 *
 * **The four fields are not equal, and the form says so.** Only one of them is
 * purely an application concern:
 *
 *  - **Permitted senders** is a filter test per datagram. It applies the moment
 *    it is saved, nothing is rebound, nothing in flight is lost — and it is the
 *    one that changes in ordinary operation, as devices are added. This is the
 *    everyday control.
 *  - **On/off, port and bind address** are properties of a bound socket, so
 *    saving one closes and reopens it. That is a few seconds of not collecting,
 *    which is why they are separated below rather than sitting in the same group.
 *
 * **And the port is a deployment fact as much as a setting.** Under Docker the
 * host port is published by `docker-compose.flow.yml`, which this application
 * cannot see or change — so a port changed here rebinds inside the container
 * while Docker goes on forwarding the old one, and collection stops with every
 * counter reading exactly like a device that is not sending. The warning is
 * beside the field. On the flow overlay the field is pinned anyway, which is the
 * belt to that braces: an operator on Compose cannot reach the mistake.
 *
 * The live state is rendered underneath, because watching the socket come back is
 * how you tell a save took effect — and a failed rebind is reported as
 * `listening: false` rather than as a failed request, since the row really was
 * written and is what the next boot will use.
 */

/** What the form holds while it is being edited. */
interface Draft {
  enabled: boolean;
  port: string;
  bindAddress: string;
  exporters: string;
}

export default function FlowSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: ['flow', 'settings'], queryFn: fetchFlowSettings });
  // The message, not its words — see i18n/message-state.ts.
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; body: Message } | null>(null);
  const messageText = useMessageText();
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = useMutation({
    mutationFn: (patch: FlowSettingsPatch) => saveFlowSettings(patch),
    onSuccess: (saved) => {
      setDraft(null);
      /*
       * Three outcomes, and they are not the same thing to an operator. A save
       * that rebound and came back listening is done; one that rebound and did
       * not is a real failure of a successful save — the port is taken, or the
       * address is not on this host — and the form has to say so rather than
       * show a tick. A save that needed no rebind is simply in force.
       */
      if (saved.rebound && saved.settings.enabled?.value === true && !saved.status.listening) {
        setMessage({ severity: 'error', body: { key: 'flow_settings.saved_not_listening' } });
      } else {
        setMessage({
          severity: 'success',
          body: { key: saved.rebound ? 'flow_settings.saved_rebound' : 'flow_settings.saved' },
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['flow'] });
    },
    // The server's message names the environment variable that pinned a field,
    // which is the one thing somebody could go and remove.
    onError: (error) =>
      setMessage({ severity: 'error', body: { error, fallbackKey: 'flow_settings.save_failed' } }),
  });

  if (current.isPending) return <Typography variant="body2">{t('flow_settings.loading')}</Typography>;
  if (current.isError) {
    return <Alert severity="error">{describeError(current.error, t('flow_settings.read_failed'))}</Alert>;
  }

  const fields = current.data.settings;
  const pinned = (field: string) => current.data.pinned.includes(field);
  const envOf = (field: string) => fields[field]?.env ?? field;
  const pinnedNote = (field: string) =>
    pinned(field) ? t('flow_settings.pinned_note', { variable: envOf(field) }) : undefined;

  const live: Draft = {
    enabled: fields.enabled?.value === true,
    port: String(fields.port?.value ?? ''),
    bindAddress: String(fields.bindAddress?.value ?? ''),
    exporters: String(fields.exporters?.value ?? ''),
  };
  const shown = draft ?? live;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setMessage(null);
    setDraft({ ...shown, [key]: value });
  };

  /**
   * Only what moved, and never a pinned field.
   *
   * A pinned field is disabled so it should not differ at all — filtered anyway,
   * because a background refetch can pin one between an edit and the Save, and
   * sending it would earn a 409 for something the reader did nothing wrong to
   * cause. The same guard `QueryConsoleSettings` keeps for the same reason.
   */
  const submit = () => {
    const patch: FlowSettingsPatch = {};
    if (!pinned('enabled') && shown.enabled !== live.enabled) patch.enabled = shown.enabled;
    if (!pinned('port') && shown.port !== live.port) patch.port = Number(shown.port);
    if (!pinned('bindAddress') && shown.bindAddress !== live.bindAddress) {
      patch.bindAddress = shown.bindAddress;
    }
    if (!pinned('exporters') && shown.exporters !== live.exporters) patch.exporters = shown.exporters;

    if (Object.keys(patch).length === 0) {
      setMessage({ severity: 'error', body: { key: 'flow_settings.nothing_to_save' } });
      return;
    }
    setMessage(null);
    save.mutate(patch);
  };

  const everythingPinned = ['enabled', 'port', 'bindAddress', 'exporters'].every(pinned);

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.severity}>{messageText(message.body)}</Alert>}

      {/*
        Said once at the top when the whole form is inert, rather than left to be
        inferred from four disabled controls. That state is reachable — a
        deployment driven by config management is entitled to it — and a panel
        that looks broken without explaining itself is the thing somebody files a
        bug about.
      */}
      {everythingPinned && (
        <Alert severity="info">
          <AlertTitle>{t('flow_settings.all_pinned')}</AlertTitle>
          {t('flow_settings.all_pinned_note')}
        </Alert>
      )}

      <Typography variant="subtitle2">{t('flow_settings.group.everyday')}</Typography>

      <TextField
        label={t('flow_settings.exporters')}
        size="small"
        fullWidth
        multiline
        minRows={2}
        value={shown.exporters}
        disabled={pinned('exporters') || save.isPending}
        onChange={(event) => set('exporters', event.target.value)}
        placeholder="10.0.0.1, 10.0.0.2"
        slotProps={{ input: { sx: monoSx } }}
        helperText={pinnedNote('exporters') ?? t('flow_settings.exporters_help')}
      />

      <Divider />

      <Box>
        <Typography variant="subtitle2">{t('flow_settings.group.socket')}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('flow_settings.group.socket_note')}
        </Typography>
      </Box>

      <FormControlLabel
        control={
          <Switch
            checked={shown.enabled}
            disabled={pinned('enabled') || save.isPending}
            onChange={(event) => set('enabled', event.target.checked)}
            slotProps={{ input: { 'aria-label': t('flow_settings.enabled') } }}
          />
        }
        label={t('flow_settings.enabled')}
      />
      {pinnedNote('enabled') && (
        <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}>
          {pinnedNote('enabled')}
        </Typography>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label={t('flow_settings.port')}
          size="small"
          fullWidth
          type="number"
          value={shown.port}
          disabled={pinned('port') || save.isPending}
          onChange={(event) => set('port', event.target.value)}
          helperText={pinnedNote('port') ?? t('flow_settings.port_help')}
        />
        <TextField
          label={t('flow_settings.bind_address')}
          size="small"
          fullWidth
          value={shown.bindAddress}
          disabled={pinned('bindAddress') || save.isPending}
          onChange={(event) => set('bindAddress', event.target.value)}
          slotProps={{ input: { sx: monoSx } }}
          helperText={pinnedNote('bindAddress') ?? t('flow_settings.bind_address_help')}
        />
      </Stack>

      {/*
        The published-port trap, beside the field that springs it. Shown whenever
        the port is editable here, because this application cannot tell whether it
        is running under Compose — and the consequence of being wrong is silent.
      */}
      {!pinned('port') && (
        <Alert severity="warning">
          <AlertTitle>{t('flow_settings.port_published')}</AlertTitle>
          {t('flow_settings.port_published_note')}
        </Alert>
      )}

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          onClick={submit}
          disabled={save.isPending || everythingPinned || draft === null}
        >
          {save.isPending ? t('flow_settings.saving') : t('flow_settings.save')}
        </Button>
        <Button disabled={save.isPending || draft === null} onClick={() => setDraft(null)}>
          {t('common.cancel')}
        </Button>
      </Stack>

      <Divider />

      {/*
        The live state, under the form that changes it. Watching the socket come
        back is how an operator tells a save took effect, and a rebind that failed
        shows here as "not listening" with the reason — which is the honest report
        of a save that was written and could not be applied.
      */}
      <FlowStatusPanel embedded />
    </Stack>
  );
}
