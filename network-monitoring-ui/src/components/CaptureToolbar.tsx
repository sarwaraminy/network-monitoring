import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { UsePacketCapture } from '../hooks/usePacketCapture';
import { useFormatters } from '../i18n/format';
import { useMessageText } from '../i18n/message-state';
import { type Translate, useT } from '../i18n/ui';
import { DisclosureCaret } from './DisclosureCaret';
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
  /**
   * Called when the fold has finished animating, in either direction.
   *
   * The packet table below measures its own height, and that measurement watches
   * for RESIZE — which is blind to this card getting shorter above it, because
   * nothing here changes size from the table's point of view; its top edge
   * simply rises. The page passes this through to the table so it re-measures
   * once the layout has stopped moving. Measuring on the state flip instead
   * would read a half-collapsed toolbar.
   */
  onLayoutSettled?: () => void;
}

/** So the collapse toggle's `aria-controls` has something real to point at. */
const CONTROLS_REGION = 'capture-controls';

/** What the interface dropdown says under itself, in each of its three states. */
function interfaceHelperText(loading: boolean, count: number, t: Translate): string {
  if (loading) return t('capture.loading_interfaces');
  if (count === 0) return t('capture.no_interfaces');
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
  onLayoutSettled,
}: Readonly<CaptureToolbarProps>) {
  const t = useT();
  /*
   * Open to begin with, because the first thing anyone does on this page is
   * choose an interface and press Start. It folds away afterwards by hand, which
   * is the point: once a capture is running these controls are settings you have
   * already made, and the packets are what you came to look at.
   */
  const [showControls, setShowControls] = useState(true);
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
    resume,
    busy,
    loadingInterfaces,
    error,
    setError,
    canStart,
    start,
    stop,
    clear,
  } = capture;

  const errorText = useMessageText();
  const fmt = useFormatters();

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
      headerActions={
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {headerActions}
          <IconButton
            size="small"
            onClick={() => setShowControls((open) => !open)}
            aria-label={showControls ? t('capture.hide_settings') : t('capture.show_settings')}
            aria-expanded={showControls}
            // Points at what it opens, so the state it announces describes
            // something real rather than being an assertion about nothing.
            aria-controls={CONTROLS_REGION}
            sx={{ color: 'text.secondary' }}
          >
            <DisclosureCaret expanded={showControls} />
          </IconButton>
        </Stack>
      }
    >
      {captureUnavailable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('capture.unavailable_note')}
        </Alert>
      )}
      {/*
        What a restart interrupted — see V18.
        
        Without it the chip below reads "Idle", which is equally true of a host
        that has never captured anything and one that was capturing until the
        service restarted at 03:14. For a monitoring product a gap in monitoring
        that nothing reports is the worst state it can be in, because it looks
        exactly like the good one.
        
        Shown until this process starts a capture of its own — on every visit
        until then, which is deliberate: the notice is that monitoring stopped, and
        that stays true until somebody acts on it.
        
        It does not survive the run that reported it. The server stamps the session
        stopped as soon as it finds one, so a service restarted twice does not
        report the same interruption twice.
        
        `startedBy` is absent for a non-admin — the API strips it, since it is an
        administrator's email and this endpoint is not admin-gated. The rest of the
        notice is shown to everyone, because "monitoring stopped" is not privileged.
      */}
      {status?.interrupted && !capturing && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button
              size="small"
              color="inherit"
              disabled={busy || captureUnavailable}
              onClick={() => resume(status.interrupted as NonNullable<typeof status.interrupted>)}
            >
              {t('capture.resume')}
            </Button>
          }
        >
          {status.interrupted.startedBy
            ? t('capture.interrupted_note', {
                interface: status.interrupted.interfaceName,
                at: fmt.dateTime(status.interrupted.startedAt),
                by: status.interrupted.startedBy,
              })
            : // Without the name, for a reader the API did not tell. Its own
              // sentence rather than an empty `{by}`: "started by  at 03:14"
              // reads as a rendering fault.
              t('capture.interrupted_note_anon', {
                interface: status.interrupted.interfaceName,
                at: fmt.dateTime(status.interrupted.startedAt),
              })}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {errorText(error)}
        </Alert>
      )}
      {/*
        Only the CONTROLS fold away. The status row below stays put, because it
        is the half you want while watching packets — whether a capture is
        running, how many frames, whether anything was dropped. Folding the whole
        card would trade the settings for the readout, which is the wrong half.
      */}
      <Collapse
        in={showControls}
        id={CONTROLS_REGION}
        timeout={250}
        onEntered={onLayoutSettled}
        onExited={onLayoutSettled}
      >
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
              label={t('capture.network_interface')}
              value={selectedInterface}
              onChange={(event) => setSelectedInterface(event.target.value)}
              disabled={capturing || loadingInterfaces}
              helperText={interfaceHelperText(loadingInterfaces, interfaces.length, t)}
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
                label={t('capture.filter_ip')}
                value={filterIp}
                onChange={(event) => setFilterIp(event.target.value)}
                placeholder={exampleHost}
                disabled={capturing}
                helperText={t('capture.bpf_helper')}
                fullWidth
              />
            </Grid>
          )}

          <Grid size={{ xs: 6, sm: 3, md: showIpFilter ? 1.75 : 2 }}>
            <TextField
              label={t('capture.snapshot_length')}
              type="number"
              value={snapshotLength}
              onChange={(event) => setSnapshotLength(Number(event.target.value))}
              disabled={capturing}
              slotProps={{ htmlInput: { min: 64, max: 262144, step: 1024 } }}
              helperText={t('capture.snaplen_helper')}
              fullWidth
            />
          </Grid>

          <Grid size={{ xs: 6, sm: 3, md: showIpFilter ? 1.75 : 2 }}>
            <TextField
              label={t('capture.timeout')}
              type="number"
              value={timeout}
              onChange={(event) => setTimeoutMs(Number(event.target.value))}
              disabled={capturing}
              slotProps={{ htmlInput: { min: 0, step: 10 } }}
              helperText={t('capture.timeout_helper')}
              fullWidth
            />
          </Grid>
        </Grid>
      </Collapse>

      {/*
        One row: what the capture IS on the left, what you can DO to it on the
        right. They were stacked, which spent a second line of the card on two
        short rows that never fill their width — and this card sits above a table
        that wants every pixel of height it can get.

        `space-between` rather than a spacer, so the two groups keep their ends
        as the middle stretches. Both wrap internally, and the row itself wraps
        at narrow widths, which puts the actions under the status rather than
        squeezing either.

        The actions are OUTSIDE the fold above, deliberately — the same call
        `AdhocPage` makes about its Run button. The workflow this collapse exists
        for is "hide the settings so the packet table has room while packets
        stream in", and that is exactly when a capture is RUNNING and Stop is the
        control most likely to be wanted. Folding it away would take the only
        means of ending a live capture with it, at the moment of wanting to.
      */}
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          mt: 2,
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Chip
            size="small"
            icon={<FiberManualRecordIcon sx={{ fontSize: 12 }} />}
            color={capturing ? 'success' : 'default'}
            variant={capturing ? 'filled' : 'outlined'}
            label={capturing ? t('capture.capturing') : t('capture.idle')}
          />
          {status?.linkType && (
            <Chip size="small" variant="outlined" label={t('capture.link_type', { type: status.linkType })} />
          )}
          {status?.filter && (
            <Chip
              size="small"
              variant="outlined"
              label={t('capture.filter_chip', { filter: status.filter })}
            />
          )}
          {status && status.findingCount > 0 && (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              component={RouterLink}
              to="/alerts"
              clickable
              label={t('capture.findings_chip', { count: status.findingCount })}
            />
          )}
          {status && status.droppedPackets > 0 && (
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('capture.dropped', { count: status.droppedPackets })}
            </Typography>
          )}
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon />}
            onClick={start}
            disabled={!canStart || captureUnavailable}
          >
            {t('capture.start')}
          </Button>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<StopIcon />}
            onClick={stop}
            disabled={!capturing || busy}
          >
            {t('capture.stop')}
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteSweepIcon />}
            onClick={clear}
            disabled={busy}
          >
            {t('common.clear')}
          </Button>
        </Stack>
      </Stack>
    </SurfaceCard>
  );
}
