import {
  AudioFrame,
  AudioResampler,
  AudioResamplerQuality,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type LocalParticipant,
  type LocalTrackPublication,
  type Room,
} from "@livekit/rtc-node";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { textToSpeechProvider, toPcmSamples, type PcmAudio } from "@/lib/providers/text-to-speech";

/**
 * Publishes one real LiveKit audio track per target language, from the SAME
 * already-connected `caption-agent.ts` worker, instead of the per-listener
 * on-demand HTTP fetch `TranslatedAudioPlayer.tsx` used to do — see
 * `docs/DUB_AUDIO_TRACK_MIGRATION.md` for why. Deliberately not a separate
 * bot participant per language: that would need its own LiveKit Cloud room
 * connection, and this deployment already has a documented, unresolved
 * intermittent connectivity failure on `ctx.connect()` — more required
 * connections would multiply exposure to that, not reduce it.
 *
 * Matches Piper's actual output rate (the primary/default TTS tier, tried
 * first) so the common case never needs resampling; the rarer ElevenLabs
 * fallback tier is resampled to this via `AudioResampler` when its requested
 * rate (`ELEVENLABS_PCM_SAMPLE_RATE`) differs — see that constant's doc
 * comment in `text-to-speech.ts`.
 */
const DUB_TRACK_SAMPLE_RATE = 22_050;
const DUB_TRACK_CHANNELS = 1;

/** Caps how many segments can be queued for TTS+publish on one language's track before
 * new ones are dropped — captions/translations are already persisted regardless of this,
 * so a dropped dub is a latency/best-effort concern, not a correctness one. Bounds memory
 * and avoids an ever-growing backlog of stale audio if TTS synthesis falls behind a fast
 *-talking facilitator for one language's queue. */
const MAX_QUEUE_DEPTH = 5;

interface LanguageTrack {
  source: AudioSource;
  publication: LocalTrackPublication;
  /** Chained promise acting as this language's FIFO — each new segment's synthesis+publish
   * is appended after the previous one's `waitForPlayout()` resolves, so two facilitator
   * segments dubbed into the same language never talk over each other on the shared track.
   * Cross-language work (a different `LanguageTrack`'s queue) stays fully parallel. */
  queue: Promise<void>;
  queueDepth: number;
}

export interface DubAudioPublisher {
  /** Fire-and-forget: synthesizes `text` and publishes it onto `language`'s track, queued
   * behind any segment already in flight for that same language. Never throws — internal
   * failures are caught and logged so a bad TTS call never surfaces to (or blocks) the
   * caller, which is the STT segment-handling loop in `caption-agent.ts`. */
  enqueue(language: SupportedLanguage, text: string, allowCloudFallback: boolean): void;
  /** Unpublishes every language's track — call on worker/job shutdown. */
  closeAll(): Promise<void>;
}

function resampleToTrackRate(pcm: PcmAudio): AudioFrame {
  const resampler = new AudioResampler(pcm.sampleRate, DUB_TRACK_SAMPLE_RATE, pcm.channels, AudioResamplerQuality.MEDIUM);
  try {
    const input = new AudioFrame(pcm.samples, pcm.sampleRate, pcm.channels, pcm.samples.length / pcm.channels);
    const frames = [...resampler.push(input), ...resampler.flush()];
    return combineFrames(frames, pcm.channels);
  } finally {
    resampler.close();
  }
}

function combineFrames(frames: AudioFrame[], channels: number): AudioFrame {
  const totalSamples = frames.reduce((sum, frame) => sum + frame.data.length, 0);
  const combined = new Int16Array(totalSamples);
  let offset = 0;
  for (const frame of frames) {
    combined.set(frame.data, offset);
    offset += frame.data.length;
  }
  return new AudioFrame(combined, DUB_TRACK_SAMPLE_RATE, channels, combined.length / channels);
}

