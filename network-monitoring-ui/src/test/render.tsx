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

/** The provider stack, shared by both render helpers. */
function makeWrapper(client: QueryClient, route: string, body: (children: ReactNode) => ReactNode) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider theme={theme} defaultMode="light">
        <CssBaseline />
        <QueryClientProvider client={client}>
          <SnackbarProvider>
            <AuthProvider>
              <MemoryRouter initialEntries={[route]}>{body(children)}</MemoryRouter>
            </AuthProvider>
          </SnackbarProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  };
}

export function renderApp(ui: ReactElement, options: RenderAppOptions = {}) {
  const { route = '/', authenticated = false, path, ...rest } = options;

  if (authenticated) setToken('test-token');
  else setToken(null);

  const client = makeClient();
  const Wrapper = makeWrapper(client, route, (children) =>
    path ? (
      <Routes>
        <Route path={path} element={children} />
      </Routes>
    ) : (
      children
    ),
  );

  return { client, ...render(ui, { wrapper: Wrapper, ...rest }) };
}

/**
 * Renders a real route tree.
 *
 * Needed for anything that redirects. A component containing `<Navigate>` mounted
 * outside `<Routes>` has nowhere to navigate to, so it re-renders and navigates
 * again — an infinite loop that hangs the whole test file with no output. That is
 * exactly what happened to PrivateRoute; the fix is to give the redirect a real
 * destination, as the app does.
 *
 *   renderRoutes(
 *     <>
 *       <Route element={<PrivateRoute />}>
 *         <Route path="/alerts" element={<div>protected</div>} />
 *       </Route>
 *       <Route path="/login" element={<div>login screen</div>} />
 *     </>,
 *     { route: '/alerts' },
 *   )
 */
export function renderRoutes(routes: ReactNode, options: Omit<RenderAppOptions, 'path'> = {}) {
  const { route = '/', authenticated = false, ...rest } = options;

  if (authenticated) setToken('test-token');
  else setToken(null);

  const client = makeClient();
  const Wrapper = makeWrapper(client, route, (children) => <Routes>{children}</Routes>);

  return { client, ...render(routes as ReactElement, { wrapper: Wrapper, ...rest }) };
}
