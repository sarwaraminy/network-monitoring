import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import type { UsePacketCapture } from '../hooks/usePacketCapture';

interface CaptureToolbarProps {
  capture: UsePacketCapture;
  /** Shows the "Filter by IP address" field for the /api/ip/packets variant. */
  showIpFilter?: boolean;
}

/** Replaces the row of Bootstrap form-groups at the top of both capture pages. */
export default function CaptureToolbar({ capture, showIpFilter = false }: CaptureToolbarProps) {
  const {
    interfaces,
    selectedInterface,
    setSelectedInterface,
    snapshotLength,
    setSnapshotLength,
    timeout,
    setTimeoutMs,
    filterIp,
    setFilterIp,
    status,
    capturing,
    busy,
    loadingInterfaces,
    error,
    setError,
    canStart,
    start,
    stop,
    clear,
  } = capture;

  const captureUnavailable = status?.captureAvailable === false;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      {captureUnavailable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Live capture is unavailable on the server: the packet capture library could not be loaded. Install
          Npcap (Windows) or libpcap (Linux/macOS) and restart the API. Everything else on this page still
          works.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <Grid
        container
        spacing={2}
        sx={{
          alignItems: 'flex-start',
        }}
      >
        <Grid size={{ xs: 12, md: showIpFilter ? 4 : 5 }}>
          <TextField
            select
            label="Network interface"
            value={selectedInterface}
            onChange={(event) => setSelectedInterface(event.target.value)}
            disabled={capturing || loadingInterfaces}
            helperText={
              loadingInterfaces
                ? 'Loading interfaces…'
                : interfaces.length === 0
                  ? 'No interfaces reported by the server'
                  : ' '
            }
            fullWidth
          >
            {interfaces.map((device) => (
              <MenuItem key={device.name} value={device.name}>
                {device.description || device.name}
                {device.addresses.length > 0 && ` — ${device.addresses[0]}`}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        {showIpFilter && (
          <Grid size={{ xs: 12, sm: 6, md: 2.5 }}>
            <TextField
              label="Filter by IP address"
              value={filterIp}
              onChange={(event) => setFilterIp(event.target.value)}
              placeholder="192.168.1.20"
              disabled={capturing}
              helperText="Applied as the BPF filter host <ip>"
              fullWidth
            />
          </Grid>
        )}

        <Grid size={{ xs: 6, sm: 3, md: showIpFilter ? 1.75 : 2 }}>
          <TextField
            label="Snapshot length"
            type="number"
            value={snapshotLength}
            onChange={(event) => setSnapshotLength(Number(event.target.value))}
            disabled={capturing}
            slotProps={{ htmlInput: { min: 64, max: 262144, step: 1024 } }}
            helperText="Bytes per frame"
            fullWidth
          />
        </Grid>

        <Grid size={{ xs: 6, sm: 3, md: showIpFilter ? 1.75 : 2 }}>
          <TextField
            label="Timeout (ms)"
            type="number"
            value={timeout}
            onChange={(event) => setTimeoutMs(Number(event.target.value))}
            disabled={capturing}
            slotProps={{ htmlInput: { min: 0, step: 10 } }}
            helperText="pcap read timeout"
            fullWidth
          />
        </Grid>

        <Grid size={{ xs: 12, md: showIpFilter ? 12 : 3 }}>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{
              flexWrap: 'wrap',
              pt: { md: 0.25 },
            }}
          >
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => void start()}
              disabled={!canStart || captureUnavailable}
            >
              Start capture
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<StopIcon />}
              onClick={() => void stop()}
              disabled={!capturing || busy}
            >
              Stop
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={() => void clear()}
              disabled={busy}
            >
              Clear
            </Button>
          </Stack>
        </Grid>
      </Grid>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          alignItems: 'center',
          flexWrap: 'wrap',
          mt: 2,
        }}
      >
        <Chip
          size="small"
          icon={<FiberManualRecordIcon sx={{ fontSize: 12 }} />}
          color={capturing ? 'success' : 'default'}
          variant={capturing ? 'filled' : 'outlined'}
          label={capturing ? 'Capturing' : 'Idle'}
        />
        {status?.linkType && <Chip size="small" variant="outlined" label={`Link: ${status.linkType}`} />}
        {status?.filter && <Chip size="small" variant="outlined" label={`Filter: ${status.filter}`} />}
        {status && status.findingCount > 0 && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            component={RouterLink}
            to="/alerts"
            clickable
            label={`${status.findingCount} finding${status.findingCount === 1 ? '' : 's'} — view alerts`}
          />
        )}
        {status && status.droppedPackets > 0 && (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
            }}
          >
            {status.droppedPackets.toLocaleString()} older packet(s) dropped from the buffer
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
