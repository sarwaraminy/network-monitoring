import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LoginIcon from '@mui/icons-material/Login';
import ShieldMoonOutlinedIcon from '@mui/icons-material/ShieldMoonOutlined';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { fetchSignupMode } from '../api/auth.api';
import { describeError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useT } from '../i18n/ui';

export default function LoginPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { login, isAuthenticated, loading } = useAuth();

  /**
   * Whether to offer registration at all.
   *
   * On failure this resolves to undefined and the link stays hidden, which is the
   * safe direction: better to omit a link an administrator does not need than to
   * show one that leads to a refusal.
   */
  const signupMode = useQuery({
    queryKey: ['auth', 'signup-mode'],
    queryFn: fetchSignupMode,
    retry: false,
    staleTime: 30_000,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  /*
   * Somebody already signed in does not need this page.
   *
   * Reachable in ordinary use, not just by typing the URL: the user-guide gate
   * answers a missing or expired cookie with a redirect to `/login`, and the cookie
   * is deliberately shorter-lived than the session. Without this, that lands a
   * signed-in user on a sign-in form — which reads as having been signed out, when
   * they have not been. Waiting for `loading` matters, because `isAuthenticated` is
   * false until the stored token has been checked and redirecting on that would
   * bounce a legitimate visitor straight back.
   */
  if (!loading && isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setSubmitting(true);

    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setErrorMessage(describeError(error, t('login.failed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        px: 2,
        py: 6,
        backgroundColor: '#0f172a',
        backgroundImage:
          'linear-gradient(rgba(15,23,42,0.82), rgba(15,23,42,0.94)), url("/images/about_banner.webp")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 440, borderColor: 'rgba(255,255,255,0.12)' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack
            spacing={1}
            sx={{
              alignItems: 'center',
              mb: 3,
            }}
          >
            <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48 }}>
              <ShieldMoonOutlinedIcon />
            </Avatar>
            <Typography variant="h5" component="h1">
              {t('app.name')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('login.subtitle')}
            </Typography>
          </Stack>

          {errorMessage && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage('')}>
              {errorMessage}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              <TextField
                label={t('login.email')}
                type="email"
                id="email"
                autoComplete="username"
                placeholder="someone@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                fullWidth
                required
                autoFocus
              />
              <TextField
                label={t('login.password')}
                type="password"
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                fullWidth
                required
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                startIcon={<LoginIcon />}
                disabled={!email || !password || submitting}
                fullWidth
              >
                {submitting ? t('login.signing_in') : t('login.sign_in')}
              </Button>
            </Stack>
          </Box>

          <Divider sx={{ my: 3 }} />

          <Stack
            spacing={1.5}
            sx={{
              alignItems: 'center',
            }}
          >
            {/*
              Shown only when the server will actually accept a registration.
              Accounts are created by an administrator on a normal installation, so
              inviting a visitor to "register here" would walk them into a refusal —
              and it was previously an invitation to escalate to administrator.
              Adding a user now lives in the account menu, where an admin will be.
            */}
            {signupMode.data?.allowed && (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {signupMode.data.mode === 'first-admin' ? (
                  <>
                    {t('login.no_accounts')}{' '}
                    <Link component={RouterLink} to="/sign-up" underline="hover" sx={{ fontWeight: 600 }}>
                      {t('login.create_first_admin')}
                    </Link>
                  </>
                ) : (
                  <>
                    {t('login.no_account')}{' '}
                    <Link component={RouterLink} to="/sign-up" underline="hover" sx={{ fontWeight: 600 }}>
                      {t('login.register_here')}
                    </Link>
                  </>
                )}
              </Typography>
            )}
            <Stack
              direction="row"
              spacing={0.75}
              sx={{
                alignItems: 'center',
                color: 'text.secondary',
              }}
            >
              <LockOutlinedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">{t('login.admin_required')}</Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
