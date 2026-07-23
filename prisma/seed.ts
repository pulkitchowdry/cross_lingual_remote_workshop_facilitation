import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, ParticipantRole } from "../src/generated/prisma/client";
import { createOpaqueToken, hashToken } from "../src/lib/session-security";

if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
} else if (existsSync(".env")) {
  loadEnvFile(".env");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the workshop database.");
}

/**
 * Seeds one demo session so `npm run db:seed` gives a fresh database the same
 * "coding workshop" fixture the facilitator's "Load demo scenario" button
 * creates, plus a ready learner join link — useful for local dev and for
 * `docs/PLAN.md`'s Phase 0 acceptance criteria (a facilitator can share a
 * working learner link without going through `/setup` first).
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const facilitator = await prisma.user.create({
    data: { displayName: "Demo Facilitator", preferredLanguage: "en" },
  });

  const session = await prisma.session.create({
    data: {
      title: "Debugging a signup 500 error",
      goal: "Implement a working REST endpoint for user signup, including input validation.",
      sourceLanguage: "en",
      learnerLanguages: ["zh", "es"],
      retentionDays: 7,
      facilitatorId: facilitator.id,
      participants: {
        create: {
          userId: facilitator.id,
          role: ParticipantRole.FACILITATOR,
          preferredLanguage: "en",
          consentedAt: new Date(),
        },
      },
    },
  });

  const facilitatorToken = createOpaqueToken();
  const learnerToken = createOpaqueToken();
  await prisma.joinLink.createMany({
    data: [
      {
        sessionId: session.id,
        role: ParticipantRole.FACILITATOR,
        tokenHash: hashToken(facilitatorToken),
        maxUses: 1,
        useCount: 1,
      },
      { sessionId: session.id, role: ParticipantRole.LEARNER, tokenHash: hashToken(learnerToken) },
    ],
  });

  console.log("Seeded demo session:", session.id);
  console.log("Facilitator dashboard cookie value (set manually if needed):", facilitatorToken);
  console.log("Learner join link: /join/" + learnerToken);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
