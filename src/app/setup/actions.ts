"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ParticipantRole, TranslationMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  createOpaqueToken,
  facilitatorCookieName,
  hashToken,
  learnerInviteCookieName,
} from "@/lib/session-security";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { translateText } from "@/lib/providers/translation";

const languageValues = new Set<string>(SUPPORTED_LANGUAGES.map((language) => language.value));

function requiredText(formData: FormData, field: string, maximum: number) {
  const value = formData.get(field);
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) throw new Error(`Enter a valid ${field}.`);
  return trimmed;
}

function languageFrom(formData: FormData, field: string): SupportedLanguage {
  const value = formData.get(field);
  if (typeof value !== "string" || !languageValues.has(value)) {
    throw new Error(`Choose a supported ${field}.`);
  }
  return value as SupportedLanguage;
}

export async function createSession(formData: FormData) {
  const facilitatorName = requiredText(formData, "facilitatorName", 80);
  const title = requiredText(formData, "title", 120);
  const goal = requiredText(formData, "goal", 1_000);
  const sourceLanguage = languageFrom(formData, "sourceLanguage");
  const retentionDays = Number(formData.get("retentionDays"));

  // Was `Number.isInteger(...) && >= 1` (whole days only) — a facilitator had no way to
  // pick a short-enough window to actually verify the cleanup cron deletes a session's
  // data on schedule without waiting a full day. `retentionDays` is a Float column now
  // (see the matching Prisma migration) specifically so SetupForm can offer sub-day
  // presets (5 minutes, 1 hour) alongside the original day/week/month options. The floor
  // is set to 4 minutes, not 5 — SetupForm's "5 minutes" option value is a truncated
  // decimal string (JS floats can't exactly represent 5/1440), and comparing it directly
  // against a from-scratch `5 / (24 * 60)` here would reject that exact option due to
  // floating-point rounding landing a hair under the boundary. A 1-minute margin avoids
  // that razor's edge without changing what's actually enforced in practice.
  const MIN_RETENTION_DAYS = 4 / (24 * 60); // 4 minutes — headroom below the "5 minutes" option
  if (!Number.isFinite(retentionDays) || retentionDays < MIN_RETENTION_DAYS || retentionDays > 30) {
    throw new Error("Choose a retention period between 5 minutes and 30 days.");
  }

  const strictPrivacy = formData.get("strictPrivacy") === "on";
  const translationMode = strictPrivacy ? TranslationMode.LOCAL_ONLY : TranslationMode.AUTO;

  const facilitatorToken = createOpaqueToken();
  const learnerToken = createOpaqueToken();
  // Deliberately NOT tied to `retentionDays`: that clock is anchored to session
  // *creation*, but the actual data-retention deadline the cleanup cron enforces
  // (session-retention.ts) is anchored to when the session *ends* (falling back to
  // createdAt only for an abandoned session that never ends). A short retention
  // choice (e.g. 1 day) would otherwise expire the facilitator's own access link —
  // and the learner invite — before or during a session created ahead of time or
  // running longer than that window, locking everyone out of a still-live workshop.
  // A link with no expiry isn't a standing risk either: `logoutFacilitator` /
  // `revokeLearnerInvite` can cut access immediately, and the cleanup cron deletes
  // the Session row (cascading its JoinLinks) once retention genuinely expires — this
  // generous, retention-independent cap is just a secondary safety net for a link
  // that's simply never revoked or reclaimed.
  const linkExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Populated once here, at creation — mirrors sendChatMessage's per-language fan-out
  // (sessions/actions.ts) for the exact same reason: a session's title/goal are set
  // once and read many times (unlike a transcript segment's live per-utterance
  // translation), so every learner-facing render site can just look this up by their
  // own preferredLanguage instead of re-translating on every read. Run outside the
  // `$transaction` below — these are outbound network calls (Claude/local-inference),
  // not DB writes, and shouldn't hold a DB transaction open for their duration.
  const allowCloudFallback = translationMode !== TranslationMode.LOCAL_ONLY;
  const sessionTranslations = (
    await Promise.all(
      SUPPORTED_LANGUAGES.map(async ({ value: targetLanguage }) => {
        const [titleResult, goalResult] = await Promise.all([
          translateText(title, sourceLanguage, targetLanguage, { allowCloudFallback }),
          translateText(goal, sourceLanguage, targetLanguage, { allowCloudFallback }),
        ]);
        // translateText returns null both for the source language itself (nothing to
        // translate — no row needed, the facilitator's own views render the raw
        // columns directly) and for a genuine failure/unconfigured tier. Either way,
        // skip the row entirely rather than persisting a fabricated "translation"
        // that's actually just the untranslated original — same convention as
        // MessageTranslation.
        if (!titleResult && !goalResult) return null;
        return {
          targetLanguage,
          title: titleResult?.text ?? null,
          goal: goalResult?.text ?? null,
          provider: (titleResult ?? goalResult)!.provider,
        };
      }),
    )
  ).filter((translation): translation is NonNullable<typeof translation> => translation !== null);

  const session = await prisma.$transaction(async (transaction) => {
    const facilitator = await transaction.user.create({
      data: { displayName: facilitatorName, preferredLanguage: sourceLanguage },
    });
    const createdSession = await transaction.session.create({
      data: {
        title,
        goal,
        sourceLanguage,
        // Learners choose freely from every supported language at join time
        // (see join/[token]/page.tsx) — this isn't a facilitator-curated
        // subset, so it's just the full supported set.
        learnerLanguages: SUPPORTED_LANGUAGES.map((language) => language.value),
        retentionDays,
        translationMode,
        facilitatorId: facilitator.id,
        participants: {
          create: {
            userId: facilitator.id,
            role: ParticipantRole.FACILITATOR,
            preferredLanguage: sourceLanguage,
            consentedAt: new Date(),
          },
        },
        joinLinks: {
          create: [
            {
              role: ParticipantRole.FACILITATOR,
              tokenHash: hashToken(facilitatorToken),
              maxUses: 1,
              useCount: 1,
              expiresAt: linkExpiresAt,
            },
            {
              role: ParticipantRole.LEARNER,
              tokenHash: hashToken(learnerToken),
              expiresAt: linkExpiresAt,
            },
          ],
        },
        translations: {
          create: sessionTranslations,
        },
      },
    });
    return createdSession;
  });

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
  cookieStore.set(facilitatorCookieName(session.id), facilitatorToken, cookieOptions);
  cookieStore.set(learnerInviteCookieName(session.id), learnerToken, cookieOptions);

  redirect(`/sessions/${session.id}/facilitator`);
}
