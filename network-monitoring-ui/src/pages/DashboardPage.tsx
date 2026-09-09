import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RadarIcon from '@mui/icons-material/Radar';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAlertDashboard } from '../api/alerts.api';
import { describeError } from '../api/client';
import { fetchCaptureStatus } from '../api/packets.api';
import { ALL_SENSORS, queryKeys } from '../api/queryClient';
import MagnitudeBarChart from '../charts/MagnitudeBarChart';
import SeverityTrendChart from '../charts/SeverityTrendChart';
import { useChartPalette } from '../charts/useChartPalette';
import { KIND_LABEL, SEVERITY_STYLE } from '../components/SeverityChip';
import StatTile from '../components/StatTile';
import SurfaceCard from '../components/SurfaceCard';
import { distinctMacCount, useKnownDevices, useSensors } from '../hooks/useAlerts';
import { type UiMessageKey, useT } from '../i18n/ui';
import type { AlertKind, TrendBucket } from '../types';

/**
 * Trend windows.
 *
 * The last two exist to reach past `ALERT_RETENTION_DAYS`, whose default is a year.
 * Once detail has expired, those days are served from the daily rollup rather than
 * from `alerts` — a window that could never exceed the retention setting would have
 * made the rollup invisible from here, which is most of what it is for.
 *
 * 1825 matches `MAX_TREND_DAYS`'s own floor in api/src/routes/validation.ts
 * (`Math.max(1825, env.retention.alertDays + 1)`), so this reaches every rolled-up
 * day for the common case — `ALERT_RETENTION_DAYS` left at its default or anywhere
 * under five years. `ALERT_RETENTION_DAYS` itself has no ceiling, though, so an
 * operator who configures a longer window (a compliance-driven decade, say) has
 * real, API-reachable rollup data beyond what any option here can request. Fixing
 * that fully means the API telling this page how far back retention actually
 * reaches, which is worth doing if that case shows up in practice.
 */
/**
 * What each bucket is called, and how its bars are counted.
 *
 * Tables rather than conditionals because there are four units now: a chain of
 * ternaries that has to stay in step with `TREND_BUCKETS` is the shape that
 * silently keeps working while quietly saying "per day" about a month.
 * `satisfies Record<TrendBucket, …>` is what makes a fifth unit a compile error
 * here rather than a wrong caption.
 */
const BUCKET_SUBTITLE = {
  hour: 'dashboard.per_hour',
  day: 'dashboard.per_day',
  week: 'dashboard.per_week',
  month: 'dashboard.per_month',
} as const satisfies Record<TrendBucket, UiMessageKey>;

const BUCKET_COUNT = {
  hour: 'dashboard.hours_count',
  day: 'dashboard.days_count',
  week: 'dashboard.weeks_count',
  month: 'dashboard.months_count',
} as const satisfies Record<TrendBucket, UiMessageKey>;

const PERIODS = [
  { value: 1, labelKey: 'period.24h' },
  { value: 7, labelKey: 'period.7d' },
  { value: 30, labelKey: 'period.30d' },
  { value: 90, labelKey: 'period.90d' },
  { value: 365, labelKey: 'period.12m' },
  { value: 1825, labelKey: 'period.5y' },
] as const satisfies readonly { value: number; labelKey: UiMessageKey }[];

/**
 * The landing page: what is happening, at a glance.
 *
 * There was no visualisation anywhere in the app before this — the only view of
 * findings was a table, which answers "what happened" but not "is it getting
 * worse" or "who is responsible".
 *
 * Form choices follow the data's job: headline counts are stat tiles rather than
 * one-bar charts, the trend is a stacked column, and the two rankings are
 * horizontal bars. See charts/palette.ts for the colour reasoning.
 */
