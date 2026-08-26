import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { UsePacketCapture } from '../hooks/usePacketCapture';
import SurfaceCard from './SurfaceCard';

interface CaptureToolbarProps {
  capture: UsePacketCapture;
  /** Shows the "Filter by IP address" field for the /api/ip/packets variant. */
  showIpFilter?: boolean;
  /**
   * The page's title, carried by this card's header.
   *
   * The capture pages used to open with a title band and then immediately show
   * this toolbar under its own "Capture" header — two headers, stacked, saying
   * roughly the same thing. There is only one card at the top of the page now,
   * and it is this one.
   */
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
}

/** What the interface dropdown says under itself, in each of its three states. */
function interfaceHelperText(loading: boolean, count: number): string {
  if (loading) return 'Loading interfaces…';
  if (count === 0) return 'No interfaces reported by the server';
  // A space, not an empty string: it reserves the line so the row does not jump
  // by the height of the helper text once the interfaces land.
  return ' ';
}

/** Replaces the row of Bootstrap form-groups at the top of both capture pages. */
export default function CaptureToolbar({
  capture,
  showIpFilter = false,
  title,
  subtitle,
  headerActions,
}: Readonly<CaptureToolbarProps>) {
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

  /*
   * The placeholder comes from the selected adapter's own address rather than a
   * made-up one.
   *
   * It used to be a hardcoded private address, which was a guess at what the
   * operator's network looks like — and on a 10.x or CGNAT network it is a
   * misleading guess. The interface dropdown directly above already knows a real
   * address on the network being captured, so the field can show one that is
   * actually reachable from here. It also leaves no hardcoded address in the
   * source, which is what a static analyser objects to and is right to.
   */
  const exampleHost = interfaces.find((device) => device.name === selectedInterface)?.addresses[0];

  return (
    <SurfaceCard
      title={title}
      titleComponent="h1"
      titleVariant="h5"
      subtitle={subtitle}
      headerActions={headerActions}
    >
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
            helperText={interfaceHelperText(loadingInterfaces, interfaces.length)}
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
              placeholder={exampleHost}
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
              onClick={start}
              disabled={!canStart || captureUnavailable}
            >
              Start capture
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<StopIcon />}
              onClick={stop}
              disabled={!capturing || busy}
            >
              Stop
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={clear}
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
    </SurfaceCard>
  );
}
