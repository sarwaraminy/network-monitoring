import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import InventoryOutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MRT_ColumnDef } from 'material-react-table';
import { useMemo, useState } from 'react';
import { describeError } from '../api/client';
import { fetchIntelStatus, reloadIntel } from '../api/intel.api';
import { useChartPalette } from '../charts/useChartPalette';
import DataGrid, { numericColumn } from '../components/DataGrid';
import StatTile from '../components/StatTile';
import SurfaceCard from '../components/SurfaceCard';
import { useAuth } from '../contexts/AuthContext';
import { useT } from '../i18n/ui';
import type { IntelFeedOrigin, IntelFeedStatus } from '../types';

/**
 * Threat intelligence.
 *
 * The page is a table of feeds, not a count of indicators. "24,318 indicators
 * loaded" is the least useful thing this feature can tell you: a feed silently
 * serving an empty file, or quietly falling back to a months-old cache, looks
 * identical to a healthy one from a total. A detector that stopped matching is
 * worse than one never enabled, because it looks like coverage — so the origin
 * of every feed is the headline, and the totals are supporting detail.
 */

/** How each origin is presented, and what it means for the operator. */
const ORIGIN: Record<
  IntelFeedOrigin,
  { label: string; color: 'success' | 'warning' | 'info' | 'error'; hint: string }
> = {
  network: {
    label: 'Live',
    color: 'success',
    hint: 'Downloaded on the last refresh — this feed is current.',
  },
  cache: {
    label: 'Cached',
    color: 'warning',
    hint:
      'The download failed and the last saved copy was used instead. Detection still works, but these ' +
      'indicators are as old as the last successful fetch.',
  },
  file: {
    label: 'Local file',
    color: 'info',
    hint: 'Read from disk. Freshness is whatever your own process makes it.',
  },
  failed: {
    label: 'Failed',
    color: 'error',
    hint: 'Nothing could be loaded from this source. Its indicators are not being matched at all.',
  },
};

/** The one-line summary under the feed count: the worst state, named. */
function feedHealthCaption(failed: number, stale: number): string {
  if (failed > 0) return `${failed} failing`;
  if (stale > 0) return `${stale} on a cached copy`;
  return 'all loaded';
}

/**
 * The row's left edge, in the colour of whatever is wrong with the feed.
 *
 * A feed reporting zero indicators counts as degraded even when it "succeeded" —
 * that silent case is the one this page exists to make visible.
 */
function feedEdge(feed: IntelFeedStatus): string {
  if (feed.from === 'failed') return 'error.main';
  if (feed.from === 'cache' || feed.indicators === 0) return 'warning.main';
  return 'transparent';
}

/** Worst first — the order the Source column sorts in. */
const ORIGIN_ORDER: IntelFeedOrigin[] = ['failed', 'cache', 'file', 'network'];

