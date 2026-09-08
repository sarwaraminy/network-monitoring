import PublicIcon from '@mui/icons-material/Public';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useT } from '../i18n/ui';
import { monoSx } from '../theme';
import type { GeoData, IpInfo } from '../types';
import AppDialog from './AppDialog';
import Identifier from './Identifier';

interface IpInfoDialogProps {
  open: boolean;
  ipAddress: string;
  info: IpInfo | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}

/**
 * One dialog shared by all three pages. The Bootstrap markup for this modal was
 * previously copy-pasted into LogPage, PacketCapture and PacketCaptureWithIP.
 */
export default function IpInfoDialog({
  open,
  ipAddress,
  info,
  loading,
  error,
  onClose,
}: Readonly<IpInfoDialogProps>) {
  const t = useT();
  const geo = info?.geoData ?? null;

  return (
    // Draggable, like every other dialog here, and for a reason this one feels
    // most: it is opened *from a row* to explain that row, and a panel pinned to
    // the middle of the screen covers the table it is about.
    <AppDialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      scroll="paper"
      title={
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <PublicIcon color="primary" />
          <span>IP information</span>
          <Chip label={<Identifier mono={false}>{ipAddress}</Identifier>} size="small" sx={monoSx} />
        </Stack>
      }
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <Box>
        {loading && (
          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: 'center',
              py: 3,
            }}
          >
            <CircularProgress size={20} />
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              Running reverse DNS, WHOIS and geolocation lookups…
            </Typography>
          </Stack>
        )}

        {!loading && error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && info && (
          <Stack spacing={3}>
            <Section title={t('ipinfo.domain_name')}>
              <Typography variant="body2" sx={monoSx}>
                {/* A hostname is an identifier: it is looked up and compared, not read. */}
                {info.domainName ? (
                  <Identifier mono={false}>{info.domainName}</Identifier>
                ) : (
                  <NotAvailable label={t('ipinfo.no_ptr')} />
                )}
              </Typography>
            </Section>

            <Section title={t('ipinfo.geolocation')}>
              {geo && geo.status !== 'fail' ? (
                <GeoTable geo={geo} />
              ) : (
                <NotAvailable
                  label={geo?.message ? `Lookup failed: ${geo.message}` : 'No geolocation data'}
                />
              )}
            </Section>

            <Section title={t('ipinfo.whois')}>
              {info.whoisData ? (
                <Box
                  component="pre"
                  sx={{
                    ...monoSx,
                    m: 0,
                    p: 1.5,
                    maxHeight: 280,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    bgcolor: 'grey.50',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                  }}
                >
                  {info.whoisData}
                </Box>
              ) : (
                <NotAvailable label={t('ipinfo.no_whois')} />
              )}
            </Section>
          </Stack>
        )}
      </Box>
    </AppDialog>
  );
}

function Section({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Box>
      <Typography
        variant="subtitle2"
        gutterBottom
        sx={{
          color: 'text.secondary',
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function NotAvailable({ label }: Readonly<{ label: string }>) {
  return (
    <Typography
      variant="body2"
      sx={{
        color: 'text.disabled',
        fontStyle: 'italic',
      }}
    >
      {label}
    </Typography>
  );
}

function GeoTable({ geo }: Readonly<{ geo: GeoData }>) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Country', geo.country],
    ['Region', geo.regionName],
    ['City', geo.city],
    ['Postal code', geo.zip],
    ['Coordinates', formatCoordinates(geo)],
    ['Timezone', geo.timezone],
    ['ISP', geo.isp],
    ['Organization', geo.org],
    ['AS', geo.as],
  ];

  return (
    <Table size="small">
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableCell sx={{ width: 170, fontWeight: 600, border: 0, py: 0.6 }}>{label}</TableCell>
            <TableCell sx={{ border: 0, py: 0.6 }}>
              {value === undefined || value === null || value === '' ? <NotAvailable label="—" /> : value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatCoordinates(geo: GeoData): React.ReactNode {
  if (typeof geo.lat !== 'number' || typeof geo.lon !== 'number') return undefined;
  return (
    <Link
      href={`https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=10/${geo.lat}/${geo.lon}`}
      target="_blank"
      rel="noreferrer"
      underline="hover"
      sx={monoSx}
    >
      {geo.lat}, {geo.lon}
    </Link>
  );
}
