import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import type { MRT_ColumnDef } from 'material-react-table';
import { useMemo } from 'react';
import { describeError } from '../api/client';
import { fetchFlowStatus } from '../api/flow.api';
import { useFormatters } from '../i18n/format';
import { type UiMessageKey, useT } from '../i18n/ui';
import { monoSx } from '../theme';
import type { FlowExporter, FlowStatus } from '../types';
import DataGrid, { numericColumn } from './DataGrid';
import Identifier from './Identifier';
import StatTile from './StatTile';
import SurfaceCard from './SurfaceCard';

/**
 * Flow collection: what is arriving, from where, and whether it decodes.
 *
 * The last subsystem with no interface at all. `GET /api/flow/status` has
 * returned everything needed for this since the collector was written and nothing
 * in the browser called it, so setting flow up meant reading the API's log.
 *
 * The page is built around the two failure modes the route's own docblock names,
 * because a single record total cannot tell them apart:
 *
 *  - **Configured but receiving nothing.** Zero datagrams. The device is not
 *    sending, cannot reach us, or is sending somewhere else.
 *  - **Receiving but nothing decodes.** Datagrams climbing with records at zero.
 *    Almost always `pendingTemplates`: a v9 or IPFIX exporter that sends data
 *    records before the templates describing them is counted in `datagrams`,
 *    decodes nothing, and looks identical to a working device from any total.
 *
 * Two more distinctions the layout exists to preserve. **`enabled` is not
 * `listening`** — they differ exactly when the bind failed, which is the second
 * most likely setup failure and the thing a single on/off chip would hide. And
 * **`ignored` is three separate problems**: a sender the allowlist refuses, a
 * device configured for sFlow, and a version with no parser. Each is fixed
 * somewhere else, so each gets its own line and the allowlist is printed beside
 * them.
 *
 * Read-only, deliberately, and not only because the endpoint is: the collector's
 * lifetime is the process's, and a start/stop button here would invite switching
 * security telemetry off by accident. Changing the port or the exporters is still
 * a file and a restart — the roadmap's next half.
 */

/**
 * Refresh cadence.
 *
 * Flow arrives continuously, so a panel that never updates reads as a dead one —
 * and the moment this page is most used is while somebody is changing an
 * exporter's configuration and watching for the counters to move.
 *
 * Fifteen seconds rather than the five it started at, for request volume: this is
 * a diagnostic panel that can sit open in a tab for a working day, and four
 * requests a minute is responsive enough to watch a device come up while being a
 * third of the traffic. The shorter interval was also measurably expensive in the
 * test suite — each tick re-renders the exporter grid, and across parallel
 * workers that was enough to push unrelated files past their timeout — which is a
 * fair proxy for what it costs a browser with the tab left open.
 *
 * Only while the socket is open. Polling a disabled collector is a request every
 * fifteen seconds that can only ever answer "off".
 */
const POLL_MS = 15_000;

/** How a version word is presented, and whether we can read it. */
const PROTOCOL_LABEL: Record<string, UiMessageKey> = {
  netflow5: 'flow.protocol.netflow5',
  netflow9: 'flow.protocol.netflow9',
  ipfix: 'flow.protocol.ipfix',
};

export interface FlowStatusPanelProps {
  /**
   * Render without the page's own title band, for use inside another panel.
   *
   * The same flag and the same reason as `DeliverySettingsForm`: a title band
   * inside a dialog that already has one is a heading under a heading. The state
   * chip and the refresh move into the body rather than disappearing — they are
   * the two things a diagnostic panel is read for.
   */
  embedded?: boolean;
}

