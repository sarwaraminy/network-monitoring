import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AdhocStatus, fetchAdhocStatus, recheckAdhoc } from '../../api/adhoc.api';
import { describeError } from '../../api/client';
import { monoSx } from '../../theme';

/**
 * Why the query console is off, and what to do about it.
 *
 * The console is environment-only on purpose — `env.ts` argues it at length, and
 * the short version is that a SQL prompt against the production database should
 * be an installation's decision rather than a click in a browser session. This
 * page therefore *diagnoses* rather than configures: there is no switch on it,
 * and adding one would move that decision from somebody with server access to
 * anybody holding an admin session.
 *
 * What it replaces is a dead end. The old message named `ADHOC_ENABLED` and
 * `ADHOC_DB_PASSWORD` whether or not they were already set, and said the console
 * "also stays off if the database cannot confirm the role is read-only" without
 * saying whether that was what had happened. Three situations, one sentence, and
 * the only way to tell them apart was to read the server log. The server now
 * reports which one it is in and this says what to do about that one.
 */

/** The environment lines to set, per reason. Only what is actually missing. */
const REMEDY: Record<string, { title: string; lines: string[]; note: string }> = {
  disabled: {
    title: 'The console has not been switched on',
    lines: ['ADHOC_ENABLED=true', 'ADHOC_DB_PASSWORD=<a strong value, used nowhere else>'],
    note: 'Set both in the API environment and restart it. This is the default state, not a fault.',
  },
  'no-password': {
    title: 'Switched on, but there is no password to install',
    lines: ['ADHOC_DB_PASSWORD=<a strong value, used nowhere else>'],
    note:
      'ADHOC_ENABLED is set, so the console was asked for — but the role it authenticates as has ' +
      'no credential, and the server will not invent one.',
  },
  'sandbox-failed': {
    title: 'The database would not confirm the console is sandboxed',
    lines: [],
    note:
      'The console is configured, and the server refused to start it because it could not prove ' +
      'the role is neither a superuser nor able to write. Check that the migrations have run, and ' +
      'that nobody has recreated the role by hand. Fix it and check again — no restart needed.',
  },
};

function Running({ status }: { status: AdhocStatus }) {
  return (
    <Stack spacing={1.5}>
      <Alert severity="success">
        <AlertTitle>The console is running</AlertTitle>
        Queries are executed as a Postgres role whose grants decide what is possible — not as this
        application's own database user.
      </Alert>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip
          size="small"
          color={status.mode === 'write' ? 'warning' : 'success'}
          label={status.mode === 'write' ? 'Read and write' : 'Read only'}
        />
        {status.role && (
          <Typography variant="caption" sx={{ ...monoSx, color: 'text.secondary' }}>
            {status.role}
          </Typography>
        )}
      </Stack>

      {status.mode === 'write' && (
        <Alert severity="warning">
          ADHOC_WRITE_ENABLED is set, so the console authenticates as the read-write role and can UPDATE,
          INSERT and DELETE the operational tables. It still cannot touch the audit trail, the secret columns,
          accounts or delivery settings.
        </Alert>
      )}

      {status.passwordMayBeLogged && (
        /*
         * The one thing about this feature an operator cannot discover for
         * themselves. `ALTER ROLE … PASSWORD` has no parameterised form, so the
         * password is part of the statement text; the server suppresses statement
         * logging around it, but that setting is superuser-only. Left in a boot log
         * nobody re-reads, this would never be seen.
         */
        <Alert severity="warning">
          <AlertTitle>The console password may be in the Postgres log</AlertTitle>
          The database owner is not a superuser, so statement logging could not be suppressed while the
          password was set. Under{' '}
          <Box component="code" sx={monoSx}>
            log_statement = 'ddl'
          </Box>{' '}
          or{' '}
          <Box component="code" sx={monoSx}>
            'all'
          </Box>{' '}
          it will have been written in cleartext. Treat ADHOC_DB_PASSWORD as a value the database server may
          have recorded.
        </Alert>
      )}
    </Stack>
  );
}

export default function QueryConsoleStatus() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['adhoc', 'status'], queryFn: fetchAdhocStatus });

  const recheck = useMutation({
    mutationFn: recheckAdhoc,
    onSuccess: (fresh) => {
      // The console page reads the same key, so writing it here updates both.
      queryClient.setQueryData(['adhoc', 'status'], fresh);
    },
  });

  if (status.isPending) {
    return <Typography variant="body2">Asking the server…</Typography>;
  }

  if (status.isError) {
    // Not the same as "off", and conflating them would give the wrong
    // instruction: the remedies below tell somebody to set variables that may
    // already be set.
    return <Alert severity="error">{describeError(status.error, 'Could not read the console status')}</Alert>;
  }

  const current = status.data;
  if (current.enabled) return <Running status={current} />;

  const remedy = current.reason ? REMEDY[current.reason] : undefined;

  return (
    <Stack spacing={1.5}>
      <Alert severity="info">
        <AlertTitle>{remedy?.title ?? 'The console is not available'}</AlertTitle>
        {remedy?.note}
      </Alert>

      {remedy && remedy.lines.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            In the API environment:
          </Typography>
          <Box
            component="pre"
            sx={{
              ...monoSx,
              m: 0,
              mt: 0.5,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              overflowX: 'auto',
            }}
          >
            {remedy.lines.join('\n')}
          </Box>
        </Box>
      )}

      {current.detail && (
        <Alert severity="warning">
          <AlertTitle>What the database said</AlertTitle>
          <Box component="code" sx={{ ...monoSx, wordBreak: 'break-word' }}>
            {current.detail}
          </Box>
        </Alert>
      )}

      {recheck.isError && (
        <Alert severity="error">{describeError(recheck.error, 'The re-check could not be run')}</Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button size="small" variant="outlined" onClick={() => recheck.mutate()} disabled={recheck.isPending}>
          {recheck.isPending ? 'Checking…' : 'Check again'}
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Re-runs the startup check against the current environment. It cannot switch the console on.
        </Typography>
      </Stack>
    </Stack>
  );
}
