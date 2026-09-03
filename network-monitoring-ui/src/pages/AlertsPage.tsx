import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import UndoIcon from '@mui/icons-material/Undo';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { MRT_ColumnDef, MRT_TableOptions } from 'material-react-table';
import { useCallback, useMemo, useState } from 'react';
import { describeError } from '../api/client';
import AlertSummaryTiles from '../components/AlertSummaryTiles';
import DataGrid from '../components/DataGrid';
import IpInfoDialog from '../components/IpInfoDialog';
import { KIND_DESCRIPTION, KIND_LABEL, SeverityChip } from '../components/SeverityChip';
import SurfaceCard from '../components/SurfaceCard';
import { useAuth } from '../contexts/AuthContext';
import { useAcknowledgeAlert, useAlertSummary, useAlerts, useDeleteAlert } from '../hooks/useAlerts';
import { useIpInfo } from '../hooks/useIpInfo';
import { monoSx } from '../theme';
import { ALERT_KINDS, type AlertKind, type Alert as AlertRecord, type Severity } from '../types';

const WINDOWS = [
  { value: '', label: 'All time' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;

/**
 * The primary view: security findings, most urgent first.
 *
 * This replaces the old per-packet anomaly log. Each row is an event with a
 * severity, an occurrence count and structured evidence, rather than one row per
 * suspicious packet.
 */
export default function AlertsPage() {
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [kind, setKind] = useState<AlertKind | ''>('');
  const [since, setSince] = useState<string>('');
  const [hideAcknowledged, setHideAcknowledged] = useState(true);
  const [actionError, setActionError] = useState('');
  const ipInfo = useIpInfo();
  const { user } = useAuth();
  /*
   * Deleting a finding requires ADMIN on the server, so the button does not exist
   * for anyone else. Acknowledging beside it stays available to everybody: it is
   * what an operator does all day, and it is the reason this row keeps an actions
   * column at all rather than dropping it wholesale the way `SuppressionsPage`
   * does for a non-admin.
   *
   * The server is what enforces this. Hiding the control only stops offering
   * somebody an action that would come back 403 — see AppLayout, where the same
   * convention is stated for the account menu.
   */
  const isAdmin = user?.role === 'ADMIN';

  // The filter values are part of the query key, so changing one refetches and
  // caches independently — no manual reload, and going back to a previous filter
  // is served from cache.
  const filters = useMemo(
    () => ({
      ...(severity === 'all' ? {} : { severity }),
      ...(kind ? { kind } : {}),
      ...(since ? { since } : {}),
      ...(hideAcknowledged ? { acknowledged: false } : {}),
      limit: 500,
    }),
    [severity, kind, since, hideAcknowledged],
  );

  const alertsQuery = useAlerts(filters);
  const summaryQuery = useAlertSummary();
  const acknowledge = useAcknowledgeAlert();
  const remove = useDeleteAlert();

  const alerts = alertsQuery.data ?? [];
  const summary = summaryQuery.data ?? null;
  const loading = alertsQuery.isPending;

  // Whichever failed most recently; mutations report through actionError.
  const error =
    actionError ||
    (alertsQuery.error ? describeError(alertsQuery.error, 'Could not load alerts') : '') ||
    (summaryQuery.error ? describeError(summaryQuery.error, 'Could not load the alert summary') : '');

  const setError = setActionError;
  const load = useCallback(() => {
    setActionError('');
    void alertsQuery.refetch();
    void summaryQuery.refetch();
  }, [alertsQuery, summaryQuery]);

  const handleAcknowledge = useCallback(
    (alert: AlertRecord) => {
      setActionError('');
      acknowledge.mutate(alert, {
        onError: (caught) => setActionError(describeError(caught, 'Could not update the alert')),
      });
    },
    [acknowledge],
  );

  const handleDelete = useCallback(
    (id: number) => {
      setActionError('');
      remove.mutate(id, {
        onError: (caught) => setActionError(describeError(caught, 'Could not delete the alert')),
      });
    },
    [remove],
  );

  const showIp = ipInfo.show;

  const columns = useMemo<MRT_ColumnDef<AlertRecord>[]>(
    () => [
      { accessorKey: 'severity', header: 'Severity', size: 115, Cell: SeverityCell },
      { accessorKey: 'kind', header: 'Detector', size: 165, Cell: DetectorCell },
      { accessorKey: 'title', header: 'Finding', size: 420, Cell: FindingCell },
      { accessorKey: 'sourceIp', header: 'Source', size: 155, Cell: sourceCell(showIp) },
      { accessorKey: 'targetIp', header: 'Target', size: 155, Cell: targetCell(showIp) },
      { accessorKey: 'lastSeen', header: 'Last seen', size: 175, Cell: LastSeenCell },
      { accessorKey: 'acknowledgedAt', header: 'Status', size: 130, Cell: StatusCell },
    ],
    [showIp],
  );

  const tableOptions = {
    enableRowActions: true,
    positionActionsColumn: 'last' as const,
    muiSearchTextFieldProps: { placeholder: 'Search findings', sx: { minWidth: 240 } },
    muiTableBodyRowProps: ({ row }) => ({
      sx: {
        // A left edge in the severity colour, so urgency reads at a glance.
        borderLeft: '4px solid',
        borderLeftColor: severityEdge(row.original.severity),
        opacity: row.original.acknowledgedAt ? 0.6 : 1,
      },
    }),
    renderDetailPanel: ({ row }) => <EvidencePanel alert={row.original} />,
    renderRowActions: ({ row }) => (
      <Stack direction="row" spacing={0.5}>
        <Tooltip title={row.original.acknowledgedAt ? 'Reopen' : 'Acknowledge'}>
          <IconButton size="small" onClick={() => handleAcknowledge(row.original)}>
            {row.original.acknowledgedAt ? (
              <UndoIcon fontSize="small" />
            ) : (
              <CheckCircleOutlineIcon fontSize="small" color="success" />
            )}
          </IconButton>
        </Tooltip>
        {isAdmin && (
          <Tooltip title="Delete — the finding and its evidence go with it">
            <IconButton
              size="small"
              color="error"
              aria-label={`Delete finding ${row.original.id}`}
              onClick={() => handleDelete(row.original.id)}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    ),
    renderTopToolbarCustomActions: () => (
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          alignItems: 'center',
          flexWrap: 'wrap',
          pl: 0.5,
        }}
      >
        <TextField
          select
          size="small"
          label="Detector"
          value={kind}
          onChange={(event) => setKind(event.target.value as AlertKind | '')}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value="">All detectors</MenuItem>
          {ALERT_KINDS.map((value) => (
            <MenuItem key={value} value={value}>
              {KIND_LABEL[value]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Period"
          value={since}
          onChange={(event) => setSince(event.target.value)}
          sx={{ minWidth: 150 }}
        >
          {WINDOWS.map((window) => (
            <MenuItem key={window.value} value={window.value}>
              {window.label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={hideAcknowledged}
              onChange={(event) => setHideAcknowledged(event.target.checked)}
            />
          }
          label={<Typography variant="body2">Open only</Typography>}
        />
        <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refresh
        </Button>
      </Stack>
    ),
    renderEmptyRowsFallback: () => (
      <Box sx={{ py: 7, textAlign: 'center' }}>
        <ShieldOutlinedIcon sx={{ fontSize: 40, color: 'success.main', opacity: 0.7 }} />
        <Typography variant="subtitle1" sx={{ mt: 1 }}>
          Nothing to report
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            maxWidth: 460,
            mx: 'auto',
            mt: 0.5,
          }}
        >
          No findings match these filters. An empty list during a capture means the detectors saw nothing
          suspicious — which is the expected result on a healthy network.
        </Typography>
      </Box>
    ),
  } satisfies Partial<MRT_TableOptions<AlertRecord>>;

  return (
    <>
      <SurfaceCard
        title="Security alerts"
        titleComponent="h1"
        titleVariant="h5"
        subtitle="Every finding the detectors raised, newest first"
        headerActions={
          summary && summary.unacknowledged > 0 ? (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={`${summary.unacknowledged.toLocaleString()} unacknowledged`}
            />
          ) : null
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <AlertSummaryTiles summary={summary} selected={severity} onSelect={setSeverity} />
      <SurfaceCard bodyVariant="grid">
        <DataGrid columns={columns} data={alerts} isLoading={loading} tableOptions={tableOptions} />
      </SurfaceCard>
      <IpInfoDialog
        open={ipInfo.open}
        ipAddress={ipInfo.ipAddress}
        info={ipInfo.info}
        loading={ipInfo.loading}
        error={ipInfo.error}
        onClose={ipInfo.close}
      />
    </>
  );
}

/*
 * Cell renderers, at module scope.
 *
 * MRT's `Cell` is a render prop rather than a component, but it is analysed as
 * one, and defining seven of them inside the page rebuilt seven function
 * identities on every render for no benefit. None of these close over anything
 * except the two that need `showIp`, and those now say so by taking it as an
 * argument instead of reaching outward.
 */

const SeverityCell: MRT_ColumnDef<AlertRecord>['Cell'] = ({ cell }) => (
  <SeverityChip severity={cell.getValue<Severity>()} />
);

const DetectorCell: MRT_ColumnDef<AlertRecord>['Cell'] = ({ cell }) => {
  const value = cell.getValue<AlertKind>();
  return (
    <Tooltip title={KIND_DESCRIPTION[value] ?? ''}>
      <span>{KIND_LABEL[value] ?? value}</span>
    </Tooltip>
  );
};

const FindingCell: MRT_ColumnDef<AlertRecord>['Cell'] = ({ row, cell }) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
    <Typography variant="body2" noWrap sx={{ fontWeight: 550 }}>
      {cell.getValue<string>()}
    </Typography>
    {row.original.occurrences > 1 && (
      <Chip size="small" variant="outlined" label={`×${row.original.occurrences.toLocaleString()}`} />
    )}
  </Stack>
);

const sourceCell =
  (showIp: (ipAddress: string) => void): MRT_ColumnDef<AlertRecord>['Cell'] =>
  ({ row, cell }) => {
    const ip = cell.getValue<string | null>();
    if (ip) return <IpLink value={ip} onClick={showIp} />;
    // ARP and device findings identify the actor by MAC, not IP.
    return <Box sx={monoSx}>{row.original.sourceMac ?? '—'}</Box>;
  };

const targetCell =
  (showIp: (ipAddress: string) => void): MRT_ColumnDef<AlertRecord>['Cell'] =>
  ({ cell }) => {
    const ip = cell.getValue<string | null>();
    return ip ? <IpLink value={ip} onClick={showIp} /> : <Box sx={{ color: 'text.disabled' }}>—</Box>;
  };

const LastSeenCell: MRT_ColumnDef<AlertRecord>['Cell'] = ({ cell }) => (
  <Box sx={monoSx}>{new Date(cell.getValue<string>()).toLocaleString()}</Box>
);

const StatusCell: MRT_ColumnDef<AlertRecord>['Cell'] = ({ row, cell }) =>
  cell.getValue<string | null>() ? (
    <Tooltip title={`Acknowledged by ${row.original.acknowledgedBy ?? 'unknown'}`}>
      <Chip size="small" color="success" variant="outlined" label="Acknowledged" />
    </Tooltip>
  ) : (
    <Chip size="small" color="warning" label="Open" />
  );

/** The row's left edge. Only the two severities worth interrupting for get one. */
function severityEdge(severity: Severity): string {
  if (severity === 'critical') return 'error.main';
  if (severity === 'high') return 'warning.main';
  return 'transparent';
}

/** Expanded row: what happened, why it matters, and the supporting detail. */
function EvidencePanel({ alert }: Readonly<{ alert: AlertRecord }>) {
  const entries = Object.entries(alert.evidence ?? {});

  return (
    <Stack spacing={2} sx={{ px: 1, py: 1.5, maxWidth: 1000 }}>
      <Box>
        <Typography
          variant="subtitle2"
          gutterBottom
          sx={{
            color: 'text.secondary',
          }}
        >
          What this means
        </Typography>
        <Typography variant="body2">{alert.description}</Typography>
      </Box>
      <Divider />
      <Box>
        <Typography
          variant="subtitle2"
          gutterBottom
          sx={{
            color: 'text.secondary',
          }}
        >
          Evidence
        </Typography>
        {entries.length === 0 ? (
          <Typography
            variant="body2"
            sx={{
              color: 'text.disabled',
            }}
          >
            No structured evidence recorded.
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'minmax(180px, auto) 1fr' },
              columnGap: 2,
              rowGap: 0.75,
            }}
          >
            {entries.map(([key, value]) => (
              <Box key={key} sx={{ display: 'contents' }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    color: 'text.secondary',
                  }}
                >
                  {humanizeKey(key)}
                </Typography>
                <Box sx={{ ...monoSx, wordBreak: 'break-word' }}>{formatValue(value)}</Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Divider />
      <Stack
        direction="row"
        spacing={3}
        useFlexGap
        sx={{
          flexWrap: 'wrap',
        }}
      >
        <Metric label="First seen" value={new Date(alert.firstSeen).toLocaleString()} />
        <Metric label="Last seen" value={new Date(alert.lastSeen).toLocaleString()} />
        <Metric label="Occurrences" value={alert.occurrences.toLocaleString()} />
        {alert.protocol && <Metric label="Protocol" value={alert.protocol} />}
        {alert.sourceMac && <Metric label="Source MAC" value={alert.sourceMac} />}
        {alert.targetMac && <Metric label="Target MAC" value={alert.targetMac} />}
      </Stack>
    </Stack>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          display: 'block',
        }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={monoSx}>
        {value}
      </Typography>
    </Box>
  );
}

/** `distinctPortsProbed` -> `Distinct ports probed`. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    // Each element formatted rather than `join`ed. `join` calls String() on every
    // element, so one object in an evidence array renders as "[object Object]"
    // and the analyst is told nothing about what was actually found.
    const shown = value.slice(0, 24).map(formatValue).join(', ');
    return value.length > 24 ? `${shown}, … (${value.length} total)` : shown;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  // All that is left is a symbol or a function. Neither belongs in evidence, and
  // neither has a string form worth showing — printing a function's source would
  // be worse than saying nothing. Narrowed explicitly rather than left to
  // `String(unknown)`, which cannot be read as safe at a glance.
  return '—';
}

function IpLink({ value, onClick }: Readonly<{ value: string; onClick: (ipAddress: string) => void }>) {
  return (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={() => onClick(value)}
      sx={{ ...monoSx, display: 'inline-flex', alignItems: 'center', gap: 0.5, textAlign: 'left' }}
    >
      {value}
      <TravelExploreIcon sx={{ fontSize: 14, opacity: 0.65 }} />
    </Link>
  );
}