export default function ThreatIntelPage() {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const palette = useChartPalette();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const status = useQuery({
    queryKey: ['intel', 'status'],
    queryFn: fetchIntelStatus,
    refetchInterval: 60_000,
  });

  const reload = useMutation({
    mutationFn: reloadIntel,
    onSuccess: (result) => {
      // `sources` is every CONFIGURED source with its result, failures included,
      // so counting it claims a feed loaded that did not. The banner below would
      // then say a feed could not be loaded while this said all of them did —
      // undercutting the one thing this page is for.
      const loaded = result.sources.filter((feed) => feed.from !== 'failed').length;
      setMessage({
        severity: 'success',
        text: `Reloaded ${result.indicators.toLocaleString()} indicators from ${loaded} feed(s).`,
      });
      void queryClient.invalidateQueries({ queryKey: ['intel', 'status'] });
    },
    onError: (error) => {
      // The server distinguishes "already running" from "every source failed",
      // and both leave the previous indicators in place. Saying so matters —
      // otherwise a failed reload reads as "no indicators".
      setMessage({ severity: 'error', text: describeError(error, 'Reload failed') });
    },
  });

  const data = status.data;
  const loading = status.isPending;
  const failedFeeds = data?.sources.filter((feed) => feed.from === 'failed') ?? [];
  const staleFeeds = data?.sources.filter((feed) => feed.from === 'cache') ?? [];

  return (
    <>
      <SurfaceCard
        title={t('intel.title')}
        titleComponent="h1"
        titleVariant="h5"
        subtitle={t('intel.subtitle')}
        headerActions={
          isAdmin ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => reload.mutate()}
              disabled={reload.isPending || !data?.enabled}
            >
              {reload.isPending ? 'Reloading…' : 'Reload feeds'}
            </Button>
          ) : null
        }
      />

      {status.error && (
        <Alert severity="error">
          {describeError(status.error, 'Could not read threat-intelligence status')}
        </Alert>
      )}

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {!loading && data && !data.enabled && <DisabledNotice />}

      {!loading && data?.enabled && data.sources.length === 0 && (
        <Alert severity="warning">
          Threat intelligence is enabled but no feeds are configured, so nothing is being matched. Set
          <Box component="code" sx={{ mx: 0.75 }}>
            INTEL_FEEDS
          </Box>
          to one or more <Box component="code">name=location</Box> pairs.
        </Alert>
      )}

      {/*
        Surfaced above the table, because a feed that failed or fell back is the
        thing worth acting on and it is easy to miss in a row of otherwise
        healthy-looking numbers.
      */}
      {failedFeeds.length > 0 && (
        <Alert severity="error">
          {failedFeeds.length} feed{failedFeeds.length === 1 ? '' : 's'} could not be loaded at all:{' '}
          {failedFeeds.map((feed) => feed.name).join(', ')}. Those indicators are not being matched.
        </Alert>
      )}

      {failedFeeds.length === 0 && staleFeeds.length > 0 && (
        <Alert severity="warning">
          {staleFeeds.length} feed{staleFeeds.length === 1 ? '' : 's'} fell back to a cached copy:{' '}
          {staleFeeds.map((feed) => feed.name).join(', ')}. Detection still works, but these indicators are
          only as fresh as the last successful download.
        </Alert>
      )}

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('intel.indicators_loaded')}
            value={data?.stats.total ?? 0}
            caption={data?.enabled ? 'matched on every packet and flow' : 'threat intelligence is off'}
            icon={<InventoryOutlinedIcon />}
            accent={palette.bar}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('intel.feeds')}
            value={data?.sources.length ?? 0}
            caption={feedHealthCaption(failedFeeds.length, staleFeeds.length)}
            icon={<CloudDoneOutlinedIcon />}
            accent={failedFeeds.length > 0 ? palette.severity.critical : undefined}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('intel.last_loaded')}
            value={data?.loadedAt ? relativeTime(data.loadedAt) : 'never'}
            caption={
              data?.refreshSeconds ? `refreshes every ${Math.round(data.refreshSeconds / 3600)}h` : undefined
            }
            icon={<ScheduleOutlinedIcon />}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('intel.refused')}
            value={data?.stats.rejected ?? 0}
            caption={t('intel.refused_caption')}
            icon={<GppMaybeOutlinedIcon />}
            loading={loading}
          />
        </Grid>
      </Grid>

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <FeedTable feeds={data?.sources ?? []} loading={loading} />
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <SurfaceCard title={t('intel.what_loaded')} subtitle={t('intel.by_type')} sx={{ height: '100%' }}>
            <Stack spacing={1}>
              <TypeRow label={t('intel.ipv4')} value={data?.stats.ipv4 ?? 0} loading={loading} />
              <TypeRow label={t('intel.ipv4_cidr')} value={data?.stats.cidr ?? 0} loading={loading} />
              <TypeRow label={t('intel.ipv6')} value={data?.stats.ipv6 ?? 0} loading={loading} />
              <TypeRow label={t('intel.domains')} value={data?.stats.domain ?? 0} loading={loading} />
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2.5 }}>
              A domain indicator also covers its subdomains. Private and reserved addresses are refused on
              load, whatever a feed says — one wrongly listed would alert on every host at once.
            </Typography>
          </SurfaceCard>
        </Grid>
      </Grid>
    </>
  );
}

/* Cell renderers, at module scope — same reasoning as AlertsPage. */

const FeedNameCell: MRT_ColumnDef<IntelFeedStatus>['Cell'] = ({ row, cell }) => (
  <>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>
      {cell.getValue<string>()}
    </Typography>
    {row.original.error && (
      <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
        {row.original.error}
      </Typography>
    )}
  </>
);

const OriginCell: MRT_ColumnDef<IntelFeedStatus>['Cell'] = ({ cell }) => {
  const origin = ORIGIN[cell.getValue<IntelFeedOrigin>()];
  return (
    <Tooltip title={origin.hint}>
      <Chip size="small" variant="outlined" color={origin.color} label={origin.label} />
    </Tooltip>
  );
};

const IndicatorCountCell: MRT_ColumnDef<IntelFeedStatus>['Cell'] = ({ cell }) => {
  const value = cell.getValue<number>();
  return (
    <Typography
      variant="body2"
      sx={{
        // `numericColumn` already sets the tabular figures on the cell; setting
        // them again here is the per-cell drift its own docblock warns about.
        // Zero indicators from a feed that "succeeded" is the silent failure
        // this page exists to make visible.
        color: value === 0 ? 'warning.main' : 'text.primary',
        fontWeight: value === 0 ? 600 : 400,
      }}
    >
      {value.toLocaleString()}
    </Typography>
  );
};

