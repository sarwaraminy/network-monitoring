import ChatOutlinedIcon from '@mui/icons-material/ChatOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { describeError } from '../api/client';
import { fetchNotifyStatus, sendNotifyTest } from '../api/notify.api';
import SurfaceCard from '../components/SurfaceCard';
import { useAuth } from '../contexts/AuthContext';
import { useFormatters } from '../i18n/format';
import { type Message, useMessageText } from '../i18n/message-state';
import { type UiMessageKey, useT } from '../i18n/ui';

/**
 * Alert delivery.
 *
 * The page answers one question — *is anything actually reaching anyone?* —
 * because notification config fails silently by nature. A wrong webhook URL, a
 * wrong SMTP password, a syslog target pointed at a collector that was
 * decommissioned last quarter: none of it produces an error anybody sees until
 * the night an alert does not arrive. Which is why the Send test button is the
 * most important control here and not a convenience.
 *
 * The two-column split is the substance, not layout. Webhook and email are read
 * by a person, so they are gated by severity, throttled, capped per hour and
 * digested — and every one of those limits is a reason an alert you expected did
 * not arrive, so they are shown next to the channels they apply to. Syslog feeds
 * a SIEM, which correlates and deduplicates itself and needs the complete
 * stream, so it is ungated and shown apart from those numbers. Listing it beside
 * "min severity: high" would be actively misleading.
 *
 * **Editing them is no longer here.** The settings form moved to the
 * administration gear, so there is one place to change delivery rather than two
 * — and this page keeps the half nothing else does: whether it is working, and
 * the test send. The banner below points a reader who used to edit here at where
 * the form went, because "the Settings button is gone" is otherwise indis-
 * tinguishable from a page that broke.
 */

/** Only the two that need explaining; the rest read fine as a number. */
const GATE_NOTES: Record<string, UiMessageKey> = {
  throttle: 'delivery.gate.throttle_note',
  ceiling: 'delivery.gate.ceiling_note',
};

export default function DeliveryPage() {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  // Held as a key, rendered on display — see i18n/message-state.ts.
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; body: Message } | null>(null);
  const messageText = useMessageText();

  const status = useQuery({
    queryKey: ['notify', 'status'],
    queryFn: fetchNotifyStatus,
    refetchInterval: 60_000,
  });

  const test = useMutation({
    mutationFn: sendNotifyTest,
    onSuccess: (result) => {
      const failed = result.results.filter((entry) => !entry.ok);
      setMessage({
        severity: failed.length > 0 ? 'error' : 'success',
        // Names the channel that failed rather than reporting a count. "1 of 2
        // delivered" sends you to the logs; "email failed: invalid login" does not.
        // The failure detail is the server's own words and stays as it came.
        body:
          failed.length > 0
            ? {
                key: 'delivery.test_partial',
                params: {
                  delivered: result.delivered,
                  failures: failed.map((entry) => `${entry.channel} — ${entry.detail}`).join('; '),
                },
              }
            : { key: 'delivery.test_ok', params: { delivered: result.delivered } },
      });
      void queryClient.invalidateQueries({ queryKey: ['notify', 'status'] });
    },
    onError: (error) => {
      setMessage({ severity: 'error', body: { error, fallbackKey: 'delivery.test_failed' } });
    },
  });

  const data = status.data;
  const loading = status.isPending;

  return (
    <>
      <SurfaceCard
        title={t('delivery.title')}
        titleComponent="h1"
        titleVariant="h5"
        subtitle={t('delivery.subtitle')}
        headerActions={
          isAdmin ? (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SendOutlinedIcon />}
                onClick={() => test.mutate()}
                disabled={test.isPending || (data?.channels.length ?? 0) === 0}
              >
                {test.isPending ? t('delivery.sending') : t('delivery.send_test')}
              </Button>
            </Stack>
          ) : null
        }
      />

      {/*
        Where the form went.
        
        Shown to administrators only, because it is the only audience that could
        edit here before and the only one that can edit anywhere now. "The
        Settings button is gone" is otherwise indistinguishable from a page that
        broke — and the gear is in the header, which is not where somebody who
        knew this page would look.
      */}
      {isAdmin && (
        <Alert severity="info" icon={<SettingsOutlinedIcon fontSize="small" />}>
          {/* One key rather than three around the <strong>: splitting a sentence
              to keep emphasis freezes English word order into every other
              language. See QueryConsoleSettings, same trade. */}
          {t('delivery.moved_note')}
        </Alert>
      )}

      {status.error && (
        <Alert severity="error">{describeError(status.error, t('delivery.status_failed'))}</Alert>
      )}

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)}>
          {messageText(message.body)}
        </Alert>
      )}

      {!loading && data && data.channels.length === 0 && (
        <Alert severity="warning">
          {t('delivery.nothing_configured')}
          {isAdmin ? t('delivery.nothing_configured_admin') : t('delivery.nothing_configured_user')}
        </Alert>
      )}

      {/*
        Configured but switched off is its own state, and a confusing one: the
        channels list is populated, the test button works, and no alert is ever
        sent. Worth saying plainly rather than leaving someone to infer it.
      */}
      {!loading && data && !data.enabled && data.channels.length > 0 && (
        <Alert severity="info">
          {t('delivery.switched_off')}
          {isAdmin ? t('delivery.switched_off_admin') : ''}
          {t('delivery.test_still_works')}
          {data.syslog.configured && t('delivery.syslog_unaffected')}
        </Alert>
      )}

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SurfaceCard
            title={t('delivery.for_people')}
            subtitle={t('delivery.for_people_subtitle')}
            sx={{ height: '100%' }}
          >
            <Stack spacing={1.5}>
              <ChannelRow
                icon={<ChatOutlinedIcon />}
                name={t('delivery.channel.webhook')}
                configured={data?.webhook.configured ?? false}
                detail={
                  data?.webhook.format
                    ? t('delivery.channel.webhook_format', { format: data.webhook.format })
                    : t('delivery.channel.webhook_hint')
                }
                loading={loading}
              />
              <ChannelRow
                icon={<MailOutlineIcon />}
                name={t('delivery.channel.email')}
                configured={data?.email.configured ?? false}
                detail={
                  data?.email.configured
                    ? t('delivery.channel.recipients', { count: data.email.recipients })
                    : // The server's own reason when it has one. An OAuth2 mailbox
                      // missing its refresh token has a host, a sender and recipients
                      // already, so the standing sentence would name the three things
                      // that are not the problem.
                      (data?.email.reason ?? t('delivery.channel.email_hint'))
                }
                loading={loading}
              />
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2.5 }}>
              {t('delivery.four_limits')}
            </Typography>

            <Stack spacing={1} sx={{ mt: 1.5 }}>
              <GateRow
                label={t('delivery.min_severity')}
                value={data?.minSeverity ?? '—'}
                loading={loading}
              />
              <GateRow
                label={t('delivery.digest_window')}
                value={data ? `${data.digestSeconds}s` : '—'}
                loading={loading}
              />
              <GateRow
                label={t('delivery.throttle')}
                value={data ? `${data.throttleSeconds}s` : '—'}
                note={GATE_NOTES.throttle}
                loading={loading}
              />
              <GateRow
                label={t('delivery.hourly_ceiling')}
                value={data ? `${data.maxPerHour}/h` : '—'}
                note={GATE_NOTES.ceiling}
                loading={loading}
              />
            </Stack>
          </SurfaceCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <SurfaceCard
            title={t('delivery.for_siem')}
            subtitle={t('delivery.for_siem_subtitle')}
            sx={{ height: '100%' }}
          >
            <ChannelRow
              icon={<DnsOutlinedIcon />}
              name={t('delivery.channel.syslog')}
              configured={data?.syslog.configured ?? false}
              detail={data?.syslog.target ?? t('delivery.channel.syslog_hint')}
              loading={loading}
            />

            {data?.syslog.configured && (
              <Stack spacing={1} sx={{ mt: 2 }}>
                <GateRow
                  label={t('delivery.protocol')}
                  value={data.syslog.protocol.toUpperCase()}
                  loading={false}
                />
                <GateRow
                  label={t('delivery.format')}
                  value={data.syslog.format.toUpperCase()}
                  loading={false}
                />
                <GateRow label={t('delivery.framing')} value={`RFC ${data.syslog.rfc}`} loading={false} />
                <GateRow
                  label={t('delivery.evidence')}
                  value={data.syslog.includeEvidence ? t('delivery.included') : t('delivery.omitted')}
                  loading={false}
                />
              </Stack>
            )}

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2.5 }}>
              {t('delivery.siem_note')}
            </Typography>
          </SurfaceCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SurfaceCard title={t('delivery.right_now')} subtitle={t('delivery.right_now_subtitle')}>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatRow label={t('delivery.queued')} value={data?.queued ?? 0} loading={loading} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatRow
                  label={t('delivery.sent_last_hour')}
                  value={data?.sentLastHour ?? 0}
                  loading={loading}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatRow label={t('delivery.throttled')} value={data?.throttledKeys ?? 0} loading={loading} />
              </Grid>
            </Grid>
          </SurfaceCard>
        </Grid>
      </Grid>
    </>
  );
}

