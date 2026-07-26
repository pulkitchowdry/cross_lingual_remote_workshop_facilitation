/**
 * Two specific, known-benign `console.error` calls that Next's dev-mode
 * console interception (`intercept-console-error.ts`) promotes to a
 * full-page "Console Error" overlay indistinguishable from an actual crash —
 * each already investigated and confirmed self-recovering, not fixable by
 * changing what calls it:
 *
 * 1. "could not determine track dimensions, using defaults" — livekit-client's
 *    `LocalParticipant.publish` polls `MediaStreamTrack.getSettings()` for up
 *    to 1s while waiting for a newly-captured video track to report its
 *    dimensions, then falls back to a default resolution and logs the
 *    fallback via `this.log.error(...)`. Publishing still succeeds with the
 *    fallback dimensions and playback is unaffected. On Linux screen-share
 *    captures (PipeWire/Wayland backends in particular), `getSettings()`
 *    routinely doesn't populate width/height within that window, so this
 *    fires on effectively every screen share here. livekit-client's public
 *    logging hooks (`setLogExtension`, `setLogLevel`) can't suppress just
 *    this one message without either leaving the original `console.error`
 *    call intact (`setLogExtension` is additive — see its `loglevel`
 *    "writing-plugins" doc) or silencing every other `error`-level log from
 *    the same `Participant` logger (which also carries genuine publish
 *    failures).
 *
 * 2. "Encountered a script tag while rendering React component" — the root
 *    layout (`src/app/layout.tsx`) renders an inline `<script>` to apply a
 *    stored theme before first paint (avoiding a flash of the wrong theme).
 *    React's dev-mode renderer warns on any `<script>` element rendered by a
 *    component, full stop — `next/script`'s `beforeInteractive` strategy
 *    does NOT avoid this for an inline script under the App Router: its own
 *    implementation (node_modules/next/dist/client/script.js) still returns
 *    a real `<script>` JSX element for that case (just with the content
 *    wrapped for Next's runtime), so the identical warning fires regardless
 *    of which of the two renders it.
 *
 * Both are patched narrowly, by exact message text, rather than broadly —
 * every other `console.error` call (including a real LiveKit publish
 * failure, or a real React warning) still reaches the console/overlay
 * unchanged.
 */
const BENIGN_MESSAGES = [
  "could not determine track dimensions, using defaults",
  "Encountered a script tag while rendering React component.",
];

export function wrapConsoleError(original: typeof console.error, debug: typeof console.debug): typeof console.error {
  return (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === "string" && BENIGN_MESSAGES.some((message) => first.startsWith(message))) {
      debug("[filtered]", ...args);
      return;
    }
    original(...args);
  };
}

let patched = false;

export function filterBenignConsoleErrors(): void {
  if (patched || typeof window === "undefined") return;
  patched = true;
  console.error = wrapConsoleError(console.error.bind(console), console.debug.bind(console));
}

filterBenignConsoleErrors();