const SkippedCountCell: MRT_ColumnDef<IntelFeedStatus>['Cell'] = ({ cell }) => {
  const t = useT();
  return (
    <Tooltip title={t('intel.skipped_explain')}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {cell.getValue<number>().toLocaleString()}
      </Typography>
    </Tooltip>
  );
};

/**
 * The feed list, as a Material React Table like every other table in the app.
 *
 * It is usually four rows, which is far less than MRT is built for — but sorting
 * by indicator count is exactly how you find the feed that quietly returned
 * nothing, and a deployment running twenty feeds needs the search box. Paging is
 * deliberately off: a second page would hide the very row this page exists to
 * surface, and no real feed list is long enough to need one.
 */
function FeedTable({ feeds, loading }: Readonly<{ feeds: IntelFeedStatus[]; loading: boolean }>) {
  const t = useT();
  const columns = useMemo<MRT_ColumnDef<IntelFeedStatus>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('intel.feed'),
        size: 220,
        Cell: FeedNameCell,
      },
      {
        accessorKey: 'from',
        header: t('intel.source'),
        size: 140,
        filterVariant: 'select',
        // Without these MRT builds the dropdown from the faceted raw values —
        // `network`, `cache`, `file`, `failed` — while the cells render Live,
        // Cached, Local file, Failed. Filtering for a failed feed would mean
        // knowing the wire value, and "Live" would not be findable at all.
        filterSelectOptions: ORIGIN_ORDER.map((origin) => ({
          value: origin,
          label: ORIGIN[origin].label,
        })),
        // Worst first, rather than alphabetically — which would straddle "file"
        // between "cache" and "failed" and bury the row worth acting on.
        sortingFn: (a, b) => ORIGIN_ORDER.indexOf(a.original.from) - ORIGIN_ORDER.indexOf(b.original.from),
        Cell: OriginCell,
      },
      numericColumn({
        accessorKey: 'indicators',
        header: t('intel.indicators'),
        size: 130,
        Cell: IndicatorCountCell,
      }),
      numericColumn({
        accessorKey: 'skipped',
        header: t('intel.skipped'),
        size: 120,
        Cell: SkippedCountCell,
      }),
    ],
    [t],
  );

  return (
    <SurfaceCard
      title={t('intel.feeds')}
      subtitle={t('intel.feeds_subtitle')}
      bodyVariant="grid"
      sx={{ height: '100%' }}
    >
      <DataGrid
        columns={columns}
        data={feeds}
        isLoading={loading}
        emptyMessage={t('intel.no_feeds')}
        tableOptions={{
          enablePagination: false,
          enableBottomToolbar: false,
          enableDensityToggle: false,
          enableFullScreenToggle: false,
          enableHiding: false,
          initialState: { density: 'comfortable', sorting: [{ id: 'from', desc: false }] },
          muiSearchTextFieldProps: { placeholder: 'Search feeds', sx: { minWidth: 180 } },
          muiTableBodyRowProps: ({ row }) => ({
            sx: {
              // The left edge the alerts table uses for severity, in the colour
              // of whatever is wrong with this feed — so a degraded row is
              // findable without reading the Source column.
              borderLeft: '4px solid',
              borderLeftColor: feedEdge(row.original),
            },
          }),
        }}
      />
    </SurfaceCard>
  );
}

function TypeRow({ label, value, loading }: Readonly<{ label: string; value: number; loading: boolean }>) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
      <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
        {label}
      </Typography>
      {loading ? (
        <Skeleton width={48} />
      ) : (
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {value.toLocaleString()}
        </Typography>
      )}
    </Stack>
  );
}

/** Local copy of the stat tile, so the accent bar reads against this palette. */
function DisabledNotice() {
  return (
    <SurfaceCard>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <ErrorOutlineIcon sx={{ color: 'text.disabled', mt: 0.25 }} />
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
            Threat intelligence is off
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Nothing is being matched against known-malicious addresses or domains. It is off by default
            because no feeds are shipped — which intelligence to trust is your decision, and a security tool
            should not start making outbound requests to a list nobody chose.
          </Typography>

          <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>
            To enable it, add to <Box component="code">api/.env</Box>:
          </Typography>
          <Box
            component="pre"
            sx={{
              mt: 1,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              fontSize: '0.78rem',
              overflowX: 'auto',
            }}
          >
            {'INTEL_ENABLED=true\nINTEL_FEEDS=feodo=https://feodotracker.abuse.ch/downloads/ipblocklist.txt'}
          </Box>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.5 }}>
            <FolderOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              A local file path works too, and is the right choice where this host has no outbound internet.
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
            <DnsOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Check each feed's licence before relying on it commercially.
            </Typography>
          </Stack>
        </Box>
      </Stack>
    </SurfaceCard>
  );
}

/** "3 minutes ago" — absolute timestamps make freshness hard to judge at a glance. */
function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return new Date(iso).toLocaleString();

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