async function synthesizeAndCapture(
  source: AudioSource,
  language: SupportedLanguage,
  text: string,
  allowCloudFallback: boolean,
): Promise<void> {
  const speech = await textToSpeechProvider.synthesize(text, language, { allowCloudFallback });
  if (!speech) return; // Nothing configured, or the tier degraded to null — matches every other TTS call site's contract.

  const pcm = toPcmSamples(speech.audio);
  if (pcm.channels !== DUB_TRACK_CHANNELS) {
    // Neither configured TTS tier should ever produce this (Piper's voices and
    // `wrapPcmAsWav`'s ElevenLabs wrapping are both mono) — downmixing isn't
    // implemented, so surface it loudly rather than silently play back a
    // garbled/wrong-speed track.
    console.error(
      `[dub-audio-publisher] "${language}" segment has ${pcm.channels} channels, expected ${DUB_TRACK_CHANNELS}; skipping this segment's dub audio.`,
    );
    return;
  }

  const frame =
    pcm.sampleRate === DUB_TRACK_SAMPLE_RATE
      ? new AudioFrame(pcm.samples, pcm.sampleRate, pcm.channels, pcm.samples.length / pcm.channels)
      : resampleToTrackRate(pcm);

  await source.captureFrame(frame);
  await source.waitForPlayout();
}

/**
 * Eagerly publishes a `dub-<language>` track for every `SUPPORTED_LANGUAGES` entry against
 * `room`'s local participant — not lazily on first use, so a learner already in a target
 * language can subscribe before the facilitator has said anything that needs dubbing into
 * it, with no publish-latency race to reason about.
 */
export async function createDubAudioPublisher(room: Room): Promise<DubAudioPublisher> {
  if (!room.localParticipant) {
    throw new Error("createDubAudioPublisher: room.localParticipant is not set — call after ctx.connect() resolves.");
  }
  // Rebound to a fresh, plainly-typed `const` — TS doesn't retain `room.localParticipant`'s
  // narrowing (from the guard above) through the async closures below (`enqueue`/`closeAll`
  // are declared later and one nests inside a `.map(async ...)`), so without this it re-widens
  // back to `LocalParticipant | undefined` at each use site.
  const localParticipant: LocalParticipant = room.localParticipant;

  const languageTracks = new Map<SupportedLanguage, LanguageTrack>();
  await Promise.all(
    SUPPORTED_LANGUAGES.map(async ({ value: language }) => {
      const source = new AudioSource(DUB_TRACK_SAMPLE_RATE, DUB_TRACK_CHANNELS);
      const track = LocalAudioTrack.createAudioTrack(`dub-${language}`, source);
      const publication = await localParticipant.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_UNKNOWN }));
      languageTracks.set(language, { source, publication, queue: Promise.resolve(), queueDepth: 0 });
    }),
  );

  function enqueue(language: SupportedLanguage, text: string, allowCloudFallback: boolean): void {
    const entry = languageTracks.get(language);
    if (!entry) return; // Not a SUPPORTED_LANGUAGES value — shouldn't happen, every target language has a track.
    if (entry.queueDepth >= MAX_QUEUE_DEPTH) {
      console.warn(
        `[dub-audio-publisher] "${language}" queue is full (${MAX_QUEUE_DEPTH} pending); dropping this segment's dub audio. Captions/translation for it are unaffected.`,
      );
      return;
    }
    entry.queueDepth++;
    entry.queue = entry.queue
      .then(() => synthesizeAndCapture(entry.source, language, text, allowCloudFallback))
      .catch((error) => console.error(`[dub-audio-publisher] failed to synthesize/publish dub audio for "${language}":`, error))
      .finally(() => {
        entry.queueDepth--;
      });
  }

  async function closeAll(): Promise<void> {
    await Promise.all(
      [...languageTracks.values()].map(async ({ publication }) => {
        if (!publication.sid) return;
        try {
          await localParticipant.unpublishTrack(publication.sid);
        } catch (error) {
          console.error(`[dub-audio-publisher] failed to unpublish track ${publication.sid}:`, error);
        }
      }),
    );
    languageTracks.clear();
  }

  return { enqueue, closeAll };
}
