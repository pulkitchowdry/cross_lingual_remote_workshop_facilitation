"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { GlossaryEntry } from "@/lib/types";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Renders `text` with any matching glossary terms as clickable spans.
 * Clicking a term opens an inline card with definition, pronunciation,
 * example, and translation — the AI Glossary feature from FEATURE_LIST.md.
 */
export function GlossaryText({
  text,
  glossary,
}: {
  text: string;
  glossary: GlossaryEntry[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (glossary.length === 0) return <>{text}</>;

  const pattern = new RegExp(`(${glossary.map((entry) => escapeRegExp(entry.term)).join("|")})`, "g");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, index) => {
        const entry = glossary.find((candidate) => candidate.term === part);
        if (!entry) return <span key={index}>{part}</span>;
        const isOpen = openId === entry.id;
        return (
          <span key={entry.id + index} className="relative inline-block">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : entry.id)}
              className="font-data text-accent underline decoration-dotted decoration-2 underline-offset-2 hover:opacity-80"
              aria-expanded={isOpen}
            >
              {part}
            </button>
            {isOpen && (
              <Card
                eyebrow="Glossary"
                title={entry.term}
                className="absolute left-0 top-full z-10 mt-1 w-64 text-left not-italic shadow-lg"
              >
                <dl className="flex flex-col gap-1.5 text-xs">
                  <div>
                    <dt className="font-data uppercase tracking-wider text-muted-foreground">
                      Pronunciation
                    </dt>
                    <dd>{entry.pronunciation}</dd>
                  </div>
                  <div>
                    <dt className="font-data uppercase tracking-wider text-muted-foreground">
                      Definition
                    </dt>
                    <dd>{entry.definition}</dd>
                  </div>
                  <div>
                    <dt className="font-data uppercase tracking-wider text-muted-foreground">
                      Example
                    </dt>
                    <dd className="italic">{entry.example}</dd>
                  </div>
                  <div>
                    <dt className="font-data uppercase tracking-wider text-muted-foreground">
                      Translation
                    </dt>
                    <dd lang="und">{entry.translation}</dd>
                  </div>
                </dl>
              </Card>
            )}
          </span>
        );
      })}
    </>
  );
}
