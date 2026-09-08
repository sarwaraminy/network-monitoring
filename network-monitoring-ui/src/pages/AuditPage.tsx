import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { MRT_ColumnDef } from 'material-react-table';
import { useMemo, useState } from 'react';
import { describeError } from '../api/client';
import DataGrid from '../components/DataGrid';
import SurfaceCard from '../components/SurfaceCard';
import { useAuth } from '../contexts/AuthContext';
import { useLocale } from '../contexts/LocaleContext';
import { useAuditActions, useAuditEvents } from '../hooks/useAudit';
import { findingText } from '../i18n/findings';
import { useFormatters } from '../i18n/format';
import type { Locale } from '../i18n/generated/locales';
import { type Translate, useT } from '../i18n/ui';
import { monoSx } from '../theme';
import type { AuditEvent } from '../types';

/**
 * Who did what.
 *
 * The page exists because the answer used to be unavailable. Identity was recorded
 * for actions that build something — acknowledging a finding, writing a suppression
 * rule, changing the delivery settings — and for nothing that removes or redirects:
 * deleting a finding, clearing the table, forgetting a device, pointing the webhook
 * elsewhere. On a tool whose output is evidence, "who removed this finding" is the
 * first question asked after an incident, and it could not be answered afterwards
 * because the row was gone and nothing else knew it had existed.
 *
 * Read-only, and not as a simplification: `audit_events` refuses UPDATE, DELETE and
 * TRUNCATE at the database level, so there is nothing for this page to offer beyond
 * reading. There is deliberately no "clear the log" button, which is the control an
 * audit trail must not have.
 */

