import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

/**
 * How often an open tab re-mints the guide cookie.
 *
 * Four hours against the cookie's twelve, so two consecutive misses still leave it
 * valid. Short enough to survive background-tab throttling, long enough that the
 * request is invisible.
 */
const GUIDE_RENEW_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
  /**
   * When the cookie was last minted, so a renewal can decline.
   *
   * `visibilitychange` fires on every alt-tab, window switch and return from
   * another browser tab, and the listener was registered unconditionally — so
   * ordinary use sent a mint per focus where the intent needs at most one per
   * interval. Each is only a signed JWT and a `Set-Cookie`, so it was cheap
   * rather than harmful, but it scaled with tab-switching rather than with time
   * and was indistinguishable in the logs from a session that genuinely needed
   * renewing.
   */
  const lastMint = useRef(0);

  const openGuide = useCallback((force = true) => {
    if (!force && Date.now() - lastMint.current < GUIDE_RENEW_INTERVAL_MS) return;
    lastMint.current = Date.now();
    void openGuideSession().catch(() => undefined);
  }, []);

  const logout = useCallback(() => {
    // Read before it is cleared, and handed over explicitly: see closeGuideSession
    // for why letting the interceptor find it does not work here.
    void closeGuideSession(getToken()).catch(() => undefined);
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
        // own, shorter life, so it is renewed here as well as at sign-in — and,
        // below, for as long as the tab stays open.
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

  /*
   * Keep the guide cookie alive for as long as the session is.
   *
   * Minting it on mount and at sign-in covers a returning visitor and misses the
   * case that actually needs it: a tab nobody reloads. The access token lasts a
   * day and the cookie twelve hours, so a dashboard left open — which is what this
   * application is for — reaches a point where clicking help finds no cookie, gets
   * redirected to the sign-in page, and cannot get back to the guide without a hard
   * reload.
   *
   * A timer rather than minting on the click itself. "Mint, then open" reads better
   * but has to `await` inside a click handler before calling `window.open`, and a
   * popup blocker is entitled to refuse a window opened outside the gesture — that
   * trades a predictable failure after twelve hours for an unpredictable one at any
   * time. The interval is comfortably inside the cookie's life even if a background
   * tab throttles it, and `visibilitychange` covers the case timers do not fire at
   * all: a laptop that slept through the whole interval.
   */
  useEffect(() => {
    if (!user) return;

    // `force = false`: a focus that arrives inside the interval has nothing to
    // renew. Waking from sleep is the case this listener exists for, and there the
    // last mint is long enough ago to pass.
    const renew = () => {
      if (document.visibilityState === 'visible') openGuide(false);
    };

    const timer = window.setInterval(renew, GUIDE_RENEW_INTERVAL_MS);
    document.addEventListener('visibilitychange', renew);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', renew);
    };
  }, [user, openGuide]);

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