function ChannelRow({
  icon,
  name,
  configured,
  detail,
  loading,
}: Readonly<{
  icon: ReactNode;
  name: string;
  configured: boolean;
  detail: string;
  loading: boolean;
}>) {
  const t = useT();
  if (loading) return <Skeleton variant="rounded" height={52} />;

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <Box sx={{ color: configured ? 'success.main' : 'text.disabled', display: 'flex' }}>{icon}</Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {name}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {detail}
        </Typography>
      </Box>
      <Chip
        size="small"
        variant="outlined"
        color={configured ? 'success' : 'default'}
        label={configured ? t('delivery.configured') : t('delivery.off')}
      />
    </Stack>
  );
}

function GateRow({
  label,
  value,
  note,
  loading,
}: Readonly<{ label: string; value: string; note?: UiMessageKey; loading: boolean }>) {
  // A key, not a sentence, and rendered here rather than by the caller.
  //
  // `GATE_NOTES` was converted to hold keys and both call sites passed them
  // straight through, so `/delivery` rendered `delivery.gate.throttle_note` on
  // screen in every language. Every guard reported green: `tsc` because
  // `UiMessageKey` is a string subtype and this prop was `string`, the orphan
  // check because the literals do appear in `GATE_NOTES`, and parity because the
  // keys exist everywhere with no placeholders. Narrowing the prop is what makes
  // passing an unrendered key a compile error instead of a silent one.
  const t = useT();
  if (loading) return <Skeleton height={20} />;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1, minWidth: 0 }}>
        {label}
        {note && (
          <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
            {t(note)}
          </Typography>
        )}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
  );
}

function StatRow({ label, value, loading }: Readonly<{ label: string; value: number; loading: boolean }>) {
  const fmt = useFormatters();
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      {loading ? (
        <Skeleton width={64} height={32} />
      ) : (
        <Typography variant="h5" component="p" sx={{ lineHeight: 1.2 }}>
          {fmt.number(value)}
        </Typography>
      )}
    </Box>
  );
}
