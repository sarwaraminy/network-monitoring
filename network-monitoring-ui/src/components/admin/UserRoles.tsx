import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { describeError } from '../../api/client';
import { type AccountSummary, fetchAccounts, type Role, setAccountRole } from '../../api/users.api';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Accounts and their roles.
 *
 * Role is what every other guard in this application reads, and it was settable
 * only in the database until now — so granting somebody administrator meant a
 * `psql` session on the server, which is the person this panel exists to avoid
 * needing.
 *
 * It is also the most dangerous tool here, because every way of getting it wrong
 * is a lockout: demote the last administrator and the panel that would undo it
 * sits behind the guard that just closed. The server refuses that case and the
 * self-demotion case, and this form disables the controls that would earn those
 * refusals rather than offering them and reporting an error — but the server is
 * the one enforcing it, since a list can be stale by the time somebody clicks.
 *
 * No creating or deleting accounts. Sign-up has its own policy deciding who may
 * call it and when, and an account referenced by suppression rules and audit rows
 * is not something to remove from a settings dialog.
 */

const ROLES: readonly Role[] = ['ADMIN', 'USER'];

const nameOf = (account: AccountSummary) =>
  [account.firstname, account.lastname].filter(Boolean).join(' ') || '—';

export default function UserRoles() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  /** Which row is in flight, so only its control is disabled. */
  const [pending, setPending] = useState<number | null>(null);

  const change = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => setAccountRole(id, role),
    onSuccess: (updated) => {
      setMessage({ severity: 'success', text: `${updated.email ?? 'That account'} is now ${updated.role}.` });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (error) => {
      // The server's own message, verbatim: it names which refusal this was, and
      // each one has a different remedy.
      setMessage({ severity: 'error', text: describeError(error, 'Could not change the role') });
    },
    onSettled: () => setPending(null),
  });

  if (accounts.isPending) return <Typography variant="body2">Asking the server…</Typography>;
  if (accounts.isError) {
    return <Alert severity="error">{describeError(accounts.error, 'Could not read the accounts')}</Alert>;
  }

  const rows = accounts.data;
  const admins = rows.filter((account) => account.role.toUpperCase() === 'ADMIN');

  /**
   * Why a row's control is disabled, or `null` if it is not.
   *
   * Returning the reason rather than a boolean so the interface can say it. A
   * disabled control with no explanation is the thing an administrator files a
   * bug about, and both of these have a remedy worth naming.
   */
  const blocked = (account: AccountSummary): string | null => {
    if (account.id === user?.id) {
      return 'You cannot change your own role. Ask another administrator.';
    }
    if (account.role.toUpperCase() === 'ADMIN' && admins.length <= 1) {
      return 'The only administrator. Promote another account before changing this one.';
    }
    return null;
  };

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.severity}>{message.text}</Alert>}

      {admins.length <= 1 && (
        <Alert severity="info">
          One administrator. Promoting a second is what makes this account recoverable — with only one, a
          forgotten password means editing the database by hand.
        </Alert>
      )}

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Account</TableCell>
              <TableCell>Name</TableCell>
              <TableCell sx={{ width: 200 }}>Role</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((account) => {
              const reason = blocked(account);
              const isSelf = account.id === user?.id;

              return (
                <TableRow key={account.id}>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <span>{account.email ?? `account ${account.id}`}</span>
                      {isSelf && <Chip size="small" variant="outlined" label="you" />}
                    </Stack>
                  </TableCell>
                  <TableCell>{nameOf(account)}</TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      // Named per row. Every select sharing the accessible name
                      // "Role" would make each of these unaddressable — by a
                      // screen reader and by a test alike.
                      label={`Role for ${account.email ?? `account ${account.id}`}`}
                      value={account.role.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER'}
                      disabled={reason !== null || pending === account.id}
                      helperText={reason ?? undefined}
                      onChange={(event) => {
                        setMessage(null);
                        setPending(account.id);
                        change.mutate({ id: account.id, role: event.target.value as Role });
                      }}
                    >
                      {ROLES.map((role) => (
                        <MenuItem key={role} value={role}>
                          {role}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Every change is recorded in the audit trail, with who made it and which way the role moved.
      </Typography>
    </Stack>
  );
}
