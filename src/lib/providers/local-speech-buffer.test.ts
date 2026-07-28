import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/providers/local-inference-client", () => ({
  localTranscribe: vi.fn(),
}));

import { localTranscribe } from "@/lib/providers/local-inference-client";
import { LocalBufferingSpeechToTextStream } from "./local-speech-buffer";

const localTranscribeMock = localTranscribe as unknown as ReturnType<typeof vi.fn>;

/** Builds one ISO-BMFF box: 4-byte big-endian size + 4-byte ASCII type + payload. */
function mp4Box(type: string, payload: number[] = []): number[] {
  const size = 8 + payload.length;
  return [
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
    ...payload,
  ];
}

describe("LocalBufferingSpeechToTextStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localTranscribeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers sendAudio chunks and flushes one concatenated window every ~2.5s", async () => {
    localTranscribeMock.mockResolvedValue({ text: "hello world" });
    const onSegment = vi.fn();
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment,
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback: vi.fn(),
    });

    stream.sendAudio(new Uint8Array([1, 2]));
    stream.sendAudio(new Uint8Array([3, 4]));
    expect(localTranscribeMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_500);

    expect(localTranscribeMock).toHaveBeenCalledTimes(1);
    const [audioArg] = localTranscribeMock.mock.calls[0];
    expect(Array.from(audioArg as Uint8Array)).toEqual([1, 2, 3, 4]);
    expect(onSegment).toHaveBeenCalledWith({ text: "hello world", isFinal: true });

    stream.close();
  });

  it("skips the flush entirely when no audio was buffered in a window", async () => {
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2_500);
    expect(localTranscribeMock).not.toHaveBeenCalled();
    stream.close();
  });

  it("switches to the cloud fallback exactly once on local failure, then routes all future audio there", async () => {
    localTranscribeMock.mockRejectedValue(new Error("local down"));
    const fallbackStream = { sendAudio: vi.fn(), close: vi.fn() };
    const openCloudFallback = vi.fn().mockReturnValue(fallbackStream);
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback,
    });

    stream.sendAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(2_500);
    expect(openCloudFallback).toHaveBeenCalledTimes(1);
    // The failed window's own audio is recovered to the fallback instead of dropped.
    expect(fallbackStream.sendAudio).toHaveBeenNthCalledWith(1, new Uint8Array([1]));

    stream.sendAudio(new Uint8Array([2]));
    stream.sendAudio(new Uint8Array([3]));
    // A second window tick must not re-attempt local or re-open the fallback.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(openCloudFallback).toHaveBeenCalledTimes(1);
    expect(localTranscribeMock).toHaveBeenCalledTimes(1);
    expect(fallbackStream.sendAudio).toHaveBeenCalledTimes(3);

    stream.close();
    expect(fallbackStream.close).toHaveBeenCalledTimes(1);
  });

  it("forwards the failed window's audio plus anything buffered while the failing call was pending, instead of dropping it", async () => {
    let rejectLocal!: (error: Error) => void;
    localTranscribeMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLocal = reject;
      }),
    );
    const fallbackStream = { sendAudio: vi.fn(), close: vi.fn() };
    const openCloudFallback = vi.fn().mockReturnValue(fallbackStream);
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback,
    });

    stream.sendAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(2_500); // flush() starts; localTranscribe is pending, not yet rejected

    // Arrives while the (about to fail) local call is still in flight — must not be lost.
    stream.sendAudio(new Uint8Array([2]));

    rejectLocal(new Error("local down"));
    await vi.waitFor(() => expect(fallbackStream.sendAudio).toHaveBeenCalledTimes(1));

    expect(Array.from(fallbackStream.sendAudio.mock.calls[0][0] as Uint8Array)).toEqual([1, 2]);

    stream.close();
  });

  it("does not drop audio buffered while close() races an in-flight flush", async () => {
    let resolveFirstFlush!: (result: { text: string }) => void;
    localTranscribeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstFlush = resolve;
      }),
    );
    const onSegment = vi.fn();
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment,
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback: vi.fn(),
    });

    stream.sendAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(2_500); // first flush() starts; localTranscribe is pending

    // Arrives after the in-flight call already captured/cleared the buffer, so it sits
    // in the (now empty, then refilled) buffer for a window that hasn't flushed yet.
    stream.sendAudio(new Uint8Array([2]));

    // close() while the first flush is still in-flight — must not silently no-op on
    // the single-flight guard and lose the audio sent above.
    localTranscribeMock.mockResolvedValueOnce({ text: "second" });
    stream.close();

    resolveFirstFlush({ text: "first" });
    await vi.waitFor(() => expect(localTranscribeMock).toHaveBeenCalledTimes(2));

    expect(Array.from(localTranscribeMock.mock.calls[1][0] as Uint8Array)).toEqual([2]);
    await vi.waitFor(() => expect(onSegment).toHaveBeenCalledWith({ text: "second", isFinal: true }));
    expect(onSegment).toHaveBeenCalledWith({ text: "first", isFinal: true });
  });

  it("awaits the true in-flight flush on close(), not a stale one clobbered by a later timer tick", async () => {
    let resolveFirstFlush!: (result: { text: string }) => void;
    localTranscribeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstFlush = resolve;
      }),
    );
    const onSegment = vi.fn();
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment,
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback: vi.fn(),
    });

    stream.sendAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(2_500); // first flush() starts; localTranscribe is pending

    // Arrives after the first flush already captured/cleared the buffer.
    stream.sendAudio(new Uint8Array([2]));

    // A second timer tick fires while the first flush is still in-flight. Before the
    // fix, this reassigned `flushPromise` to this tick's own (single-flight-guarded,
    // trivially-resolved) no-op promise, clobbering the reference to the real
    // in-flight flush that close() needs to wait out.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(localTranscribeMock).toHaveBeenCalledTimes(1); // second tick must not re-invoke localTranscribe

    localTranscribeMock.mockResolvedValueOnce({ text: "second" });
    stream.close();

    resolveFirstFlush({ text: "first" });
    await vi.waitFor(() => expect(localTranscribeMock).toHaveBeenCalledTimes(2));

    expect(Array.from(localTranscribeMock.mock.calls[1][0] as Uint8Array)).toEqual([2]);
    await vi.waitFor(() => expect(onSegment).toHaveBeenCalledWith({ text: "second", isFinal: true }));
    expect(onSegment).toHaveBeenCalledWith({ text: "first", isFinal: true });
  });

  it("captures the WebM container header from the first window and prepends it to later headerless windows", async () => {
    localTranscribeMock.mockResolvedValue({ text: "" });
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback: vi.fn(),
    });

    // Cluster ID 0x1F43B675 at offset 3: bytes [0..2] are the container "header",
    // matching how browser MediaRecorder only writes EBML+Segment+Tracks once.
    const firstWindow = new Uint8Array([0xaa, 0xbb, 0xcc, 0x1f, 0x43, 0xb6, 0x75, 0x01]);
    stream.sendAudio(firstWindow);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(Array.from(localTranscribeMock.mock.calls[0][0] as Uint8Array)).toEqual(Array.from(firstWindow));

    const secondWindow = new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x02]);
    stream.sendAudio(secondWindow);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(Array.from(localTranscribeMock.mock.calls[1][0] as Uint8Array)).toEqual([
      0xaa, 0xbb, 0xcc, 0x1f, 0x43, 0xb6, 0x75, 0x02,
    ]);

    stream.close();
  });

  it("prepends the captured WebM header when forwarding a second-or-later failed window to the cloud fallback", async () => {
    // Window 1 succeeds locally and captures the WebM container header.
    localTranscribeMock.mockResolvedValueOnce({ text: "ok" });
    const fallbackStream = { sendAudio: vi.fn(), close: vi.fn() };
    const openCloudFallback = vi.fn().mockReturnValue(fallbackStream);
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback,
    });

    const firstWindow = new Uint8Array([0xaa, 0xbb, 0xcc, 0x1f, 0x43, 0xb6, 0x75, 0x01]);
    stream.sendAudio(firstWindow);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(openCloudFallback).not.toHaveBeenCalled();

    // Window 2 fails locally — its raw chunk is headerless (no EBML/Segment/Tracks),
    // matching every real second-or-later MediaRecorder chunk.
    localTranscribeMock.mockRejectedValueOnce(new Error("local down"));
    const secondWindow = new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x02]);
    stream.sendAudio(secondWindow);
    await vi.advanceTimersByTimeAsync(2_500);

    expect(openCloudFallback).toHaveBeenCalledTimes(1);
    // The fallback must receive the header-prepended bytes (the captured header plus
    // the raw second window), not the raw headerless chunk — otherwise Deepgram,
    // opening a brand-new connection with no container header of its own, can't
    // decode it and the "seamless" fallback goes silently, permanently dead.
    expect(Array.from(fallbackStream.sendAudio.mock.calls[0][0] as Uint8Array)).toEqual([
      0xaa, 0xbb, 0xcc, 0x1f, 0x43, 0xb6, 0x75, 0x02,
    ]);

    stream.close();
  });

  it("forwards raw PCM chunks (not WAV-wrapped) to the cloud fallback when encoding is provided", async () => {
    localTranscribeMock.mockRejectedValue(new Error("local down"));
    const fallbackStream = { sendAudio: vi.fn(), close: vi.fn() };
    const openCloudFallback = vi.fn().mockReturnValue(fallbackStream);
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback,
      encoding: { format: "linear16", sampleRate: 16_000, channels: 1 },
    });

    stream.sendAudio(new Uint8Array([1, 2, 3, 4]));
    await vi.advanceTimersByTimeAsync(2_500);

    expect(openCloudFallback).toHaveBeenCalledTimes(1);
    // Deepgram is told the exact raw format via URL params for this path (see
    // openDeepgramStream's `encoding`) — a WAV header here would corrupt the first 44
    // bytes of what it expects to be headerless raw PCM.
    expect(Array.from(fallbackStream.sendAudio.mock.calls[0][0] as Uint8Array)).toEqual([1, 2, 3, 4]);

    stream.close();
  });

  it("calls onError and drops audio when local fails and cloud fallback is disallowed", async () => {
    localTranscribeMock.mockRejectedValue(new Error("local down"));
    const onError = vi.fn();
    const openCloudFallback = vi.fn();
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError,
      allowCloudFallback: false,
      openCloudFallback,
    });

    stream.sendAudio(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(2_500);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(openCloudFallback).not.toHaveBeenCalled();
    stream.close();
  });

  it("captures the fragmented-MP4 header from the first window and prepends it to later headerless windows when mimeType is audio/mp4", async () => {
    // Safari's MediaRecorder produces fragmented MP4, not WebM — the boundary
    // finder must walk ISO-BMFF box sizes (ftyp/moov/moof), not search for
    // WebM's Cluster ID byte pattern.
    localTranscribeMock.mockResolvedValue({ text: "" });
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback: vi.fn(),
      mimeType: "audio/mp4",
    });

    const ftyp = mp4Box("ftyp", [0, 0, 0, 0]);
    const moov = mp4Box("moov", [1, 2, 3, 4]);
    const header = [...ftyp, ...moov];
    const firstWindow = new Uint8Array([...header, ...mp4Box("moof", [9]), ...mp4Box("mdat", [0xaa])]);

    stream.sendAudio(firstWindow);
    await vi.advanceTimersByTimeAsync(2_500);
    const [firstBytes, firstMimeType] = localTranscribeMock.mock.calls[0].slice(0, 2) as [Uint8Array, string];
    expect(firstMimeType).toBe("audio/mp4");
    expect(Array.from(firstBytes)).toEqual(Array.from(firstWindow));

    // A real second-or-later MediaRecorder chunk is headerless: just more fragments.
    const secondWindow = new Uint8Array([...mp4Box("moof", [9]), ...mp4Box("mdat", [0xbb])]);
    stream.sendAudio(secondWindow);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(Array.from(localTranscribeMock.mock.calls[1][0] as Uint8Array)).toEqual([...header, ...Array.from(secondWindow)]);

    stream.close();
  });

  it("wraps linear16 PCM audio in a WAV header when encoding is provided", async () => {
    localTranscribeMock.mockResolvedValue({ text: "" });
    const stream = new LocalBufferingSpeechToTextStream({
      expectedLanguage: "en",
      onSegment: vi.fn(),
      onError: vi.fn(),
      allowCloudFallback: true,
      openCloudFallback: vi.fn(),
      encoding: { format: "linear16", sampleRate: 16_000, channels: 1 },
    });

    stream.sendAudio(new Uint8Array([1, 2, 3, 4]));
    await vi.advanceTimersByTimeAsync(2_500);

    const [bytes, mimeType] = localTranscribeMock.mock.calls[0].slice(0, 2) as [Uint8Array, string];
    expect(mimeType).toBe("audio/wav");
    expect(bytes.byteLength).toBe(44 + 4); // WAV header + original PCM bytes
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");

    stream.close();
  });
});
