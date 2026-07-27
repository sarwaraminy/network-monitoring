/**
 * The IPFIX Information Elements we care about (IANA registry), which NetFlow v9
 * numbers identically for the fields the two have in common.
 *
 * Only a subset is listed. An exporter's template will contain fields we have no
 * use for — AS numbers, prefix lengths, MPLS labels, vendor enterprise fields —
 * and the record decoder skips those by length without needing to know them. That
 * matters: templates are vendor-defined, so a decoder that insists on
 * understanding every field would fail on most real hardware.
 */
export const IE = {
  OCTET_DELTA_COUNT: 1,
  PACKET_DELTA_COUNT: 2,
  PROTOCOL_IDENTIFIER: 4,
  TCP_CONTROL_BITS: 6,
  SOURCE_TRANSPORT_PORT: 7,
  SOURCE_IPV4_ADDRESS: 8,
  INGRESS_INTERFACE: 10,
  DESTINATION_TRANSPORT_PORT: 11,
  DESTINATION_IPV4_ADDRESS: 12,
  EGRESS_INTERFACE: 14,
  FLOW_END_SYS_UP_TIME: 21,
  FLOW_START_SYS_UP_TIME: 22,
  SOURCE_IPV6_ADDRESS: 27,
  DESTINATION_IPV6_ADDRESS: 28,
  SOURCE_MAC_ADDRESS: 56,
  DESTINATION_MAC_ADDRESS: 80,
  FLOW_START_SECONDS: 150,
  FLOW_END_SECONDS: 151,
  FLOW_START_MILLISECONDS: 152,
  FLOW_END_MILLISECONDS: 153,
  FLOW_START_MICROSECONDS: 154,
  FLOW_END_MICROSECONDS: 155,
  /** Totals rather than deltas; some exporters send these instead of 1 and 2. */
  OCTET_TOTAL_COUNT: 85,
  PACKET_TOTAL_COUNT: 86,
} as const;

/** Marks a variable-length field in a template (RFC 7011 §7). */
export const VARIABLE_LENGTH = 0xffff;

/** One field of a template, in wire order. */
export interface TemplateField {
  informationElement: number;
  /** Bytes in the record, or VARIABLE_LENGTH. */
  length: number;
  /**
   * Set for enterprise-specific fields. We never interpret those, but the length
   * still has to be stepped over, and knowing it is enterprise-scoped stops us
   * mistaking, say, enterprise element 8 for sourceIPv4Address.
   */
  enterprise: number | null;
}

export interface Template {
  id: number;
  fields: TemplateField[];
  /**
   * Total record length, or null when any field is variable-length — in that case
   * each record has to be measured as it is decoded.
   */
  fixedLength: number | null;
}

export function templateFixedLength(fields: TemplateField[]): number | null {
  let total = 0;
  for (const field of fields) {
    if (field.length === VARIABLE_LENGTH) return null;
    total += field.length;
  }
  return total;
}
