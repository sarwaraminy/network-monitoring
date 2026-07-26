import Chip, { type ChipProps } from '@mui/material/Chip';
import type { AlertKind, Severity } from '../types';

/** Colour and label for each severity, used by the chip and the summary tiles. */
export const SEVERITY_STYLE: Record<Severity, { label: string; color: ChipProps['color']; hex: string }> = {
  critical: { label: 'Critical', color: 'error', hex: '#b91c1c' },
  high: { label: 'High', color: 'warning', hex: '#c2410c' },
  medium: { label: 'Medium', color: 'info', hex: '#a16207' },
  low: { label: 'Low', color: 'default', hex: '#0f766e' },
  info: { label: 'Info', color: 'default', hex: '#475569' },
};

/** Human-readable names for detector kinds. */
export const KIND_LABEL: Record<AlertKind, string> = {
  arp_spoofing: 'ARP spoofing',
  port_scan: 'Port scan',
  host_sweep: 'Host sweep',
  syn_flood: 'SYN flood',
  plaintext_credentials: 'Cleartext credentials',
  dns_tunneling: 'DNS tunnelling',
  new_device: 'New device',
};

/** One-line explanation of what each detector looks for. */
export const KIND_DESCRIPTION: Record<AlertKind, string> = {
  arp_spoofing:
    'A host claiming an IP address that belongs to another device — the basis of most LAN man-in-the-middle attacks.',
  port_scan: 'One source probing many ports on a single host, mapping which services it exposes.',
  host_sweep: 'One source probing the same port across many hosts, hunting for a service to exploit.',
  syn_flood:
    'An implausible rate of connection attempts, indicating denial of service or an aggressive scanner.',
  plaintext_credentials: 'Credentials or session cookies crossing the network without encryption.',
  dns_tunneling:
    'DNS queries shaped like encoded data rather than name lookups, suggesting exfiltration or C2.',
  new_device: 'A MAC address not seen on this network before.',
};

export function SeverityChip({
  severity,
  size = 'small',
}: {
  severity: Severity;
  size?: 'small' | 'medium';
}) {
  const style = SEVERITY_STYLE[severity];
  return (
    <Chip
      label={style.label}
      size={size}
      color={style.color}
      variant={severity === 'critical' || severity === 'high' ? 'filled' : 'outlined'}
      sx={{ fontWeight: 600, minWidth: 74 }}
    />
  );
}
