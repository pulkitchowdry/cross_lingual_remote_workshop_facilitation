import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * A row from the shared CentralGlossaryEntry table (issue #131), shaped for
 * lookup rather than the raw Prisma row — `translations` is narrowed to
 * `Record<string, string>` since Prisma types it as `Json`.
 */
export interface CentralGlossaryEntryLike {
  sourceTerm: string;
  translate: boolean;
  translations: Record<string, string>;
}

export interface GlossaryMatch {
  entry: CentralGlossaryEntryLike;
  /** The literal substring found in the source text — usually `entry.sourceTerm`, case-preserved as it appeared. */
  matchedText: string;
}

/**
 * Finds every central-glossary term present in `text` (issue #131's "Detect
 * candidate technical terms before translation"). A cheap word-boundary
 * substring scan, not NLP/tokenization — the glossary is small (tens to low
 * hundreds of entries) and this runs once per transcript segment, so a
 * linear scan comfortably meets the "no noticeable latency" requirement
 * without needing an index structure.
 */
export function findGlossaryMatches(text: string, glossary: CentralGlossaryEntryLike[]): GlossaryMatch[] {
  if (glossary.length === 0) return [];
  const matches: GlossaryMatch[] = [];
  for (const entry of glossary) {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.sourceTerm)}\\b`, "i");
    const found = pattern.exec(text);
    if (found) {
      matches.push({ entry, matchedText: found[0] });
    }
  }
  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The preferred rendering of a matched term for one target language — verbatim
 * (untranslated) for `translate: false` entries, `translations[targetLanguage]`
 * when the facilitator has set one, or `null` when the glossary has no opinion
 * (falls through to the normal translation pipeline).
 */
export function preferredTranslation(entry: CentralGlossaryEntryLike, targetLanguage: SupportedLanguage): string | null {
  if (!entry.translate) return entry.sourceTerm;
  return entry.translations[targetLanguage] ?? null;
}

/**
 * Builds the "use these preferred translations" instruction appended to
 * translateWithClaude's system prompt (issue #131's translation-pipeline
 * diagram: "Glossary Lookup" happens before "Translation"). Returns null
 * when nothing in the glossary matched, so callers can skip the extra
 * prompt text entirely on the (common) case with no technical terms.
 */
export function buildGlossaryPromptHint(matches: GlossaryMatch[], targetLanguage: SupportedLanguage): string | null {
  if (matches.length === 0) return null;
  const lines = matches
    .map((match) => {
      const preferred = preferredTranslation(match.entry, targetLanguage);
      if (preferred === null) return null;
      return `- "${match.entry.sourceTerm}" -> "${preferred}"`;
    })
    .filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    `This text contains the following technical term(s). Use exactly these preferred ` +
    `translations for them, keeping the rest of the sentence translated normally:\n${lines.join("\n")}`
  );
}

/**
 * Whether the translation output actually used the glossary's preferred
 * rendering for a matched term — a simple substring check, not exact-match,
 * since the term may appear inflected/with surrounding punctuation in a full
 * sentence. Used by estimateTerminologyConfidence (confidence.ts) to
 * distinguish a genuine mismatch from a term the glossary has no opinion on.
 */
export function translationUsesPreferredTerm(translatedText: string, preferred: string): boolean {
  return translatedText.toLowerCase().includes(preferred.toLowerCase());
}

/**
 * Minimal RFC4180-style CSV parser (quoted fields, escaped `""`, embedded commas
 * and newlines) — small enough to hand-roll rather than add a dependency for a
 * format this simple; Excel uploads (issue #131 also wants .xlsx) go through the
 * `xlsx` package instead, see glossary/actions.ts.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  }
  return rows;
}

export interface GlossaryCsvRow {
  sourceTerm: string;
  translate: boolean;
  translations: Record<string, string>;
  notes?: string;
}

/**
 * Parses the CSV/Excel glossary upload format from issue #131 ("Source Term |
 * Translate? | Chinese (Simplified) | Spanish | Notes"). Column headers for
 * languages are matched case-insensitively against SUPPORTED_LANGUAGES'
 * `label`/`nativeLabel` (e.g. "Chinese (Simplified)" and "中文" both map to
 * "zh") so facilitators can author the sheet in either the app's languages
 * or their own native labels — an unrecognized language column is ignored
 * rather than rejecting the whole upload, since Notes/other metadata columns
 * are expected to be present too.
 */
export function parseGlossaryRows(headerRow: string[], dataRows: string[][]): GlossaryCsvRow[] {
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  const sourceTermIdx = headers.findIndex((h) => h === "source term" || h === "term" || h === "source_term");
  const translateIdx = headers.findIndex((h) => h === "translate?" || h === "translate");
  const notesIdx = headers.findIndex((h) => h === "notes");
  if (sourceTermIdx === -1) {
    throw new Error('Glossary file is missing a "Source Term" column.');
  }

  const languageColumns: Array<{ index: number; language: SupportedLanguage }> = [];
  headers.forEach((header, index) => {
    if (index === sourceTermIdx || index === translateIdx || index === notesIdx) return;
    const language = matchLanguageColumn(header);
    if (language) languageColumns.push({ index, language });
  });

  return dataRows
    .filter((row) => row[sourceTermIdx]?.trim())
    .map((row) => {
      const translations: Record<string, string> = {};
      for (const { index, language } of languageColumns) {
        const value = row[index]?.trim();
        if (value) translations[language] = value;
      }
      const translateCell = translateIdx !== -1 ? row[translateIdx]?.trim().toLowerCase() : undefined;
      return {
        sourceTerm: row[sourceTermIdx].trim(),
        translate: translateCell === undefined ? true : translateCell !== "no" && translateCell !== "false",
        translations,
        notes: notesIdx !== -1 ? row[notesIdx]?.trim() || undefined : undefined,
      };
    });
}

/** Common short acronyms/initialisms that read as "technical" by shape (all-caps,
 * 2-6 letters) but are ordinary enough not to worth flagging as an unknown glossary
 * candidate every time someone says them — keeps recordUnknownGlossaryTerms' post-
 * meeting recommendation list from being dominated by noise. */
const CANDIDATE_TERM_STOPLIST = new Set([
  "OK",
  "US",
  "UK",
  "TV",
  "PM",
  "AM",
  "CEO",
  "CFO",
  "FYI",
  "ASAP",
  "ETA",
]);

/**
 * Heuristically detects technical-looking terms with no central-glossary entry
 * yet (issue #131's "Unknown Technical Term" / "Record unknown technical terms
 * during meetings") — an acronym (all-caps, 2-6 letters), CamelCase identifier,
 * or an alphanumeric token mixing letters and digits (e.g. "GPT4", "OAuth2").
 * This is a shape-based heuristic, not NLP term extraction: good enough to
 * surface post-meeting recommendations without adding a model call to every
 * caption on the hot path.
 */
export function detectCandidateTerms(text: string, knownTerms: Set<string>): string[] {
  const known = new Set(Array.from(knownTerms, (term) => term.toLowerCase()));
  const patterns = [/\b[A-Z]{2,6}\b/g, /\b[A-Z][a-z]+(?:[A-Z][a-zA-Z]*)+\b/g, /\b[A-Za-z]+\d[A-Za-z0-9]*\b/g];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const term = match[0];
      if (CANDIDATE_TERM_STOPLIST.has(term.toUpperCase())) continue;
      if (known.has(term.toLowerCase())) continue;
      found.add(term);
    }
  }
  return Array.from(found);
}

const LANGUAGE_COLUMN_ALIASES: Record<SupportedLanguage, string[]> = {
  en: ["english", "en"],
  zh: ["chinese", "chinese (simplified)", "中文", "zh"],
  es: ["spanish", "español", "es"],
};

function matchLanguageColumn(header: string): SupportedLanguage | null {
  for (const [language, aliases] of Object.entries(LANGUAGE_COLUMN_ALIASES) as Array<[SupportedLanguage, string[]]>) {
    if (aliases.some((alias) => header.includes(alias))) return language;
  }
  return null;
}
