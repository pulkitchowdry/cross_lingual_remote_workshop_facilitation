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
  /**
   * Optional readiness signal for a stream whose underlying transport isn't
   * usable the instant it's constructed (e.g. `DeepgramStreamingSession`'s
   * WebSocket in speech-to-text.ts, which starts CONNECTING, not OPEN — its
   * `sendAudio` silently no-ops on anything sent before the socket reaches
   * OPEN). `switchToFallback` below awaits this, with a bounded timeout,
   * before flushing the audio recovered from the failed local window, so
   * that window isn't silently dropped into a not-yet-open socket the way it
   * used to be. Omit (as every stream today does) for a stream that's usable
   * synchronously — `waitUntilReady` treats a missing `ready` the same as an
   * already-resolved one.
   */
  ready?(): Promise<void>;
}

const WINDOW_MS = 2_500;

/** Bounded wait for a fallback stream's optional `ready()` — a stream that never
 * resolves it (e.g. a handshake that hangs) must not block audio forever; after
 * this, sends proceed anyway and take whatever the stream's own send-time guard
 * decides, same as before this class had any readiness concept at all. */
const FALLBACK_READY_TIMEOUT_MS = 5_000;

function waitUntilReady(stream: SpeechToTextStream): Promise<void> {
  if (!stream.ready) return Promise.resolve();
  return Promise.race([
    stream.ready().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, FALLBACK_READY_TIMEOUT_MS)),
  ]);
}

interface LocalBufferingSpeechToTextStreamOptions {
  expectedLanguage: SupportedLanguage;
  onSegment: (event: StreamingTranscriptEvent) => void;
  onError: (error: Error) => void;
  allowCloudFallback: boolean;
  /** Lazily invoked exactly once, on the first local failure, if `allowCloudFallback` is true. */
  openCloudFallback: () => SpeechToTextStream;
  encoding?: { format: "linear16"; sampleRate: number; channels: number };
  /** The browser `MediaRecorder` mimeType in use for a containerized (no `encoding`)
   * stream — see `OpenStreamInput.mimeType` in speech-to-text.ts. Determines which
   * container-header-boundary finder `encodeWindow` uses; unrecognized values fall
   * back to the original WebM-only assumption. */
  mimeType?: string;
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
  /** False from the moment `fallbackStream` is opened until its `ready()` (if any)
   * resolves — `sendAudio` queues into `fallbackPending` instead of forwarding
   * directly while this is false, so audio arriving mid-handshake isn't silently
   * swallowed the way it used to be. See `switchToFallback`. */
  private fallbackReady = false;
  /** Chunks queued by `sendAudio` while `fallbackReady` is false; flushed as one
   * combined send once the fallback stream signals it's actually ready. */
  private fallbackPending: Uint8Array[] = [];
  private closed = false;
  private flushing = false;
  /** The most recently started `flush()` call's promise — lets `close()` find and wait out an in-flight flush before issuing its own final one; see `close()`'s comment for why. */
  private flushPromise: Promise<void> | null = null;
  /**
   * Browser `MediaRecorder` writes the container's initialization header (WebM's
   * EBML + Segment info + Tracks, or fragmented-MP4's ftyp + moov) only into the
   * very first emitted chunk of a continuous recording; every later chunk is a
   * headerless WebM Cluster or MP4 `moof`/`mdat` fragment that can't be decoded
   * on its own. Captured once from the first window and prepended to every later
   * window so each POST to local-inference is an independently decodable file.
   * `null` until the first window has been seen; an empty array if no boundary
   * was found (best effort — including for a container this app doesn't know how
   * to find a boundary for, in which case later windows won't transcribe, but the
   * first one — the client's own genuinely self-contained chunk — still will).
   */
  private containerHeader: Uint8Array | null = null;

