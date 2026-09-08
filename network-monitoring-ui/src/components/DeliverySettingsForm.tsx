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
import { type UiMessageKey, useT } from '../i18n/ui';
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
  /**
   * Catalogue keys, not sentences — this table is module-level, so it is built
   * once at import before any locale exists. See QueryConsoleSettings, which
   * carries the same reasoning.
   */
  labelKey: UiMessageKey;
  kind: FieldKind;
  helpKey?: UiMessageKey;
  options?: readonly string[];
  /** Rendered narrow, so a port does not get a full-width box. */
  narrow?: true;
  /**
   * Shown only while another field holds this value.
   *
   * Used for the two SMTP auth methods, whose fields are mutually exclusive: a
   * password box on an OAuth2 mailbox and a client secret on a relay are both
   * controls that accept an edit and change nothing, which is rule 1 of this
   * component in a different disguise. A hidden field's unsaved edit is not sent —
   * see `visibleFields` — so switching the method back and forth cannot save a
   * value the operator can no longer see.
   */
  showWhen?: { key: string; equals: string };
}

interface Section {
  title: UiMessageKey;
  subtitle: UiMessageKey;
  fields: FieldDef[];
}

const SECTIONS: Section[] = [
  {
    title: 'delivery.section.0',
    subtitle: 'delivery.section.0_subtitle',
    fields: [
      {
        key: 'enabled',
        labelKey: 'delivery.field.enabled',
        kind: 'switch',
        helpKey: 'delivery.field.enabled_help',
      },
      {
        key: 'minSeverity',
        labelKey: 'delivery.field.minSeverity',
        kind: 'select',
        options: ['critical', 'high', 'medium', 'low', 'info'],
        narrow: true,
      },
      {
        key: 'digestSeconds',
        labelKey: 'delivery.field.digestSeconds',
        kind: 'number',
        narrow: true,
        helpKey: 'delivery.field.digestSeconds_help',
      },
      {
        key: 'throttleSeconds',
        labelKey: 'delivery.field.throttleSeconds',
        kind: 'number',
        narrow: true,
        helpKey: 'delivery.field.throttleSeconds_help',
      },
      {
        key: 'maxPerHour',
        labelKey: 'delivery.field.maxPerHour',
        kind: 'number',
        narrow: true,
        helpKey: 'delivery.field.maxPerHour_help',
      },
      {
        key: 'includeEvidence',
        labelKey: 'delivery.field.includeEvidence',
        kind: 'switch',
        helpKey: 'delivery.field.includeEvidence_help',
      },
      {
        key: 'dashboardUrl',
        labelKey: 'delivery.field.dashboardUrl',
        kind: 'text',
        helpKey: 'delivery.field.dashboardUrl_help',
      },
    ],
  },
  {
    title: 'delivery.section.1',
    subtitle: 'delivery.section.1_subtitle',
    fields: [
      {
        key: 'webhookUrl',
        labelKey: 'delivery.field.webhookUrl',
        kind: 'secret',
        helpKey: 'delivery.field.webhookUrl_help',
      },
      {
        key: 'webhookFormat',
        labelKey: 'delivery.field.webhookFormat',
        kind: 'select',
        options: ['auto', 'slack', 'teams', 'teams-connector', 'discord', 'generic'],
        narrow: true,
        helpKey: 'delivery.field.webhookFormat_help',
      },
    ],
  },
  {
    title: 'delivery.section.2',
    subtitle: 'delivery.section.2_subtitle',
    fields: [
      { key: 'emailHost', labelKey: 'delivery.field.emailHost', kind: 'text' },
      { key: 'emailPort', labelKey: 'delivery.field.emailPort', kind: 'number', narrow: true },
      {
        key: 'emailSecure',
        labelKey: 'delivery.field.emailSecure',
        kind: 'switch',
        helpKey: 'delivery.field.emailSecure_help',
      },
      { key: 'emailFrom', labelKey: 'delivery.field.emailFrom', kind: 'text' },
      {
        key: 'emailTo',
        labelKey: 'delivery.field.emailTo',
        kind: 'list',
        helpKey: 'delivery.field.emailTo_help',
      },
      {
        key: 'emailAuthMethod',
        labelKey: 'delivery.field.emailAuthMethod',
        kind: 'select',
        options: ['password', 'oauth2'],
        narrow: true,
        helpKey: 'delivery.field.emailAuthMethod_help',
      },
      {
        key: 'emailUser',
        labelKey: 'delivery.field.emailUser',
        kind: 'text',
        helpKey: 'delivery.field.emailUser_help',
      },
      {
        key: 'emailPassword',
        labelKey: 'delivery.field.emailPassword',
        kind: 'secret',
        showWhen: { key: 'emailAuthMethod', equals: 'password' },
        helpKey: 'delivery.field.emailPassword_help',
      },
      {
        key: 'emailOauthTokenUrl',
        labelKey: 'delivery.field.emailOauthTokenUrl',
        kind: 'text',
        showWhen: { key: 'emailAuthMethod', equals: 'oauth2' },
        helpKey: 'delivery.field.emailOauthTokenUrl_help',
      },
      {
        key: 'emailOauthClientId',
        labelKey: 'delivery.field.emailOauthClientId',
        kind: 'text',
        showWhen: { key: 'emailAuthMethod', equals: 'oauth2' },
      },
      {
        key: 'emailOauthClientSecret',
        labelKey: 'delivery.field.emailOauthClientSecret',
        kind: 'secret',
        showWhen: { key: 'emailAuthMethod', equals: 'oauth2' },
      },
      {
        key: 'emailOauthRefreshToken',
        labelKey: 'delivery.field.emailOauthRefreshToken',
        kind: 'secret',
        showWhen: { key: 'emailAuthMethod', equals: 'oauth2' },
        helpKey: 'delivery.field.emailOauthRefreshToken_help',
      },
      {
        key: 'emailOauthScope',
        labelKey: 'delivery.field.emailOauthScope',
        kind: 'text',
        showWhen: { key: 'emailAuthMethod', equals: 'oauth2' },
        helpKey: 'delivery.field.emailOauthScope_help',
      },
    ],
  },
  {
    title: 'delivery.section.3',
    subtitle: 'delivery.section.3_subtitle',
    fields: [
      { key: 'syslogHost', labelKey: 'delivery.field.syslogHost', kind: 'text' },
      { key: 'syslogPort', labelKey: 'delivery.field.syslogPort', kind: 'number', narrow: true },
      {
        key: 'syslogProtocol',
        labelKey: 'delivery.field.syslogProtocol',
        kind: 'select',
        options: ['udp', 'tcp'],
        narrow: true,
      },
      {
        key: 'syslogFormat',
        labelKey: 'delivery.field.syslogFormat',
        kind: 'select',
        options: ['cef', 'json'],
        narrow: true,
      },
      {
        key: 'syslogRfc',
        labelKey: 'delivery.field.syslogRfc',
        kind: 'select',
        options: ['5424', '3164'],
        narrow: true,
        helpKey: 'delivery.field.syslogRfc_help',
      },
      {
        key: 'syslogFacility',
        labelKey: 'delivery.field.syslogFacility',
        kind: 'number',
        narrow: true,
        helpKey: 'delivery.field.syslogFacility_help',
      },
      { key: 'syslogAppName', labelKey: 'delivery.field.syslogAppName', kind: 'text', narrow: true },
      {
        key: 'syslogIncludeEvidence',
        labelKey: 'delivery.field.syslogIncludeEvidence',
        kind: 'switch',
        helpKey: 'delivery.field.syslogIncludeEvidence_help',
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
  emailAuthMethod: 'SMTP_AUTH_METHOD',
  emailOauthClientId: 'SMTP_OAUTH_CLIENT_ID',
  emailOauthClientSecret: 'SMTP_OAUTH_CLIENT_SECRET',
  emailOauthRefreshToken: 'SMTP_OAUTH_REFRESH_TOKEN',
  emailOauthTokenUrl: 'SMTP_OAUTH_TOKEN_URL',
  emailOauthScope: 'SMTP_OAUTH_SCOPE',
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
  const t = useT();
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
      setMessage({ severity: 'success', text: t('delivery.saved') });
    },
    onError: (error) => {
      // The server's own message is the useful one: it names a pinned field, or the
      // bound a number missed.
      setMessage({ severity: 'error', text: describeError(error, t('delivery.save_failed')) });
    },
  });

  /** The classic SMTP misconfiguration, described if the current pair is one. */
  const smtpMismatch = (() => {
    const host = String(currentValue('emailHost', 'text'));
    if (host.trim() === '') return null;

    const secure = currentValue('emailSecure', 'switch') === true;
    const port = Number(currentValue('emailPort', 'number'));

    if (secure && port === 587) {
      return t('delivery.tls_587');
    }
    if (!secure && port === 465) {
      return t('delivery.tls_465');
    }
    return null;
  })();

  /**
   * Whether a field applies to the configuration as it currently stands.
   *
   * Only the two SMTP auth methods use this. It reads the *current* value rather
   * than the saved one, so switching the method reveals its fields before saving —
   * the alternative would need a save to find out what the other method even asks
   * for.
   */
  const isVisible = (field: FieldDef): boolean =>
    !field.showWhen || currentValue(field.showWhen.key, 'select') === field.showWhen.equals;

  /**
   * Every field that applies, across all sections.
   *
   * Both the unsaved count and the patch are built from this rather than from the
   * whole form: an edit to a field that is no longer shown must not be counted as
   * "1 unsaved" against nothing visible, and must not be saved by a later click on
   * a form where it cannot be seen. It stays in `draft`, so switching the method
   * back brings the typed value with it.
   */
  /**
   * A secret belonging to the *other* authentication method, still stored.
   *
   * Switching from OAuth2 back to a password hid the refresh token along with its
   * Clear button, and the server still had it: a credential with no path in the
   * interface to revoke it. It stays on screen while it is stored, so it can be
   * cleared and nothing else — see the rendering below, which disables the box.
   *
   * Deliberately *not* part of `visibleFields`, which is what builds the patch: a
   * value typed into a field the current method does not use must still never be
   * saved. `clearSecret` sends its one key directly and so is unaffected.
   */
  const isStranded = (field: FieldDef): boolean =>
    field.kind === 'secret' && !isVisible(field) && settings.data?.settings[field.key]?.configured === true;

  const visibleFields = SECTIONS.flatMap((section) => section.fields).filter(isVisible);

  const changedFields = Object.keys(draft).filter((key) => {
    const def = visibleFields.find((field) => field.key === key);
    if (!def) return false;
    // A secret counts as changed only when something was typed into it.
    if (def.kind === 'secret') return String(draft[key] ?? '') !== '';
    return draft[key] !== savedValue(key, def.kind);
  });

  const submit = () => {
    const patch: DeliverySettingsPatch = {};
    for (const key of changedFields) {
      const def = visibleFields.find((field) => field.key === key);
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
      text: t('delivery.all_pinned_note'),
    });
  };

  const clearSecret = (key: string) => {
    save.mutate({ [key]: null });
  };

  if (settings.error) {
    return (
      <SurfaceCard title={t('delivery.settings_title')} embedded={embedded}>
        <Alert severity="error">{describeError(settings.error, t('delivery.read_failed'))}</Alert>
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
      <SurfaceCard
        title={t('delivery.settings_title')}
        subtitle={t('delivery.form_loading')}
        embedded={embedded}
      >
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
      title={t('delivery.settings_title')}
      subtitle={t('delivery.form_subtitle')}
      embedded={embedded}
      headerActions={
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {changedFields.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('delivery.unsaved', { count: changedFields.length })}
            </Typography>
          )}
          <Button
            size="small"
            onClick={() => setDraft({})}
            disabled={changedFields.length === 0 || save.isPending}
          >
            {t('common.discard')}
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={submit}
            disabled={changedFields.length === 0 || save.isPending}
          >
            {save.isPending ? t('delivery.saving') : t('delivery.save_changes')}
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
          {t('delivery.pinned_note', { count: pinned.size })}
        </Alert>
      )}

      <Stack spacing={3}>
        {SECTIONS.map((section) => (
          <Box key={section.title}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {t(section.title)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
              {t(section.subtitle)}
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
              {section.fields
                .filter((field) => isVisible(field) || isStranded(field))
                .map((field) => {
                  const isPinned = pinned.has(field.key);
                  const state = settings.data?.settings[field.key];
                  // The pinned chip (with its own tooltip naming the variable) sits next to
                  // every pinned field already, so the helper text only needs to say
                  // whatever is specific to the field, not restate that it is pinned.
                  const helper = field.helpKey ? t(field.helpKey) : undefined;
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
                              slotProps={{ input: { 'aria-label': t(field.labelKey) } }}
                            />
                          }
                          label={
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <span>{t(field.labelKey)}</span>
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
                    const stranded = isStranded(field);
                    return (
                      <Box key={field.key} sx={fullRowSx}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                          <TextField
                            label={t(field.labelKey)}
                            size="small"
                            fullWidth={!field.narrow}
                            type="password"
                            autoComplete="new-password"
                            value={stranded ? '' : currentValue(field.key, 'secret')}
                            // A stranded secret is shown to be removed, not edited:
                            // the current method does not use it, so replacing it
                            // would store a credential nothing reads.
                            disabled={stranded || isPinned || save.isPending}
                            onChange={(event) =>
                              setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                            }
                            placeholder={
                              stranded
                                ? t('delivery.secret_stored_unused')
                                : state?.configured
                                  ? t('delivery.secret_configured')
                                  : t('delivery.secret_unset')
                            }
                            helperText={stranded ? t('delivery.secret_unused_note') : helper}
                          />
                          {state?.configured && !isPinned && (
                            <Button
                              size="small"
                              onClick={() => clearSecret(field.key)}
                              disabled={save.isPending}
                            >
                              {t('common.clear')}
                            </Button>
                          )}
                        </Stack>
                        <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center' }}>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={state?.configured ? 'success' : 'default'}
                            label={state?.configured ? t('delivery.configured') : t('delivery.set_not_set')}
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
                        label={t(field.labelKey)}
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
  const t = useT();
  return (
    <Tooltip title={t('delivery.pinned_by', { name: name ?? t('delivery.the_environment') })}>
      {/*
        Wraps rather than truncates: a narrow field's column is well short of
        SYSLOG_INCLUDE_EVIDENCE, and a chip that ellipsizes the one thing an admin
        needs — which line to remove from api/.env — defeats the point of showing it.
      */}
      <Chip
        size="small"
        variant="outlined"
        icon={<LockOutlinedIcon sx={{ fontSize: 14 }} />}
        label={name ?? t('delivery.environment')}
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
