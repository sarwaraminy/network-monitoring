import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { describeError } from '../api/client';
import { fetchDeliverySettings, saveDeliverySettings } from '../api/notify.api';
import type { DeliverySettingsPatch, DeliverySettingsResponse } from '../types';
import SurfaceCard from './SurfaceCard';

/**
 * The delivery settings form.
 *
 * Every one of these values used to require editing a file on the host and
 * restarting the service, which made each tuning change an outage and put the buyer
 * — an IT admin, not the developer — in a shell. See issue #28.
 *
 * Three rules shape the whole component, and each exists because of a specific way
 * this could mislead somebody:
 *
 *  1. **A field pinned in the environment is disabled and says so.** The API refuses
 *     to store a change to it, so an editable control would accept an edit and
 *     change nothing. That is the failure this codebase keeps finding, and it is
 *     worse here than usual: the operator's conclusion would be "delivery settings
 *     don't work", not "that field is managed elsewhere".
 *  2. **Only changed fields are sent.** Absent means "leave it", which is what lets
 *     the form save without round-tripping a webhook URL the API never sent it. It
 *     also means a save cannot accidentally rewrite twenty-three fields it did not
 *     touch.
 *  3. **A secret is never displayed, only replaced.** The API reports whether one is
 *     configured and never its value. An empty secret box means "leave it alone";
 *     clearing one is a separate, explicit action.
 */

type FieldKind = 'switch' | 'number' | 'text' | 'select' | 'secret' | 'list';

interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  help?: string;
  options?: readonly string[];
  /** Rendered narrow, so a port does not get a full-width box. */
  narrow?: true;
}

interface Section {
  title: string;
  subtitle: string;
  fields: FieldDef[];
}

const SECTIONS: Section[] = [
  {
    title: 'Gates',
    subtitle: 'Applied to the channels a person reads, never to the SIEM feed',
    fields: [
      {
        key: 'enabled',
        label: 'Deliver alerts',
        kind: 'switch',
        help: 'Off means findings are recorded and nobody is told. Syslog is unaffected.',
      },
      {
        key: 'minSeverity',
        label: 'Minimum severity',
        kind: 'select',
        options: ['critical', 'high', 'medium', 'low', 'info'],
        narrow: true,
      },
      {
        key: 'digestSeconds',
        label: 'Digest window (s)',
        kind: 'number',
        narrow: true,
        help: 'Findings are batched for this long, so one burst is one message. Zero means no batching.',
      },
      {
        key: 'throttleSeconds',
        label: 'Per-finding throttle (s)',
        kind: 'number',
        narrow: true,
        help: 'The same finding will not notify again inside this window.',
      },
      {
        key: 'maxPerHour',
        label: 'Max messages per hour',
        kind: 'number',
        narrow: true,
        help: 'A hard ceiling, whatever detection does.',
      },
      {
        key: 'includeEvidence',
        label: 'Include evidence',
        kind: 'switch',
        help: 'Evidence never contains passwords or payloads, but it does contain internal addresses and usernames — which a third-party chat service would then hold.',
      },
      {
        key: 'dashboardUrl',
        label: 'Dashboard link',
        kind: 'text',
        help: 'Linked from every message, e.g. https://nmt.example.com/alerts',
      },
    ],
  },
  {
    title: 'Webhook',
    subtitle: 'Slack, Teams, Discord, or anything accepting JSON',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        kind: 'secret',
        help: 'For Teams, create a Workflows webhook — its URL is on logic.azure.com. Treated as a credential and never shown back.',
      },
      {
        key: 'webhookFormat',
        label: 'Payload format',
        kind: 'select',
        options: ['auto', 'slack', 'teams', 'teams-connector', 'discord', 'generic'],
        narrow: true,
        help: '`auto` reads the host and picks the right shape, including the retired Office 365 connector for a webhook.office.com URL.',
      },
    ],
  },
  {
    title: 'Email',
    subtitle: 'An internal relay needs no credentials and is the right answer for an on-prem sensor',
    fields: [
      { key: 'emailHost', label: 'SMTP host', kind: 'text' },
      { key: 'emailPort', label: 'Port', kind: 'number', narrow: true },
      {
        key: 'emailSecure',
        label: 'Implicit TLS',
        kind: 'switch',
        help: 'True only for port 465. On 587 leave this off — STARTTLS is negotiated instead, and setting it here hangs until the socket times out.',
      },
      { key: 'emailFrom', label: 'From address', kind: 'text' },
      { key: 'emailTo', label: 'Recipients', kind: 'list', help: 'One per line, or comma-separated.' },
      {
        key: 'emailUser',
        label: 'Username',
        kind: 'text',
        help: 'Leave empty for a relay that needs no authentication.',
      },
      {
        key: 'emailPassword',
        label: 'Password',
        kind: 'secret',
        help: 'Microsoft 365 and Google disable basic SMTP AUTH by default, so a correct password can still be rejected.',
      },
    ],
  },
  {
    title: 'Syslog / SIEM',
    subtitle: 'Ungated on purpose: a SIEM correlates for itself and needs the complete stream',
    fields: [
      { key: 'syslogHost', label: 'Collector host', kind: 'text' },
      { key: 'syslogPort', label: 'Port', kind: 'number', narrow: true },
      { key: 'syslogProtocol', label: 'Protocol', kind: 'select', options: ['udp', 'tcp'], narrow: true },
      { key: 'syslogFormat', label: 'Format', kind: 'select', options: ['cef', 'json'], narrow: true },
      {
        key: 'syslogRfc',
        label: 'RFC',
        kind: 'select',
        options: ['5424', '3164'],
        narrow: true,
        help: '3164 has no year and no timezone in its timestamp; prefer 5424.',
      },
      {
        key: 'syslogFacility',
        label: 'Facility',
        kind: 'number',
        narrow: true,
        help: '16–23 are the local-use facilities; 16 is local0.',
      },
      { key: 'syslogAppName', label: 'App name', kind: 'text', narrow: true },
      {
        key: 'syslogIncludeEvidence',
        label: 'Include evidence',
        kind: 'switch',
        help: 'On by default here, unlike the chat channels: the disclosure argument does not apply to a collector inside your own network.',
      },
    ],
  },
];

