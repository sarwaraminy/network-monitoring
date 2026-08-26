import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { MRT_ColumnDef, MRT_TableOptions } from 'material-react-table';
import { useMemo } from 'react';
import { monoSx } from '../theme';
import type { Packet } from '../types';
import DataGrid from './DataGrid';
import HexDump, { hexByteCount } from './HexDump';

interface PacketTableProps {
  packets: Packet[];
  capturing: boolean;
  onIpClick: (ipAddress: string) => void;
}

/**
 * Material React Table replacement for the hand-written packet table.
 *
 * Only rows with a destination IP are shown, matching the original's
 * `packet.destinationIpAddress ? ... : null` guard. The two hex streams live in
 * the expandable detail panel rather than inline cells.
 */
export default function PacketTable({ packets, capturing, onIpClick }: PacketTableProps) {
  const rows = useMemo(() => packets.filter((packet) => Boolean(packet.destinationIpAddress)), [packets]);

  const columns = useMemo<MRT_ColumnDef<Packet>[]>(
    () => [
      {
        accessorFn: (row) => row.sourceIpAddress ?? '',
        id: 'sourceIpAddress',
        header: 'Source IP',
        size: 165,
        Cell: ({ cell }) => <IpLink value={cell.getValue<string>()} onClick={onIpClick} />,
      },
      {
        accessorFn: (row) => row.ethernetHeader.sourceAddress,
        id: 'sourceMac',
        header: 'Source MAC',
        size: 160,
        Cell: ({ cell }) => <Box sx={monoSx}>{cell.getValue<string>()}</Box>,
      },
      {
        accessorFn: (row) => row.destinationIpAddress ?? '',
        id: 'destinationIpAddress',
        header: 'Destination IP',
        size: 165,
        Cell: ({ cell }) => <IpLink value={cell.getValue<string>()} onClick={onIpClick} />,
      },
      {
        accessorFn: (row) => row.ethernetHeader.destinationAddress,
        id: 'destinationMac',
        header: 'Destination MAC',
        size: 160,
        Cell: ({ cell }) => <Box sx={monoSx}>{cell.getValue<string>()}</Box>,
      },
      {
        accessorFn: (row) => row.ethernetHeader.type,
        id: 'type',
        header: 'EtherType',
        size: 175,
        Cell: ({ cell }) => (
          <Chip size="small" variant="outlined" label={cell.getValue<string>()} sx={monoSx} />
        ),
      },
      {
        accessorFn: (row) => row.llcHeader?.dsap ?? '',
        id: 'llcDsap',
        header: 'LLC DSAP',
        size: 140,
        Cell: ({ cell }) => <Box sx={monoSx}>{cell.getValue<string>() || '—'}</Box>,
      },
      {
        accessorFn: (row) => row.llcHeader?.ssap ?? '',
        id: 'llcSsap',
        header: 'LLC SSAP',
        size: 140,
        Cell: ({ cell }) => <Box sx={monoSx}>{cell.getValue<string>() || '—'}</Box>,
      },
      {
        accessorFn: (row) => row.llcHeader?.control ?? '',
        id: 'llcControl',
        header: 'LLC Control',
        size: 140,
        Cell: ({ cell }) => <Box sx={monoSx}>{cell.getValue<string>() || '—'}</Box>,
      },
      {
        accessorFn: (row) => hexByteCount(row.dataHexStream),
        id: 'frameBytes',
        header: 'Frame',
        size: 100,
        filterVariant: 'range',
        Cell: ({ cell }) => (
          <Typography variant="body2" sx={monoSx}>
            {cell.getValue<number>()} B
          </Typography>
        ),
      },
      {
        accessorFn: (row) => hexByteCount(row.ethernetPadHexStream),
        id: 'padBytes',
        header: 'Pad',
        size: 90,
        filterVariant: 'range',
        Cell: ({ cell }) => (
          <Typography
            variant="body2"
            sx={monoSx}
            color={cell.getValue<number>() > 0 ? 'text.primary' : 'text.disabled'}
          >
            {cell.getValue<number>()} B
          </Typography>
        ),
      },
    ],
    [onIpClick],
  );

  const tableOptions = {
    muiSearchTextFieldProps: { placeholder: 'Search packets', sx: { minWidth: 240 } },
    renderDetailPanel: ({ row }) => (
      <Stack spacing={2} sx={{ px: 1, py: 1.5, maxWidth: 900 }}>
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Frame data ({hexByteCount(row.original.dataHexStream)} bytes)
          </Typography>
          <HexDump hexStream={row.original.dataHexStream} emptyLabel="No frame data captured" />
        </Box>
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Ethernet padding ({hexByteCount(row.original.ethernetPadHexStream)} bytes)
          </Typography>
          <HexDump hexStream={row.original.ethernetPadHexStream} emptyLabel="No padding on this frame" />
        </Box>
      </Stack>
    ),
    renderTopToolbarCustomActions: () => (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          pl: 0.5,
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 650,
          }}
        >
          Captured packets
        </Typography>
        <Chip size="small" label={`${rows.length.toLocaleString()} shown`} />
        {packets.length !== rows.length && (
          <Chip
            size="small"
            variant="outlined"
            label={`${(packets.length - rows.length).toLocaleString()} non-IP hidden`}
          />
        )}
      </Stack>
    ),
    renderEmptyRowsFallback: () => (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
          }}
        >
          {capturing
            ? 'Waiting for packets…'
            : 'No packets captured yet. Choose an interface and start a capture.'}
        </Typography>
      </Box>
    ),
  } satisfies Partial<MRT_TableOptions<Packet>>;

  return <DataGrid columns={columns} data={rows} tableOptions={tableOptions} />;
}

function IpLink({ value, onClick }: { value: string; onClick: (ipAddress: string) => void }) {
  if (!value) return <Box sx={{ color: 'text.disabled' }}>—</Box>;
  return (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={() => onClick(value)}
      sx={{ ...monoSx, display: 'inline-flex', alignItems: 'center', gap: 0.5, textAlign: 'left' }}
    >
      {value}
      <TravelExploreIcon sx={{ fontSize: 14, opacity: 0.65 }} />
    </Link>
  );
}
