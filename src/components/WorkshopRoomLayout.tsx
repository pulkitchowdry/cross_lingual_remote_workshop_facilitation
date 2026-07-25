"use client";

import { useCallback, useState, type ReactNode } from "react";
import { LiveSessionRoom } from "@/components/LiveSessionRoom";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Wraps the workshop video room and the chat sidebar in a grid whose column
 * split reacts to whether a screen share is actively live in the room —
 * screen-shared content should always read as the biggest thing on screen,
 * which a fixed column ratio can't deliver on its own (a facilitator
 * presenting slides needs far more than a static 75% width; a workshop with
 * no share active shouldn't force the chat sidebar to nothing, or stretch the
 * video tiles to fill a large monitor just because the space exists). Client
 * component only for this state; the video room and chat panel underneath it
 * keep their own existing component boundaries (`LiveSessionRoom` is already
 * client, `sidebar`/`belowVideo` stay server-rendered trees — Next.js
 * supports a server component subtree as a client component's children
 * without forcing it to also become client).
 */
export function WorkshopRoomLayout({
  sessionId,
  role,
  lang,
  belowVideo,
  sidebar,
}: {
  sessionId: string;
  role: "facilitator" | "learner";
  lang: SupportedLanguage;
  /** Extra controls rendered under the video room, inside the same column (e.g. the facilitator's typed-caption form and mic-capture button) — stays with the video column at every width instead of becoming a separate grid item. */
  belowVideo?: ReactNode;
  sidebar: ReactNode;
}) {
  const [screenSharing, setScreenSharing] = useState(false);
  const handleScreenShareActiveChange = useCallback((active: boolean) => setScreenSharing(active), []);

  return (
    <div
      className={
        screenSharing
          ? "grid grid-cols-1 gap-4"
          : "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,1fr)]"
      }
    >
      <div className="flex flex-col gap-3">
        <LiveSessionRoom sessionId={sessionId} role={role} lang={lang} onScreenShareActiveChange={handleScreenShareActiveChange} />
        {belowVideo}
      </div>
      {sidebar}
    </div>
  );
}
