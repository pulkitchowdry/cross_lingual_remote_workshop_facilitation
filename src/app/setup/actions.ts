"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ParticipantRole } from "@/generated/prisma/client";
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

  const learnerLanguages = formData
    .getAll("learnerLanguages")
    .filter((value): value is string => typeof value === "string" && languageValues.has(value));

  if (learnerLanguages.length === 0) {
    throw new Error("Choose at least one learner language.");
  }

  const facilitatorToken = createOpaqueToken();
  const learnerToken = createOpaqueToken();

  const session = await prisma.$transaction(async (transaction) => {
    const facilitator = await transaction.user.create({
      data: { displayName: facilitatorName, preferredLanguage: sourceLanguage },
    });
    const createdSession = await transaction.session.create({
      data: {
        title,
        goal,
        sourceLanguage,
        learnerLanguages: [...new Set(learnerLanguages)],
        retentionDays,
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
            },
            {
              role: ParticipantRole.LEARNER,
              tokenHash: hashToken(learnerToken),
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
