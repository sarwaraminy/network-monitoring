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
import { queryKeys } from '../api/queryClient';
import MagnitudeBarChart from '../charts/MagnitudeBarChart';
import SeverityTrendChart from '../charts/SeverityTrendChart';
import { useChartPalette } from '../charts/useChartPalette';
import { KIND_LABEL } from '../components/SeverityChip';
import StatTile from '../components/StatTile';
import SurfaceCard from '../components/SurfaceCard';
import { distinctMacCount, useKnownDevices, useSensors } from '../hooks/useAlerts';
import type { AlertKind } from '../types';

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
const PERIODS = [
  { value: 1, label: 'Last 24 hours' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 12 months' },
  { value: 1825, label: 'Last 5 years' },
] as const;

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
   * Derived, never applied straight from the state — see AlertsPage, which
   * carries the full reasoning. `sensors` shrinks in ordinary operation, and a
   * filter that goes on applying after its control has been unmounted presents
   * as an empty dashboard with no visible cause.
   */
  const appliedSensor = multiSensor ? sensor || undefined : undefined;

  const dashboard = useQuery({
    queryKey: ['alerts', 'dashboard', days, appliedSensor ?? 'all'],
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
  const bucket = days <= 2 ? 'hour' : 'day';

  const criticalAndHigh = (data?.bySeverity.critical ?? 0) + (data?.bySeverity.high ?? 0);
  const capturing = interfaceStatus.data?.capturing ?? false;

  return (
    <>
      <SurfaceCard
        title="Dashboard"
        titleComponent="h1"
        titleVariant="h5"
        subtitle="What the detectors have found, and which hosts keep appearing"
        headerActions={
          <>
            {multiSensor && (
              <TextField
                select
                size="small"
                label="Sensor"
                value={sensor}
                onChange={(event) => setSensor(event.target.value)}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="">All sensors</MenuItem>
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
              label="Period"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              sx={{ minWidth: 160 }}
            >
              {PERIODS.map((period) => (
                <MenuItem key={period.value} value={period.value}>
                  {period.label}
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
              Refresh
            </Button>
          </>
        }
      />

      {dashboard.error && (
        <Alert severity="error">{describeError(dashboard.error, 'Could not load the dashboard')}</Alert>
      )}

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label="Open findings"
            value={data?.unacknowledged ?? 0}
            caption={`${(data?.total ?? 0).toLocaleString()} total, all time`}
            icon={<WarningAmberOutlinedIcon />}
            accent={palette.bar}
            loading={loading}
            onClick={() => navigate('/alerts')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label="Critical and high"
            value={criticalAndHigh}
            caption="Needs attention first"
            icon={<ErrorOutlineIcon />}
            accent={palette.severity.critical}
            loading={loading}
            onClick={() => navigate('/alerts')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label="Capture"
            value={capturing ? 'Running' : 'Idle'}
            caption={
              interfaceStatus.data?.captureAvailable === false
                ? 'pcap library unavailable'
                : (interfaceStatus.data?.linkType ?? 'No capture started')
            }
            icon={<RadarIcon />}
            accent={capturing ? palette.bar : undefined}
            loading={interfaceStatus.isPending}
            onClick={() => navigate('/capture-packets')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label="Known devices"
            value={knownMacCount}
            caption="MAC addresses seen"
            icon={<DevicesOtherIcon />}
            loading={devices.isPending}
          />
        </Grid>
      </Grid>

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <ChartCard
            title="Findings over time"
            subtitle={`By severity, per ${bucket}`}
            loading={loading}
            action={
              data && data.trend.length > 0 ? (
                <Chip size="small" variant="outlined" label={`${data.trend.length} ${bucket}s`} />
              ) : null
            }
          >
            <SeverityTrendChart trend={data?.trend ?? []} bucket={bucket} />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <ChartCard title="Findings by detector" subtitle="Which checks are firing" loading={loading}>
            <MagnitudeBarChart
              valueLabel="Findings"
              data={(data?.byKind ?? []).map((row) => ({
                label: KIND_LABEL[row.kind as AlertKind] ?? row.kind,
                value: row.count,
                detail: `${row.occurrences.toLocaleString()} occurrences`,
              }))}
              emptyMessage="No findings yet."
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <ChartCard
            title="Most implicated sources"
            subtitle="Addresses appearing in the most findings"
            loading={loading}
          >
            <MagnitudeBarChart
              valueLabel="Findings"
              data={(data?.topSources ?? []).map((row) => ({
                label: row.sourceIp,
                value: row.count,
                detail: `${row.occurrences.toLocaleString()} occurrences`,
              }))}
              emptyMessage="No findings with a source address yet."
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <ChartCard title="Severity breakdown" subtitle="All findings, all time" loading={loading}>
            <MagnitudeBarChart
              valueLabel="Findings"
              data={(['critical', 'high', 'medium', 'low', 'info'] as const)
                .map((severity) => ({ label: capitalise(severity), value: data?.bySeverity[severity] ?? 0 }))
                .filter((row) => row.value > 0)}
              emptyMessage="No findings yet."
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

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Re-exported so tests can assert against the same palette the charts use.
export { chartPalette } from '../charts/palette';
