import { AutoSubscribe, defineAgent, type JobContext } from "@livekit/agents";
import {
  AudioStream,
  ConnectionQuality,
  type RemoteAudioTrack,
  RoomEvent,
  TrackKind,
  TrackSource,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publishTranslatedCaption } from "@/lib/captions";
import { clearCaptionAgentCapturing, markCaptionAgentCapturing } from "@/lib/caption-source-state";
import { speechToTextProvider } from "@/lib/providers/speech-to-text";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { captionLatencyNowMs } from "@/lib/caption-latency-log";

const WORKSHOP_ROOM_PREFIX = "workshop-";
const FACILITATOR_IDENTITY_PREFIX = "facilitator:";
/**
 * Rate the agent asks LiveKit to resample a participant's track to before
 * handing frames to Deepgram — matches the `linear16` PCM framing passed to
 * `openStream`'s `encoding` option below.
 */
const STREAM_SAMPLE_RATE = 16_000;
const STREAM_CHANNELS = 1;

/** Maps this SDK's numeric wire enum to the same string vocabulary the browser-mic path
 * (livekit-client's own `ConnectionQuality`) sends over the WebSocket — both paths funnel
 * into the one estimateNetworkConfidence in src/lib/confidence.ts, so they must agree on
 * the label, not just the underlying quality level. */
const CONNECTION_QUALITY_LABEL: Record<ConnectionQuality, string> = {
  [ConnectionQuality.QUALITY_EXCELLENT]: "excellent",
  [ConnectionQuality.QUALITY_GOOD]: "good",
  [ConnectionQuality.QUALITY_POOR]: "poor",
  [ConnectionQuality.QUALITY_LOST]: "lost",
};

function sessionIdFromRoomName(roomName: string | undefined): string | null {
  if (!roomName || !roomName.startsWith(WORKSHOP_ROOM_PREFIX)) return null;
  return roomName.slice(WORKSHOP_ROOM_PREFIX.length);
}

/**
 * Resolves what language the facilitator's audio should be attributed to —
 * always the session's own `sourceLanguage` (no `SessionParticipant` row
 * exists for the facilitator). Facilitator-only, deliberately: see this
 * file's own top-level doc comment for why learner tracks are never
 * subscribed to here in the first place. Returns `null` for an identity that
 * isn't a recognized facilitator one.
 */
async function resolveSpeakerContext(
  session: { id: string; sourceLanguage: string; facilitator: { displayName: string } },
  identity: string,
): Promise<{ language: SupportedLanguage; speakerId: string | null } | null> {
  if (identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) {
    return { language: session.sourceLanguage as SupportedLanguage, speakerId: `${session.facilitator.displayName} (Facilitator)` };
  }
  return null;
}

/**
 * Subscribes to the facilitator's audio track, streams it to Deepgram via the
 * same `SpeechToTextProvider.openStream` boundary the browser mic path uses
 * (`LiveCaptionStream`/`/api/captions/stream`), and publishes final
 * transcripts through `publishTranslatedCaption` directly — this worker runs
 * in the same process as the rest of the app now, so there's no HTTP hop.
 */
