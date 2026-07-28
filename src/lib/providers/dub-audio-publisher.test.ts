import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LANGUAGES } from "@/lib/session-contracts";

/** Builds a minimal real WAV container so the module's real `toPcmSamples` (not mocked —
 * only `textToSpeechProvider.synthesize` below is) has something genuine to parse. */
function makeWavBytes(samples: number[], sampleRate: number, channels = 1): Uint8Array {
  const pcm = new Int16Array(samples);
  const HEADER = 44;
  const buffer = new ArrayBuffer(HEADER + pcm.byteLength);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, tag: string) => {
    for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, HEADER).set(new Uint8Array(pcm.buffer));
  return new Uint8Array(buffer);
}

// The vendor SDK: a native binding, mocked wholesale (per this repo's testing
// convention — mock the vendor SDK, not this module's own logic). Track/source
// creations are recorded so tests can find "the AudioSource for language X" without
// depending on `SUPPORTED_LANGUAGES`' iteration order.
const trackCreations: Array<{ name: string; source: FakeAudioSource }> = [];
const publishedTracks: Array<{ name: string }> = [];
const unpublishedSids: string[] = [];

class FakeAudioSource {
  captureFrame = vi.fn<(frame: FakeAudioFrame) => Promise<void>>(async () => {});
  waitForPlayout = vi.fn(async () => {});
  constructor(
    public sampleRate: number,
    public channels: number,
  ) {}
}

class FakeAudioFrame {
  constructor(
    public data: Int16Array,
    public sampleRate: number,
    public channels: number,
    public samplesPerChannel: number,
  ) {}
}

class FakeAudioResampler {
  push = vi.fn((frame: FakeAudioFrame) => [frame]);
  flush = vi.fn(() => [] as FakeAudioFrame[]);
  close = vi.fn();
  constructor(
    public inputRate: number,
    public outputRate: number,
    public channels: number,
  ) {}
}

vi.mock("@livekit/rtc-node", () => ({
  AudioSource: FakeAudioSource,
  AudioFrame: FakeAudioFrame,
  AudioResampler: FakeAudioResampler,
  AudioResamplerQuality: { MEDIUM: 2 },
  LocalAudioTrack: {
    createAudioTrack: vi.fn((name: string, source: FakeAudioSource) => {
      trackCreations.push({ name, source });
      return { name, source };
    }),
  },
  TrackPublishOptions: class {
    constructor(public opts: unknown) {}
  },
  TrackSource: { SOURCE_UNKNOWN: 0 },
}));

// `text-to-speech.ts` is this module's own internal provider abstraction, not a raw
// vendor SDK — mocking its `synthesize` directly (while keeping the real `toPcmSamples`
// via `importOriginal`) keeps this test focused on dub-audio-publisher's own queueing/
// publishing logic rather than re-testing text-to-speech.ts's own fallback behavior
// (already covered by text-to-speech.test.ts).
const synthesizeMock = vi.fn();
vi.mock("@/lib/providers/text-to-speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/text-to-speech")>();
  return { ...actual, textToSpeechProvider: { isConfigured: true, synthesize: synthesizeMock } };
});

function makeFakeRoom() {
  const publishTrack = vi.fn(async (track: { name: string }) => {
    publishedTracks.push({ name: track.name });
    return { sid: `sid-${track.name}` };
  });
  const unpublishTrack = vi.fn(async (sid: string) => {
    unpublishedSids.push(sid);
  });
  return { localParticipant: { publishTrack, unpublishTrack } };
}

function sourceForLanguage(language: string): FakeAudioSource {
  const entry = trackCreations.find((t) => t.name === `dub-${language}`);
  if (!entry) throw new Error(`no track created for "${language}"`);
  return entry.source;
}

