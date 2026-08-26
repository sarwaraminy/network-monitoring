import type { PacketDTO } from '../types/dto.js';
import { toHexStream } from './addresses.js';
import { type DecodedPacket, ipAddresses } from './decode.js';

export interface PacketDtoOptions {
  /**
   * Omits the frame and padding hex streams. Captured payloads can contain
   * message content and personal data, which brings wiretap statutes and GDPR
   * into scope; deployments that must not expose them set REDACT_PACKET_PAYLOAD.
   * Detection is unaffected — detectors read the decoded packet, not the DTO.
   */
  redactPayload?: boolean;
}

/** Was PacketCaptureService.createPacketDTO(Packet). */
export function toPacketDTO(packet: DecodedPacket, options: PacketDtoOptions = {}): PacketDTO {
  const { src, dst } = ipAddresses(packet);
  const redact = options.redactPayload === true;

  return {
    ethernetHeader: {
      destinationAddress: packet.ethernet?.destinationAddress ?? '',
      sourceAddress: packet.ethernet?.sourceAddress ?? '',
      type: packet.ethernet?.type ?? '',
    },
    llcHeader: packet.llc,
    dataHexStream: redact ? '' : toHexStream(packet.raw),
    ethernetPadHexStream: redact ? '' : toHexStream(packet.ethernetPad),
    sourceIpAddress: src,
    destinationIpAddress: dst,
    frameLength: packet.frameLength,
    payloadRedacted: redact,
  };
}

/**
 * A copy of a stored packet with its frame bytes removed.
 *
 * Applied per request rather than at capture time, because the two questions are
 * different: `REDACT_PACKET_PAYLOAD` asks whether this deployment retains frame
 * bytes at all, and this asks whether THIS caller may see the ones it retained.
 *
 * Gating capture control on ADMIN was not enough on its own — a USER could still
 * read a capture an administrator had started, and the global flag offered no
 * way to give admins frames without giving them to everyone.
 */
export function withoutPayload(packet: PacketDTO): PacketDTO {
  return { ...packet, dataHexStream: '', ethernetPadHexStream: '', payloadRedacted: true };
}
