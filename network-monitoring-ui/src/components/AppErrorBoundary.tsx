import RefreshIcon from '@mui/icons-material/Refresh';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a single broken component shows a message instead of a
 * blank white page — which is what React does by default once an error escapes.
 *
 * Still a class: `componentDidCatch` has no hook equivalent.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as console.error deliberately: this is the browser, and it is the one
    // place a developer will look for a stack trace.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh', p: 3 }}>
        <Alert severity="error" sx={{ maxWidth: 640 }}>
          <AlertTitle>Something broke while rendering this page</AlertTitle>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {error.message || 'No error message was provided.'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" startIcon={<RefreshIcon />} onClick={this.reset}>
              Try again
            </Button>
            <Button size="small" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
          </Stack>
        </Alert>
      </Box>
    );
  }
}
