

export interface OvDriver {
  id: string;
  vehicleNumber: string;
  seatCapacity: number;
  luggageCapacity: number;
  status: string;
  currentLat: number | null;
  currentLng: number | null;
  lastLocationAt: string | null;
  tripsSinceBreak: number;
  user: { name: string; phone: string | null };
}

export interface OvGuest {
  id: string;
  status: string;
  pickupLat: number | null;
  pickupLng: number | null;
  pickupLabel: string | null;
  dropLabel: string | null;
  flightTrainEta: string | null;
  groupSize: number;
  luggageCount: number;
  priority: boolean;
  deadline: string | null;
  waitingSince: string | null;
  user: { name: string; phone: string | null };
  accommodation: { name: string } | null;
}

export interface OvRequest {
  id: string;
  status: string;
  note: string | null;
  requestedAt: string;
  guest: { id: string; pickupLabel: string | null; groupSize: number; user: { name: string } };
}

export interface OvTrip {
  id: string;
  type: string;
  status: string;
  originLabel: string | null;
  destLabel: string | null;
  etaSeconds: number | null;
  assignedBy: string;
  assignedAt: string;
  driver: { id: string; vehicleNumber: string; user: { name: string } };
  tripGuests: { guest: { id: string; groupSize: number; user: { name: string } } }[];
}

export interface Overview {
  event: { id: string; name: string; status: string } | null;
  drivers: OvDriver[];
  guests: {
    waiting: OvGuest[];
    assigned: OvGuest[];
    inTransit: OvGuest[];
    completed: OvGuest[];
  };
  pendingRequests: OvRequest[];
  activeTrips: OvTrip[];
}

export interface Upcoming {
  upcoming: OvTrip[];
  unmatched: OvGuest[];
}