/** The environment variable that pins a field, for the message on a disabled one. */
const ENV_NAMES: Record<string, string> = {
  enabled: 'NOTIFY_ENABLED',
  minSeverity: 'NOTIFY_MIN_SEVERITY',
  digestSeconds: 'NOTIFY_DIGEST_SECONDS',
  throttleSeconds: 'NOTIFY_THROTTLE_SECONDS',
  maxPerHour: 'NOTIFY_MAX_PER_HOUR',
  includeEvidence: 'NOTIFY_INCLUDE_EVIDENCE',
  dashboardUrl: 'NOTIFY_DASHBOARD_URL',
  webhookUrl: 'NOTIFY_WEBHOOK_URL',
  webhookFormat: 'NOTIFY_WEBHOOK_FORMAT',
  syslogHost: 'SYSLOG_HOST',
  syslogPort: 'SYSLOG_PORT',
  syslogProtocol: 'SYSLOG_PROTOCOL',
  syslogFormat: 'SYSLOG_FORMAT',
  syslogRfc: 'SYSLOG_RFC',
  syslogFacility: 'SYSLOG_FACILITY',
  syslogAppName: 'SYSLOG_APP_NAME',
  syslogIncludeEvidence: 'SYSLOG_INCLUDE_EVIDENCE',
  emailHost: 'SMTP_HOST',
  emailPort: 'SMTP_PORT',
  emailSecure: 'SMTP_SECURE',
  emailUser: 'SMTP_USER',
  emailPassword: 'SMTP_PASSWORD',
  emailFrom: 'NOTIFY_EMAIL_FROM',
  emailTo: 'NOTIFY_EMAIL_TO',
};

/** The form's own state: what the user has typed, keyed by field. */
type Draft = Record<string, string | boolean>;

