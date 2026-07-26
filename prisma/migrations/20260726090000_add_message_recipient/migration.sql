ALTER TABLE "Message" ADD COLUMN "recipientId" TEXT;

CREATE INDEX "Message_sessionId_recipientId_idx" ON "Message"("sessionId", "recipientId");
CREATE INDEX "Message_sessionId_senderId_idx" ON "Message"("sessionId", "senderId");

ALTER TABLE "Message"
ADD CONSTRAINT "Message_recipientId_fkey"
FOREIGN KEY ("recipientId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
