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

    stream.sendAudio(new Uint8Array([2]));
    stream.sendAudio(new Uint8Array([3]));
    // A second window tick must not re-attempt local or re-open the fallback.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(openCloudFallback).toHaveBeenCalledTimes(1);
    expect(localTranscribeMock).toHaveBeenCalledTimes(1);
    expect(fallbackStream.sendAudio).toHaveBeenCalledTimes(2);

    stream.close();
    expect(fallbackStream.close).toHaveBeenCalledTimes(1);
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
