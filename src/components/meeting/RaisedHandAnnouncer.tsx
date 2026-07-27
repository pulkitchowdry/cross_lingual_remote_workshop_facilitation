"use client";

import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type Participant } from "livekit-client";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

const ANNOUNCE_CLEAR_MS = 5_000;

/**
 * ParticipantChip's raised-hand badge is a bare `title`-only span (not reachable by
 * screen readers — no role, not focusable), and nothing else in the meeting room
 * announces a hand-raise. This visually-hidden `aria-live` region is the only
 * screen-reader-facing signal for it, mirroring the confusion/blocker badges
 * elsewhere in the app that already use aria-live for the same kind of async signal.
 */
export function RaisedHandAnnouncer({ uiLang }: { uiLang: SupportedLanguage }) {
  const room = useRoomContext();
  const dict = getDictionary(uiLang).meeting;
  const [message, setMessage] = useState("");

  useEffect(() => {
    function handleAttributesChanged(changed: Record<string, string>, participant: Participant) {
      if (changed.raisedHand === "true") {
        setMessage(dict.raisedHandTitle(participant.name || participant.identity));
      }
    }
    room.on(RoomEvent.ParticipantAttributesChanged, handleAttributesChanged);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, handleAttributesChanged);
    };
  }, [room, dict]);

  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(""), ANNOUNCE_CLEAR_MS);
    return () => clearTimeout(timeout);
  }, [message]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
