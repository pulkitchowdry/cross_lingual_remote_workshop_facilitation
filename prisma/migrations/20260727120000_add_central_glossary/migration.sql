-- CreateEnum
CREATE TYPE "GlossarySuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'IGNORED');

-- CreateTable
CREATE TABLE "CentralGlossaryEntry" (
    "id" TEXT NOT NULL,
    "sourceTerm" TEXT NOT NULL,
    "category" TEXT,
    "notes" TEXT,
    "translate" BOOLEAN NOT NULL DEFAULT true,
    "translations" JSONB NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentralGlossaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossarySuggestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sourceTerm" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "GlossarySuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlossarySuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CentralGlossaryEntry_sourceTerm_key" ON "CentralGlossaryEntry"("sourceTerm");

-- CreateIndex
CREATE UNIQUE INDEX "GlossarySuggestion_sessionId_sourceTerm_key" ON "GlossarySuggestion"("sessionId", "sourceTerm");

-- AddForeignKey
ALTER TABLE "GlossarySuggestion" ADD CONSTRAINT "GlossarySuggestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the built-in technical glossary (issue #131 "Built-in Glossary") — idempotent so
-- this migration can safely re-run against a database that already has these rows (e.g.
-- a facilitator who deleted one and re-applied migrations in a fresh environment).
INSERT INTO "CentralGlossaryEntry" ("id", "sourceTerm", "category", "translate", "translations", "isBuiltIn", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'API', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'REST API', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GraphQL', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'OAuth', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'JWT', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Kubernetes', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Docker', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Git', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GitHub', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PostgreSQL', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Redis', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'LiveKit', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Webhook', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'API Gateway', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Feature Flag', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CI/CD', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Machine Learning', 'Technical Term', true, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Artificial Intelligence', 'Technical Term', true, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'LLM', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'RAG', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'MCP', 'Technical Term', false, '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sourceTerm") DO NOTHING;
