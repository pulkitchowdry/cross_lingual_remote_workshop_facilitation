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

  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
    throw new Error("Choose a retention period between 1 and 30 days.");
  }

  const strictPrivacy = formData.get("strictPrivacy") === "on";
  const translationMode = strictPrivacy ? TranslationMode.LOCAL_ONLY : TranslationMode.AUTO;

  const facilitatorToken = createOpaqueToken();
  const learnerToken = createOpaqueToken();
  // Tie both join links' lifetime to the facilitator's own retention choice: once the
  // transcript is due for deletion, a leaked/forgotten link should stop working too,
  // rather than staying valid indefinitely (see docs/problem_statement.md's privacy
  // requirement — a link with no expiry is a standing access risk for the life of the
  // Session row).
  const linkExpiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

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
