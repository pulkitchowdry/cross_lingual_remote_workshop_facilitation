"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { parseCsv, parseGlossaryRows } from "@/lib/glossary";
import { SUPPORTED_LANGUAGES } from "@/lib/session-contracts";

/**
 * The Centralised Technical Glossary (issue #131) is shared across every
 * facilitator/session, not scoped to `sessionId` — but this app has no
 * standalone facilitator login (see session-access.ts), only a per-session
 * cookie, so `hasFacilitatorAccess(sessionId)` is reused here purely as "is
 * this browser a facilitator of *some* session" gate, matching every other
 * mutation in this app. Any facilitator can manage the shared glossary,
 * exactly as the issue's "shared across all facilitators" design principle
 * asks for.
 */
async function requireFacilitator(sessionId: string) {
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");
}

export interface GlossaryFormResult {
  error: string | null;
}

function revalidateGlossaryPage(sessionId: string) {
  revalidatePath(`/sessions/${sessionId}/facilitator/glossary`);
}

function readTranslations(formData: FormData): Record<string, string> {
  const translations: Record<string, string> = {};
  for (const { value } of SUPPORTED_LANGUAGES) {
    const raw = formData.get(`translation_${value}`);
    if (typeof raw === "string" && raw.trim()) translations[value] = raw.trim();
  }
  return translations;
}

export async function upsertGlossaryEntry(
  sessionId: string,
  entryId: string | null,
  _prevState: GlossaryFormResult,
  formData: FormData,
): Promise<GlossaryFormResult> {
  await requireFacilitator(sessionId);

  const sourceTerm = formData.get("sourceTerm");
  if (typeof sourceTerm !== "string" || !sourceTerm.trim()) {
    return { error: "Enter a source term." };
  }
  const category = formData.get("category");
  const notes = formData.get("notes");
  const translate = formData.get("translate") !== "verbatim";
  const translations = readTranslations(formData);

  try {
    if (entryId) {
      await prisma.centralGlossaryEntry.update({
        where: { id: entryId },
        data: {
          sourceTerm: sourceTerm.trim(),
          category: typeof category === "string" && category.trim() ? category.trim() : null,
          notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
          translate,
          translations,
        },
      });
    } else {
      await prisma.centralGlossaryEntry.create({
        data: {
          sourceTerm: sourceTerm.trim(),
          category: typeof category === "string" && category.trim() ? category.trim() : null,
          notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
          translate,
          translations,
        },
      });
    }
  } catch (error) {
    // Most likely the unique(sourceTerm) constraint — surfaced as a form error rather
    // than crashing to the route's error boundary, same reasoning as publishCaption's
    // try/catch (facilitator/actions.ts).
    console.error("upsertGlossaryEntry failed", error);
    return { error: "That source term already exists in the glossary, or the entry could not be saved." };
  }
  revalidateGlossaryPage(sessionId);
  return { error: null };
}

export async function deleteGlossaryEntry(sessionId: string, entryId: string) {
  await requireFacilitator(sessionId);
  await prisma.centralGlossaryEntry.delete({ where: { id: entryId } }).catch(() => null);
  revalidateGlossaryPage(sessionId);
}

export interface GlossaryUploadResult {
  error: string | null;
  addedOrUpdated: number;
}

/**
 * Bulk CSV upload (issue #131's "Custom Glossary Upload") — Excel (.xlsx) is not
 * yet supported: the only npm-published `xlsx` (SheetJS) release carries an
 * unpatched high-severity prototype-pollution advisory (GHSA-4r6h-8v6p-xvw6)
 * with no fixed version on the npm registry, so it isn't safe to add as a
 * dependency. Facilitators can export a spreadsheet to CSV as a workaround
 * until a vetted parser is available.
 */
export async function uploadGlossaryCsv(
  sessionId: string,
  _prevState: GlossaryUploadResult,
  formData: FormData,
): Promise<GlossaryUploadResult> {
  await requireFacilitator(sessionId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to upload.", addedOrUpdated: 0 };
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { error: "Only CSV files are supported right now — export your spreadsheet to CSV first.", addedOrUpdated: 0 };
  }

  let rows;
  try {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) throw new Error("empty");
    rows = parseGlossaryRows(parsed[0], parsed.slice(1));
  } catch (error) {
    console.error("uploadGlossaryCsv failed to parse file", error);
    return { error: "Couldn't read that file — check it matches the expected glossary format.", addedOrUpdated: 0 };
  }
  if (rows.length === 0) {
    return { error: "That file has no glossary rows to import.", addedOrUpdated: 0 };
  }

  await Promise.all(
    rows.map((row) =>
      prisma.centralGlossaryEntry.upsert({
        where: { sourceTerm: row.sourceTerm },
        update: { translate: row.translate, translations: row.translations, notes: row.notes ?? null },
        create: {
          sourceTerm: row.sourceTerm,
          translate: row.translate,
          translations: row.translations,
          notes: row.notes ?? null,
        },
      }),
    ),
  );

  revalidateGlossaryPage(sessionId);
  return { error: null, addedOrUpdated: rows.length };
}

/** Promotes a post-meeting "unknown technical term" recommendation (issue #131) into
 * a real central glossary entry, and marks the suggestion APPROVED so it stops
 * showing as pending. */
export async function approveGlossarySuggestion(sessionId: string, suggestionId: string) {
  await requireFacilitator(sessionId);

  const suggestion = await prisma.glossarySuggestion.findFirst({ where: { id: suggestionId, sessionId } });
  if (!suggestion) return;

  await prisma.$transaction([
    prisma.centralGlossaryEntry.upsert({
      where: { sourceTerm: suggestion.sourceTerm },
      update: {},
      create: { sourceTerm: suggestion.sourceTerm, translate: true, translations: {} },
    }),
    prisma.glossarySuggestion.update({ where: { id: suggestionId }, data: { status: "APPROVED" } }),
  ]);
  revalidatePath(`/sessions/${sessionId}/facilitator`);
  revalidateGlossaryPage(sessionId);
}

export async function ignoreGlossarySuggestion(sessionId: string, suggestionId: string) {
  await requireFacilitator(sessionId);
  await prisma.glossarySuggestion.updateMany({
    where: { id: suggestionId, sessionId },
    data: { status: "IGNORED" },
  });
  revalidatePath(`/sessions/${sessionId}/facilitator`);
}
