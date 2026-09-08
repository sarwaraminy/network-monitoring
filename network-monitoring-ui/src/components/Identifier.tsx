import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { monoSx } from '../theme';

/**
 * A technical identifier, displayed so that it reads the way it was written.
 *
 * An IP address, MAC, CIDR, port, hostname or SQL fragment placed in a
 * right-to-left context is reordered by the bidirectional algorithm unless it is
 * isolated, and `192.168.1.10` can be displayed with its octets in a different
 * order than they were stored. For a network tool that is not a cosmetic bug: the
 * operator reads an address that is not the one in the finding, and acts on it.
 *
 * `dir="ltr"` plus `unicode-bidi: isolate` is the pair that fixes it — the
 * direction says how to lay the value out internally, the isolation stops it
 * interacting with the sentence around it. This is the same rule the message
 * renderer applies with U+2068/U+2069 to everything interpolated into a finding;
 * this component is for the identifiers that never pass through a message at all,
 * which is most of the ones on screen: table cells, chips, metric values.
 *
 * Deliberately a component rather than a convention. There are several hundred
 * places an identifier is rendered, and "remember to isolate this one" is not a
 * rule that survives contact with a codebase — the failure is invisible to anyone
 * who does not read right-to-left, so nothing catches it in review.
 */
export default function Identifier({
  children,
  mono = true,
  sx,
  ...rest
}: Readonly<{
  children: ReactNode;
  /**
   * Monospace, which is the right default here: these are values an operator
   * compares character by character against a firewall rule or a `tcpdump` line.
   * Set false for a value that is technical but prose-shaped, like a feed name.
   */
  mono?: boolean;
  sx?: SxProps<Theme>;
  title?: string;
}>) {
  return (
    <Box
      component="span"
      dir="ltr"
      sx={[
        {
          // `isolate` rather than `embed`: isolation additionally stops this value
          // from changing how the text *around* it is ordered, which `embed` allows.
          unicodeBidi: 'isolate',
          ...(mono ? monoSx : {}),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {children}
    </Box>
  );
}
