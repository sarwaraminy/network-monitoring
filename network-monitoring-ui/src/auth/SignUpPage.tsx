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
import { LOCALES } from '../i18n/generated/locales';
import { ENDONYMS, useT } from '../i18n/ui';
import type { SignupPayload } from '../types';

const MIN_PASSWORD_LENGTH = 8;

const ROLE_VALUES = ['USER', 'ADMIN'] as const;

/*
 * The languages this installation actually has, named in themselves.
 *
 * Was a hand-written list offering English, Dari and Pashto — and not German.
 * Pashto has no catalogue here, so choosing it wrote a `lang_code` the interface
 * cannot honour and silently fell back to English; German was missing although it
 * ships. Harmless while nothing read the column, and a bug from the moment it
 * started choosing the interface language. Derived now, so the two can no longer
 * disagree.
 */
const LANGUAGES = LOCALES.map((value) => ({ value, label: ENDONYMS[value] }));

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
  const t = useT();
  const { user, loading: authLoading } = useAuth();
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
      // An administrator adding a colleague still holds a valid session, so
      // sending them to the sign-in form would be nonsense. Only a self-created
      // account has nowhere to go but /login.
      navigate(isAdmin ? '/dashboard' : '/login', { replace: true });
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

  // authLoading matters as much as the query: on a reload, `user` is undefined
  // until /auth/me resolves, so an administrator would see the "restricted"
  // dead-end for a beat before the page corrected itself.
  if (signupMode.isPending || authLoading) {
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
          title={t('signup.restricted')}
          subheader={t('signup.restricted_subtitle')}
          titleTypographyProps={{ variant: 'h6' }}
        />
        <CardContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('signup.ask_admin')}{' '}
            <code>npm run user -- create --email you@example.com --generate --role ADMIN</code> on the server.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/login')}>
            {t('signup.back_to_sign_in')}
          </Button>
        </CardContent>
      </>,
    );
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2, py: 6 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 640 }}>
        <CardHeader
          title={bootstrap ? t('login.create_first_admin') : t('signup.title')}
          subheader={bootstrap ? t('signup.bootstrap_subtitle') : t('signup.subtitle')}
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
                  label={t('login.email')}
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
                  label={t('login.password')}
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
                  label={t('signup.confirm_password')}
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
                  label={t('signup.first_name')}
                  value={form.firstname}
                  onChange={(event) => update('firstname', event.target.value)}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t('signup.last_name')}
                  value={form.lastname}
                  onChange={(event) => update('lastname', event.target.value)}
                  fullWidth
                />
              </Grid>
              {canChooseRole && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    select
                    label={t('signup.role')}
                    value={form.role}
                    onChange={(event) => update('role', event.target.value as SignupPayload['role'])}
                    helperText={t('signup.role_helper')}
                    fullWidth
                  >
                    {ROLE_VALUES.map((role) => (
                      <MenuItem key={role} value={role}>
                        {t(role === 'ADMIN' ? 'role.administrator' : 'role.user')}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
              )}
              <Grid size={{ xs: 12, sm: canChooseRole ? 6 : 12 }}>
                <TextField
                  select
                  label={t('account.language')}
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
                {submitting
                  ? t('signup.creating')
                  : bootstrap
                    ? t('signup.create_administrator')
                    : t('signup.submit')}
              </Button>
              <Button variant="text" onClick={() => navigate('/login')}>
                {isAdmin ? t('signup.back_to_app') : t('signup.have_account')}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
