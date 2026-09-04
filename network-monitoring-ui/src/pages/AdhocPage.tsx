import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import type { MRT_ColumnDef } from 'material-react-table';
import { useMemo, useState } from 'react';
import { type AdhocResult, fetchAdhocAvailability, isNumericOid, runAdhocQuery } from '../api/adhoc.api';
import { describeError } from '../api/client';
import DataGrid from '../components/DataGrid';
import { DisclosureCaret } from '../components/DisclosureCaret';
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

/** So the header toggle's `aria-controls` has something real to point at. */
const EDITOR_REGION = 'adhoc-editor';

/**
 * A numeric column's sort key.
 *
 * Postgres sends `bigint` and `numeric` as strings to avoid losing precision in
 * JavaScript, so a numeric column arrives as text and would sort as text. `NaN`
 * for anything unparseable — including null — keeps those together at one end
 * rather than scattering them.
 */
function toSortableNumber(value: unknown): number {
  if (value === null || value === undefined) return Number.NaN;
  return Number(value);
}

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
  /*
   * The editor folds away once a query has run, so the result gets the room —
   * the same move `professional`'s Ad Hoc Request makes, and for the same
   * reason: on this page the question is short and the answer is a table.
   *
   * Re-openable from the header, and it only ever collapses ITSELF. The Run
   * button stays outside the fold so a collapsed query can still be re-run, which
   * is the common thing to want after reading a result.
   */
  const [showEditor, setShowEditor] = useState(true);
  /*
   * Bumped when the editor's collapse animation FINISHES.
   *
   * `showEditor` flipping is not enough on its own: the grid re-measures during
   * the same render, while `Collapse` is still animating, so it reads a
   * half-collapsed editor and settles on a height that is wrong by whatever was
   * left of the transition. Measuring again once the layout has stopped moving
   * is the only reading that is true.
   */
  const [layoutSettled, setLayoutSettled] = useState(0);
  const onLayoutSettled = () => setLayoutSettled((tick) => tick + 1);

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
      setShowEditor(false);
    } catch (caught) {
      // The result is cleared, not left in place: a stale grid beside a fresh
      // error reads as though the error were a warning about the rows shown.
      setResult(null);
      setError(describeError(caught));
      // Stays open on failure: the query is what needs editing, and folding it
      // away would hide the thing the error is about.
      setShowEditor(true);
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
  const columns = useMemo<MRT_ColumnDef<unknown[]>[]>(
    () =>
      (result?.columns ?? []).map((column, index) => {
        const numeric = isNumericOid(column.dataTypeId);
        return {
          id: `${index}:${column.name}`,
          header: column.name,
          /*
           * By POSITION, and returning the RAW value.
           *
           * Position, because two columns can share a name and a lookup by name
           * would read the same cell twice. Raw, because handing the sorter a
           * string makes a column of integers sort lexicographically — 10, 100,
           * 2 — which is exactly the column already being right-aligned for
           * looking like a number. `Cell` below does the formatting, so what is
           * displayed is unchanged.
           */
          accessorFn: (row) => (numeric ? toSortableNumber(row[index]) : renderCell(row[index])),
          Cell: ({ row }) => renderCell(row.original[index]),
          muiTableBodyCellProps: {
            align: numeric ? ('right' as const) : ('left' as const),
            sx: monoSx,
          },
        };
      }),
    [result],
  );

  if (availability.isLoading) {
    return (
      <SurfaceCard title="Ad Hoc Query" titleComponent="h1" titleVariant="h5">
        <CircularProgress size={20} />
      </SurfaceCard>
    );
  }

  if (availability.isError) {
    /*
     * A failed request is not "the feature is off", and conflating them gives
     * the wrong instruction: the disabled copy below tells the reader to go set
     * `ADHOC_ENABLED` on a server where it may already be set. `staleTime:
     * Infinity` means nothing refetches to correct it either — one failed
     * request at first paint and the page keeps misleading for the session.
     *
     * 403 gets its own sentence because it is the likeliest of these and the
     * only one the reader can act on: they are signed in, just not as an admin.
     */
    const forbidden = (availability.error as { response?: { status?: number } })?.response?.status === 403;

    return (
      <SurfaceCard title="Ad Hoc Query" titleComponent="h1" titleVariant="h5">
        <Alert severity={forbidden ? 'info' : 'error'}>
          {forbidden
            ? 'The query console is available to administrators only.'
            : `The server could not be asked whether the query console is available. ${describeError(availability.error)}`}
        </Alert>
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
        headerActions={
          <IconButton
            size="small"
            onClick={() => setShowEditor((open) => !open)}
            aria-label={showEditor ? 'Hide the query' : 'Show the query'}
            aria-expanded={showEditor}
            // Points at what it opens, so the state it announces describes
            // something real — the rule the sidebar's rail button is held to.
            aria-controls={EDITOR_REGION}
            sx={{ color: 'text.secondary' }}
          >
            <DisclosureCaret expanded={showEditor} />
          </IconButton>
        }
      >
        <Stack spacing={1.5}>
          <Collapse
            in={showEditor}
            id={EDITOR_REGION}
            timeout={250}
            onEntered={onLayoutSettled}
            onExited={onLayoutSettled}
          >
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
                // `!running` too, matching the button. Without it, holding
                // Ctrl+Enter — or pressing it again because a query with a
                // ten-second timeout feels stuck — fires overlapping requests,
                // each writing its own audit row for a query the operator believes
                // they ran once, against a pool of two connections.
                if (
                  event.key === 'Enter' &&
                  (event.metaKey || event.ctrlKey) &&
                  !running &&
                  sql.trim() !== ''
                ) {
                  event.preventDefault();
                  void run();
                }
              }}
            />
          </Collapse>

          {/*
            Outside the fold on purpose: re-running a query you have just read the
            result of is the common thing to want, and having to re-open the
            editor first would make the collapse a cost rather than a help.
          */}
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
            <DataGrid
              columns={columns}
              data={result.rows}
              /*
               * Folding the editor away moves this table UP without changing its
               * size, and the height measurement watches for resizes — so
               * without this the grid keeps the height it was given while the
               * editor was open and leaves a gap beneath it. Collapsing to give
               * the result more room has to actually give it the room.
               */
              fitHeightDeps={[showEditor, layoutSettled]}
            />
          )}
        </SurfaceCard>
      )}
    </>
  );
}