async function streamParticipantAudio(
  track: RemoteAudioTrack,
  sessionId: string,
  session: { id: string; sourceLanguage: string; facilitator: { displayName: string } },
  translationMode: "AUTO" | "LOCAL_ONLY",
  activeTracks: Map<string, RemoteAudioTrack>,
  identity: string,
  // Read fresh at publish time (below), not captured once at subscribe time — the
  // facilitator's connection quality can change mid-session, same reasoning as
  // resolveSpeakerContext being re-resolved per segment rather than reused from
  // `initialSpeaker`.
  connectionQualityByIdentity: Map<string, string>,
) {
  if (!speechToTextProvider.openStream) {
    console.warn(`[caption-agent] STT provider has no streaming support; not capturing session ${sessionId}.`);
    return;
  }
  // A network blip/reconnect can republish the facilitator's audio track under the
  // same identity before the old track's `TrackUnsubscribed` has cleared this guard
  // (see the RoomEvent.TrackUnsubscribed handler in `entry` below, which is what
  // actually clears it — not this loop's own completion, which can lag behind the
  // room-level unsubscribe signal), so `RoomEvent.TrackSubscribed` can arrive twice
  // for one facilitator. Without this guard both would open their own Deepgram
  // stream and publish for the same session, duplicating/interleaving transcript
  // segments — the caption pipeline has no de-duplication.
  if (activeTracks.has(identity)) {
    console.warn(`[caption-agent] Track already streaming for ${identity} in session ${sessionId}; skipping duplicate subscription.`);
    return;
  }
  activeTracks.set(identity, track);
  // `captionAgentActive` is only ever about the facilitator's own manual
  // "Start live captions from mic" fallback (see caption-source-state.ts and
  // its consumers in server.ts/captions-socket.ts) — that fallback doesn't
  // exist for learners, so only a facilitator identity should ever flip this
  // DB flag. Without this guard, a learner speaking would spuriously mark the
  // flag true (hiding/blocking the facilitator's own unrelated fallback) even
  // though the facilitator's own audio isn't what's being captured.
  if (identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) {
    await markCaptionAgentCapturing(sessionId);
  }

  // Resolved *after* claiming the `activeTracks` slot above (not before, and not
  // by the caller) so the duplicate-subscription guard above stays synchronous
  // relative to the `TrackSubscribed` event — inserting an `await` ahead of that
  // guard would let two rapid-fire subscribe events for the same identity (the
  // reconnect race the guard exists for) both race past it before either claims
  // the slot.
  const initialSpeaker = await resolveSpeakerContext(session, identity);
  if (!initialSpeaker) {
    console.warn(`[caption-agent] could not resolve speaker context for ${identity} in session ${sessionId}; not capturing.`);
    activeTracks.delete(identity);
    return;
  }

  let segmentStartedAt = new Date();
  let firstAudioSubmittedAtMs: number | undefined;
  // Set by onError below and checked by the audio loop so a dead STT stream actually
  // stops the pipeline instead of running forever — see the loop's own comment.
  let stopped = false;
  let sttStream: ReturnType<typeof speechToTextProvider.openStream> | undefined;
  try {
    sttStream = speechToTextProvider.openStream({
      expectedLanguage: initialSpeaker.language,
      encoding: { format: "linear16", sampleRate: STREAM_SAMPLE_RATE, channels: STREAM_CHANNELS },
      allowCloudFallback: translationMode !== "LOCAL_ONLY",
      onSegment: (event) => {
        if (!event.isFinal) return;
        // Capture and advance synchronously — see the matching comment in
        // src/app/api/captions/stream/route.ts for why reassigning inside a
        // post-publish `.finally()` races on back-to-back final segments.
        const startedAt = segmentStartedAt;
        const endedAt = new Date();
        const originalCaptionReadyAtMs = captionLatencyNowMs();
        const audioSubmittedAtMs = firstAudioSubmittedAtMs;
        segmentStartedAt = endedAt;
        firstAudioSubmittedAtMs = undefined;
        void (async () => {
          const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: { facilitator: { select: { displayName: true } } },
          });
          if (!session || session.status !== SessionStatus.LIVE) return;
          // Freshly re-resolved, not the `initialSpeaker` this stream was opened
          // with — a facilitator can change their session's source language, and a
          // learner can change their own preferred language, mid-LIVE-session, and
          // this stream (opened once, at subscribe time, and not restarted on that
          // change) would otherwise keep stamping every caption with the stale
          // language for the rest of the session even after the change.
          const speaker = await resolveSpeakerContext(session, identity);
          if (!speaker) {
            console.warn(`[caption-agent] could not resolve speaker context for ${identity} in session ${sessionId}; dropping segment.`);
            return;
          }
          await publishTranslatedCaption(session, {
            speakerId: speaker.speakerId,
            originalText: event.text,
            language: speaker.language,
            startedAt,
            endedAt,
            sttConfidence: event.confidence,
            networkQuality: connectionQualityByIdentity.get(identity),
            instrumentation: {
              source: "caption-agent",
              audioSubmittedAtMs,
              originalCaptionReadyAtMs,
            },
          });
        })().catch((error) => console.error(`[caption-agent] failed to publish a segment for ${sessionId}:`, error));
      },
      // A console.error alone used to leave the pipeline running: the for-await loop
      // below kept feeding frames into a now-dead stream (its sendAudio silently
      // no-ops once the underlying connection isn't OPEN) forever — captions died
      // instantly but captionAgentActive stayed true and the browser-mic fallback
      // stayed hidden behind "already running", with zero signal to the facilitator
      // that anything broke, for the rest of the LIVE session. Stopping the loop lets
      // the `finally` below run its real cleanup (activeTracks + captionAgentActive).
      onError: (error) => {
        console.error(`[caption-agent] Deepgram stream error for ${sessionId}:`, error);
        stopped = true;
        sttStream?.close();
      },
    });
    console.log(`[caption-agent] STT stream opened for ${identity} in session ${sessionId} (expectedLanguage: ${initialSpeaker.language}).`);

    const audioStream = new AudioStream(track, STREAM_SAMPLE_RATE, STREAM_CHANNELS);
    for await (const frame of audioStream) {
      if (stopped) break;
      firstAudioSubmittedAtMs ??= captionLatencyNowMs();
      sttStream.sendAudio(new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
    }
  } catch (error) {
    // Without this, an error thrown mid-stream (a dropped LiveKit connection, a
    // malformed frame, or openStream() itself throwing synchronously — e.g. a
    // LOCAL_ONLY session whose local-inference tier isn't configured) becomes an
    // unhandled promise rejection from the `void streamParticipantAudio(...)` call
    // site below — silent in production, where Node only logs unhandled rejections
    // at a debug level most deployments don't capture. Wrapping openStream() itself
    // (not just the loop) here also means a synchronous open failure still reaches
    // the `finally` below instead of leaving captionAgentActive stuck true forever.
    console.error(`[caption-agent] audio stream error for ${sessionId}:`, error);
  } finally {
    sttStream?.close();
    // Only clear this identity's guard if `track` is still the one on record — a
    // `TrackUnsubscribed`-triggered clear (or a newer `TrackSubscribed` superseding
    // it) may have already happened for a *different* track under this same
    // identity between this loop ending and this `finally` running; blindly
    // deleting here could otherwise clobber a newer, still-active stream's guard.
    if (activeTracks.get(identity) === track) activeTracks.delete(identity);
    // Only clear the DB-backed `captionAgentActive` flag once no *facilitator*
    // track is active — it's set only for facilitator identities above, so
    // only a facilitator identity's departure can ever need to clear it (a
    // learner's stream ending never touched the flag in the first place, and
    // checking regardless of role would be a harmless but pointless DB write
    // on every learner utterance). An old, already-superseded facilitator
    // track's cleanup (the guard above correctly skipped deleting the map
    // entry for it) must not still unconditionally reset the flag to false
    // while a newer facilitator track is actively capturing, or the
    // facilitator dashboard shows "Start live captions from mic" as available
    // while the agent is in fact still streaming, inviting exactly the
    // duplicate pipeline this flag exists to prevent (see server.ts's
    // upgrade-handler check).
    if (identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) {
      const facilitatorStillActive = [...activeTracks.keys()].some((id) => id.startsWith(FACILITATOR_IDENTITY_PREFIX));
      if (!facilitatorStillActive) await clearCaptionAgentCapturing(sessionId);
    }
  }
}

