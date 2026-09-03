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
import { useAuditActions, useAuditEvents } from '../hooks/useAudit';
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
 * The detail object, rendered as text.
 *
 * Deliberately plain: this is a record, and a record is more useful legible than
 * pretty. Nothing here needs redacting on this side — the server records which
 * delivery fields changed and never their values, so a credential cannot reach this
 * component in the first place.
 */
function DetailCell({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail);
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

export default function AuditPage() {
  const { user } = useAuth();
  const [action, setAction] = useState<string>('');

  const actions = useAuditActions();
  const trail = useAuditEvents(action === '' ? undefined : action);

  const labels = useMemo(
    () => new Map((actions.data ?? []).map((option) => [option.action, option.label])),
    [actions.data],
  );

  const events = useMemo(() => (trail.data?.pages ?? []).flatMap((page) => page.events), [trail.data]);

  const columns = useMemo<MRT_ColumnDef<AuditEvent>[]>(
    () => [
      {
        accessorKey: 'at',
        header: 'When',
        size: 185,
        Cell: ({ row }) => (
          <Typography variant="body2" sx={monoSx}>
            {new Date(row.original.at).toLocaleString()}
          </Typography>
        ),
      },
      {
        accessorKey: 'actor',
        header: 'Who',
        size: 220,
        Cell: ({ row }) => <Typography variant="body2">{row.original.actor}</Typography>,
      },
      {
        accessorKey: 'action',
        header: 'What',
        size: 250,
        Cell: ({ row }) => <ActionCell row={row.original} labels={labels} />,
      },
      {
        accessorKey: 'subject',
        header: 'Which',
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
        header: 'Detail',
        size: 420,
        Cell: ({ row }) => <DetailCell detail={row.original.detail} />,
      },
    ],
    [labels],
  );

  // The route is ADMIN-only on the server and the nav entry is hidden for everyone
  // else, so this is the third layer rather than the first. It exists because a
  // pasted URL should explain itself rather than render an error from a failed
  // fetch.
  if (user?.role !== 'ADMIN') {
    return (
      <SurfaceCard title="Activity" titleComponent="h1" titleVariant="h5">
        <Alert severity="info">
          The audit trail is visible to administrators. It records who deleted, changed or redirected things,
          and it names accounts.
        </Alert>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      title="Activity"
      titleComponent="h1"
      titleVariant="h5"
      subtitle="Who deleted, changed or redirected something — append-only, and never pruned"
      headerActions={
        <TextField
          select
          size="small"
          label="Action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          sx={{ minWidth: 230 }}
          slotProps={{ htmlInput: { 'aria-label': 'Filter by action' } }}
        >
          <MenuItem value="">All actions</MenuItem>
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
          {describeError(trail.error, 'Could not load the audit trail')}
        </Alert>
      )}

      <DataGrid
        columns={columns}
        data={events}
        isLoading={trail.isPending}
        emptyMessage={
          action === ''
            ? 'Nothing has been deleted, changed or redirected yet. Entries appear here as soon as something is.'
            : 'No entries for this action.'
        }
      />

      {trail.hasNextPage && (
        <Stack direction="row" sx={{ justifyContent: 'center', mt: 2 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void trail.fetchNextPage()}
            disabled={trail.isFetchingNextPage}
          >
            {trail.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
          </Button>
        </Stack>
      )}
    </SurfaceCard>
  );
}
