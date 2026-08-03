

export * from "./constants.js";

export type LatLng = { lat: number; lng: number };

export type RoleName = "ADMIN" | "DRIVER" | "GUEST";

export interface JwtPayload {
  sub: string;
  role: RoleName;
  driverId?: string;
  guestId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface EtaResult {
  seconds: number;
  meters: number;
  provider: "google" | "mock";
  cached: boolean;
}

export interface RouteStop {
  kind: "PICKUP" | "DROP";
  guestId: string;
  lat: number;
  lng: number;
  label?: string;
  etaSeconds?: number;
}

export interface PlannedRoute {
  stops: RouteStop[];
  totalSeconds: number;
  totalMeters: number;
  computedAt: string;
}

export interface MatchCandidate {
  driverId: string;
  guestId: string;
  etaToPickupSeconds: number;
  freeInSeconds: number;
  cost: number;
  feasible: boolean;
  infeasibleReason?:
    | "CAPACITY_SEATS"
    | "CAPACITY_LUGGAGE"
    | "DEADLINE"
    | "OFFLINE"
    | "ON_BREAK";
}

export interface AssignmentDecision {
  guestIds: string[];
  driverId: string;
  tripType: "ARRIVAL" | "TO_VENUE" | "RETURN" | "DEPARTURE" | "ON_DEMAND";
  etaToPickupSeconds: number;
  reason: "BATCH" | "GREEDY" | "DETOUR" | "ADMIN_OVERRIDE";
}

export interface SimulationReport {
  totalGuests: number;
  assigned: number;
  unassigned: number;
  sharedRides: number;
  detours: number;
  avgWaitSeconds: number;
  maxWaitSeconds: number;
  capacityViolations: number;
  deadlineViolations: number;
}
