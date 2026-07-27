"use client";

import { VideoTrack, useConnectionQualityIndicator, useIsSpeaking, useParticipantAttributes } from "@livekit/components-react";
import { ConnectionQuality, type Participant } from "livekit-client";
import type { TrackReference, TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { HandIcon, MicOffIcon } from "@/components/meeting/icons";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

const QUALITY_COLOR: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: "var(--tick-high)",
  [ConnectionQuality.Good]: "var(--tick-medium)",
  [ConnectionQuality.Poor]: "var(--tick-low)",
  [ConnectionQuality.Lost]: "var(--tick-low)",
  [ConnectionQuality.Unknown]: "var(--muted-foreground)",
};

const SPEAKER_COLORS = ["var(--speaker-1)", "var(--speaker-2)", "var(--speaker-3)", "var(--speaker-4)"];

function speakerColor(identity: string) {
  let hash = 0;
  for (let i = 0; i < identity.length; i++) hash = (hash * 31 + identity.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Narrows a possibly-placeholder track ref to a real one `VideoTrack` can render. */
function realTrack(trackRef: TrackReferenceOrPlaceholder | undefined): TrackReference | undefined {
  return trackRef?.publication ? (trackRef as TrackReference) : undefined;
}

export function ParticipantChip({
  participant,
  camTrack,
  micTrack,
  uiLang,
  variant = "strip",
}: {
  participant: Participant;
  camTrack: TrackReferenceOrPlaceholder | undefined;
  micTrack: TrackReferenceOrPlaceholder | undefined;
  uiLang: SupportedLanguage;
  variant?: "strip" | "list" | "tile";
}) {
  const isSpeaking = useIsSpeaking(participant);
  const { quality } = useConnectionQualityIndicator({ participant });
  const { attributes } = useParticipantAttributes({ participant });
  const dict = getDictionary(uiLang).meeting;

  const raisedHand = attributes?.raisedHand === "true";
  const preferredLanguage = resolveLanguage(attributes?.preferredLanguage);
  const camEnabled = Boolean(camTrack?.publication) && !camTrack?.publication?.isMuted;
  const micEnabled = Boolean(micTrack?.publication) && !micTrack?.publication?.isMuted;
  const liveCamTrack = camEnabled ? realTrack(camTrack) : undefined;
  const name = participant.name || participant.identity;

  if (variant === "tile") {
    return (
      <div
        className="relative h-full w-full shrink-0 overflow-hidden rounded-lg border-2"
        style={{ borderColor: isSpeaking ? "var(--accent)" : "var(--border-subtle)", background: "var(--surface)" }}
        role="listitem"
      >
        {liveCamTrack ? (
          <VideoTrack trackRef={liveCamTrack} className="h-full w-full object-cover" />
        ) : (
          <div
            className="font-data flex h-full w-full items-center justify-center text-lg font-semibold text-white sm:text-2xl"
            style={{ background: speakerColor(participant.identity) }}
          >
            {initials(name)}
          </div>
        )}
        {raisedHand && (
          <span
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-foreground"
            role="img"
            aria-label={dict.raisedHandTitle(name)}
            title={dict.raisedHandTitle(name)}
          >
            <HandIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
        <span
          className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full border-2"
          style={{ background: QUALITY_COLOR[quality], borderColor: "var(--surface)" }}
          title={dict.connectionQualityTitle(quality)}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/55 px-1.5 py-1">
          {!micEnabled && <MicOffIcon className="h-3 w-3 shrink-0 text-white" />}
          <span className="truncate text-[0.6875rem] font-medium text-white" title={name}>
            {name}
          </span>
        </div>
      </div>
    );
  }

  const avatarSize = "h-9 w-9 sm:h-11 sm:w-11";

  return (
    <div
      className={`flex shrink-0 items-center gap-2 rounded-lg border p-2 transition-colors ${
        variant === "strip" ? "flex-col text-center" : "flex-row"
      }`}
      style={{ borderColor: isSpeaking ? "var(--accent)" : "var(--border-subtle)" }}
      role="listitem"
    >
      <div className="relative shrink-0">
        {liveCamTrack ? (
          <div className={`overflow-hidden rounded-full ${avatarSize}`} style={{ background: "var(--surface)" }}>
            <VideoTrack trackRef={liveCamTrack} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div
            className={`font-data flex items-center justify-center rounded-full text-sm font-semibold text-white ${avatarSize}`}
            style={{ background: speakerColor(participant.identity) }}
          >
            {initials(name)}
          </div>
        )}
        {raisedHand && (
          <span
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-foreground"
            role="img"
            aria-label={dict.raisedHandTitle(name)}
            title={dict.raisedHandTitle(name)}
          >
            <HandIcon className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2"
          style={{ background: QUALITY_COLOR[quality], borderColor: "var(--surface)" }}
          title={dict.connectionQualityTitle(quality)}
        />
      </div>
      <div className={`flex min-w-0 flex-col ${variant === "strip" ? "items-center" : "items-start"}`}>
        <span className="max-w-[6rem] truncate text-xs font-medium text-foreground" title={name}>
          {name}
        </span>
        <div className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
          {!micEnabled && <MicOffIcon className="h-3 w-3" />}
          <span className="font-data uppercase">{preferredLanguage}</span>
        </div>
      </div>
    </div>
  );
}
