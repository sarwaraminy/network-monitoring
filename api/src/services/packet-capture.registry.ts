import { PacketCaptureService } from './packet-capture.service.js';

/**
 * The two singletons Spring used to inject: PacketCaptureService (interface-wide)
 * and PacketCaptureServiceWithIP (filtered by host). They stay separate so each
 * keeps its own capture handle, packet buffer and detection state.
 *
 * They no longer differ in detection logic. The Java classes had drifted into two
 * inconsistent `isAnomalous` implementations by accident, not by design; both now
 * run the same detector set.
 */
export const interfaceCapture = new PacketCaptureService('interface');
export const filteredIpCapture = new PacketCaptureService('filtered-ip');

export async function stopAllCaptures(): Promise<void> {
  await Promise.allSettled([interfaceCapture.stopCapture(), filteredIpCapture.stopCapture()]);
}
