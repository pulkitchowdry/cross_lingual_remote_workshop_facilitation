import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/providers/local-inference-client", () => ({
  localTranscribe: vi.fn(),
}));

import { localTranscribe } from "@/lib/providers/local-inference-client";
import { LocalBufferingSpeechToTextStream } from "./local-speech-buffer";

const localTranscribeMock = localTranscribe as unknown as ReturnType<typeof vi.fn>;

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
