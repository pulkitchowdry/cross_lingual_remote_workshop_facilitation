-- AlterTable
ALTER TABLE "SessionParticipant" ADD COLUMN "accessTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_accessTokenHash_key" ON "SessionParticipant"("accessTokenHash");
