-- CreateTable
CREATE TABLE "SessionTranslation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "title" TEXT,
    "goal" TEXT,
    "provider" TEXT NOT NULL,

    CONSTRAINT "SessionTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionTranslation_sessionId_targetLanguage_key" ON "SessionTranslation"("sessionId", "targetLanguage");

-- AddForeignKey
ALTER TABLE "SessionTranslation" ADD CONSTRAINT "SessionTranslation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
