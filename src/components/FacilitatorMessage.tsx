"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfidenceTick } from "@/components/ui/ConfidenceTick";
import { getSpeakerColor } from "@/lib/speaker-color";
import type { TranscriptEntry } from "@/lib/types";

export function FacilitatorMessage({ entry }: { entry: TranscriptEntry }) {
  const [simplified, setSimplified] = useState(false);
  const facilitatorColor = getSpeakerColor("Facilitator");
  const showSimplified = simplified && entry.simplified;
  const translation = showSimplified ? entry.simplified!.translation : entry.translation;
  const original = showSimplified ? entry.simplified!.original : entry.original;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-raised p-3"
      style={{ borderLeft: `3px solid ${facilitatorColor}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading text-sm font-semibold" style={{ color: facilitatorColor }}>
          {entry.speaker}
        </span>
        <ConfidenceTick confidence={entry.confidence} />
      </div>
      <p className="text-base leading-snug text-foreground">
        {translation}
        {showSimplified && (
          <span className="font-data ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
            simplified
          </span>
        )}
      </p>
      <p className="text-xs italic text-muted-foreground" lang="und">
        {original}
      </p>
      {entry.simplified && (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() => setSimplified((value) => !value)}
        >
          {simplified ? "Show original explanation" : "Simplify explanation"}
        </Button>
      )}
    </div>
  );
}