describe("createDubAudioPublisher", () => {
  afterEach(() => {
    vi.clearAllMocks();
    trackCreations.length = 0;
    publishedTracks.length = 0;
    unpublishedSids.length = 0;
  });

  it("eagerly publishes one dub-<language> track per SUPPORTED_LANGUAGES entry", async () => {
    const { createDubAudioPublisher } = await import("./dub-audio-publisher");
    const room = makeFakeRoom();

    await createDubAudioPublisher(room as never);

    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(SUPPORTED_LANGUAGES.length);
    for (const { value } of SUPPORTED_LANGUAGES) {
      expect(publishedTracks.some((t) => t.name === `dub-${value}`)).toBe(true);
    }
  });

  it("synthesizes and captures a frame on the matching language's track only", async () => {
    synthesizeMock.mockResolvedValue({ audio: makeWavBytes([1, 2, 3, 4], 22_050), mimeType: "audio/wav", provider: "piper" });
    const { createDubAudioPublisher } = await import("./dub-audio-publisher");
    const publisher = await createDubAudioPublisher(makeFakeRoom() as never);

    publisher.enqueue("zh", "你好", true);
    await vi.waitFor(() => expect(sourceForLanguage("zh").captureFrame).toHaveBeenCalledTimes(1));

    expect(synthesizeMock).toHaveBeenCalledWith("你好", "zh", { allowCloudFallback: true });
    expect(sourceForLanguage("en").captureFrame).not.toHaveBeenCalled();
    expect(sourceForLanguage("es").captureFrame).not.toHaveBeenCalled();
    expect(sourceForLanguage("zh").waitForPlayout).toHaveBeenCalledTimes(1);
  });

  it("queues same-language segments FIFO even when synthesis resolves out of order", async () => {
    const { createDubAudioPublisher } = await import("./dub-audio-publisher");
    const publisher = await createDubAudioPublisher(makeFakeRoom() as never);
    const order: string[] = [];

    // First call's synthesis resolves *after* the second call's — a slow local-inference
    // request racing a fast one, in practice. The per-language queue must still play
    // "first" before "second" on the shared track.
    let resolveFirst!: () => void;
    synthesizeMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = () => resolve({ audio: makeWavBytes([1, 2], 22_050), mimeType: "audio/wav", provider: "piper" });
          }),
      )
      .mockImplementationOnce(async () => ({ audio: makeWavBytes([3, 4], 22_050), mimeType: "audio/wav", provider: "piper" }));

    const source = sourceForLanguage("es");
    source.captureFrame.mockImplementation(async (frame: FakeAudioFrame) => {
      order.push(frame.data[0] === 1 ? "first" : "second");
    });

    publisher.enqueue("es", "first", true);
    publisher.enqueue("es", "second", true);
    // Let the second call's synthesis (already resolved) get as far as it can — it must
    // still block on the first call's still-pending promise.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([]);

    resolveFirst();
    await vi.waitFor(() => expect(order).toEqual(["first", "second"]));
  });

  it("drops a segment past the per-language queue depth cap without throwing", async () => {
    const { createDubAudioPublisher } = await import("./dub-audio-publisher");
    const publisher = await createDubAudioPublisher(makeFakeRoom() as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Never resolves — the first enqueued segment for "en" stays "in flight" forever,
    // which (correctly, since the queue is strictly FIFO/sequential per language) also
    // blocks every segment queued behind it from ever actually reaching `synthesize` —
    // only the depth *count* advances for those, not the call count.
    synthesizeMock.mockImplementation(() => new Promise(() => {}));

    // 5 fit under MAX_QUEUE_DEPTH (queueDepth reaches 5); the 6th finds depth already at
    // the cap and is dropped instead of queued.
    for (let i = 0; i < 6; i++) publisher.enqueue("en", `segment ${i}`, true);

    await vi.waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"en" queue is full'));
  });

  it("resamples audio whose rate differs from the track's configured rate", async () => {
    synthesizeMock.mockResolvedValue({ audio: makeWavBytes([5, 6], 16_000), mimeType: "audio/wav", provider: "elevenlabs" });
    const { createDubAudioPublisher } = await import("./dub-audio-publisher");
    const publisher = await createDubAudioPublisher(makeFakeRoom() as never);

    publisher.enqueue("es", "hola", true);
    await vi.waitFor(() => expect(sourceForLanguage("es").captureFrame).toHaveBeenCalledTimes(1));

    const capturedFrame = sourceForLanguage("es").captureFrame.mock.calls[0][0] as FakeAudioFrame;
    expect(capturedFrame.sampleRate).toBe(22_050); // the track's configured rate, not the source 16,000
  });

  it("unpublishes every language's track on closeAll", async () => {
    const { createDubAudioPublisher } = await import("./dub-audio-publisher");
    const room = makeFakeRoom();
    const publisher = await createDubAudioPublisher(room as never);

    await publisher.closeAll();

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledTimes(SUPPORTED_LANGUAGES.length);
    expect(unpublishedSids.sort()).toEqual(SUPPORTED_LANGUAGES.map(({ value }) => `sid-dub-${value}`).sort());
  });
});