/**
 * The panel itself, shared by the Flow page and the administration gear.
 *
 * Named `FlowStatusPanel` and not `FlowStatus`, which is the type this file
 * already imports for the endpoint's shape. TypeScript keeps types and values in
 * separate namespaces so both compiled, and a reader would still have had to work
 * out which `FlowStatus` any given line meant. The contract keeps the plain name.
 *
 * Two entry points because two people want it for different reasons. An operator
 * reaches it from the navigation while watching the network; whoever is setting
 * flow up reaches it from the administration panel, next to the query console's
 * diagnostics, because at that moment it is a configuration question. One
 * component rather than two views over one endpoint — see `AdminSettingsMenu`,
 * which makes the same argument about embedding the delivery form rather than
 * writing a second.
 */
export default function FlowStatusPanel({ embedded = false }: Readonly<FlowStatusPanelProps>) {
  const t = useT();
  const fmt = useFormatters();

  const status = useQuery({
    queryKey: ['flow', 'status'],
    queryFn: fetchFlowStatus,
    refetchInterval: (query) => (query.state.data?.listening ? POLL_MS : false),
  });

  const columns = useMemo<MRT_ColumnDef<FlowExporter>[]>(
    () => [
      {
        accessorKey: 'exporter',
        header: t('flow.column.exporter'),
        size: 170,
        Cell: ({ cell }) => <Identifier>{cell.getValue<string>()}</Identifier>,
      },
      {
        accessorKey: 'protocolVersion',
        header: t('flow.column.protocol'),
        size: 150,
        Cell: ProtocolCell,
      },
      numericColumn({ accessorKey: 'datagrams', header: t('flow.column.datagrams'), size: 120 }),
      numericColumn({ accessorKey: 'records', header: t('flow.column.records'), size: 120 }),
      {
        // The one number worth a colour. Everything else on this row can be
        // nonzero on a healthy exporter; this cannot.
        ...numericColumn({
          accessorKey: 'pendingTemplates',
          header: t('flow.column.pending'),
          size: 150,
        }),
        Cell: PendingCell,
      },
      numericColumn({ accessorKey: 'malformed', header: t('flow.column.malformed'), size: 130 }),
      {
        accessorKey: 'lastSeen',
        header: t('flow.column.last_seen'),
        size: 175,
        Cell: ({ cell }) => <Box sx={monoSx}>{fmt.dateTime(cell.getValue<string>())}</Box>,
      },
    ],
    [t, fmt],
  );

  /*
   * The state chip and the refresh, which sit in the title band on the page and
   * above the body when embedded. Built once here so the two placements cannot
   * come to show different controls.
   */
  const controls = (data: FlowStatus) => (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <StateChip status={data} />
      <Button
        size="small"
        startIcon={<RefreshIcon />}
        onClick={() => void status.refetch()}
        disabled={status.isFetching}
      >
        {t('common.refresh')}
      </Button>
    </Stack>
  );

  const band = embedded ? null : (
    <SurfaceCard
      title={t('flow.title')}
      titleComponent="h1"
      titleVariant="h5"
      subtitle={t('flow.subtitle')}
      headerActions={status.data ? controls(status.data) : null}
    />
  );

  if (status.isPending) {
    return (
      <>
        {band}
        <Skeleton variant="rounded" height={120} />
        <Skeleton variant="rounded" height={240} />
      </>
    );
  }

  if (status.isError) {
    return (
      <>
        {band}
        <Alert severity="error">{describeError(status.error, t('flow.status_failed'))}</Alert>
      </>
    );
  }

  const data = status.data;

  return (
    <Stack spacing={2}>
      {band}
      {embedded && <Box>{controls(data)}</Box>}

      {!data.enabled && <DisabledNotice />}

      {/*
        Enabled but not bound. The whole reason `enabled` and `listening` are two
        fields: this is a misconfiguration with a specific cause and a specific
        fix, and it is invisible to anything that renders one on/off state.
      */}
      {data.enabled && !data.listening && (
        <Alert severity="error">
          <AlertTitle>{t('flow.bind_failed')}</AlertTitle>
          {t('flow.bind_failed_note')}
        </Alert>
      )}

      {data.enabled && data.listening && <Diagnosis status={data} />}

      {data.enabled && (
        <>
          <Grid container spacing={2}>
            <Totals status={data} />
          </Grid>

          <IgnoredPanel status={data} />

          <SurfaceCard title={t('flow.exporters')} subtitle={t('flow.exporters_note')} bodyVariant="grid">
            <DataGrid
              columns={columns}
              data={data.exporters}
              tableOptions={{
                enableSorting: false,
                enableTopToolbar: false,
                renderEmptyRowsFallback: () => (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <RouterOutlinedIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
                    <Typography variant="subtitle1" sx={{ mt: 1 }}>
                      {t('flow.no_exporters')}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: 'text.secondary', maxWidth: 520, mx: 'auto', mt: 0.5 }}
                    >
                      {t('flow.no_exporters_note', { port: data.port ?? 0 })}
                    </Typography>
                  </Box>
                ),
              }}
            />
          </SurfaceCard>

          <ComposeNotice />
        </>
      )}
    </Stack>
  );
}

