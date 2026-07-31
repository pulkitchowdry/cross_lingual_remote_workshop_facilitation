"use client";

import { useEffect, useState } from "react";

export type CaptionAgentStatus = "pending" | "connected" | "failed" | "not-applicable";

const POLL_INTERVAL_MS = 3_000;
// Hard ceiling on top of the "stop once terminal" logic below — a safety net, not the
// normal path. room.ts's own retry loop gives up after ~70s (AGENT_DISPATCH_MAX_ATTEMPTS
// * AGENT_DISPATCH_RETRY_DELAY_MS), which should always produce a "failed" response well
// before this fires. This exists for the cases that logic can't cover: a persistently
// erroring fetch (403/404 from a session that ended mid-poll, a network issue between
// this browser and the server) that never resolves to a real status at all — without a
// cap, a LIVE session left open for hours would otherwise poll every 3s for its entire
// remaining lifetime instead of giving up like everything else here does.
const MAX_POLLS = 40; // 40 * 3s = 120s, comfortably past the server's own ~70s budget

/**
 * Polls `/api/sessions/[sessionId]/caption-agent-status` while the server-side caption
 * agent hasn't yet reached a terminal state, so the captions tab can show pending/
 * connected/failed instead of silence — see docs/CAPTION_AUDIO_TROUBLESHOOTING.md §12 for
 * the underlying LiveKit Cloud dispatch-delivery gap this surfaces.
 *
 * `enabled` should just be "is this viewer the facilitator" — the route itself decides
 * whether the agent is even relevant for this deployment (`CAPTION_CAPTURE_MODE`, e.g.
 * `browser-only` has no agent to report on) and returns `"not-applicable"`, so callers
 * don't need their own copy of that server-only config check.
 *
 * `null` until the first response lands (nothing to show yet). Stops polling the moment
 * any of three things happens, whichever comes first: (1) the server reports a terminal
 * status ("connected"/"failed"/"not-applicable" — all three permanent for the rest of
 * this LIVE session), (2) a non-OK HTTP response arrives (403/404 mean "not authorized"/
 * "session gone", neither of which a retry fixes), or (3) `MAX_POLLS` is reached with no
 * resolution — surfaced as "failed" rather than leaving the UI silently stuck on
 * "pending" forever once this gives up asking.
 */
export function useCaptionAgentStatus(sessionId: string, enabled: boolean): CaptionAgentStatus | null {
  const [status, setStatus] = useState<CaptionAgentStatus | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollCount = 0;

    async function poll() {
      pollCount++;
      try {
        const response = await fetch(`/api/sessions/${sessionId}/caption-agent-status`, { cache: "no-store" });
        if (!response.ok) {
          // Not authorized / session no longer available — both permanent, not worth
          // retrying. A transient server error would also stop here rather than retry
          // indefinitely, which is fine: MAX_POLLS below is the real backstop for
          // anything genuinely transient that outlasts a few attempts.
          return;
        }
        const data = (await response.json()) as { status?: CaptionAgentStatus };
        if (!cancelled && data.status) {
          setStatus(data.status);
          if (data.status !== "pending") return; // terminal — stop polling
        }
      } catch {
        // Best-effort — a transient fetch failure just retries on the next interval
        // (bounded by MAX_POLLS below) rather than flipping to "failed" over a single
        // network blip unrelated to whether the caption agent itself ever connected.
      }
      if (cancelled) return;
      if (pollCount >= MAX_POLLS) {
        setStatus((current) => (current === "pending" || current === null ? "failed" : current));
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, enabled]);

  return status;
}
