/**
 * Small self-contained stroke-icon set for the meeting toolbar/strip — the rest of the app uses
 * text-label buttons throughout (see Button.tsx, every form action), but a floating video-call
 * control bar is universally icon-first and text labels don't fit a compact bar. Kept in one file,
 * plain inline SVG, so this doesn't need a new icon-library dependency (only Radix was approved).
 * Every icon is decorative (`aria-hidden`) — the accessible label always comes from the button's
 * own `aria-label`/tooltip, not the glyph.
 */
type IconProps = { className?: string };

const base = "h-4.5 w-4.5";

function Svg({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? base}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function MicIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="7" y="2.5" width="6" height="9" rx="3" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0" />
      <path d="M10 15v2.5M7 17.5h6" />
    </Svg>
  );
}

export function MicOffIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="7" y="2.5" width="6" height="9" rx="3" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 8.9 4.3" />
      <path d="M15.3 11.8c.13-.42.2-.86.2-1.3" />
      <path d="M10 15v2.5M7 17.5h6" />
      <path d="M3 3l14 14" />
    </Svg>
  );
}

export function CameraIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="5.5" width="10.5" height="9" rx="2" />
      <path d="M13 8.5l4.2-2.6a.6.6 0 0 1 .9.5v7.2a.6.6 0 0 1-.9.5L13 11.5" />
    </Svg>
  );
}

export function CameraOffIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 8v7a2 2 0 0 0 2 2h5.5a2 2 0 0 0 2-2v-1" />
      <path d="M12 5.5H4.5a2 2 0 0 0-1.4.6" />
      <path d="M13 8.5l4.2-2.6a.6.6 0 0 1 .9.5v7.2a.6.6 0 0 1-.9.5L13 11.5" />
      <path d="M3 3l14 14" />
    </Svg>
  );
}

export function ScreenShareIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 17.5h6M10 13.5v4" />
      <path d="M10 6.5v4M8 8.5l2-2 2 2" />
    </Svg>
  );
}

export function HandIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 10.5V4a1.2 1.2 0 0 1 2.4 0v5" />
      <path d="M9.4 9V3.2a1.2 1.2 0 0 1 2.4 0V9" />
      <path d="M11.8 9V4.4a1.2 1.2 0 0 1 2.4 0V11" />
      <path d="M14.2 6.6a1.2 1.2 0 0 1 2.4 0v6.4c0 3-2.2 5.5-5.5 5.5h-.9c-1.8 0-2.9-.6-4-2l-2.5-3.3a1.3 1.3 0 0 1 2-1.6l1.5 1.4" />
    </Svg>
  );
}

export function WhiteboardIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 17.5h6M10 13.5v4M6 7l2.5 2.5L11 7l3 3" />
    </Svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  // A solid gear, not a stroked outline like the rest of this set — thin
  // radiating lines read as a sparkle/asterisk at 18-20px, not a gear. A
  // filled disc-with-teeth-and-a-hole shape is what reads instantly as
  // "settings" at small sizes (WhatsApp, Slack, etc. all use a solid glyph
  // here even amid otherwise-outline icon sets).
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className ?? base} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14.6 10a4.6 4.6 0 1 1-9.2 0 4.6 4.6 0 0 1 9.2 0Zm-2.4 0a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z"
      />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <rect key={angle} x="8.8" y="2.8" width="2.4" height="3.6" rx="0.8" transform={`rotate(${angle} 10 10)`} />
      ))}
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 4.5h14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H8.5L4.8 17V14H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 5l10 10M15 5 5 15" />
    </Svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />
      <path d="M13.5 7.5V4.5a1 1 0 0 0-1-1H4.5a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h3" />
    </Svg>
  );
}

export function LeaveIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 8.2c4.2-3.6 9.8-3.6 14 0" />
      <path d="M6.3 11c2.5-1.9 4.9-1.9 7.4 0" />
      <path d="M8.3 13.6a2.6 2.6 0 0 1 3.4 0l.5.5a1 1 0 0 1-.1 1.5l-1.1.9a.9.9 0 0 1-1.2 0c-.7-.6-1.9-.6-2.6 0a.9.9 0 0 1-1.2 0l-1.1-.9a1 1 0 0 1-.1-1.5Z" />
    </Svg>
  );
}

export function ChevronIcon({ className, direction = "down" }: IconProps & { direction?: "up" | "down" | "left" | "right" }) {
  const rotation = { up: "rotate-180", down: "rotate-0", left: "rotate-90", right: "-rotate-90" }[direction];
  return (
    <Svg className={`${className ?? base} ${rotation}`}>
      <path d="M5 7.5 10 12.5 15 7.5" />
    </Svg>
  );
}
