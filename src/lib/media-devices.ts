/**
 * Some camera/mic drivers hand the browser two `MediaDeviceInfo` entries for
 * one physical device that share a single browser-anonymized `deviceId` —
 * e.g. V4L2 on Linux, where webcams with a hardware ISP expose a capture
 * node and a metadata node for the same camera, both hashing to the same id.
 * `@livekit/components-react`'s device menu (`MediaDeviceSelect.tsx`) keys
 * its `<li>` options by `deviceId` with no deduplication, so a collision
 * reliably trips React's "two children with the same key" warning —
 * independent of mic/camera permission state. (Permission state causes a
 * *different* collision — every device reporting `deviceId: ""` before
 * permission is granted — which `WorkshopVideoStage`'s permission-priming
 * effect in `LiveSessionRoom.tsx` already handles; this fixes the other
 * one, which survived two earlier permission-focused attempts because
 * permissions were never the cause of it.)
 */
export function dedupeDevicesByDeviceId(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const byDeviceId = new Map<string, MediaDeviceInfo>();
  for (const device of devices) {
    const existing = byDeviceId.get(device.deviceId);
    if (!existing || (!existing.label && device.label)) {
      byDeviceId.set(device.deviceId, device);
    }
  }
  return [...byDeviceId.values()];
}

const patchedInstances = new WeakSet<MediaDevices>();

/**
 * `enumerateDevices()` is the one chokepoint every LiveKit device-listing
 * path calls internally (`Room.getLocalDevices` → `ControlBar`'s device
 * menus), and LiveKit doesn't expose a way to filter its result — so this
 * wraps the browser API itself instead of working around it downstream.
 * Idempotent per `MediaDevices` instance, so calling it repeatedly (module
 * re-evaluation under Fast Refresh, multiple mounted rooms) is safe.
 */
export function dedupeEnumerateDevices(mediaDevices: MediaDevices): void {
  if (patchedInstances.has(mediaDevices)) return;
  patchedInstances.add(mediaDevices);
  const original = mediaDevices.enumerateDevices.bind(mediaDevices);
  mediaDevices.enumerateDevices = () => original().then(dedupeDevicesByDeviceId);
}

if (typeof navigator !== "undefined" && navigator.mediaDevices) {
  dedupeEnumerateDevices(navigator.mediaDevices);
}
