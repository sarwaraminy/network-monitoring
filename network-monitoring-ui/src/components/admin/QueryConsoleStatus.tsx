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
 * This panel *diagnoses*; the row below it in the same menu — Query console
 * settings — configures. That split is why there is no switch here, and it is
 * not the old reason: this docblock used to say the console was environment-only
 * and that a switch here would move the decision to anybody holding an admin
 * session. V15 made it settable on purpose, so the argument no longer holds —
 * what remains is that this component is also what the console page itself
 * renders when the console is off, and two switches over one setting would
 * eventually disagree about what is in force.
 *
 * The consequence for the text below: every remedy has to point at the settings
 * panel, not at a file. An administrator without server access who reads "set it
 * in the environment and restart" concludes there is nothing they can do — one
 * row above the panel that would have done it, with no restart.
 *
 * What it replaces is a dead end. The old message named `ADHOC_ENABLED` and
 * `ADHOC_DB_PASSWORD` whether or not they were already set, and said the console
 * "also stays off if the database cannot confirm the role is read-only" without
 * saying whether that was what had happened. Three situations, one sentence, and
 * the only way to tell them apart was to read the server log. The server now
 * reports which one it is in and this says what to do about that one.
 */

/**
 * What to do, per reason.
 *
 * `lines` used to be environment lines to go and edit. Since V15 both of these
 * are settable in **Query console settings**, the next row in this menu, so the
 * remedy names that instead — the old text was the same dead end this panel was
 * built to replace, just pointing at a different file.
 *
 * A variable is named only where it is genuinely the answer: if one is set in
 * the environment it pins the field, and the settings panel says so with the
 * variable's name on the disabled control.
 */
const REMEDY: Record<string, { title: string; lines: string[]; note: string }> = {
  disabled: {
    title: 'The console has not been switched on',
    lines: [],
    note:
      'Switch it on in Query console settings, the next row in this menu, and set a console ' +
      'password there. No restart needed. This is the default state, not a fault.',
  },
  'no-password': {
    title: 'Switched on, but there is no password to install',
    lines: [],
    note:
      'The console was asked for, but the role it authenticates as has no credential and the ' +
      'server will not invent one. Set one in Query console settings, the next row in this menu.',
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
          {/*
            "Write mode is on" rather than naming the variable: since V15 it can
            come from the stored settings instead, so naming ADHOC_WRITE_ENABLED
            pointed an operator at a line that may not exist.
          */}
          Write mode is on, so the console authenticates as the read-write role and can UPDATE, INSERT and
          DELETE the operational tables. It still cannot touch the audit trail, the secret columns, accounts
          or delivery settings.
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
          it will have been written in cleartext. Treat the console password as a value the database server
          may have recorded — wherever it was set from, since it reaches the role the same way either way.
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
