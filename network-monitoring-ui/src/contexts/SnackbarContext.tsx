import Alert, { type AlertColor } from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Transient notifications.
 *
 * Inline `<Alert>` blocks stay for anything the user must act on. This is for
 * confirmations and background failures — "capture started", "alert
 * acknowledged" — which previously either went to the console or produced no
 * feedback at all.
 */

interface Notification {
  message: string;
  severity: AlertColor;
  key: number;
}

interface SnackbarContextValue {
  notify: (message: string, severity?: AlertColor) => void;
  notifySuccess: (message: string) => void;
  notifyError: (message: string) => void;
}

const SnackbarContext = createContext<SnackbarContextValue | undefined>(undefined);

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Notification | null>(null);

  const notify = useCallback((message: string, severity: AlertColor = 'info') => {
    // A fresh key restarts the auto-hide timer when one message replaces another.
    setCurrent({ message, severity, key: Date.now() });
  }, []);

  const value = useMemo<SnackbarContextValue>(
    () => ({
      notify,
      notifySuccess: (message: string) => notify(message, 'success'),
      notifyError: (message: string) => notify(message, 'error'),
    }),
    [notify],
  );

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.key}
        open={current !== null}
        // Errors stay longer: they carry more to read and matter more.
        autoHideDuration={current?.severity === 'error' ? 8_000 : 4_000}
        onClose={(_event, reason) => {
          // Don't dismiss mid-read because the user clicked elsewhere.
          if (reason !== 'clickaway') setCurrent(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {current ? (
          <Alert
            severity={current.severity}
            variant="filled"
            onClose={() => setCurrent(null)}
            sx={{ width: '100%' }}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): SnackbarContextValue {
  const context = useContext(SnackbarContext);
  if (!context) throw new Error('useSnackbar must be used inside a SnackbarProvider');
  return context;
}
