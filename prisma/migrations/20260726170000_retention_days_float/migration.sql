-- AlterTable
-- retentionDays widens from Int (whole days only) to Float so the setup form can offer
-- sub-day presets (5 minutes, 1 hour) — a facilitator previously had no way to actually
-- verify the retention cleanup cron deletes data on schedule without waiting a full day.
ALTER TABLE "Session" ALTER COLUMN "retentionDays" TYPE DOUBLE PRECISION;
