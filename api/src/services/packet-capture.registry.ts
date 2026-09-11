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

/**
 * Ends both captures because the process is going away.
 *
 * `'shutdown'`, and that argument is the whole point: this runs from the
 * SIGINT/SIGTERM handler, so every ordinary restart arrives here. Stopping
 * without saying why recorded a clean stop, and the interruption notice then
 * fired only on SIGKILL — never on the container restart and machine reboot the
 * feature is documented for.
 */
export async function stopAllCaptures(): Promise<void> {
  await Promise.allSettled([
    interfaceCapture.stopCapture('shutdown'),
    filteredIpCapture.stopCapture('shutdown'),
  ]);
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
export async function reportInterruptedCaptures(): Promise<void> {
  await Promise.allSettled([
    interfaceCapture.reportInterruptedCapture(),
    filteredIpCapture.reportInterruptedCapture(),
  ]);
}

/**
 * Starts again whatever was interrupted, when the installation asked for that.
 *
 * Separate from the reporting above, and called later in the boot sequence, for a
 * reason that is not tidiness: a resumed capture decodes packets immediately, so
 * starting it before `refreshSuppressions()` and `startIntel()` means the first
 * findings of the process are matched against no suppression rules and no
 * indicator feeds. Suppressed findings would be stored *and* notified, and intel
 * matches missed rather than deferred.
 *
 * Reading the record does not depend on any of that; only running a capture does.
 */
export async function resumeInterruptedCaptures(): Promise<void> {
  await Promise.allSettled([
    interfaceCapture.resumeInterruptedCapture(),
    filteredIpCapture.resumeInterruptedCapture(),
  ]);
}