/**
 * The header chip: on, listening, or bound to what.
 *
 * Three states rather than two, and the third is the one that matters — see the
 * page docblock.
 */
function StateChip({ status }: Readonly<{ status: FlowStatus }>) {
  const t = useT();

  if (!status.enabled) return <Chip size="small" label={t('flow.state.off')} />;
  if (!status.listening) {
    return <Chip size="small" color="error" label={t('flow.state.not_listening')} />;
  }
  return (
    <Chip
      size="small"
      color="success"
      variant="outlined"
      // The address and port it actually bound, not the ones it was asked for:
      // `0.0.0.0` in the configuration and `0.0.0.0` on the socket are different
      // claims, and only the second one means traffic can arrive.
      label={t('flow.state.listening', { address: status.address ?? '?', port: status.port ?? 0 })}
    />
  );
}

/**
 * The single most useful sentence on the page, chosen from what the counters say.
 *
 * Deliberately one answer rather than a list of observations. An operator setting
 * flow up is asking "what is wrong", and four true statements they have to
 * combine themselves is what the log already gave them.
 */
function Diagnosis({ status }: Readonly<{ status: FlowStatus }>) {
  const t = useT();
  const pending = status.exporters.reduce((total, exporter) => total + exporter.pendingTemplates, 0);
  const unreadable = status.exporters.filter((exporter) => exporter.protocolVersion === null);

  if (status.datagrams === 0) {
    return (
      <Alert severity="info" icon={<HourglassEmptyOutlinedIcon />}>
        <AlertTitle>{t('flow.waiting')}</AlertTitle>
        {t('flow.waiting_note', { address: status.address ?? '?', port: status.port ?? 0 })}
      </Alert>
    );
  }

  // Ordered by how specific the fix is. A sender being refused is one line of
  // configuration; templates are a device's export settings; malformed is a bug
  // report. The first one that applies is the one shown.
  if (status.ignoredReasons.notAllowed > 0 && status.records === 0) {
    return (
      <Alert severity="warning" icon={<BlockOutlinedIcon />}>
        <AlertTitle>{t('flow.all_refused')}</AlertTitle>
        {t('flow.all_refused_note', { count: status.ignoredReasons.notAllowed })}
      </Alert>
    );
  }

  if (pending > 0 && status.records === 0) {
    return (
      <Alert severity="warning" icon={<HourglassEmptyOutlinedIcon />}>
        <AlertTitle>{t('flow.awaiting_templates')}</AlertTitle>
        {t('flow.awaiting_templates_note', { count: pending })}
      </Alert>
    );
  }

  if (unreadable.length > 0) {
    return (
      <Alert severity="warning" icon={<ErrorOutlineIcon />}>
        <AlertTitle>{t('flow.unreadable_version')}</AlertTitle>
        {t('flow.unreadable_version_note', {
          exporters: unreadable.map((exporter) => exporter.exporter).join(', '),
        })}
      </Alert>
    );
  }

  if (status.records > 0) {
    return (
      <Alert severity="success" icon={<InsightsOutlinedIcon />}>
        <AlertTitle>{t('flow.healthy')}</AlertTitle>
        {t('flow.healthy_note', {
          records: status.records,
          exporters: status.exporters.length,
          findings: status.detection.findings,
        })}
      </Alert>
    );
  }

  // Datagrams arriving, nothing refused, no templates pending, and still no
  // records. Nothing here can name the cause, so it says that rather than
  // guessing — the counters below are the evidence.
  return (
    <Alert severity="warning" icon={<ErrorOutlineIcon />}>
      <AlertTitle>{t('flow.nothing_decoded')}</AlertTitle>
      {t('flow.nothing_decoded_note', { datagrams: status.datagrams })}
    </Alert>
  );
}

