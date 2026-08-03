-- New Event entity (replaces single-row EventState)
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- Migrate the existing single EventState row into an Event (keep history)
INSERT INTO "Event" ("id", "name", "status", "closedAt")
SELECT 'evt_legacy', COALESCE("name", 'Baraat Event'), "status", "closedAt"
FROM "EventState" WHERE "id" = 'event'
ON CONFLICT DO NOTHING;

DROP TABLE "EventState";

-- eventId links
ALTER TABLE "Accommodation" ADD COLUMN "eventId" TEXT;
ALTER TABLE "EventLocation" ADD COLUMN "eventId" TEXT;
ALTER TABLE "Guest" ADD COLUMN "eventId" TEXT;
ALTER TABLE "Guest" ADD COLUMN "pickupAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD COLUMN "eventId" TEXT;

CREATE INDEX "Accommodation_eventId_idx" ON "Accommodation"("eventId");
CREATE INDEX "EventLocation_eventId_idx" ON "EventLocation"("eventId");
CREATE INDEX "Guest_eventId_idx" ON "Guest"("eventId");
CREATE INDEX "Trip_eventId_idx" ON "Trip"("eventId");

ALTER TABLE "Accommodation" ADD CONSTRAINT "Accommodation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: attach all existing places/guests/trips to the legacy event
UPDATE "Accommodation" SET "eventId" = 'evt_legacy' WHERE "eventId" IS NULL;
UPDATE "EventLocation" SET "eventId" = 'evt_legacy' WHERE "eventId" IS NULL;
UPDATE "Guest" SET "eventId" = 'evt_legacy' WHERE "eventId" IS NULL;
UPDATE "Trip" SET "eventId" = 'evt_legacy' WHERE "eventId" IS NULL;
