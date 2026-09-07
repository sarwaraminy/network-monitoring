import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth.api';
import { getToken, onUnauthorized, setToken } from '../api/client';
import { closeGuideSession, openGuideSession } from '../api/user-guide.api';
import type { AuthenticatedUser } from '../types';

/**
 * Replaces the old AuthContext + UserContext pair.
 *
 * The previous version derived `isAuthenticated` by AES-decrypting a string in
 * localStorage and comparing it to `Love<email>...<password>...`, and kept the
 * user's plaintext password in sessionStorage. Authentication is now simply
 * "the server accepted our token", and the password is never stored.
 */

interface AuthContextValue {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  /** True until the stored token has been validated against the server. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  /*
   * The user guide is gated by its own cookie, minted whenever we know we are
   * signed in and cleared when we are not — see api/user-guide.api.ts for why it
   * cannot ride the access token.
   *
   * Deliberately fire-and-forget. The guide is documentation: not being able to
   * unlock it must never be a reason a sign-in fails or a sign-out hangs, and the
   * gate's own answer to a missing cookie is the sign-in page, which is the right
   * place to end up anyway.
   */
  const openGuide = useCallback(() => {
    void openGuideSession().catch(() => undefined);
  }, []);

  const logout = useCallback(() => {
    void closeGuideSession().catch(() => undefined);
    setToken(null);
    setUser(null);
  }, []);

  // Validate whatever token we already have before rendering guarded routes.
  useEffect(() => {
    let cancelled = false;

    if (!getToken()) {
      setLoading(false);
      return;
    }

    authApi
      .fetchCurrentUser()
      .then((current) => {
        if (cancelled) return;
        setUser(current);
        // A returning visitor whose token is still good: the guide cookie has its
        // own, shorter life, so it is renewed here rather than only at sign-in.
        openGuide();
      })
      .catch(() => {
        if (!cancelled) {
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [openGuide]);

  // A 401 on any request means the token expired or was revoked.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authApi.login(email, password);
      setToken(response.token);
      setUser({
        id: response.id,
        email: response.email,
        firstName: response.firstName,
        lastName: response.lastName,
        role: response.role,
      });
      openGuide();
    },
    [openGuide],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
