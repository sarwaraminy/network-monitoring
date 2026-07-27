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
import { type FormEvent, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { describeError } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setSubmitting(true);

    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setErrorMessage(describeError(error, 'Login failed'));
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
              Network Monitoring Tool
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              Sign in to capture and analyse traffic
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
                label="Email address"
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
                label="Password"
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
                {submitting ? 'Signing in…' : 'Sign in'}
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
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              Don&apos;t have an account?{' '}
              <Link
                component={RouterLink}
                to="/sign-up"
                underline="hover"
                sx={{
                  fontWeight: 600,
                }}
              >
                Register here
              </Link>
            </Typography>
            <Stack
              direction="row"
              spacing={0.75}
              sx={{
                alignItems: 'center',
                color: 'text.secondary',
              }}
            >
              <LockOutlinedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">Capturing traffic requires an administrator session</Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