export default function DashboardPage() {
  const t = useT();
  const [days, setDays] = useState<number>(7);
  const [sensor, setSensor] = useState<string>('');
  const navigate = useNavigate();
  const palette = useChartPalette();

  // Shown only once a second sensor has written something — see AlertsPage for
  // the reasoning. A dashboard that merges two segments into one trend is the
  // readable answer while there is one segment and a misleading one after that,
  // so the control appears exactly when it starts to matter.
  const sensorsQuery = useSensors();
  const sensors = sensorsQuery.data ?? [];
  const multiSensor = sensors.length > 1;

  /*
   * Applied only while the selection still names a sensor that exists — see
   * AlertsPage, which carries the full reasoning. `sensors` shrinks in ordinary
   * operation, and a stale filter lands harder here than anywhere else: every
   * query on this page takes it, so the trend, all four tiles and the device
   * count zero together. An empty dashboard reads as "the capture stopped" or
   * "the database is empty", not as a filter — and the control, rendering blank
   * because its value matches no option, says nothing is filtered.
   */
  const appliedSensor = sensors.some((entry) => entry.sensorId === sensor) ? sensor : undefined;

  const dashboard = useQuery({
    queryKey: ['alerts', 'dashboard', days, appliedSensor ?? ALL_SENSORS],
    queryFn: () => fetchAlertDashboard(days, appliedSensor),
    refetchInterval: 30_000,
  });

  const interfaceStatus = useQuery({
    queryKey: queryKeys.captureStatus('interface'),
    queryFn: () => fetchCaptureStatus('interface'),
    refetchInterval: 10_000,
  });

  const devices = useKnownDevices(appliedSensor);

  // Distinct addresses, not rows — see `distinctMacCount`. The tile's caption
  // says "MAC addresses seen", and since V16 a row is a (sensor, MAC) pair.
  const knownMacCount = distinctMacCount(devices.data ?? []);

  const data = dashboard.data;
  const loading = dashboard.isPending;
  /*
   * The API's answer, not a second copy of its rule.
   *
   * This used to be `days <= 2 ? 'hour' : 'day'` — the same expression the route
   * evaluated to build the query — so the axis labelled itself from an
   * independent guess about what the server had done. That held while there were
   * two units and would not have survived four. `'day'` until the first response
   * arrives, which only affects the empty-state caption.
   */
  const bucket: TrendBucket = data?.bucket ?? 'day';

  const criticalAndHigh = (data?.bySeverity.critical ?? 0) + (data?.bySeverity.high ?? 0);
  const capturing = interfaceStatus.data?.capturing ?? false;

  return (
    <>
      <SurfaceCard
        title={t('dashboard.title')}
        titleComponent="h1"
        titleVariant="h5"
        subtitle={t('dashboard.subtitle')}
        headerActions={
          <>
            {multiSensor && (
              <TextField
                select
                size="small"
                label={t('dashboard.sensor')}
                // What is in force, not what was picked — see AlertsPage.
                value={appliedSensor ?? ''}
                onChange={(event) => setSensor(event.target.value)}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="">{t('common.all_sensors')}</MenuItem>
                {sensors.map((entry) => (
                  <MenuItem key={entry.sensorId} value={entry.sensorId}>
                    {entry.sensorId}
                    {entry.self ? ' (this one)' : ''}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              size="small"
              label={t('dashboard.period')}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              sx={{ minWidth: 160 }}
            >
              {PERIODS.map((period) => (
                <MenuItem key={period.value} value={period.value}>
                  {t(period.labelKey)}
                </MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              startIcon={<RefreshIcon />}
              // `void` earns its place here, unlike the capture controls: refetch
              // really does return a promise, and this deliberately does not
              // await it — the button reflects `isFetching`, not the result.
              onClick={() => void dashboard.refetch()}
              disabled={dashboard.isFetching}
            >
              {t('common.refresh')}
            </Button>
          </>
        }
      />

      {dashboard.error && (
        <Alert severity="error">{describeError(dashboard.error, t('dashboard.load_failed'))}</Alert>
      )}

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('dashboard.open_findings')}
            value={data?.unacknowledged ?? 0}
            caption={t('dashboard.total_all_time', { count: data?.total ?? 0 })}
            icon={<WarningAmberOutlinedIcon />}
            accent={palette.bar}
            loading={loading}
            onClick={() => navigate('/alerts')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('dashboard.critical_high')}
            value={criticalAndHigh}
            caption={t('dashboard.needs_attention')}
            icon={<ErrorOutlineIcon />}
            accent={palette.severity.critical}
            loading={loading}
            onClick={() => navigate('/alerts')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('dashboard.capture')}
            value={capturing ? t('dashboard.capture_running') : t('dashboard.capture_idle')}
            caption={
              interfaceStatus.data?.captureAvailable === false
                ? t('dashboard.pcap_unavailable')
                : // The link type is a libpcap identifier (EN10MB), not prose — left
                  // as it is for the reason the catalogue gives about identifiers.
                  (interfaceStatus.data?.linkType ?? t('dashboard.no_capture'))
            }
            icon={<RadarIcon />}
            accent={capturing ? palette.bar : undefined}
            loading={interfaceStatus.isPending}
            onClick={() => navigate('/capture-packets')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('dashboard.known_devices')}
            value={knownMacCount}
            caption={t('dashboard.macs_seen')}
            icon={<DevicesOtherIcon />}
            loading={devices.isPending}
          />
        </Grid>
      </Grid>

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <ChartCard
            title={t('dashboard.over_time')}
            subtitle={t(BUCKET_SUBTITLE[bucket])}
            loading={loading}
            action={
              data && data.trend.length > 0 ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={t(BUCKET_COUNT[bucket], { count: data.trend.length })}
                />
              ) : null
            }
          >
            <SeverityTrendChart
              trend={data?.trend ?? []}
              bucket={bucket}
              rolledUpBefore={data?.rolledUpBefore ?? null}
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <ChartCard
            title={t('dashboard.by_detector')}
            subtitle={t('dashboard.which_firing')}
            loading={loading}
          >
            <MagnitudeBarChart
              valueLabel={t('dashboard.findings')}
              data={(data?.byKind ?? []).map((row) => ({
                label: KIND_LABEL[row.kind as AlertKind] ? t(KIND_LABEL[row.kind as AlertKind]) : row.kind,
                value: row.count,
                detail: t('dashboard.occurrences', { count: row.occurrences }),
              }))}
              emptyMessage={t('dashboard.no_findings')}
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <ChartCard
            title={t('dashboard.top_sources')}
            subtitle={t('dashboard.top_sources_subtitle')}
            loading={loading}
          >
            <MagnitudeBarChart
              valueLabel={t('dashboard.findings')}
              data={(data?.topSources ?? []).map((row) => ({
                label: row.sourceIp,
                value: row.count,
                detail: t('dashboard.occurrences', { count: row.occurrences }),
              }))}
              emptyMessage={t('dashboard.no_source_findings')}
              labelsAreIdentifiers
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <ChartCard
            title={t('dashboard.severity_breakdown')}
            subtitle={t('dashboard.all_time')}
            loading={loading}
          >
            <MagnitudeBarChart
              valueLabel={t('dashboard.findings')}
              data={(['critical', 'high', 'medium', 'low', 'info'] as const)
                .map((severity) => ({
                  // The keys SeverityChip renders, so a severity does not appear
                  // in English on this chart and translated on the row beside it.
                  label: t(SEVERITY_STYLE[severity].labelKey),
                  value: data?.bySeverity[severity] ?? 0,
                }))
                .filter((row) => row.value > 0)}
              emptyMessage={t('dashboard.no_findings')}
            />
          </ChartCard>
        </Grid>
      </Grid>
    </>
  );
}

/**
 * A chart panel: SurfaceCard, plus the skeleton every chart here wants.
 *
 * Kept as a wrapper rather than inlined at each call site so the four charts
 * cannot drift apart on placeholder height, which is what decides whether the
 * grid jumps as the data lands.
 */
function ChartCard({
  title,
  subtitle,
  children,
  loading,
  action,
}: Readonly<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  loading?: boolean;
  action?: React.ReactNode;
}>) {
  return (
    <SurfaceCard title={title} subtitle={subtitle} headerActions={action} sx={{ height: '100%' }}>
      {loading ? <Skeleton variant="rounded" height={260} /> : children}
    </SurfaceCard>
  );
}

// Re-exported so tests can assert against the same palette the charts use.
export { chartPalette } from '../charts/palette';
