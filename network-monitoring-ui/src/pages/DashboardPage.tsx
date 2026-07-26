import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RadarIcon from '@mui/icons-material/Radar';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAlertDashboard } from '../api/alerts.api';
import { describeError } from '../api/client';
import { fetchCaptureStatus } from '../api/packets.api';
import { queryKeys } from '../api/queryClient';
import MagnitudeBarChart from '../charts/MagnitudeBarChart';
import { chartPalette } from '../charts/palette';
import SeverityTrendChart from '../charts/SeverityTrendChart';
import { useChartPalette } from '../charts/useChartPalette';
import { KIND_LABEL } from '../components/SeverityChip';
import StatTile from '../components/StatTile';
import { useKnownDevices } from '../hooks/useAlerts';
import type { AlertKind } from '../types';

const PERIODS = [
  { value: 1, label: 'Last 24 hours' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
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
  const navigate = useNavigate();
  const palette = useChartPalette();

  const dashboard = useQuery({
    queryKey: ['alerts', 'dashboard', days],
    queryFn: () => fetchAlertDashboard(days),
    refetchInterval: 30_000,
  });

  const interfaceStatus = useQuery({
    queryKey: queryKeys.captureStatus('interface'),
    queryFn: () => fetchCaptureStatus('interface'),
    refetchInterval: 10_000,
  });

  const devices = useKnownDevices();

  const data = dashboard.data;
  const loading = dashboard.isPending;
  const bucket = days <= 2 ? 'hour' : 'day';

  const criticalAndHigh = (data?.bySeverity.critical ?? 0) + (data?.bySeverity.high ?? 0);
  const capturing = interfaceStatus.data?.capturing ?? false;

  return (
    <>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="h5" component="h1" sx={{ flexGrow: 1 }}>
          Dashboard
        </Typography>
        {/* Filters sit in one row above the charts. */}
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
          onClick={() => void dashboard.refetch()}
          disabled={dashboard.isFetching}
        >
          Refresh
        </Button>
      </Stack>

      {dashboard.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {describeError(dashboard.error, 'Could not load the dashboard')}
        </Alert>
      )}

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
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
            value={devices.data?.length ?? 0}
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

function ChartCard({
  title,
  subtitle,
  children,
  loading,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  loading?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mb: 1 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
        {loading ? <Skeleton variant="rounded" height={260} /> : children}
      </CardContent>
    </Card>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Re-exported so tests can assert against the same palette the charts use.
export { chartPalette };
