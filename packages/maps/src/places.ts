
export interface KnownPlace {
  label: string;
  lat: number;
  lng: number;
}

export const KOLHAPUR_PLACES: KnownPlace[] = [
  { label: "Kolhapur Airport (Ujalaiwadi)", lat: 16.6647, lng: 74.2894 },
  { label: "Kolhapur Railway Station (CSMT)", lat: 16.7089, lng: 74.2293 },
  { label: "Kolhapur Central Bus Stand (CBS)", lat: 16.7047, lng: 74.2401 },
  { label: "Sayaji Hotel Kolhapur", lat: 16.7093, lng: 74.2349 },
  { label: "Mahalaxmi Temple (Ambabai), Kolhapur", lat: 16.6949, lng: 74.2312 },
  { label: "Rankala Lake, Kolhapur", lat: 16.6912, lng: 74.2189 },
  { label: "New Palace (Shahu Museum), Kolhapur", lat: 16.7172, lng: 74.2372 },
  { label: "Shivaji University, Kolhapur", lat: 16.6789, lng: 74.2540 },
  { label: "Rajarampuri, Kolhapur", lat: 16.7008, lng: 74.2445 },
  { label: "Tarabai Park, Kolhapur", lat: 16.7139, lng: 74.2320 },
  { label: "Dabholkar Corner, Kolhapur", lat: 16.7024, lng: 74.2312 },
  { label: "Bindu Chowk, Kolhapur", lat: 16.6966, lng: 74.2295 },
  { label: "Laxmipuri, Kolhapur", lat: 16.7010, lng: 74.2360 },
  { label: "Shahupuri, Kolhapur", lat: 16.7052, lng: 74.2287 },
  { label: "CPR Hospital, Kolhapur", lat: 16.7041, lng: 74.2261 },
  { label: "Kasba Bawada, Kolhapur", lat: 16.7205, lng: 74.2540 },
  { label: "Nagala Park, Kolhapur", lat: 16.7118, lng: 74.2426 },
  { label: "Ruikar Colony, Kolhapur", lat: 16.6893, lng: 74.2380 },
];

export function searchKnownPlaces(query: string): KnownPlace[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return KOLHAPUR_PLACES.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 8);
}
