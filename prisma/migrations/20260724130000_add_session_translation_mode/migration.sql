CREATE TYPE "TranslationMode" AS ENUM ('AUTO', 'LOCAL_ONLY');

ALTER TABLE "Session" ADD COLUMN "translationMode" "TranslationMode" NOT NULL DEFAULT 'AUTO';
