-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DRIVER', 'GUEST');
CREATE TYPE "DriverStatus" AS ENUM ('OFFLINE', 'IDLE', 'EN_ROUTE_PICKUP', 'OCCUPIED', 'ON_BREAK');
CREATE TYPE "GuestStatus" AS ENUM ('WAITING', 'ASSIGNED', 'IN_TRANSIT', 'COMPLETED');
CREATE TYPE "TripType" AS ENUM ('ARRIVAL', 'TO_VENUE', 'RETURN', 'DEPARTURE', 'ON_DEMAND');
CREATE TYPE "TripStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'ARRIVED_PICKUP', 'BOARDED', 'ARRIVED_DROP', 'COMPLETED', 'REJECTED', 'CANCELLED');
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "seatCapacity" INTEGER NOT NULL,
    "luggageCapacity" INTEGER NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'OFFLINE',
    "currentLat" DOUBLE PRECISION,
    "currentLng" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "predictedFreeAt" TIMESTAMP(3),
    "predictedFreeLat" DOUBLE PRECISION,
    "predictedFreeLng" DOUBLE PRECISION,
    "tripsSinceBreak" INTEGER NOT NULL DEFAULT 0,
    "lastBreakAt" TIMESTAMP(3),
    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Accommodation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "Accommodation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "EventLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION,
    "pickupLng" DOUBLE PRECISION,
    "pickupLabel" TEXT,
    "accommodationId" TEXT,
    "flightTrainEta" TIMESTAMP(3),
    "groupSize" INTEGER NOT NULL DEFAULT 1,
    "luggageCount" INTEGER NOT NULL DEFAULT 0,
    "status" "GuestStatus" NOT NULL DEFAULT 'WAITING',
    "waitingSince" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "priority" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "TripType" NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'ASSIGNED',
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "originLabel" TEXT,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "destLabel" TEXT,
    "deadline" TIMESTAMP(3),
    "plannedRoute" JSONB,
    "etaSeconds" INTEGER,
    "assignedBy" TEXT NOT NULL DEFAULT 'ENGINE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "arrivedPickupAt" TIMESTAMP(3),
    "boardedAt" TIMESTAMP(3),
    "arrivedDropAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripGuest" (
    "tripId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    CONSTRAINT "TripGuest_pkey" PRIMARY KEY ("tripId", "guestId")
);

CREATE TABLE "RideRequest" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "resultingTripId" TEXT,
    CONSTRAINT "RideRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");
CREATE INDEX "Driver_status_idx" ON "Driver"("status");
CREATE UNIQUE INDEX "Guest_userId_key" ON "Guest"("userId");
CREATE INDEX "Guest_status_idx" ON "Guest"("status");
CREATE INDEX "Trip_driverId_status_idx" ON "Trip"("driverId", "status");
CREATE INDEX "Trip_status_idx" ON "Trip"("status");
CREATE INDEX "RideRequest_status_idx" ON "RideRequest"("status");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_accommodationId_fkey" FOREIGN KEY ("accommodationId") REFERENCES "Accommodation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripGuest" ADD CONSTRAINT "TripGuest_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripGuest" ADD CONSTRAINT "TripGuest_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
