import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from './api/queryClient';
import LoginPage from './auth/LoginPage';
import PrivateRoute from './auth/PrivateRoute';
import AppErrorBoundary from './components/AppErrorBoundary';
import AppLayout from './components/AppLayout';
import { AuthProvider } from './contexts/AuthContext';
import DirectionProvider from './contexts/DirectionProvider';
import { LocaleProvider } from './contexts/LocaleContext';
import { SnackbarProvider } from './contexts/SnackbarContext';

/**
 * Routes behind the login screen are code-split, so the login page no longer
 * downloads Material React Table and the charting library before anyone has
 * signed in. LoginPage itself stays eager — it is the first paint.
 */
const SignUpPage = lazy(() => import('./auth/SignUpPage'));
const ThreatIntelPage = lazy(() => import('./pages/ThreatIntelPage'));
const DeliveryPage = lazy(() => import('./pages/DeliveryPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const SuppressionsPage = lazy(() => import('./pages/SuppressionsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const AdhocPage = lazy(() => import('./pages/AdhocPage'));
const PacketCapture = lazy(() => import('./pages/PacketCapture'));
const PacketCaptureWithIP = lazy(() => import('./pages/PacketCaptureWithIP'));

function RouteFallback() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
      <CircularProgress />
    </Box>
  );
}

export default function App() {
  return (
    <>
      {/* Sets the colour scheme before first paint, avoiding a light flash. */}
      <InitColorSchemeScript attribute="data" />
      <QueryClientProvider client={queryClient}>
        {/*
         * The order here is forced by what each provider needs from the ones
         * above it, rather than chosen. `AuthProvider` renders no markup, so it
         * can sit outside the theme; `LocaleProvider` reads the signed-in
         * account's `lang_code`, so it goes inside auth; `DirectionProvider`
         * supplies the theme and the emotion cache for the *current* language, so
         * it goes inside the locale; and `SnackbarProvider` renders a MUI
         * component, so it has to be inside the theme rather than outside it as
         * it was.
         */}
        <AuthProvider>
          <LocaleProvider>
            <DirectionProvider>
              <CssBaseline enableColorScheme />
              <SnackbarProvider>
                <BrowserRouter>
                  <AppErrorBoundary>
                    <Suspense fallback={<RouteFallback />}>
                      <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/sign-up" element={<SignUpPage />} />

                        <Route element={<PrivateRoute />}>
                          <Route element={<AppLayout />}>
                            <Route index element={<Navigate to="/dashboard" replace />} />
                            <Route path="/dashboard" element={<DashboardPage />} />
                            <Route path="/alerts" element={<AlertsPage />} />
                            <Route path="/suppressions" element={<SuppressionsPage />} />
                            <Route path="/activity" element={<AuditPage />} />
                            <Route path="/adhoc" element={<AdhocPage />} />
                            <Route path="/threat-intel" element={<ThreatIntelPage />} />
                            <Route path="/delivery" element={<DeliveryPage />} />
                            {/* /logs was the per-packet anomaly log that alerts supersede. */}
                            <Route path="/logs" element={<Navigate to="/alerts" replace />} />
                            <Route path="/capture-packets" element={<PacketCapture />} />
                            <Route path="/capture-packets-ip" element={<PacketCaptureWithIP />} />
                          </Route>
                        </Route>

                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Suspense>
                  </AppErrorBoundary>
                </BrowserRouter>
              </SnackbarProvider>
            </DirectionProvider>
          </LocaleProvider>
        </AuthProvider>
      </QueryClientProvider>
    </>
  );
}
