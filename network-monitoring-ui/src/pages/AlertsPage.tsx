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
import Identifier from '../components/Identifier';
import IpInfoDialog from '../components/IpInfoDialog';
import { KIND_DESCRIPTION, KIND_LABEL, SeverityChip } from '../components/SeverityChip';
import SurfaceCard from '../components/SurfaceCard';
import { useAuth } from '../contexts/AuthContext';
import { useLocale } from '../contexts/LocaleContext';
import {
  useAcknowledgeAlert,
  useAlertSummary,
  useAlerts,
  useDeleteAlert,
  useSensors,
} from '../hooks/useAlerts';
import { useIpInfo } from '../hooks/useIpInfo';
import { findingText, useFindingText } from '../i18n/findings';
import { useFormatters } from '../i18n/format';
import { useT } from '../i18n/ui';
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
  const [sensor, setSensor] = useState<string>('');
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

  const sensorsQuery = useSensors();

  /*
   * The sensor controls appear only once a second sensor has written something.
   *
   * Every installation today has one, and for those this page is unchanged: no
   * extra column taking width to repeat one value on every row, and no filter
   * offering a choice of one. The moment a second sensor writes a finding, both
   * appear on their own.
   */
  const sensors = sensorsQuery.data ?? [];
  const multiSensor = sensors.length > 1;
  const { locale } = useLocale();
  const t = useT();

  /*
   * The filter that is actually applied: the selection, but only while it still
   * names a sensor that exists.
   *
   * The sensor list SHRINKS in ordinary operation — it is read from the `alerts`
   * table, so clearing findings empties it and retention rolls a quiet sensor's
   * rows into `alert_rollup_daily` and deletes them. Nothing clears `sensor` when
   * that happens, so without this the filter goes on applying to a sensor that is
   * no longer there, and the page shows no findings for a reason the operator
   * cannot see. A reload does not help: the state is rebuilt from the same data.
   *
   * **Membership, not `multiSensor`.** Keying on the count catches only the
   * collapse to a single sensor. Three sensors becoming two, where the one that
   * went quiet is the one selected, leaves the count above the threshold — so the
   * control renders, `value={sensor}` matches no `MenuItem`, and it renders
   * *blank*. That looks exactly like "All sensors" while the list is still
   * filtered to a sensor with nothing in it, which is worse than the control
   * disappearing: at least a missing control tells the operator something moved.
   *
   * Derived rather than reset in an effect, so there is no render in which a
   * stale filter is still applied. A sensor that returns is matched again and the
   * selection resumes — visible in the control, and therefore clearable.
   */
  const appliedSensor = sensors.some((entry) => entry.sensorId === sensor) ? sensor : '';

  // The filter values are part of the query key, so changing one refetches and
  // caches independently — no manual reload, and going back to a previous filter
  // is served from cache.
  const filters = useMemo(
    () => ({
      ...(severity === 'all' ? {} : { severity }),
      ...(kind ? { kind } : {}),
      ...(appliedSensor ? { sensor: appliedSensor } : {}),
      ...(since ? { since } : {}),
      ...(hideAcknowledged ? { acknowledged: false } : {}),
      limit: 500,
    }),
    [severity, kind, appliedSensor, since, hideAcknowledged],
  );

  const alertsQuery = useAlerts(filters);
  // The tiles follow the sensor filter. Leaving them global would put a total on
  // screen that the list underneath could never account for — the same mismatch
  // `summarizeAlerts` refuses to create by folding in rollups.
  const summaryQuery = useAlertSummary(appliedSensor || undefined);

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
      { accessorKey: 'severity', header: t('alerts.column.severity'), size: 115, Cell: SeverityCell },
      ...(multiSensor
        ? [
            {
              accessorKey: 'sensorId',
              header: t('alerts.column.sensor'),
              size: 130,
            } as MRT_ColumnDef<AlertRecord>,
          ]
        : []),
      { accessorKey: 'kind', header: t('alerts.column.detector'), size: 165, Cell: DetectorCell },
      {
        /*
         * An accessor function rather than a column key, because since V17 the
         * finding's text is not a column — it is rendered from `message_key` and
         * `message_params` in the reader's language. Naming the row's own `title`
         * here would show a blank Finding column for every alert written since,
         * and would hand the table's search box a null to filter on. Computing it
         * keeps "Search findings" matching what is actually on screen.
         */
        id: 'title',
        accessorFn: (row: AlertRecord) => findingText(row, locale).title,
        header: t('alerts.column.finding'),
        size: 420,
        Cell: FindingCell,
      },
      { accessorKey: 'sourceIp', header: t('alerts.column.source'), size: 155, Cell: sourceCell(showIp) },
      { accessorKey: 'targetIp', header: t('alerts.column.target'), size: 155, Cell: targetCell(showIp) },
      { accessorKey: 'lastSeen', header: t('alerts.column.last_seen'), size: 175, Cell: LastSeenCell },
      { accessorKey: 'acknowledgedAt', header: t('alerts.column.status'), size: 130, Cell: StatusCell },
    ],
    [showIp, multiSensor, locale, t],
  );

  const tableOptions = {
    enableRowActions: true,
    positionActionsColumn: 'last' as const,
    muiSearchTextFieldProps: { placeholder: t('alerts.search_placeholder'), sx: { minWidth: 240 } },
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
        <Tooltip title={row.original.acknowledgedAt ? t('alerts.reopen') : t('alerts.acknowledge')}>
          <IconButton size="small" onClick={() => handleAcknowledge(row.original)}>
            {row.original.acknowledgedAt ? (
              <UndoIcon fontSize="small" />
            ) : (
              <CheckCircleOutlineIcon fontSize="small" color="success" />
            )}
          </IconButton>
        </Tooltip>
        {isAdmin && (
          <Tooltip title={t('alerts.delete')}>
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
        {multiSensor && (
          <TextField
            select
            size="small"
            label={t('dashboard.sensor')}
            // The applied filter, not the raw selection. They differ exactly when
            // the chosen sensor has gone quiet, and binding the selection would
            // render the box BLANK — reading as "All sensors" — over a table that
            // really is unfiltered, plus an out-of-range warning from MUI. Blank
            // meaning two different things is the ambiguity this whole derivation
            // exists to remove.
            value={appliedSensor}
            onChange={(event) => setSensor(event.target.value)}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">All sensors</MenuItem>
            {sensors.map((entry) => (
              <MenuItem key={entry.sensorId} value={entry.sensorId}>
                {/* "(this one)" rather than the raw name alone: an operator
                    reaching this page through one sensor's address needs to know
                    which of these it is, and the names are the operator's own. */}
                {entry.sensorId}
                {entry.self ? ' (this one)' : ''}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          size="small"
          label={t('alerts.column.detector')}
          value={kind}
          onChange={(event) => setKind(event.target.value as AlertKind | '')}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value="">All detectors</MenuItem>
          {ALERT_KINDS.map((value) => (
            <MenuItem key={value} value={value}>
              {t(KIND_LABEL[value])}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('dashboard.period')}
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
        title={t('alerts.title')}
        titleComponent="h1"
        titleVariant="h5"
        subtitle={t('alerts.subtitle')}
        headerActions={
          summary && summary.unacknowledged > 0 ? (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={t('alerts.unacknowledged_count', { count: summary.unacknowledged })}
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
  const t = useT();
  const value = cell.getValue<AlertKind>();
  return (
    <Tooltip title={KIND_DESCRIPTION[value] ? t(KIND_DESCRIPTION[value]) : ''}>
      <span>{KIND_LABEL[value] ? t(KIND_LABEL[value]) : value}</span>
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
    return <Identifier>{row.original.sourceMac ?? '—'}</Identifier>;
  };

const targetCell =
  (showIp: (ipAddress: string) => void): MRT_ColumnDef<AlertRecord>['Cell'] =>
  ({ cell }) => {
    const ip = cell.getValue<string | null>();
    return ip ? <IpLink value={ip} onClick={showIp} /> : <Box sx={{ color: 'text.disabled' }}>—</Box>;
  };

/*
 * A timestamp is not an identifier — it is read, not matched against a firewall
 * rule — so it is formatted in the reader's locale rather than isolated. In Dari
 * that means the Solar Hijri calendar, which `fa-AF` selects on its own.
 */
const LastSeenCell: MRT_ColumnDef<AlertRecord>['Cell'] = ({ cell }) => {
  const format = useFormatters();
  return <Box sx={monoSx}>{format.dateTime(cell.getValue<string>())}</Box>;
};

const StatusCell: MRT_ColumnDef<AlertRecord>['Cell'] = ({ row, cell }) => {
  const t = useT();
  return cell.getValue<string | null>() ? (
    <Tooltip
      title={t('alerts.acknowledged_by', { who: row.original.acknowledgedBy ?? t('alerts.unknown_actor') })}
    >
      <Chip size="small" color="success" variant="outlined" label={t('alerts.acknowledged')} />
    </Tooltip>
  ) : (
    <Chip size="small" color="warning" label={t('alerts.open')} />
  );
};

/** The row's left edge. Only the two severities worth interrupting for get one. */
function severityEdge(severity: Severity): string {
  if (severity === 'critical') return 'error.main';
  if (severity === 'high') return 'warning.main';
  return 'transparent';
}

/** Expanded row: what happened, why it matters, and the supporting detail. */
function EvidencePanel({ alert }: Readonly<{ alert: AlertRecord }>) {
  const entries = Object.entries(alert.evidence ?? {});
  const { description } = useFindingText(alert);
  const format = useFormatters();
  const t = useT();

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
          {t('alerts.what_this_means')}
        </Typography>
        <Typography variant="body2">{description}</Typography>
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
          {t('alerts.evidence')}
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
        <Metric label={t('alerts.first_seen')} value={format.dateTime(alert.firstSeen)} />
        <Metric label={t('alerts.column.last_seen')} value={format.dateTime(alert.lastSeen)} />
        <Metric label={t('alerts.occurrences')} value={format.number(alert.occurrences)} />
        {/*
         * `identifier` on the three below and not on the timestamps or the count:
         * a protocol name and a MAC are matched character by character against
         * something outside this application, and must survive a right-to-left
         * layout unchanged. A date and a count are read.
         */}
        {alert.protocol && <Metric label={t('alerts.protocol')} value={alert.protocol} identifier />}
        {alert.sourceMac && <Metric label={t('alerts.source_mac')} value={alert.sourceMac} identifier />}
        {alert.targetMac && <Metric label={t('alerts.target_mac')} value={alert.targetMac} identifier />}
      </Stack>
    </Stack>
  );
}

function Metric({
  label,
  value,
  identifier = false,
}: Readonly<{ label: string; value: string; identifier?: boolean }>) {
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
        {identifier ? <Identifier mono={false}>{value}</Identifier> : value}
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
      <Identifier mono={false}>{value}</Identifier>
      <TravelExploreIcon sx={{ fontSize: 14, opacity: 0.65 }} />
    </Link>
  );
}
