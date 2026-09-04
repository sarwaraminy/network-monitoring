import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import type { MRT_ColumnDef } from 'material-react-table';
import { useMemo, useState } from 'react';
import { type AdhocResult, fetchAdhocAvailability, isNumericOid, runAdhocQuery } from '../api/adhoc.api';
import { describeError } from '../api/client';
import DataGrid from '../components/DataGrid';
import SurfaceCard from '../components/SurfaceCard';
import { monoSx } from '../theme';

/**
 * Ad Hoc Query — read-only SQL against this system's own database.
 *
 * The page exists for the question nobody anticipated. Every other screen here
 * answers a question somebody designed a screen for; this one is where an
 * administrator goes when the shape of what they need is not one of those, and
 * the alternative is a psql session on the server or an export nobody has built.
 *
 * WHAT MAKES IT SAFE IS NOT ON THIS PAGE, and that is worth stating where
 * somebody reading the UI will see it. There is no validation here, deliberately:
 * a check in the browser is advice, not a control, and writing one invites the
 * belief that it is doing something. The server runs every query as a Postgres
 * role that can only SELECT, and that cannot read the columns holding secrets —
 * the SMTP password, the webhook URL, the password hashes. See
 * `V10__Adhoc_query_role.sql`, which is where the reasoning lives.
 *
 * It is also off unless an installation switched it on, which is why this page's
 * first job is asking whether it is available rather than assuming.
 */

/** Postgres renders these itself; anything else is shown as JSON. */
function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function AdhocPage() {
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<AdhocResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const availability = useQuery({
    queryKey: ['adhoc', 'availability'],
    queryFn: fetchAdhocAvailability,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await runAdhocQuery(sql));
    } catch (caught) {
      // The result is cleared, not left in place: a stale grid beside a fresh
      // error reads as though the error were a warning about the rows shown.
      setResult(null);
      setError(describeError(caught));
    } finally {
      setRunning(false);
    }
  };

  /*
   * Columns are rebuilt from the result, not held across runs.
   *
   * A query answering different columns is the normal case here, unlike every
   * other grid in this app, so the definition is derived from what came back.
   * `accessorFn` rather than `accessorKey`, because a column name can be
   * anything Postgres allows — including a dot, which the key form reads as a
   * path into a nested object and would silently render blank.
   */
  const columns = useMemo<MRT_ColumnDef<Record<string, unknown>>[]>(
    () =>
      (result?.columns ?? []).map((column, index) => ({
        id: `${index}:${column.name}`,
        header: column.name,
        accessorFn: (row) => renderCell(row[column.name]),
        muiTableBodyCellProps: {
          align: isNumericOid(column.dataTypeId) ? ('right' as const) : ('left' as const),
          sx: monoSx,
        },
      })),
    [result],
  );

  if (availability.isLoading) {
    return (
      <SurfaceCard title="Ad Hoc Query" titleComponent="h1" titleVariant="h5">
        <CircularProgress size={20} />
      </SurfaceCard>
    );
  }

  if (!availability.data?.enabled) {
    return (
      <SurfaceCard title="Ad Hoc Query" titleComponent="h1" titleVariant="h5">
        {/*
          "Off" is a normal state, not a fault, so it is explained rather than
          reported as an error — and the server also refuses to enable the console
          if its sandbox does not hold, so "off" can mean either. Both are the
          operator's business, and neither is something this page can fix.
        */}
        <Alert severity="info">
          The query console is not enabled on this server. An administrator turns it on by setting{' '}
          <Box component="code" sx={monoSx}>
            ADHOC_ENABLED
          </Box>{' '}
          and{' '}
          <Box component="code" sx={monoSx}>
            ADHOC_DB_PASSWORD
          </Box>
          . It also stays off if the database cannot confirm that the console's role is read-only.
        </Alert>
      </SurfaceCard>
    );
  }

  return (
    <>
      <SurfaceCard
        title="Ad Hoc Query"
        titleComponent="h1"
        titleVariant="h5"
        subtitle="Read-only SQL against this system's database. Every query is recorded in the audit trail."
      >
        <Stack spacing={1.5}>
          <TextField
            label="SQL"
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            multiline
            minRows={5}
            fullWidth
            placeholder="SELECT kind, count(*) FROM alerts GROUP BY kind ORDER BY 2 DESC"
            slotProps={{ htmlInput: { sx: monoSx, spellCheck: false } }}
            // Ctrl/Cmd+Enter runs. Plain Enter has to keep inserting a newline:
            // this is a multi-line editor, and a query is routinely more than one.
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && sql.trim() !== '') {
                event.preventDefault();
                void run();
              }
            }}
          />

          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Button
              variant="contained"
              startIcon={running ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlinedIcon />}
              onClick={() => void run()}
              disabled={running || sql.trim() === ''}
            >
              {running ? 'Running' : 'Run'}
            </Button>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Ctrl/Cmd + Enter also runs. Writes and the columns holding secrets are refused by the database,
              not by this page.
            </Typography>
          </Stack>

          {/*
            Postgres's own message, verbatim. "permission denied for table users"
            tells an administrator exactly which rule they met; replacing it with
            "query failed" would leave them guessing at a restriction that is
            deliberate and documented.
          */}
          {error !== null && (
            <Alert severity="error" sx={{ '& .MuiAlert-message': monoSx }}>
              {error}
            </Alert>
          )}
        </Stack>
      </SurfaceCard>

      {result !== null && (
        <SurfaceCard
          title="Result"
          bodyVariant="grid"
          headerActions={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'} in {result.durationMs} ms
              </Typography>
              {/*
                Said plainly rather than implied by a round number. Reading a
                truncated result as a complete one is the specific harm a row cap
                does if it stays quiet — the count looks like an answer.
              */}
              {result.truncated && (
                <Chip size="small" color="warning" label="Truncated — there are more rows" />
              )}
            </Stack>
          }
        >
          {result.rows.length === 0 ? (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                The query ran and returned no rows.
              </Typography>
            </Box>
          ) : (
            <DataGrid columns={columns} data={result.rows} />
          )}
        </SurfaceCard>
      )}
    </>
  );
}
