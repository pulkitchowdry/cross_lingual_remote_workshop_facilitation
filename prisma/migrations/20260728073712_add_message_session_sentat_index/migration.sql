-- CreateIndex
CREATE INDEX "Message_sessionId_sentAt_idx" ON "Message"("sessionId", "sentAt");
