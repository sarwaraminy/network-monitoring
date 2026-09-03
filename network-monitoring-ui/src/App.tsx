import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from './api/queryClient';
import LoginPage from './auth/LoginPage';
import PrivateRoute from './auth/PrivateRoute';
import AppErrorBoundary from './components/AppErrorBoundary';
import AppLayout from './components/AppLayout';
import { AuthProvider } from './contexts/AuthContext';
import { SnackbarProvider } from './contexts/SnackbarContext';
import { theme } from './theme';

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
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline enableColorScheme />
        <QueryClientProvider client={queryClient}>
          <SnackbarProvider>
            <AuthProvider>
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
            </AuthProvider>
          </SnackbarProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </>
  );
}
