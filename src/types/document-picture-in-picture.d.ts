/**
 * Chromium-only Document Picture-in-Picture API (not yet in TypeScript's DOM
 * lib) — used by AutoPictureInPicture.tsx to keep a video floating when the
 * user switches browser tabs. Feature-detected at call sites via
 * `"documentPictureInPicture" in window`; absent everywhere else (Safari,
 * Firefox), where the optional field below is simply undefined.
 */
interface DocumentPictureInPictureWindowOptions {
  width?: number;
  height?: number;
}

interface DocumentPictureInPicture extends EventTarget {
  requestWindow(options?: DocumentPictureInPictureWindowOptions): Promise<Window>;
  readonly window: Window | null;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
}
