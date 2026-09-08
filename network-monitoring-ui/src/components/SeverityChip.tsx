import Chip, { type ChipProps } from '@mui/material/Chip';
import type { UiMessageKey } from '../i18n/ui';
import { useT } from '../i18n/ui';
import type { AlertKind, Severity } from '../types';

/**
 * Colour and label for each severity, used by the chip and the summary tiles.
 *
 * `labelKey` rather than `label`: a severity name is read, so it is translated,
 * while the `kind` it sits beside is an identifier and is not. The hex is here
 * because the charts need a colour outside the MUI palette; see charts/palette.ts.
 */
export const SEVERITY_STYLE: Record<
  Severity,
  { labelKey: UiMessageKey; color: ChipProps['color']; hex: string }
> = {
  critical: { labelKey: 'severity.critical', color: 'error', hex: '#b91c1c' },
  high: { labelKey: 'severity.high', color: 'warning', hex: '#c2410c' },
  medium: { labelKey: 'severity.medium', color: 'info', hex: '#a16207' },
  low: { labelKey: 'severity.low', color: 'default', hex: '#0f766e' },
  info: { labelKey: 'severity.info', color: 'default', hex: '#475569' },
};

/**
 * Readable names for detector kinds.
 *
 * The `kind` itself stays English wherever it is stored, exported or matched — it
 * is an identifier that happens to be readable, and a SIEM rule keys on it. This
 * map is the *label*, which is the half a person reads.
 */
export const KIND_LABEL: Record<AlertKind, UiMessageKey> = {
  arp_spoofing: 'kind.arp_spoofing',
  port_scan: 'kind.port_scan',
  host_sweep: 'kind.host_sweep',
  syn_flood: 'kind.syn_flood',
  plaintext_credentials: 'kind.plaintext_credentials',
  dns_tunneling: 'kind.dns_tunneling',
  new_device: 'kind.new_device',
  threat_intel: 'kind.threat_intel',
};

/** One-line explanation of what each detector looks for. */
export const KIND_DESCRIPTION: Record<AlertKind, UiMessageKey> = {
  arp_spoofing: 'kind.arp_spoofing.description',
  port_scan: 'kind.port_scan.description',
  host_sweep: 'kind.host_sweep.description',
  syn_flood: 'kind.syn_flood.description',
  plaintext_credentials: 'kind.plaintext_credentials.description',
  dns_tunneling: 'kind.dns_tunneling.description',
  new_device: 'kind.new_device.description',
  threat_intel: 'kind.threat_intel.description',
};

export function SeverityChip({
  severity,
  size = 'small',
}: Readonly<{
  severity: Severity;
  size?: 'small' | 'medium';
}>) {
  const t = useT();
  const style = SEVERITY_STYLE[severity];
  return (
    <Chip
      label={t(style.labelKey)}
      size={size}
      color={style.color}
      variant={severity === 'critical' || severity === 'high' ? 'filled' : 'outlined'}
      sx={{ fontWeight: 600, minWidth: 74 }}
    />
  );
}
