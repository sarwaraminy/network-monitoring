import ChatOutlinedIcon from '@mui/icons-material/ChatOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { describeError } from '../api/client';
import { fetchNotifyStatus, sendNotifyTest } from '../api/notify.api';
import SurfaceCard from '../components/SurfaceCard';
import { useAuth } from '../contexts/AuthContext';

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
 */

/** Only the two that need explaining; the rest read fine as a number. */
const GATE_NOTES: Record<string, string> = {
  throttle: 'The same finding will not notify again inside this window.',
  ceiling: 'A hard limit on messages per hour, whatever detection does.',
};

export default function DeliveryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

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
        text:
          failed.length > 0
            ? `Delivered to ${result.delivered}. Failed: ${failed.map((entry) => `${entry.channel} — ${entry.detail}`).join('; ')}`
            : `Delivered to ${result.delivered} channel(s). Check that each one arrived.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['notify', 'status'] });
    },
    onError: (error) => {
      setMessage({ severity: 'error', text: describeError(error, 'Test send failed') });
    },
  });

  const data = status.data;
  const loading = status.isPending;

  return (
    <>
      <SurfaceCard
        title="Alert delivery"
        titleComponent="h1"
        titleVariant="h5"
        subtitle="Where findings go, and whether they are getting there"
        headerActions={
          isAdmin ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<SendOutlinedIcon />}
              onClick={() => test.mutate()}
              disabled={test.isPending || (data?.channels.length ?? 0) === 0}
            >
              {test.isPending ? 'Sending…' : 'Send test'}
            </Button>
          ) : null
        }
      />

      {status.error && (
        <Alert severity="error">{describeError(status.error, 'Could not read delivery status')}</Alert>
      )}

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {!loading && data && data.channels.length === 0 && (
        <Alert severity="warning">
          Nothing is configured, so findings are recorded and nobody is told. Set{' '}
          <Box component="code">SYSLOG_HOST</Box> to feed a SIEM,{' '}
          <Box component="code">NOTIFY_WEBHOOK_URL</Box> for Slack, Teams or Discord, or{' '}
          <Box component="code">SMTP_HOST</Box> with <Box component="code">NOTIFY_EMAIL_TO</Box> for email.
        </Alert>
      )}

      {/*
        Configured but switched off is its own state, and a confusing one: the
        channels list is populated, the test button works, and no alert is ever
        sent. Worth saying plainly rather than leaving someone to infer it.
      */}
      {!loading && data && !data.enabled && data.channels.length > 0 && (
        <Alert severity="info">
          Channels are configured but <Box component="code">NOTIFY_ENABLED</Box> is off, so no alert will be
          sent. A test send still works — it deliberately bypasses this, since the question it answers is
          whether delivery reaches you at all.
          {data.syslog.configured && ' Syslog is unaffected: it is independent of this switch.'}
        </Alert>
      )}

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SurfaceCard
            title="For people"
            subtitle="Gated, throttled and batched, so the channel does not get muted"
            sx={{ height: '100%' }}
          >
            <Stack spacing={1.5}>
              <ChannelRow
                icon={<ChatOutlinedIcon />}
                name="Webhook"
                configured={data?.webhook.configured ?? false}
                detail={
                  data?.webhook.format
                    ? `${data.webhook.format} format`
                    : 'Slack, Teams, Discord or plain JSON'
                }
                loading={loading}
              />
              <ChannelRow
                icon={<MailOutlineIcon />}
                name="Email"
                configured={data?.email.configured ?? false}
                detail={
                  data?.email.configured
                    ? `${data.email.recipients} recipient${data.email.recipients === 1 ? '' : 's'}`
                    : 'SMTP host, sender and at least one recipient'
                }
                loading={loading}
              />
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2.5 }}>
              Four limits apply before anything is sent. Each one is also a reason an alert you expected did
              not arrive, which is why they are here rather than buried in a config file.
            </Typography>

            <Stack spacing={1} sx={{ mt: 1.5 }}>
              <GateRow label="Minimum severity" value={data?.minSeverity ?? '—'} loading={loading} />
              <GateRow
                label="Digest window"
                value={data ? `${data.digestSeconds}s` : '—'}
                loading={loading}
              />
              <GateRow
                label="Per-finding throttle"
                value={data ? `${data.throttleSeconds}s` : '—'}
                note={GATE_NOTES.throttle}
                loading={loading}
              />
              <GateRow
                label="Hourly ceiling"
                value={data ? `${data.maxPerHour}/h` : '—'}
                note={GATE_NOTES.ceiling}
                loading={loading}
              />
            </Stack>
          </SurfaceCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <SurfaceCard title="For a SIEM" subtitle="Every finding, ungated" sx={{ height: '100%' }}>
            <ChannelRow
              icon={<DnsOutlinedIcon />}
              name="Syslog"
              configured={data?.syslog.configured ?? false}
              detail={data?.syslog.target ?? 'Set SYSLOG_HOST to switch it on'}
              loading={loading}
            />

            {data?.syslog.configured && (
              <Stack spacing={1} sx={{ mt: 2 }}>
                <GateRow label="Protocol" value={data.syslog.protocol.toUpperCase()} loading={false} />
                <GateRow label="Format" value={data.syslog.format.toUpperCase()} loading={false} />
                <GateRow label="Framing" value={`RFC ${data.syslog.rfc}`} loading={false} />
                <GateRow
                  label="Evidence"
                  value={data.syslog.includeEvidence ? 'included' : 'omitted'}
                  loading={false}
                />
              </Stack>
            )}

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2.5 }}>
              None of the limits on the left apply here. A SIEM correlates and deduplicates itself, and it
              does so assuming it holds the complete event stream — a digest makes every rule that counts
              events over a window silently under-report, and turns suppressed events into what look like
              quiet periods.
            </Typography>
          </SurfaceCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <SurfaceCard title="Right now" subtitle="What the queue and the limits are doing">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatRow label="Queued for the next digest" value={data?.queued ?? 0} loading={loading} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatRow label="Sent in the last hour" value={data?.sentLastHour ?? 0} loading={loading} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatRow
                  label="Findings currently throttled"
                  value={data?.throttledKeys ?? 0}
                  loading={loading}
                />
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
        label={configured ? 'Configured' : 'Off'}
      />
    </Stack>
  );
}

function GateRow({
  label,
  value,
  note,
  loading,
}: Readonly<{ label: string; value: string; note?: string; loading: boolean }>) {
  if (loading) return <Skeleton height={20} />;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1, minWidth: 0 }}>
        {label}
        {note && (
          <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
            {note}
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
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      {loading ? (
        <Skeleton width={64} height={32} />
      ) : (
        <Typography variant="h5" component="p" sx={{ lineHeight: 1.2 }}>
          {value.toLocaleString()}
        </Typography>
      )}
    </Box>
  );
}
