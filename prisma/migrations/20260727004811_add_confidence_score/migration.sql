-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_recipientId_fkey";

-- AlterTable
ALTER TABLE "TranscriptSegment" ADD COLUMN     "sttConfidence" INTEGER;

-- AlterTable
ALTER TABLE "Translation" ADD COLUMN     "confidence" INTEGER,
ADD COLUMN     "confidenceLevel" TEXT,
ADD COLUMN     "rootCause" TEXT;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
