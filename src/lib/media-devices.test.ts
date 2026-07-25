import { describe, expect, it, vi } from "vitest";
import { dedupeDevicesByDeviceId, dedupeEnumerateDevices } from "./media-devices";

function fakeDevice(overrides: Partial<MediaDeviceInfo>): MediaDeviceInfo {
  return {
    deviceId: "device-1",
    groupId: "group-1",
    kind: "videoinput",
    label: "",
    toJSON() {
      return this;
    },
    ...overrides,
  };
}

describe("dedupeDevicesByDeviceId", () => {
  it("collapses two entries that share one deviceId, as V4L2's capture/metadata node pair does", () => {
    const capture = fakeDevice({ deviceId: "shared-hash", label: "Integrated Camera" });
    const metadata = fakeDevice({ deviceId: "shared-hash", label: "Integrated Camera (metadata)" });

    const result = dedupeDevicesByDeviceId([capture, metadata]);

    expect(result).toHaveLength(1);
  });

  it("keeps devices with distinct deviceIds", () => {
    const first = fakeDevice({ deviceId: "device-a" });
    const second = fakeDevice({ deviceId: "device-b" });

    expect(dedupeDevicesByDeviceId([first, second])).toHaveLength(2);
  });

  it("prefers a labeled entry over a blank one for the same deviceId", () => {
    const blank = fakeDevice({ deviceId: "shared-hash", label: "" });
    const labeled = fakeDevice({ deviceId: "shared-hash", label: "USB Webcam" });

    const [kept] = dedupeDevicesByDeviceId([blank, labeled]);

    expect(kept.label).toBe("USB Webcam");
  });

  it("returns an empty list unchanged", () => {
    expect(dedupeDevicesByDeviceId([])).toEqual([]);
  });
});

describe("dedupeEnumerateDevices", () => {
  function fakeMediaDevices(devices: MediaDeviceInfo[]) {
    return {
      enumerateDevices: vi.fn().mockResolvedValue(devices),
    } as unknown as MediaDevices;
  }

  it("wraps enumerateDevices so its resolved list is deduped", async () => {
    const duplicated = [
      fakeDevice({ deviceId: "shared-hash", label: "Integrated Camera" }),
      fakeDevice({ deviceId: "shared-hash", label: "Integrated Camera (metadata)" }),
    ];
    const mediaDevices = fakeMediaDevices(duplicated);

    dedupeEnumerateDevices(mediaDevices);
    const result = await mediaDevices.enumerateDevices();

    expect(result).toHaveLength(1);
  });

  it("only wraps a given MediaDevices instance once", async () => {
    const mediaDevices = fakeMediaDevices([fakeDevice({})]);
    const originalEnumerate = mediaDevices.enumerateDevices;

    dedupeEnumerateDevices(mediaDevices);
    const wrapped = mediaDevices.enumerateDevices;
    dedupeEnumerateDevices(mediaDevices);

    expect(mediaDevices.enumerateDevices).toBe(wrapped);
    expect(mediaDevices.enumerateDevices).not.toBe(originalEnumerate);
  });
});