/**
 * LiveKit Agents entrypoint — subscribes to the facilitator's audio track
 * server-side so their captions work without opening the mic control's
 * manual fallback in their browser. See `docs/TRANSLATION_ARCHITECTURE.md`
 * Part 2. Registered from `server.ts` in the same process as the rest of the
 * app.
 *
 * Facilitator-only, not "every participant" — this worker used to also
 * subscribe to learner mic tracks, but a learner's browser already runs its
 * own always-on capture (`LiveCaptionStream`'s mic-toggle effect auto-starts
 * whenever their mic is unmuted, same as the facilitator's browser fallback),
 * and nothing de-duplicated the two: a learner speaking produced two
 * independent STT pipelines transcribing and persisting the same utterance
 * as two separate, differently-timed `TranscriptSegment` rows. The
 * `captionAgentActive` guard this file also maintains is deliberately
 * facilitator-only in the DB schema (a single per-session boolean, not
 * per-participant) for the same reason — there's no way to represent "this
 * specific learner is already being captured server-side" without a bigger
 * schema change, so the simpler fix is to never contend for a learner's mic
 * here at all and let the existing browser path be the sole source of truth
 * for it.
 */
export default defineAgent({
  entry: async (ctx: JobContext) => {
    // `ctx.room` (the live @livekit/rtc-node Room) only has `.name` populated once
    // `ctx.connect()` resolves — its getter reads `this.info?.name`, and `info` is
    // filled in by the connect response, not before. Reading it here (pre-connect)
    // always returned `undefined`, so this check always failed and `entry` always
    // returned without ever calling `ctx.connect()` — the server-side facilitator
    // capture this worker exists for never ran, for any session, ever. `ctx.job.room`
    // is the dispatch's own `proto.Room` (job.js's `RunningJobInfo.job.room`), whose
    // `name` is a plain string field set at dispatch time, independent of the RTC
    // connection — that's the one to check before connecting.
    const sessionId = sessionIdFromRoomName(ctx.job.room?.name);
    if (!sessionId) {
      console.warn(`[caption-agent] Room name "${ctx.job.room?.name}" doesn't match "workshop-<sessionId>"; skipping.`);
      return;
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { facilitator: { select: { displayName: true } } },
    });
    if (!session || session.status !== SessionStatus.LIVE) {
      console.warn(`[caption-agent] Session ${sessionId} is not live; skipping.`);
      return;
    }

    try {
      await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    } catch (error) {
      // Diagnostic-only: `ctx.connect()` failing shows up elsewhere (e.g. Railway) as a
      // generic `TypeError: fetch failed` / `ECONNREFUSED` with a truncated
      // `AggregateError` — Node's default error printing doesn't expand nested causes,
      // so the actual unreachable host/port (almost always present on the underlying
      // `Error`s inside `AggregateError.errors`) never surfaces. `util.inspect` with
      // `depth: null` prints the whole thing, including `.cause`/`.errors`/`.address`/
      // `.port` when present. Remove once the connectivity issue this is chasing is
      // root-caused — this is not meant to be permanent logging.
      const { inspect } = await import("node:util");
      console.error(
        `[caption-agent] ctx.connect() failed for session ${sessionId} (wsURL host: ${(() => {
          try {
            return new URL(process.env.LIVEKIT_AGENT_URL || process.env.LIVEKIT_URL || "").host;
          } catch {
            return "<unparseable>";
          }
        })()}):`,
        inspect(error, { depth: null, showHidden: false }),
      );
      throw error;
    }

    // Scoped to this job/room (one `entry` call per room), so this never leaks
    // state across sessions — see the guard inside streamParticipantAudio.
    const activeTracks = new Map<string, RemoteAudioTrack>();
    // Latest reported connection quality per identity — the Confidence Score's network
    // signal (issue #130's "Future Enhancements") for whatever this facilitator is
    // saying *right now*, read fresh at each segment's publish time rather than once at
    // subscribe time (see streamParticipantAudio's own doc comment on the param).
    const connectionQualityByIdentity = new Map<string, string>();
    ctx.room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
      if (!participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) return;
      const label = CONNECTION_QUALITY_LABEL[quality];
      if (label) connectionQualityByIdentity.set(participant.identity, label);
    });
    const handleTrackSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      // NOT `track instanceof RemoteAudioTrack` — confirmed live (2026-07-26) that it's
      // always `false` here despite `track` genuinely being one (`track.constructor.name
      // === "RemoteAudioTrack"`, but `track.constructor !== RemoteAudioTrack`, the class
      // this file imports: two separate module instances of `@livekit/rtc-node` end up
      // loaded — one CJS, one ESM, per its dual-package `exports` map — so the class
      // identity `instanceof` relies on doesn't match across that boundary, even though
      // there's only one copy of the package on disk. This made every single
      // `TrackSubscribed` event silently return here, for every session, ever — the
      // server-side caption pipeline this file exists for has never actually captured
      // anything. `publication.kind` is a plain enum value (from the wire protocol, not a
      // class), so it doesn't have this problem — check that instead, and trust the SDK's
      // own pairing of "kind audio" with "constructs a RemoteAudioTrack" (room.js's
      // `TrackSubscribed` handler is what makes that pairing in the first place).
      if (publication.kind !== TrackKind.KIND_AUDIO) {
        console.log(`[caption-agent] skipping non-audio track for ${participant.identity} in session ${sessionId} (kind: ${publication.kind}).`);
        return;
      }
      // Facilitators are also granted SCREEN_SHARE_AUDIO publish rights (room.ts) and the
      // screen-share toggle explicitly requests tab/system audio (LiveSessionRoom.tsx's
      // captureOptions) — that track is kind AUDIO under the same facilitator identity as
      // the mic, so without this it can claim this identity's `activeTracks` slot first
      // (e.g. facilitator shares a video clip before unmuting), captioning the shared
      // audio instead of their speech while their real mic gets silently dropped by the
      // dedup guard below.
      if (publication.source !== TrackSource.SOURCE_MICROPHONE) {
        console.log(
          `[caption-agent] skipping non-microphone audio track for ${participant.identity} in session ${sessionId} (source: ${publication.source}).`,
        );
        return;
      }
      // Facilitator-only, deliberately: see this file's own top-level doc comment.
      // A learner's mic is captured by the browser-based fallback instead
      // (LiveCaptionStream/`/api/captions/stream`) — subscribing to it here too
      // used to run both pipelines at once for the same learner utterance,
      // producing duplicate, independently-translated transcript segments with
      // no de-duplication anywhere in the caption pipeline.
      if (!participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) {
        console.log(`[caption-agent] skipping non-facilitator identity "${participant.identity}" in session ${sessionId}.`);
        return;
      }
      const audioTrack = track as RemoteAudioTrack;
      console.log(`[caption-agent] capturing audio for session ${sessionId} (${participant.identity})`);
      // streamParticipantAudio wraps its own body in try/finally once inside the
      // stream, but a failure before that (e.g. markCaptionAgentCapturing's DB write)
      // would otherwise reject silently as an unhandled promise rejection here.
      streamParticipantAudio(
        audioTrack,
        sessionId,
        session,
        session.translationMode,
        activeTracks,
        participant.identity,
        connectionQualityByIdentity,
      ).catch((error) => console.error(`[caption-agent] streamParticipantAudio failed for ${sessionId}:`, error));
    };
    ctx.room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    // `TrackSubscribed` only fires for a subscription that happens *after* this
    // listener is attached. `AutoSubscribe.AUDIO_ONLY` (passed to `ctx.connect()`
    // above) can auto-subscribe to tracks published *before* this worker even
    // joined (e.g. the facilitator unmuted while the agent's job dispatch was
    // still in flight) — those subscriptions may already be complete by the time
    // this line runs, and their `TrackSubscribed` event (if the SDK even re-emits
    // one for an already-subscribed track — it may not) would otherwise be missed
    // entirely, permanently. Walking every remote participant's existing track
    // publications here and handling any that are already subscribed (`.track`
    // populated) the same way closes that gap.
    console.log(
      `[caption-agent] connected to session ${sessionId}; ${ctx.room.remoteParticipants.size} remote participant(s) already present.`,
    );
    for (const participant of ctx.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) {
          console.log(
            `[caption-agent] found pre-existing subscribed track for ${participant.identity} in session ${sessionId} (kind: ${publication.kind}, source: ${publication.source}); handling retroactively.`,
          );
          handleTrackSubscribed(publication.track as RemoteTrack, publication as RemoteTrackPublication, participant);
        }
      }
    }
    // Proactively frees the per-identity guard as soon as LiveKit signals the old
    // track is gone, rather than waiting for that track's own audio-frame loop to
    // notice (which can lag behind this room-level event) — without this, a fast
    // reconnect's new `TrackSubscribed` can arrive while the guard is still (stale)
    // held by the old track, and get silently, permanently dropped by the guard in
    // streamParticipantAudio, killing captions for that participant for the rest of
    // the session with no retry.
    ctx.room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      // See the matching comments on the `TrackSubscribed` handler above — not
      // `instanceof RemoteAudioTrack` (dual-module-instance reason), and source-filtered
      // the same way so a screen-share-audio unsubscribe never clears the mic's guard.
      if (publication.kind !== TrackKind.KIND_AUDIO) return;
      if (publication.source !== TrackSource.SOURCE_MICROPHONE) return;
      if (!participant.identity.startsWith(FACILITATOR_IDENTITY_PREFIX)) return;
      if (activeTracks.get(participant.identity) === track) activeTracks.delete(participant.identity);
    });
    // Mirrors streamParticipantAudio's own `finally`-block cleanup, but for the case
    // that loop never gets to run its `finally` at all: a crash, redeploy, or
    // LiveKit-initiated room disconnect kills this worker process while a track is
    // still actively streaming. Without this, `captionAgentActive` is left stuck
    // `true` in the DB forever, permanently hiding the "Start live captions from mic"
    // fallback for this session (see server.ts's upgrade-handler check). `@livekit/agents`
    // runs every `addShutdownCallback` on both a room disconnect and a graceful job
    // shutdown (see job_proc_lazy_main.js), so this one hook covers both. Only a
    // facilitator track still being active matters here — same reasoning as the
    // per-stream `finally` block above, since only facilitator identities ever set
    // this flag true in the first place.
    ctx.addShutdownCallback(async () => {
      const facilitatorActive = [...activeTracks.keys()].some((id) => id.startsWith(FACILITATOR_IDENTITY_PREFIX));
      if (facilitatorActive) await clearCaptionAgentCapturing(sessionId);
    });
  },
});