  constructor(private readonly options: LocalBufferingSpeechToTextStreamOptions) {
    this.flushTimer = setInterval(() => {
      // Skip reassigning while a previous flush is still in-flight: calling flush()
      // again here would just hit its own single-flight guard and resolve almost
      // immediately, and pointing flushPromise at that trivial resolution would make
      // close() believe the real in-flight flush is done when it isn't (see close()'s
      // comment) — silently dropping whatever's buffered once that real flush finally
      // settles.
      if (this.flushing) return;
      this.flushPromise = this.flush();
    }, WINDOW_MS);
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.fallbackStream) {
      // Queue instead of forwarding straight through until the fallback stream has
      // actually signaled it's ready — see `fallbackReady`'s doc comment.
      if (this.fallbackReady) {
        this.fallbackStream.sendAudio(chunk);
      } else {
        this.fallbackPending.push(chunk);
      }
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
      // The cloud fallback needs different framing depending on how this stream was
      // opened. With an explicit `encoding` (the LiveKit agent's raw PCM path),
      // Deepgram is told the exact raw format via URL params (see openDeepgramStream),
      // so headerless `chunks` — the original, unwrapped audio — is exactly what it
      // expects; encodeWindow's WAV-wrapping above is only for the *local*
      // transcription call in that path. Without an `encoding` (the browser-mic WebM
      // path), Deepgram must auto-detect the container from the byte stream itself,
      // so it needs `bytes` — the header-prepended version — not the raw, headerless
      // Cluster-only `chunks` a second-or-later window is. Forwarding the wrong one
      // for either path sends the newly-opened Deepgram stream audio it can't decode,
      // so the "seamless" fallback the class doc promises instead goes silently,
      // permanently dead for the rest of this connection.
      this.switchToFallback(error, this.options.encoding ? chunks : [bytes]);
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
    // Safari supports neither WebM variant at all (only `audio/mp4`), so a client
    // that reported an mp4 mimeType (see LiveCaptionStream.tsx's pickRecorderMimeType)
    // needs the fragmented-MP4 boundary finder instead of WebM's — everything else
    // (including an absent/unrecognized mimeType, e.g. an older client build) keeps
    // this app's original WebM-only assumption.
    const isMp4 = Boolean(this.options.mimeType?.startsWith("audio/mp4"));
    const outputMimeType = isMp4 ? "audio/mp4" : "audio/webm";
    const findFragmentStart = isMp4 ? findMp4FragmentStart : findWebmClusterStart;
    if (this.containerHeader === null) {
      const fragmentStart = findFragmentStart(audio);
      this.containerHeader = fragmentStart >= 0 ? audio.slice(0, fragmentStart) : new Uint8Array(0);
      return { bytes: audio, mimeType: outputMimeType };
    }
    return { bytes: concat([this.containerHeader, audio]), mimeType: outputMimeType };
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

    let fallbackStream: SpeechToTextStream;
    try {
      fallbackStream = this.options.openCloudFallback();
    } catch (fallbackError) {
      this.options.onError(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
      return;
    }
    this.fallbackStream = fallbackStream;
    this.fallbackReady = false;

    // The audio that just failed locally, plus anything that arrived via `sendAudio`
    // while that local call was still pending (it landed back in `this.buffer` since
    // `fallbackStream` wasn't set yet) — otherwise both are silently dropped at the
    // exact moment of failover. Held here (not sent immediately) until the fallback
    // stream is actually ready: `openCloudFallback()` returning doesn't mean its
    // transport is usable yet (e.g. `DeepgramStreamingSession`'s WebSocket is still
    // CONNECTING at this point), so sending straight away is exactly as lossy as
    // this method used to be.
    const recovered = [...failedWindow, ...this.buffer];
    this.buffer = [];
    void waitUntilReady(fallbackStream).then(() => {
      if (this.fallbackStream !== fallbackStream) return; // superseded/closed; nothing to flush
      this.fallbackReady = true;
      const pending = this.fallbackPending;
      this.fallbackPending = [];
      const toSend = concat([...recovered, ...pending]);
      if (toSend.byteLength > 0) fallbackStream.sendAudio(toSend);
    });
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

/**
 * Byte offset of the first ISO-BMFF `moof` (movie fragment) box in `bytes`, or
 * -1 if none is found (or the box structure looks malformed). Safari's
 * fragmented-MP4 `MediaRecorder` output writes an initialization segment
 * (`ftyp` + `moov`, analogous to WebM's EBML + Segment info + Tracks) only into
 * the first emitted chunk; every later chunk is one or more headerless
 * `moof`+`mdat` fragment pairs. Walks the top-level box sequence (each box:
 * 4-byte big-endian size + 4-byte ASCII type, or an 8-byte 64-bit "largesize"
 * when size === 1) rather than searching for a byte pattern like
 * `findWebmClusterStart` does — ISO-BMFF boxes have no unique magic-number
 * marker the way a WebM Cluster ID does, so the box sizes must be walked to
 * find where `moof` actually starts.
 */
function findMp4FragmentStart(bytes: Uint8Array): number {
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size32 = readUint32BE(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === "moof") return offset;

    let boxSize: number;
    let headerSize = 8;
    if (size32 === 1) {
      if (offset + 16 > bytes.length) return -1;
      // 64-bit largesize immediately follows the 8-byte size+type header.
      const high = readUint32BE(bytes, offset + 8);
      const low = readUint32BE(bytes, offset + 12);
      boxSize = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size32 === 0) {
      // A size of 0 means "box extends to the end of the file" — valid for a
      // truly final box, but there's no further box after it to be `moof`.
      return -1;
    } else {
      boxSize = size32;
    }
    if (boxSize < headerSize) return -1; // malformed — refuse to loop forever
    offset += boxSize;
  }
  return -1;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
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
