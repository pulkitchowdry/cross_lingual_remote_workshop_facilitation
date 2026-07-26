-- AlterTable
-- Nullable text column for the once-per-session, end-of-session AI summary (see
-- generateAndPersistSessionSummary in insights.ts, triggered from endSession()).
ALTER TABLE "Session" ADD COLUMN "summary" TEXT;