/** `alert.delete` reads as two words to a person; the label comes from the server. */
function ActionCell({ row, labels }: { row: AuditEvent; labels: Map<string, string> }) {
  const label = labels.get(row.action);

  return (
    <Stack spacing={0.25}>
      <Typography variant="body2">{label ?? row.action}</Typography>
      {label && (
        <Typography variant="caption" sx={{ ...monoSx, color: 'text.secondary' }}>
          {row.action}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * Turns a finding's stored message key back into the sentence it stands for.
 *
 * The trail records what was deleted, and since V17 an alert carries a key and a
 * params object rather than English prose — so `alert.delete` details arrive as
 * `messageKey: port_scan.packet` with a JSON blob beside them. Printed verbatim
 * that is not readable in any language, which is a worse outcome than the English
 * it replaced.
 *
 * It matters more here than on a normal screen because this table is append-only:
 * an entry written while this was unrendered keeps its raw shape for good, so the
 * cost of leaving it is a permanent band of unreadable rows rather than a display
 * bug somebody can fix later.
 *
 * The pair collapses into `title`, which is the key the pre-V17 entries already
 * used, so the two eras of the trail read identically and a reader cannot tell
 * which side of the migration an entry came from.
 */
function withRenderedFinding(detail: Record<string, unknown>, locale: Locale): Record<string, unknown> {
  if (typeof detail.messageKey !== 'string') return detail;

  const { messageKey, messageParams, ...rest } = detail;
  const { title } = findingText({ messageKey, messageParams, title: null, description: null }, locale);
  // First, so it reads where the prose used to.
  return { title, ...rest };
}

/**
 * The detail object, rendered as text.
 *
 * Deliberately plain: this is a record, and a record is more useful legible than
 * pretty. Nothing here needs redacting on this side — the server records which
 * delivery fields changed and never their values, so a credential cannot reach this
 * component in the first place.
 */
function DetailCell({ detail }: { detail: Record<string, unknown> }) {
  const { locale } = useLocale();
  const entries = Object.entries(withRenderedFinding(detail, locale));
  if (entries.length === 0)
    return (
      <Typography variant="caption" color="text.secondary">
        —
      </Typography>
    );

  return (
    <Stack spacing={0.25} sx={{ py: 0.5 }}>
      {entries.map(([key, value]) => (
        <Typography key={key} variant="caption" sx={monoSx}>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {key}:
          </Box>{' '}
          {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
        </Typography>
      ))}
    </Stack>
  );
}

/**
 * What to say when there are no rows.
 *
 * The error case is the point. `events` is empty both when the trail is genuinely
 * empty and when it could not be read, and the first version rendered the reassuring
 * message underneath the error alert — telling an operator checking whether
 * something was deleted that nothing had been, next to a message saying the check
 * failed. Of the two ways for this page to be wrong, that is the worse one.
 */
function emptyMessage(action: string, failed: boolean, t: Translate): string {
  // The failed branch is the one that has to translate. It exists so an operator
  // checking whether something was deleted does not read a failed load as
  // "nothing was", and a reader who cannot parse the sentence loses exactly that
  // distinction — an empty table and an error they cannot read.
  if (failed) return t('audit.empty_failed');
  return action === '' ? t('audit.empty_none') : t('audit.empty_for_action');
}

export default function AuditPage() {
  const t = useT();
  const { user } = useAuth();
  const [action, setAction] = useState<string>('');

  /*
   * Gated here as well as at the render below, because a hook cannot be conditional:
   * the early return further down suppresses the *render*, not the fetches. Without
   * this a non-admin opening /activity sends two requests the server correctly
   * refuses, putting failed authorisation attempts into the records this page exists
   * to make readable — for a user who did nothing wrong.
   */
  const isAdmin = user?.role === 'ADMIN';
  const actions = useAuditActions({ enabled: isAdmin });
  const trail = useAuditEvents(action === '' ? undefined : action, { enabled: isAdmin });

  const labels = useMemo(
    () => new Map((actions.data ?? []).map((option) => [option.action, option.label])),
    [actions.data],
  );

  const events = useMemo(() => (trail.data?.pages ?? []).flatMap((page) => page.events), [trail.data]);

  const format = useFormatters();
  const columns = useMemo<MRT_ColumnDef<AuditEvent>[]>(
    () => [
      {
        accessorKey: 'at',
        header: t('audit.when'),
        size: 185,
        Cell: ({ row }) => (
          <Typography variant="body2" sx={monoSx}>
            {format.dateTime(row.original.at)}
          </Typography>
        ),
      },
      {
        accessorKey: 'actor',
        header: t('audit.who'),
        size: 220,
        Cell: ({ row }) => <Typography variant="body2">{row.original.actor}</Typography>,
      },
      {
        accessorKey: 'action',
        header: t('audit.what'),
        size: 250,
        Cell: ({ row }) => <ActionCell row={row.original} labels={labels} />,
      },
      {
        accessorKey: 'subject',
        header: t('audit.which'),
        size: 165,
        Cell: ({ row }) =>
          row.original.subject ? (
            <Chip size="small" variant="outlined" label={row.original.subject} sx={monoSx} />
          ) : (
            <Typography variant="caption" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        accessorKey: 'detail',
        header: t('audit.detail'),
        size: 420,
        Cell: ({ row }) => <DetailCell detail={row.original.detail} />,
      },
    ],
    [labels, t, format.dateTime],
  );

  // The route is ADMIN-only on the server and the nav entry is hidden for everyone
  // else, so this is the third layer rather than the first. It exists because a
  // pasted URL should explain itself rather than render an error from a failed
  // fetch.
  if (!isAdmin) {
    return (
      <SurfaceCard title={t('audit.title')} titleComponent="h1" titleVariant="h5">
        <Alert severity="info">{t('audit.admin_only')}</Alert>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      title={t('audit.title')}
      titleComponent="h1"
      titleVariant="h5"
      subtitle={t('audit.subtitle')}
      headerActions={
        <TextField
          select
          size="small"
          label={t('audit.action')}
          value={action}
          onChange={(event) => setAction(event.target.value)}
          sx={{ minWidth: 230 }}
          slotProps={{ htmlInput: { 'aria-label': t('audit.filter_by_action') } }}
        >
          <MenuItem value="">{t('common.all_actions')}</MenuItem>
          {(actions.data ?? []).map((option) => (
            <MenuItem key={option.action} value={option.action}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      }
    >
      {trail.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {describeError(trail.error, t('audit.load_failed'))}
        </Alert>
      )}
      {/*
       * Independent of the trail alert above, and checked even though the trail
       * itself can be loading fine: when this query fails, `labels` is an empty
       * Map, so the dropdown silently collapses to "All actions" and every row
       * falls back to its raw slug. Without this the page reads as working —
       * filter present, rows present — while the filter cannot actually filter.
       */}
      {!trail.isError && actions.isError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {describeError(actions.error, t('audit.actions_failed'))}
        </Alert>
      )}

      <DataGrid
        columns={columns}
        data={events}
        isLoading={trail.isPending}
        emptyMessage={emptyMessage(action, trail.isError, t)}
        tableOptions={{
          // `data` is only the pages fetched so far, not the whole trail — MRT's
          // global search box and column sorting both operate client-side on that
          // slice. A search matching nothing in the loaded pages would render the
          // "nothing has happened yet" empty state, the same false reassurance
          // `emptyMessage` exists to prevent for a failed fetch, reached by a
          // different route. Off until the search term (like `action` already
          // does) or a sort routes through the API instead of filtering locally.
          enableGlobalFilter: false,
          enableSorting: false,
        }}
      />

      {trail.hasNextPage && (
        <Stack direction="row" sx={{ justifyContent: 'center', mt: 2 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void trail.fetchNextPage()}
            disabled={trail.isFetchingNextPage}
          >
            {trail.isFetchingNextPage ? t('audit.loading_more') : t('audit.load_older')}
          </Button>
        </Stack>
      )}
    </SurfaceCard>
  );
}
