CREATE TABLE "MessageTranslation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "qualitySignal" TEXT,

    CONSTRAINT "MessageTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageTranslation_messageId_targetLanguage_key"
ON "MessageTranslation"("messageId", "targetLanguage");

ALTER TABLE "MessageTranslation"
ADD CONSTRAINT "MessageTranslation_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