/** The API's value rendered as something an input can hold. */
function toInput(kind: FieldKind, value: unknown): string | boolean {
  if (kind === 'switch') return value === true;
  if (kind === 'list') return Array.isArray(value) ? value.join('\n') : '';
  if (value === null || value === undefined) return '';
  return String(value);
}

/** An input's contents rendered as something the API accepts. */
function toPatchValue(kind: FieldKind, raw: string | boolean): string | number | boolean | string[] | null {
  if (kind === 'switch') return raw === true;
  const text = String(raw).trim();
  if (kind === 'list') {
    const list = text
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    // An empty box means the same thing here as an emptied text field: unset, so
    // the field falls back to the environment or the default. An empty array is a
    // different, explicit statement — no recipients, permanently — and returning
    // one for a blank box would mean recipients can never be handed back to
    // whatever NOTIFY_EMAIL_TO says once they have been set through this page.
    return list.length === 0 ? null : list;
  }
  if (kind === 'number') return text === '' ? null : Number(text);
  // A text field emptied means "clear it", which the API spells as null.
  return text === '' ? null : text;
}

interface DeliverySettingsFormProps {
  /** Strips this component's own card chrome, for use inside a dialog that already provides one. */
  embedded?: boolean;
}

export default function DeliverySettingsForm({ embedded = false }: Readonly<DeliverySettingsFormProps> = {}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const settings = useQuery({ queryKey: ['notify', 'settings'], queryFn: fetchDeliverySettings });

  const pinned = useMemo(() => new Set(settings.data?.pinnedByEnvironment ?? []), [settings.data]);

  /** The saved value for a field, as an input would hold it. */
  const savedValue = (key: string, kind: FieldKind): string | boolean => {
    const field = settings.data?.settings[key];
    // A secret's box always starts empty: the API never sends the value, and an
    // empty box means "leave it alone".
    if (kind === 'secret') return '';
    return toInput(kind, field?.value);
  };

  const currentValue = (key: string, kind: FieldKind): string | boolean =>
    key in draft ? draft[key]! : savedValue(key, kind);

  const save = useMutation({
    mutationFn: (patch: DeliverySettingsPatch) => saveDeliverySettings(patch),
    onSuccess: (updated: DeliverySettingsResponse, patch) => {
      queryClient.setQueryData(['notify', 'settings'], updated);
      // The status card reads the same settings, so it is stale the moment this
      // returns — and it is the card people look at to decide whether delivery works.
      void queryClient.invalidateQueries({ queryKey: ['notify', 'status'] });
      // Only the keys this call actually sent, not the whole draft. clearSecret
      // reuses this same mutation to send a single field — wiping every other
      // unsaved edit sitting in draft would report "saved" for changes that were
      // never part of the request.
      setDraft((current) => {
        const next = { ...current };
        for (const key of Object.keys(patch)) delete next[key];
        return next;
      });
      setMessage({ severity: 'success', text: 'Saved. The change is already in force — no restart needed.' });
    },
    onError: (error) => {
      // The server's own message is the useful one: it names a pinned field, or the
      // bound a number missed.
      setMessage({ severity: 'error', text: describeError(error, 'Could not save the settings') });
    },
  });

  /** The classic SMTP misconfiguration, described if the current pair is one. */
  const smtpMismatch = (() => {
    const host = String(currentValue('emailHost', 'text'));
    if (host.trim() === '') return null;

    const secure = currentValue('emailSecure', 'switch') === true;
    const port = Number(currentValue('emailPort', 'number'));

    if (secure && port === 587) {
      return 'Port 587 with implicit TLS on will hang until the socket times out: 587 expects STARTTLS. Use port 465, or turn implicit TLS off.';
    }
    if (!secure && port === 465) {
      return 'Port 465 expects implicit TLS from the first byte. Turn implicit TLS on, or use port 587.';
    }
    return null;
  })();

  const changedFields = Object.keys(draft).filter((key) => {
    const def = SECTIONS.flatMap((section) => section.fields).find((field) => field.key === key);
    if (!def) return false;
    // A secret counts as changed only when something was typed into it.
    if (def.kind === 'secret') return String(draft[key] ?? '') !== '';
    return draft[key] !== savedValue(key, def.kind);
  });

  const submit = () => {
    const patch: DeliverySettingsPatch = {};
    for (const key of changedFields) {
      const def = SECTIONS.flatMap((section) => section.fields).find((field) => field.key === key);
      if (!def || pinned.has(key)) continue;
      patch[key] = toPatchValue(def.kind, draft[key]!);
    }
    if (Object.keys(patch).length > 0) {
      save.mutate(patch);
      return;
    }
    // Reachable: a background refetch can mark a field pinned between typing
    // into it and clicking Save. Silently doing nothing here would look
    // identical to the request having hung — the button is enabled, "N unsaved"
    // is still showing, and nothing else on screen changes.
    setMessage({
      severity: 'error',
      text: 'Every changed field is now set in the environment and cannot be saved. Discard to clear these edits.',
    });
  };

  const clearSecret = (key: string) => {
    save.mutate({ [key]: null });
  };

  if (settings.error) {
    return (
      <SurfaceCard title="Settings" embedded={embedded}>
        <Alert severity="error">
          {describeError(settings.error, 'Could not read the delivery settings')}
        </Alert>
      </SurfaceCard>
    );
  }

  /*
   * Nothing is rendered until the settings arrive, and that is a product decision
   * rather than a loading nicety.
   *
   * The inputs derive their values from the response, so rendering them early shows
   * every field blank and every secret as "Not set" — on the one page whose job is
   * telling an operator whether delivery is configured, and to somebody who very
   * possibly arrived because an alert did not turn up. A skeleton says "not yet"; an
   * empty form says "nothing is set up", and only one of those is true.
   */
  if (settings.isPending || !settings.data) {
    return (
      <SurfaceCard title="Settings" subtitle="Loading the current configuration" embedded={embedded}>
        <Stack spacing={2}>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <Skeleton key={row} height={44} />
          ))}
        </Stack>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      title="Settings"
      subtitle="Changed here, in force immediately — no file to edit and no restart"
      embedded={embedded}
      headerActions={
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {changedFields.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {changedFields.length} unsaved
            </Typography>
          )}
          <Button
            size="small"
            onClick={() => setDraft({})}
            disabled={changedFields.length === 0 || save.isPending}
          >
            Discard
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={submit}
            disabled={changedFields.length === 0 || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </Stack>
      }
    >
      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      {/*
        The one pairing in this form that fails by hanging rather than by erroring.
        `emailSecure` means implicit TLS, which is port 465; on 587 the server
        expects STARTTLS instead, and a client that opens TLS immediately sits there
        until the socket times out. The field's own help text says so, which is not
        the same as noticing that the two current values contradict each other.
        Warned rather than refused: implicit TLS on a non-standard port is a real
        configuration, and the schema cannot check the pair anyway — only changed
        fields are sent, so the API often sees one of the two and the row holds the
        other. The form is the one place that always has both.
      */}
      {smtpMismatch && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {smtpMismatch}
        </Alert>
      )}

      {pinned.size > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {pinned.size} setting{pinned.size === 1 ? ' is' : 's are'} set in the environment and cannot be
          changed here. Remove the variable from <Box component="code">api/.env</Box> (or your Compose file)
          to manage it from this page — deployments that pin their configuration in a file are meant to keep
          that guarantee.
        </Alert>
      )}

      <Stack spacing={3}>
        {SECTIONS.map((section) => (
          <Box key={section.title}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {section.title}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
              {section.subtitle}
            </Typography>
            <Divider sx={{ mb: 2 }} />

            {/*
              A flex-wrap row rather than a single column: a narrow field (a port, a
              facility number) is one third the width of a dialog and a vertical
              stack of them leaves most of the row empty for every one of them. Full
              fields (a URL, a select with a long helper, a switch) still claim the
              whole row — only the fields marked `narrow` share one.
            */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {section.fields.map((field) => {
                const isPinned = pinned.has(field.key);
                const state = settings.data?.settings[field.key];
                // The pinned chip (with its own tooltip naming the variable) sits next to
                // every pinned field already, so the helper text only needs to say
                // whatever is specific to the field, not restate that it is pinned.
                const helper = field.help;
                const fullRowSx = { flex: '1 1 100%', minWidth: 0 };
                const narrowSx = { flex: '0 1 200px', minWidth: 160 };

                if (field.kind === 'switch') {
                  return (
                    <Box key={field.key} sx={fullRowSx}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={currentValue(field.key, 'switch') === true}
                            disabled={isPinned || save.isPending}
                            onChange={(event) =>
                              setDraft((current) => ({ ...current, [field.key]: event.target.checked }))
                            }
                            slotProps={{ input: { 'aria-label': field.label } }}
                          />
                        }
                        label={
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <span>{field.label}</span>
                            {isPinned && <PinnedChip name={ENV_NAMES[field.key]} />}
                          </Stack>
                        }
                      />
                      {helper && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {helper}
                        </Typography>
                      )}
                    </Box>
                  );
                }

                if (field.kind === 'secret') {
                  return (
                    <Box key={field.key} sx={fullRowSx}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                        <TextField
                          label={field.label}
                          size="small"
                          fullWidth={!field.narrow}
                          type="password"
                          autoComplete="new-password"
                          value={currentValue(field.key, 'secret')}
                          disabled={isPinned || save.isPending}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                          placeholder={state?.configured ? 'configured — type to replace' : 'not configured'}
                          helperText={helper}
                        />
                        {state?.configured && !isPinned && (
                          <Button
                            size="small"
                            onClick={() => clearSecret(field.key)}
                            disabled={save.isPending}
                          >
                            Clear
                          </Button>
                        )}
                      </Stack>
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center' }}>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={state?.configured ? 'success' : 'default'}
                          label={state?.configured ? 'Configured' : 'Not set'}
                        />
                        {isPinned && <PinnedChip name={ENV_NAMES[field.key]} />}
                      </Stack>
                    </Box>
                  );
                }

                const isSelect = field.kind === 'select';
                const isList = field.kind === 'list';

                return (
                  <Box key={field.key} sx={field.narrow ? narrowSx : fullRowSx}>
                    <TextField
                      label={field.label}
                      size="small"
                      select={isSelect}
                      multiline={isList}
                      minRows={isList ? 2 : undefined}
                      type={field.kind === 'number' ? 'number' : 'text'}
                      fullWidth
                      value={currentValue(field.key, field.kind)}
                      disabled={isPinned || save.isPending}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      helperText={helper}
                      slotProps={isList ? { inputLabel: { shrink: true } } : undefined}
                    >
                      {isSelect &&
                        field.options?.map((option) => (
                          <MenuItem key={option} value={option}>
                            {option}
                          </MenuItem>
                        ))}
                    </TextField>
                    {isPinned && (
                      <Box sx={{ mt: 0.5 }}>
                        <PinnedChip name={ENV_NAMES[field.key]} />
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}

function PinnedChip({ name }: Readonly<{ name?: string }>) {
  return (
    <Tooltip title={`Set by ${name ?? 'the environment'}. Remove it from api/.env to edit this here.`}>
      {/*
        Wraps rather than truncates: a narrow field's column is well short of
        SYSLOG_INCLUDE_EVIDENCE, and a chip that ellipsizes the one thing an admin
        needs — which line to remove from api/.env — defeats the point of showing it.
      */}
      <Chip
        size="small"
        variant="outlined"
        icon={<LockOutlinedIcon sx={{ fontSize: 14 }} />}
        label={name ?? 'environment'}
        sx={{
          height: 'auto',
          maxWidth: '100%',
          '& .MuiChip-label': {
            whiteSpace: 'normal',
            overflow: 'visible',
            textOverflow: 'clip',
            display: 'block',
            py: 0.4,
            lineHeight: 1.3,
          },
        }}
      />
    </Tooltip>
  );
}
