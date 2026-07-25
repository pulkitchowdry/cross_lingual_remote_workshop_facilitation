/**
 * `LocalParticipant.publish` (livekit-client) polls `MediaStreamTrack
 * .getSettings()` for up to 1s while waiting for a newly-captured video
 * track to report its dimensions, then falls back to a default resolution
 * and logs the fallback via `this.log.error(...)` — a vendor-internal,
 * self-recovering degradation, not a failure: publishing still succeeds
 * with the fallback dimensions and playback is unaffected. On Linux
 * screen-share captures (PipeWire/Wayland backends in particular),
 * `getSettings()` routinely doesn't populate width/height within that
 * window, so this fires on effectively every screen share here — and
 * because it's a real `console.error` call, Next's dev-mode console
 * interception (`intercept-console-error.ts`) promotes it to a
 * full-page "Console Error" overlay, indistinguishable from an actual
 * crash. livekit-client's public logging hooks (`setLogExtension`,
 * `setLogLevel`) can't suppress just this one message without either
 * leaving the original `console.error` call intact (`setLogExtension` is
 * additive — see its `loglevel` "writing-plugins" doc) or silencing every
 * other `error`-level log from the same `Participant` logger (which also
 * carries genuine publish failures) — so this patches `console.error`
 * itself, narrowly, for this one known-benign message text only.
 */
const BENIGN_LIVEKIT_MESSAGES = ["could not determine track dimensions, using defaults"];

export function wrapConsoleError(original: typeof console.error, debug: typeof console.debug): typeof console.error {
  return (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === "string" && BENIGN_LIVEKIT_MESSAGES.some((message) => first.startsWith(message))) {
      debug("[livekit]", ...args);
      return;
    }
    original(...args);
  };
}

let patched = false;

export function filterBenignLiveKitConsoleErrors(): void {
  if (patched || typeof window === "undefined") return;
  patched = true;
  console.error = wrapConsoleError(console.error.bind(console), console.debug.bind(console));
}

filterBenignLiveKitConsoleErrors();
