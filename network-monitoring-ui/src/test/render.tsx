import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderOptions, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setToken } from '../api/client';
import { AuthProvider } from '../contexts/AuthContext';
import { SnackbarProvider } from '../contexts/SnackbarContext';
import { theme } from '../theme';

/**
 * Renders a component inside the providers it needs at runtime.
 *
 * A fresh QueryClient per test keeps cache from leaking between them, and retries
 * are off so a deliberate error surfaces immediately instead of after backoff.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderAppOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL. */
  route?: string;
  /** When set, a token is seeded so AuthProvider validates against /auth/me. */
  authenticated?: boolean;
  /** Wraps children in a route, for components that read route params. */
  path?: string;
}

export function renderApp(ui: ReactElement, options: RenderAppOptions = {}) {
  const { route = '/', authenticated = false, path, ...rest } = options;

  if (authenticated) setToken('test-token');
  else setToken(null);

  const client = makeClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider theme={theme} defaultMode="light">
        <CssBaseline />
        <QueryClientProvider client={client}>
          <SnackbarProvider>
            <AuthProvider>
              <MemoryRouter initialEntries={[route]}>
                {path ? (
                  <Routes>
                    <Route path={path} element={children} />
                  </Routes>
                ) : (
                  children
                )}
              </MemoryRouter>
            </AuthProvider>
          </SnackbarProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  return { client, ...render(ui, { wrapper: Wrapper, ...rest }) };
}
