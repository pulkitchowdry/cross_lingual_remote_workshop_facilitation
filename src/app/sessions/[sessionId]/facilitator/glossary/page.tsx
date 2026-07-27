import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hasFacilitatorAccess } from "@/lib/session-access";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { GlossaryManager } from "@/components/GlossaryManager";
import {
  deleteGlossaryEntry,
  upsertGlossaryEntry,
  uploadGlossaryCsv,
} from "@/app/sessions/[sessionId]/facilitator/glossary/actions";

export const metadata: Metadata = { title: "Technical glossary" };

/**
 * The Centralised Technical Glossary (issue #131) — unlike every other page
 * under `/sessions/[sessionId]/...`, the data shown here (CentralGlossaryEntry)
 * is NOT scoped to this session; `sessionId` only exists in this route because
 * facilitator auth in this app is a per-session cookie, not an account (see
 * session-access.ts). Any facilitator of any session sees and edits the same
 * shared glossary, matching the issue's "shared across all facilitators"
 * design principle.
 */
export default async function GlossaryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!(await hasFacilitatorAccess(sessionId))) redirect("/setup");

  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { sourceLanguage: true } });
  const lang = resolveLanguage(session?.sourceLanguage ?? "en");
  const dict = getDictionary(lang).glossary;

  const entries = await prisma.centralGlossaryEntry.findMany({
    orderBy: [{ isBuiltIn: "desc" }, { sourceTerm: "asc" }],
  });

  const saveAction = upsertGlossaryEntry.bind(null, sessionId);
  const deleteAction = deleteGlossaryEntry.bind(null, sessionId);
  const uploadAction = uploadGlossaryCsv.bind(null, sessionId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{dict.pageHeading}</h1>
          <p className="text-sm text-muted-foreground">{dict.pageSubtitle}</p>
        </div>
        <Link
          href={`/sessions/${sessionId}/facilitator`}
          className="font-data rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground hover:border-accent hover:text-accent"
        >
          {dict.backToDashboard}
        </Link>
      </div>
      <GlossaryManager
        entries={entries.map((entry) => ({
          id: entry.id,
          sourceTerm: entry.sourceTerm,
          category: entry.category,
          notes: entry.notes,
          translate: entry.translate,
          translations: (entry.translations as Record<string, string>) ?? {},
          isBuiltIn: entry.isBuiltIn,
        }))}
        dict={dict}
        saveAction={saveAction}
        deleteAction={deleteAction}
        uploadAction={uploadAction}
      />
    </div>
  );
}
