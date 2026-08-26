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
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialReactTable, type MRT_ColumnDef, useMaterialReactTable } from 'material-react-table';
import { useMemo, useState } from 'react';
import { describeError } from '../api/client';
import { fetchIntelStatus, reloadIntel } from '../api/intel.api';
import { useChartPalette } from '../charts/useChartPalette';
import { useAuth } from '../contexts/AuthContext';
import { sharedTableOptions } from '../tableTheme';
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

/** Worst first — the order the Source column sorts in. */
const ORIGIN_ORDER: IntelFeedOrigin[] = ['failed', 'cache', 'file', 'network'];

export default function ThreatIntelPage() {
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
      setMessage({
        severity: 'success',
        text: `Reloaded ${result.indicators.toLocaleString()} indicators from ${result.sources.length} feed(s).`,
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
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h1">
            Threat intelligence
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Addresses and domains matched against indicator feeds — the one detector here that is not a
            threshold
          </Typography>
        </Box>
        {isAdmin && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => reload.mutate()}
            disabled={reload.isPending || !data?.enabled}
          >
            {reload.isPending ? 'Reloading…' : 'Reload feeds'}
          </Button>
        )}
      </Stack>

      {status.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {describeError(status.error, 'Could not read threat-intelligence status')}
        </Alert>
      )}

      {message && (
        <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {!loading && data && !data.enabled && <DisabledNotice />}

      {!loading && data?.enabled && data.sources.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
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
        <Alert severity="error" sx={{ mb: 2 }}>
          {failedFeeds.length} feed{failedFeeds.length === 1 ? '' : 's'} could not be loaded at all:{' '}
          {failedFeeds.map((feed) => feed.name).join(', ')}. Those indicators are not being matched.
        </Alert>
      )}

      {failedFeeds.length === 0 && staleFeeds.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {staleFeeds.length} feed{staleFeeds.length === 1 ? '' : 's'} fell back to a cached copy:{' '}
          {staleFeeds.map((feed) => feed.name).join(', ')}. Detection still works, but these indicators are
          only as fresh as the last successful download.
        </Alert>
      )}

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Indicators loaded"
            value={data?.stats.total ?? 0}
            caption={data?.enabled ? 'matched on every packet and flow' : 'threat intelligence is off'}
            icon={<InventoryOutlinedIcon />}
            accent={palette.bar}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Feeds"
            value={data?.sources.length ?? 0}
            caption={
              failedFeeds.length > 0
                ? `${failedFeeds.length} failing`
                : staleFeeds.length > 0
                  ? `${staleFeeds.length} on a cached copy`
                  : 'all loaded'
            }
            icon={<CloudDoneOutlinedIcon />}
            accent={failedFeeds.length > 0 ? palette.severity.critical : undefined}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Last loaded"
            value={data?.loadedAt ? relativeTime(data.loadedAt) : 'never'}
            caption={
              data?.refreshSeconds ? `refreshes every ${Math.round(data.refreshSeconds / 3600)}h` : undefined
            }
            icon={<ScheduleOutlinedIcon />}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Refused on load"
            value={data?.stats.rejected ?? 0}
            caption="private ranges and malformed entries"
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
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
                What is loaded
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                By indicator type
              </Typography>

              <Stack spacing={1} sx={{ mt: 2 }}>
                <TypeRow label="IPv4 addresses" value={data?.stats.ipv4 ?? 0} loading={loading} />
                <TypeRow label="IPv4 ranges (CIDR)" value={data?.stats.cidr ?? 0} loading={loading} />
                <TypeRow label="IPv6 addresses" value={data?.stats.ipv6 ?? 0} loading={loading} />
                <TypeRow label="Domains" value={data?.stats.domain ?? 0} loading={loading} />
              </Stack>

              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2.5 }}>
                A domain indicator also covers its subdomains. Private and reserved addresses are refused on
                load, whatever a feed says — one wrongly listed would alert on every host at once.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}

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
  const columns = useMemo<MRT_ColumnDef<IntelFeedStatus>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Feed',
        size: 220,
        Cell: ({ row, cell }) => (
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
        ),
      },
      {
        accessorKey: 'from',
        header: 'Source',
        size: 140,
        filterVariant: 'select',
        // Worst first, rather than alphabetically — which would straddle "file"
        // between "cache" and "failed" and bury the row worth acting on.
        sortingFn: (a, b) => ORIGIN_ORDER.indexOf(a.original.from) - ORIGIN_ORDER.indexOf(b.original.from),
        Cell: ({ cell }) => {
          const origin = ORIGIN[cell.getValue<IntelFeedOrigin>()];
          return (
            <Tooltip title={origin.hint}>
              <Chip size="small" variant="outlined" color={origin.color} label={origin.label} />
            </Tooltip>
          );
        },
      },
      {
        accessorKey: 'indicators',
        header: 'Indicators',
        size: 130,
        muiTableHeadCellProps: { align: 'right' },
        muiTableBodyCellProps: { align: 'right' },
        Cell: ({ cell }) => {
          const value = cell.getValue<number>();
          return (
            <Typography
              variant="body2"
              sx={{
                fontVariantNumeric: 'tabular-nums',
                // Zero indicators from a feed that "succeeded" is the silent
                // failure this page exists to make visible.
                color: value === 0 ? 'warning.main' : 'text.primary',
                fontWeight: value === 0 ? 600 : 400,
              }}
            >
              {value.toLocaleString()}
            </Typography>
          );
        },
      },
      {
        accessorKey: 'skipped',
        header: 'Skipped',
        size: 120,
        muiTableHeadCellProps: { align: 'right' },
        muiTableBodyCellProps: { align: 'right' },
        Cell: ({ cell }) => (
          <Tooltip title="Lines that were not usable indicators: comments, blanks, and anything malformed or non-routable.">
            <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {cell.getValue<number>().toLocaleString()}
            </Typography>
          </Tooltip>
        ),
      },
    ],
    [],
  );

  const table = useMaterialReactTable({
    // Spread first, so anything below wins over the shared defaults.
    ...sharedTableOptions,
    columns,
    data: feeds,
    state: { isLoading: loading },
    enablePagination: false,
    enableBottomToolbar: false,
    enableDensityToggle: false,
    enableFullScreenToggle: false,
    enableHiding: false,
    columnFilterDisplayMode: 'popover',
    initialState: { density: 'comfortable', sorting: [{ id: 'from', desc: false }] },
    muiTableContainerProps: { sx: { maxHeight: '52vh' } },
    muiSearchTextFieldProps: { placeholder: 'Search feeds', sx: { minWidth: 180 } },
    muiTableBodyRowProps: ({ row }) => ({
      sx: {
        // The left edge the alerts table uses for severity, in the colour of
        // whatever is wrong with this feed — so a degraded row is findable
        // without reading the Source column.
        borderLeft: '4px solid',
        borderLeftColor:
          row.original.from === 'failed'
            ? 'error.main'
            : row.original.from === 'cache' || row.original.indicators === 0
              ? 'warning.main'
              : 'transparent',
      },
    }),
    renderTopToolbarCustomActions: () => (
      <Box sx={{ pl: 0.5, py: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 650, lineHeight: 1.2 }}>
          Feeds
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Where each source came from on the last load
        </Typography>
      </Box>
    ),
    renderEmptyRowsFallback: () => (
      <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
        No feeds configured.
      </Typography>
    ),
  });

  return <MaterialReactTable table={table} />;
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
function StatCard({
  label,
  value,
  caption,
  icon,
  accent,
  loading,
}: Readonly<{
  label: string;
  value: number | string;
  caption?: string;
  icon?: React.ReactNode;
  accent?: string;
  loading?: boolean;
}>) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 2 }}>
        <Box
          sx={{
            width: 6,
            alignSelf: 'stretch',
            minHeight: 44,
            borderRadius: 3,
            bgcolor: accent ?? 'divider',
            flexShrink: 0,
          }}
        />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {label}
          </Typography>
          {loading ? (
            <Skeleton width={72} height={34} />
          ) : (
            <Typography variant="h5" component="p" sx={{ lineHeight: 1.15 }}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </Typography>
          )}
          {caption && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
              {caption}
            </Typography>
          )}
        </Box>
        {icon && <Box sx={{ color: 'text.disabled', display: 'flex' }}>{icon}</Box>}
      </Stack>
    </Card>
  );
}

/**
 * Shown when the feature is off, with what to do about it.
 *
 * A blank page saying "0 indicators" would be indistinguishable from a broken
 * one. Off by default is deliberate — no feeds ship, because which intelligence
 * to trust is the operator's decision — so the empty state has to explain itself.
 */
function DisabledNotice() {
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
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
              {
                'INTEL_ENABLED=true\nINTEL_FEEDS=feodo=https://feodotracker.abuse.ch/downloads/ipblocklist.txt'
              }
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
      </CardContent>
    </Card>
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
