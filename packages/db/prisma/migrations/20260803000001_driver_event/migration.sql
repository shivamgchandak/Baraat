-- Scope drivers to an event (like guests): drivers of a closed/past event drop out of active views.
ALTER TABLE "Driver" ADD COLUMN "eventId" TEXT;

CREATE INDEX "Driver_eventId_idx" ON "Driver"("eventId");

ALTER TABLE "Driver" ADD CONSTRAINT "Driver_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
