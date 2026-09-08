import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { MRT_ColumnDef, MRT_TableOptions } from 'material-react-table';
import { useMemo } from 'react';
import { useT } from '../i18n/ui';
import { monoSx } from '../theme';
import type { Packet } from '../types';
import DataGrid from './DataGrid';
import HexDump, { hexByteCount } from './HexDump';
import Identifier from './Identifier';

interface PacketTableProps {
  packets: Packet[];
  capturing: boolean;
  onIpClick: (ipAddress: string) => void;
  /**
   * Values that should force the table to re-measure its height.
   *
   * The capture settings above this table fold away, which moves the table up
   * without changing its size — invisible to the resize observer the measurement
   * uses. See `DataGrid`'s `fitHeightDeps`.
   */
  fitHeightDeps?: readonly unknown[];
}

/**
 * Material React Table replacement for the hand-written packet table.
 *
 * Only rows with a destination IP are shown, matching the original's
 * `packet.destinationIpAddress ? ... : null` guard. The two hex streams live in
 * the expandable detail panel rather than inline cells.
 */
export default function PacketTable({
  packets,
  capturing,
  onIpClick,
  fitHeightDeps,
}: Readonly<PacketTableProps>) {
  const t = useT();
  const rows = useMemo(() => packets.filter((packet) => Boolean(packet.destinationIpAddress)), [packets]);

  const columns = useMemo<MRT_ColumnDef<Packet>[]>(
    () => [
      {
        accessorFn: (row) => row.sourceIpAddress ?? '',
        id: 'sourceIpAddress',
        header: t('packets.source_ip'),
        size: 165,
        Cell: ipCell(onIpClick),
      },
      {
        accessorFn: (row) => row.ethernetHeader.sourceAddress,
        id: 'sourceMac',
        header: t('packets.source_mac'),
        size: 160,
        Cell: MonoCell,
      },
      {
        accessorFn: (row) => row.destinationIpAddress ?? '',
        id: 'destinationIpAddress',
        header: t('packets.destination_ip'),
        size: 165,
        Cell: ipCell(onIpClick),
      },
      {
        accessorFn: (row) => row.ethernetHeader.destinationAddress,
        id: 'destinationMac',
        header: t('packets.destination_mac'),
        size: 160,
        Cell: MonoCell,
      },
      {
        accessorFn: (row) => row.ethernetHeader.type,
        id: 'type',
        header: t('packets.ethertype'),
        size: 175,
        Cell: EtherTypeCell,
      },
      {
        accessorFn: (row) => row.llcHeader?.dsap ?? '',
        id: 'llcDsap',
        header: t('packets.llc_dsap'),
        size: 140,
        Cell: MonoOrDashCell,
      },
      {
        accessorFn: (row) => row.llcHeader?.ssap ?? '',
        id: 'llcSsap',
        header: t('packets.llc_ssap'),
        size: 140,
        Cell: MonoOrDashCell,
      },
      {
        accessorFn: (row) => row.llcHeader?.control ?? '',
        id: 'llcControl',
        header: t('packets.llc_control'),
        size: 140,
        Cell: MonoOrDashCell,
      },
      {
        accessorFn: (row) => hexByteCount(row.dataHexStream),
        id: 'frameBytes',
        header: t('packets.frame'),
        size: 100,
        filterVariant: 'range',
        Cell: FrameBytesCell,
      },
      {
        accessorFn: (row) => hexByteCount(row.ethernetPadHexStream),
        id: 'padBytes',
        header: t('packets.pad'),
        size: 90,
        filterVariant: 'range',
        Cell: PadBytesCell,
      },
    ],
    [onIpClick, t],
  );

  const tableOptions = {
    muiSearchTextFieldProps: { placeholder: t('packets.search'), sx: { minWidth: 240 } },
    renderDetailPanel: ({ row }) => (
      <Stack spacing={2} sx={{ px: 1, py: 1.5, maxWidth: 900 }}>
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {t('packets.frame_data', { bytes: hexByteCount(row.original.dataHexStream) })}
          </Typography>
          <HexDump hexStream={row.original.dataHexStream} emptyLabel={t('packets.no_frame_data')} />
        </Box>
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {t('packets.padding', { bytes: hexByteCount(row.original.ethernetPadHexStream) })}
          </Typography>
          <HexDump hexStream={row.original.ethernetPadHexStream} emptyLabel={t('packets.no_padding')} />
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
          {t('packets.captured')}
        </Typography>
        <Chip size="small" label={t('packets.shown', { count: rows.length })} />
        {packets.length !== rows.length && (
          <Chip
            size="small"
            variant="outlined"
            label={t('packets.non_ip_hidden', { count: packets.length - rows.length })}
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
          {capturing ? t('packets.waiting') : t('packets.none_yet')}
        </Typography>
      </Box>
    ),
  } satisfies Partial<MRT_TableOptions<Packet>>;

  return <DataGrid columns={columns} data={rows} tableOptions={tableOptions} fitHeightDeps={fitHeightDeps} />;
}

/*
 * Cell renderers, at module scope — same reasoning as AlertsPage. Only the two
 * IP columns need anything from the component, and they take it as an argument.
 */

/*
 * Every column in this table is an identifier — MAC addresses, EtherTypes, hex —
 * so all of them isolate. A packet view is the place an operator compares what
 * they see here against what `tcpdump` printed, character by character, and a
 * right-to-left layout must not reorder any of it.
 */
const MonoCell: MRT_ColumnDef<Packet>['Cell'] = ({ cell }) => (
  <Identifier>{cell.getValue<string>()}</Identifier>
);

const MonoOrDashCell: MRT_ColumnDef<Packet>['Cell'] = ({ cell }) => (
  <Identifier>{cell.getValue<string>() || '—'}</Identifier>
);

const EtherTypeCell: MRT_ColumnDef<Packet>['Cell'] = ({ cell }) => (
  <Chip
    size="small"
    variant="outlined"
    label={<Identifier mono={false}>{cell.getValue<string>()}</Identifier>}
    sx={monoSx}
  />
);

const FrameBytesCell: MRT_ColumnDef<Packet>['Cell'] = ({ cell }) => (
  <Typography variant="body2" sx={monoSx}>
    {cell.getValue<number>()} B
  </Typography>
);

const PadBytesCell: MRT_ColumnDef<Packet>['Cell'] = ({ cell }) => (
  <Typography
    variant="body2"
    sx={monoSx}
    color={cell.getValue<number>() > 0 ? 'text.primary' : 'text.disabled'}
  >
    {cell.getValue<number>()} B
  </Typography>
);

const ipCell =
  (onIpClick: (ipAddress: string) => void): MRT_ColumnDef<Packet>['Cell'] =>
  ({ cell }) => <IpLink value={cell.getValue<string>()} onClick={onIpClick} />;

function IpLink({ value, onClick }: Readonly<{ value: string; onClick: (ipAddress: string) => void }>) {
  if (!value) return <Box sx={{ color: 'text.disabled' }}>—</Box>;
  return (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={() => onClick(value)}
      sx={{ ...monoSx, display: 'inline-flex', alignItems: 'center', gap: 0.5, textAlign: 'left' }}
    >
      <Identifier mono={false}>{value}</Identifier>
      <TravelExploreIcon sx={{ fontSize: 14, opacity: 0.65 }} />
    </Link>
  );
}