function Totals({ status }: Readonly<{ status: FlowStatus }>) {
  const t = useT();
  const pending = status.exporters.reduce((total, exporter) => total + exporter.pendingTemplates, 0);

  const tiles: { label: string; value: number; caption?: string; accent?: string }[] = [
    { label: t('flow.tile.datagrams'), value: status.datagrams, caption: t('flow.tile.datagrams_note') },
    { label: t('flow.tile.records'), value: status.records, caption: t('flow.tile.records_note') },
    {
      label: t('flow.tile.pending'),
      value: pending,
      caption: t('flow.tile.pending_note'),
      // Coloured only when nonzero: an accent on a zero would make a healthy
      // collector look like it had a problem.
      ...(pending > 0 ? { accent: 'warning.main' } : {}),
    },
    {
      label: t('flow.tile.findings'),
      value: status.detection.findings,
      caption: t('flow.tile.findings_note'),
    },
  ];

  return (
    <>
      {tiles.map((tile) => (
        <Grid key={tile.label} size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile {...tile} />
        </Grid>
      ))}
    </>
  );
}

/**
 * The three reasons a datagram was dropped, and the allowlist they were dropped
 * against.
 *
 * Hidden entirely when nothing has been ignored, rather than shown as three
 * zeroes: on a working installation this panel is noise, and the point of it is
 * to be conspicuous on a broken one.
 */
function IgnoredPanel({ status }: Readonly<{ status: FlowStatus }>) {
  const t = useT();
  const fmt = useFormatters();
  const { notAllowed, sflow, unsupportedVersion } = status.ignoredReasons;

  if (status.ignored === 0) return null;

  const rows = (
    [
      { key: 'flow.ignored.not_allowed', hint: 'flow.ignored.not_allowed_hint', count: notAllowed },
      { key: 'flow.ignored.sflow', hint: 'flow.ignored.sflow_hint', count: sflow },
      {
        key: 'flow.ignored.unsupported',
        hint: 'flow.ignored.unsupported_hint',
        count: unsupportedVersion,
      },
    ] satisfies { key: UiMessageKey; hint: UiMessageKey; count: number }[]
  ).filter((row) => row.count > 0);

  return (
    <SurfaceCard
      title={t('flow.ignored.title', { count: status.ignored })}
      subtitle={t('flow.ignored.subtitle')}
    >
      <Stack spacing={1.5}>
        {rows.map((row) => (
          <Stack key={row.key} direction="row" spacing={1.5} sx={{ alignItems: 'baseline' }}>
            <Box sx={{ ...monoSx, minWidth: 72, textAlign: 'right', fontWeight: 600 }}>
              {fmt.number(row.count)}
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t(row.key)}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t(row.hint)}
              </Typography>
            </Box>
          </Stack>
        ))}

        {/*
          The list the refusals were measured against. Without it "412 refused"
          names a problem and not its cause; with it, comparing a device's
          address to this line IS the diagnosis.
        */}
        {notAllowed > 0 && (
          <Alert severity="info" icon={<BlockOutlinedIcon />}>
            {status.allowedExporters.length === 0 ? (
              // Unreachable in practice — an empty allowlist accepts everything,
              // so nothing can be refused by it — and rendered anyway rather
              // than left as a confident assumption in a diagnostic panel.
              t('flow.allowlist_empty')
            ) : (
              <>
                {t('flow.allowlist')} <Identifier>{status.allowedExporters.join(', ')}</Identifier>
              </>
            )}
          </Alert>
        )}
      </Stack>
    </SurfaceCard>
  );
}

