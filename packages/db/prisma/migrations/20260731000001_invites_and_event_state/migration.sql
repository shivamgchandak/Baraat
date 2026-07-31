-- Guest invitation flow
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "inviteToken" TEXT;
ALTER TABLE "User" ADD COLUMN "invitedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "activatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");

-- Event lifecycle
CREATE TABLE "EventState" (
    "id" TEXT NOT NULL DEFAULT 'event',
    "name" TEXT NOT NULL DEFAULT 'Baraat Event',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "EventState_pkey" PRIMARY KEY ("id")
);
INSERT INTO "EventState" ("id") VALUES ('event') ON CONFLICT DO NOTHING;

-- Existing users (seeded/staff) are considered activated
UPDATE "User" SET "activatedAt" = CURRENT_TIMESTAMP WHERE "activatedAt" IS NULL;
