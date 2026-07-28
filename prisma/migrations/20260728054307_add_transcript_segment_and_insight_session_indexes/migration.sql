-- CreateIndex
CREATE INDEX "Insight_sessionId_createdAt_idx" ON "Insight"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptSegment_sessionId_startedAt_idx" ON "TranscriptSegment"("sessionId", "startedAt");
