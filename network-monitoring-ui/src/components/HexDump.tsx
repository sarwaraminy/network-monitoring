import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { monoSx } from '../theme';

const BYTES_PER_ROW = 16;

/**
 * Renders a space-separated hex stream (as produced by the API's
 * `dataHexStream`) as a classic offset / hex / ASCII dump.
 *
 * The old table put the entire stream into one cell, which for a 65 KB snapshot
 * length meant a ~196 000 character string per row.
 */
export default function HexDump({ hexStream, emptyLabel }: { hexStream: string; emptyLabel: string }) {
  const rows = useMemo(() => toRows(hexStream), [hexStream]);

  if (rows.length === 0) {
    return (
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
        }}
      >
        {emptyLabel}
      </Typography>
    );
  }

  return (
    <Box
      component="pre"
      sx={{
        ...monoSx,
        m: 0,
        p: 1.5,
        borderRadius: 1,
        maxHeight: 260,
        overflow: 'auto',
        bgcolor: 'grey.50',
        border: '1px solid',
        borderColor: 'divider',
        lineHeight: 1.55,
      }}
    >
      {rows.join('\n')}
    </Box>
  );
}

function toRows(hexStream: string): string[] {
  const bytes = hexStream
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  if (bytes.length === 0) return [];

  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BYTES_PER_ROW) {
    const slice = bytes.slice(offset, offset + BYTES_PER_ROW);
    const hex = slice.join(' ').padEnd(BYTES_PER_ROW * 3 - 1, ' ');
    const ascii = slice
      .map((byte) => {
        const code = Number.parseInt(byte, 16);
        return Number.isNaN(code) || code < 32 || code > 126 ? '.' : String.fromCharCode(code);
      })
      .join('');
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`);
  }
  return rows;
}

/** Byte count of a hex stream, for column display. */
export function hexByteCount(hexStream: string): number {
  const trimmed = hexStream.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
