import { localTranscribe } from "@/lib/providers/local-inference-client";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Structurally identical to the same-named types in `speech-to-text.ts` —
 * duplicated rather than imported to avoid a circular import between the two
 * provider files (`speech-to-text.ts` constructs this class). TypeScript's
 * structural typing means a value satisfying one satisfies the other.
 */
export interface StreamingTranscriptEvent {
  text: string;
  isFinal: boolean;
}

export interface SpeechToTextStream {
  sendAudio(chunk: Uint8Array): void;
  close(): void;
}

const WINDOW_MS = 2_500;

interface LocalBufferingSpeechToTextStreamOptions {
  expectedLanguage: SupportedLanguage;
  onSegment: (event: StreamingTranscriptEvent) => void;
  onError: (error: Error) => void;
  allowCloudFallback: boolean;
  /** Lazily invoked exactly once, on the first local failure, if `allowCloudFallback` is true. */
  openCloudFallback: () => SpeechToTextStream;
  encoding?: { format: "linear16"; sampleRate: number; channels: number };
}

/**
 * Chunked near-real-time speech-to-text for the local-inference tier.
 * faster-whisper has no websocket streaming API like Deepgram's, so this
 * buffers incoming audio into ~2.5s windows and transcribes each window as a
 * whole via `local-inference`'s plain REST `/stt/transcribe` endpoint — see
 * `docs/TRANSLATION_ARCHITECTURE.md` Part 5. Every emitted segment is
 * `isFinal: true`; there are no interim results, a deliberate MVP tradeoff
 * against Deepgram's true incremental streaming.
 *
 * On a local failure, the fallback to the cloud tier is *sticky*: once
 * opened, all further audio is forwarded to the cloud stream for the rest of
 * this connection's lifetime, never switching back — alternating tiers
 * mid-stream would risk duplicate or dropped segments.
 */
export class LocalBufferingSpeechToTextStream implements SpeechToTextStream {
  private buffer: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null;
  private fallbackStream: SpeechToTextStream | null = null;
  private closed = false;
  private flushing = false;
  /** The most recently started `flush()` call's promise — lets `close()` find and wait out an in-flight flush before issuing its own final one; see `close()`'s comment for why. */
  private flushPromise: Promise<void> | null = null;
  /**
   * Browser `MediaRecorder` writes the WebM/Matroska container header (EBML +
   * Segment info + Tracks) only into the very first emitted chunk of a
   * continuous recording; every later chunk is a headerless Cluster that
   * can't be decoded on its own. Captured once from the first window and
   * prepended to every later window so each POST to local-inference is an
   * independently decodable file. `null` until the first window has been
   * seen; an empty array if no Cluster boundary was found (best effort).
   */
  private webmHeader: Uint8Array | null = null;

  constructor(private readonly options: LocalBufferingSpeechToTextStreamOptions) {
    this.flushTimer = setInterval(() => {
      this.flushPromise = this.flush();
    }, WINDOW_MS);
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.fallbackStream) {
      this.fallbackStream.sendAudio(chunk);
      return;
    }
    this.buffer.push(chunk);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Best-effort final window; failures are ignored since the connection is closing
    // anyway. If a previous window's flush is still in-flight, calling `flush()`
    // directly would no-op on its own single-flight guard (`this.flushing`) and
    // silently drop everything buffered since that in-flight call started — wait for
    // it via `flushPromise` first, then flush what's left, so the last stretch of
    // audio isn't lost just because it arrived while the previous window was still
    // transcribing.
    void (this.flushPromise ?? Promise.resolve()).then(() => this.flush());
    this.fallbackStream?.close();
  }

  private async flush(): Promise<void> {
    // A single in-flight flush at a time — `localTranscribe` can take longer than
    // WINDOW_MS, and letting a second window's flush start before the first
    // resolves would fire overlapping local-inference requests for the same stream.
    if (this.flushing || this.fallbackStream || this.buffer.length === 0) return;
    this.flushing = true;
    const chunks = this.buffer;
    this.buffer = [];

    const { bytes, mimeType } = this.encodeWindow(concat(chunks));
    try {
      const { text } = await localTranscribe(bytes, mimeType, this.options.expectedLanguage);
      if (text.trim()) this.options.onSegment({ text: text.trim(), isFinal: true });
    } catch (error) {
      this.switchToFallback(error, chunks);
    } finally {
      this.flushing = false;
    }
  }

  /** Wraps raw PCM (from the LiveKit agent worker) in a WAV header so ffmpeg can decode it server-side. */
  private encodeWindow(audio: Uint8Array): { bytes: Uint8Array; mimeType: string } {
    const encoding = this.options.encoding;
    if (encoding) {
      return { bytes: wrapPcm16AsWav(audio, encoding.sampleRate, encoding.channels), mimeType: "audio/wav" };
    }
    if (this.webmHeader === null) {
      const clusterStart = findWebmClusterStart(audio);
      this.webmHeader = clusterStart >= 0 ? audio.slice(0, clusterStart) : new Uint8Array(0);
      return { bytes: audio, mimeType: "audio/webm" };
    }
    return { bytes: concat([this.webmHeader, audio]), mimeType: "audio/webm" };
  }

  private switchToFallback(error: unknown, failedWindow: Uint8Array[] = []): void {
    if (this.fallbackStream || this.closed) return;

    if (!this.options.allowCloudFallback) {
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
      this.options.onError(
        error instanceof Error
          ? error
          : new Error("Local caption service unavailable and cloud fallback is disabled for this session."),
      );
      return;
    }

    try {
      this.fallbackStream = this.options.openCloudFallback();
    } catch (fallbackError) {
      this.options.onError(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
      return;
    }
    // Forward the audio that just failed locally, plus anything that arrived
    // via `sendAudio` while that local call was still pending (it landed back
    // in `this.buffer` since `fallbackStream` wasn't set yet) — otherwise both
    // are silently dropped at the exact moment of failover.
    const recovered = concat([...failedWindow, ...this.buffer]);
    this.buffer = [];
    if (recovered.byteLength > 0) this.fallbackStream.sendAudio(recovered);
  }
}

const WEBM_CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

/**
 * Byte offset of the first Matroska/WebM Cluster element ID in `bytes`, or -1
 * if none is found. A compliant muxer always writes EBML header + Segment
 * info + Tracks before the first Cluster, so everything before this offset is
 * the container header needed to make a later, headerless Cluster-only chunk
 * independently decodable.
 */
function findWebmClusterStart(bytes: Uint8Array): number {
  for (let index = 0; index <= bytes.length - WEBM_CLUSTER_ID.length; index += 1) {
    if (WEBM_CLUSTER_ID.every((byte, offset) => bytes[index + offset] === byte)) return index;
  }
  return -1;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function wrapPcm16AsWav(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);

  const wav = new Uint8Array(44 + pcm.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