/** Off, with the two variables that turn it on. */
function DisabledNotice() {
  const t = useT();
  return (
    <SurfaceCard>
      <Stack direction="row" spacing={1.5}>
        <ErrorOutlineIcon sx={{ color: 'text.disabled', mt: 0.25 }} />
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
            {t('flow.off')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {t('flow.off_note')}
          </Typography>
          <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>
            {t('flow.enable_hint')} <Box component="code">api/.env</Box>:
          </Typography>
          <Box
            component="pre"
            sx={{
              mt: 1,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              ...monoSx,
              overflowX: 'auto',
            }}
          >
            {'FLOW_ENABLED=true\nFLOW_PORT=2055\nFLOW_EXPORTERS=10.0.0.1,10.0.0.2'}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
            {t('flow.off_restart_note')}
          </Typography>
        </Box>
      </Stack>
    </SurfaceCard>
  );
}

/**
 * The Compose trap, stated wherever flow is discussed.
 *
 * `docker-compose.flow.yml` publishes `2055/udp` and the main file deliberately
 * does not — putting it there opened the port on every deployment. So a Compose
 * install with `FLOW_ENABLED=true` and no override binds the socket inside the
 * container, reports itself listening, and receives nothing, because nothing
 * forwards the port to it. Every counter on this page reads exactly as "the
 * device is not sending".
 */
function ComposeNotice() {
  const t = useT();
  return (
    <Alert severity="info" variant="outlined">
      <AlertTitle>{t('flow.compose')}</AlertTitle>
      <Typography variant="body2">{t('flow.compose_note')}</Typography>
      <Box component="pre" sx={{ mt: 1, mb: 0, ...monoSx, overflowX: 'auto' }}>
        docker compose -f docker-compose.yml -f docker-compose.flow.yml up -d
      </Box>
    </Alert>
  );
}

/*
 * Cell renderers at module scope, for the reason `AlertsPage` gives: MRT's `Cell`
 * is a render prop that is analysed as a component, and defining them inside the
 * page rebuilds an identity per render for no benefit.
 */

const ProtocolCell: MRT_ColumnDef<FlowExporter>['Cell'] = ({ row, cell }) => {
  const t = useT();
  const protocol = cell.getValue<string | null>();

  /*
   * A version we cannot read is the headline of this cell, not a footnote. The
   * collector keeps the version word off the wire either way, so the number is
   * what an operator takes to the device's configuration.
   */
  if (protocol === null) {
    return (
      <Tooltip title={t('flow.protocol.unsupported_hint')}>
        <Chip
          size="small"
          color="error"
          variant="outlined"
          label={t('flow.protocol.unsupported', { version: row.original.version })}
        />
      </Tooltip>
    );
  }

  const key = PROTOCOL_LABEL[protocol];
  return <span>{key ? t(key) : protocol}</span>;
};

const PendingCell: MRT_ColumnDef<FlowExporter>['Cell'] = ({ cell }) => {
  const t = useT();
  const fmt = useFormatters();
  const pending = cell.getValue<number>();

  if (pending === 0) return <Box sx={{ ...monoSx, color: 'text.disabled' }}>0</Box>;

  return (
    <Tooltip title={t('flow.column.pending_hint')}>
      <Box sx={{ ...monoSx, color: 'warning.main', fontWeight: 600 }}>{fmt.number(pending)}</Box>
    </Tooltip>
  );
};
