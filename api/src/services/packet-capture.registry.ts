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

/**
 * Asks both captures what the last process left them doing — see V18.
 *
 * Here rather than in `index.ts` for the same reason `stopAllCaptures` is: how
 * many captures there are is this module's fact, and the boot sequence having its
 * own list of them is how one gets added and only stopped.
 *
 * `allSettled`, because neither outcome should cost the other. A capture whose
 * interface has since been renamed cannot be resumed, and that must not stop the
 * other one being reported.
 */
export async function restoreInterruptedCaptures(): Promise<void> {
  await Promise.allSettled([
    interfaceCapture.restoreInterruptedCapture(),
    filteredIpCapture.restoreInterruptedCapture(),
  ]);
}
