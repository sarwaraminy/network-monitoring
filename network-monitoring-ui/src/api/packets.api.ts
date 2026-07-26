import type { CaptureStatus, IpInfo, NetworkInterface, Packet, StartCaptureParams } from '../types';
import { api } from './client';

/**
 * The API exposes two parallel capture endpoints, matching the old
 * PacketCaptureController (/api/packets) and PacketCaptureControllerWithIP
 * (/api/ip/packets). `scope` picks between them.
 */
export type CaptureScope = 'interface' | 'filtered-ip';

function base(scope: CaptureScope): string {
  return scope === 'interface' ? '/api/packets' : '/api/ip/packets';
}

export async function fetchNetworkInterfaces(scope: CaptureScope): Promise<NetworkInterface[]> {
  const { data } = await api.get<NetworkInterface[]>(`${base(scope)}/nif`);
  return data;
}

export async function startCapture(scope: CaptureScope, params: StartCaptureParams): Promise<CaptureStatus> {
  // `undefined`, not `null`: axios serialises a null body to the literal string
  // "null", which express.json() rejects in strict mode. Everything travels as
  // query parameters, matching the Java @RequestParam signature.
  const { data } = await api.post<CaptureStatus>(`${base(scope)}/start`, undefined, { params });
  return data;
}

export async function stopCapture(scope: CaptureScope): Promise<CaptureStatus> {
  const { data } = await api.post<CaptureStatus>(`${base(scope)}/stop`);
  return data;
}

export async function fetchPackets(scope: CaptureScope): Promise<Packet[]> {
  const { data } = await api.get<Packet[]>(base(scope));
  return data;
}

export async function clearPackets(scope: CaptureScope): Promise<void> {
  await api.post(`${base(scope)}/clear`);
}

export async function fetchCaptureStatus(scope: CaptureScope): Promise<CaptureStatus> {
  const { data } = await api.get<CaptureStatus>(`${base(scope)}/status`);
  return data;
}

export async function fetchIpInfo(ipAddress: string): Promise<IpInfo> {
  const { data } = await api.get<IpInfo>('/api/packets/ip-info', { params: { ipAddress } });
  return data;
}
