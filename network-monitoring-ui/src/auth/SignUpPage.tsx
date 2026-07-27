import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSignupMode, signup } from '../api/auth.api';
import { describeError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { SignupPayload } from '../types';

const MIN_PASSWORD_LENGTH = 8;

const ROLES = [
  { value: 'USER', label: 'User' },
  { value: 'ADMIN', label: 'Administrator' },
] as const;

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fa', label: 'دری' },
  { value: 'ps', label: 'پشتو' },
] as const;

/**
 * Account creation.
 *
 * The page asks the server what it will actually permit before drawing anything.
 * It previously rendered an open registration form with a Role dropdown including
 * Administrator, against an endpoint that required no authentication and honoured
 * that role — so loading this page was enough to take over the installation.
 *
 * Now it has three states, driven by `/auth/signup-allowed`:
 *
 *  - **first-admin** — empty installation, so this is first-time setup. The role
 *    field is hidden because the answer can only be Administrator.
 *  - **open** — public registration is deliberately on. The role field is hidden
 *    because the server forces USER regardless of what is sent.
 *  - **admin-only** — the normal state. No form at all; an administrator creates
 *    accounts, and the page says so instead of failing at submit.
 *
 * The role field is hidden in every case an unauthenticated visitor can reach. It
 * appears only for a signed-in administrator, whose choice the server honours.
 */
export default function SignUpPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const signupMode = useQuery({
    queryKey: ['auth', 'signup-mode'],
    queryFn: fetchSignupMode,
    // Whether the install has any users can change under us during setup.
    staleTime: 0,
    retry: false,
  });

  const [form, setForm] = useState<SignupPayload>({
    email: '',
    password: '',
    firstname: '',
    lastname: '',
    role: 'USER',
    langCode: 'en',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();

  const update = <K extends keyof SignupPayload>(key: K, value: SignupPayload[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const passwordTooShort = form.password !== '' && form.password.length < MIN_PASSWORD_LENGTH;
  const passwordsDiffer = confirmPassword !== '' && form.password !== confirmPassword;
  const canSubmit =
    form.email !== '' &&
    form.firstname !== '' &&
    form.password.length >= MIN_PASSWORD_LENGTH &&
    form.password === confirmPassword &&
    !submitting;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setSubmitting(true);

    try {
      await signup(form);
      // The account exists but has no session yet, so send them to sign in.
      navigate('/login', { replace: true });
    } catch (error) {
      setErrorMessage(describeError(error, 'Could not create the account'));
    } finally {
      setSubmitting(false);
    }
  };

  const mode = signupMode.data?.mode;
  const bootstrap = mode === 'first-admin';
  // An admin choosing a role is the only case the server honours. Everyone else
  // gets USER (or ADMIN, for the very first account), so offering the field would
  // only misrepresent what is about to happen.
  const canChooseRole = isAdmin;
  const formAllowed = signupMode.data?.allowed === true || isAdmin;

  const shell = (children: React.ReactNode) => (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2, py: 6 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 640 }}>
        {children}
      </Card>
    </Box>
  );

  if (signupMode.isPending) {
    return shell(
      <CardContent sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </CardContent>,
    );
  }

  if (!formAllowed) {
    return shell(
      <>
        <CardHeader
          title="Account creation is restricted"
          subheader="Only an administrator can add accounts to this installation"
          titleTypographyProps={{ variant: 'h6' }}
        />
        <CardContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Ask an administrator to create your account. If you are setting this server up yourself, run{' '}
            <code>npm run user -- create --email you@example.com --generate --role ADMIN</code> on the server.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </CardContent>
      </>,
    );
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2, py: 6 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 640 }}>
        <CardHeader
          title={bootstrap ? 'Create the first administrator' : 'Create an account'}
          subheader={
            bootstrap
              ? 'This installation has no accounts yet, so this one becomes an administrator'
              : 'Register a user for the Network Monitoring Tool'
          }
          titleTypographyProps={{ variant: 'h6' }}
        />
        <CardContent>
          {errorMessage && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage('')}>
              {errorMessage}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Grid container spacing={2}>
              <Grid size={12}>
                <TextField
                  label="Email address"
                  type="email"
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                  placeholder="someone@example.com"
                  autoComplete="username"
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Password"
                  type="password"
                  value={form.password}
                  onChange={(event) => update('password', event.target.value)}
                  autoComplete="new-password"
                  error={passwordTooShort}
                  helperText={passwordTooShort ? `At least ${MIN_PASSWORD_LENGTH} characters` : ' '}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Confirm password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  error={passwordsDiffer}
                  helperText={passwordsDiffer ? 'Passwords do not match' : ' '}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="First name"
                  value={form.firstname}
                  onChange={(event) => update('firstname', event.target.value)}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Last name"
                  value={form.lastname}
                  onChange={(event) => update('lastname', event.target.value)}
                  fullWidth
                />
              </Grid>
              {canChooseRole && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    select
                    label="Role"
                    value={form.role}
                    onChange={(event) => update('role', event.target.value as SignupPayload['role'])}
                    helperText="You are an administrator, so this choice is honoured"
                    fullWidth
                  >
                    {ROLES.map((role) => (
                      <MenuItem key={role.value} value={role.value}>
                        {role.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
              )}
              <Grid size={{ xs: 12, sm: canChooseRole ? 6 : 12 }}>
                <TextField
                  select
                  label="Language"
                  value={form.langCode}
                  onChange={(event) => update('langCode', event.target.value)}
                  fullWidth
                >
                  {LANGUAGES.map((language) => (
                    <MenuItem key={language.value} value={language.value}>
                      {language.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>

            <Stack spacing={1.5} sx={{ mt: 3 }}>
              <Button
                type="submit"
                variant="contained"
                size="large"
                startIcon={<PersonAddAlt1Icon />}
                disabled={!canSubmit}
              >
                {submitting ? 'Creating account…' : bootstrap ? 'Create administrator' : 'Sign up'}
              </Button>
              <Button variant="text" onClick={() => navigate('/login')}>
                {isAdmin ? 'Back to the app' : 'Already have an account? Sign in'}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
