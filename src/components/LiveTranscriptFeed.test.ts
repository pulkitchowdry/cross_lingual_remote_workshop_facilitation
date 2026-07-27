import { describe, expect, it } from "vitest";
import { dedupeById, type TranscriptFeedEntry } from "@/components/LiveTranscriptFeed";

function entry(id: string, primaryText: string): TranscriptFeedEntry {
  return { id, time: "10:00", speaker: "Speaker", primaryText, primaryLang: "en" };
}

describe("dedupeById", () => {
  it("keeps every entry when ids are already unique", () => {
    const entries = [entry("a", "one"), entry("b", "two")];
    expect(dedupeById(entries)).toEqual(entries);
  });

  it("drops a later entry that repeats an earlier id, keeping the first occurrence", () => {
    // Reproduces the "Each child in a list should have a unique key prop" warning seen in
    // LiveTranscriptFeed when two racing `router.refresh()` triggers (SessionAutoRefresh's
    // poll and CaptionChannelRefresher's DataChannel push) commit a torn `transcript` array
    // containing the same segment twice for one render.
    const entries = [entry("a", "first copy"), entry("b", "two"), entry("a", "stale duplicate")];
    expect(dedupeById(entries)).toEqual([entry("a", "first copy"), entry("b", "two")]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeById([])).toEqual([]);
  });
});
