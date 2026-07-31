"use client";

/**
 * Search-first location input: type a place name, pick from a dropdown.
 * Known event places (venue ✦ hotels ✦ airport/station) rank first,
 * then map search results. No coordinates ever shown to the user.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

export interface PickedLocation {
  label: string;
  lat: number;
  lng: number;
}

interface Hit extends PickedLocation {
  kind: string;
}

const KIND_ICON: Record<string, string> = {
  VENUE: "🎪",
  AIRPORT: "✈️",
  STATION: "🚉",
  HOTEL: "🏨",
  SEARCH: "📍",
};

export function LocationPicker({
  value,
  onChange,
  placeholder,
  required,
}: {
  value: PickedLocation | null;
  onChange: (v: PickedLocation | null) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [q, setQ] = useState(value?.label ?? "");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside tap.
  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, []);

  function handleInput(text: string) {
    setQ(text);
    onChange(null); // typing invalidates the previous pick
    if (debounce.current) clearTimeout(debounce.current);
    if (text.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      const res = await api<Hit[]>(`/locations/search?q=${encodeURIComponent(text)}`);
      setSearching(false);
      if (res.ok && Array.isArray(res.data)) {
        setHits(res.data);
        setOpen(true);
      }
    }, 350);
  }

  function pick(h: Hit) {
    onChange({ label: h.label, lat: h.lat, lng: h.lng });
    setQ(h.label);
    setOpen(false);
  }

  const [locating, setLocating] = useState(false);

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        // Reverse-geocode so ops sees a readable place name, not numbers.
        const res = await api<{ label: string }>(`/locations/reverse?lat=${lat}&lng=${lng}`);
        const label = res.ok && res.data?.label ? res.data.label : "Current location";
        onChange({ label, lat, lng });
        setQ(label);
        setOpen(false);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2">
        <input
          className={`input ${value ? "border-emerald-400 dark:border-emerald-600" : ""}`}
          placeholder={placeholder ?? "Search a place…"}
          value={q}
          required={required}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          title="Use my current location"
          className="shrink-0 rounded-lg border border-edge bg-card px-3 font-medium disabled:opacity-50"
        >
          {locating ? "…" : "📍"}
        </button>
      </div>
      {value && (
        <span className="pointer-events-none absolute right-14 top-1/2 -translate-y-1/2 text-emerald-500">✓</span>
      )}
      {searching && !value && (
        <span className="pointer-events-none absolute right-14 top-1/2 -translate-y-1/2 animate-pulse text-soft">…</span>
      )}
      {open && hits.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-edge bg-card shadow-lg">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => pick(h)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-surface"
              >
                <span>{KIND_ICON[h.kind] ?? "📍"}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{h.label}</span>
                  {h.kind !== "SEARCH" && (
                    <span className="text-xs text-soft">Event location</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && hits.length === 0 && !searching && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-edge bg-card px-3 py-2.5 text-sm text-soft shadow-lg">
          No places found — try a different name.
        </div>
      )}
    </div>
  );
}
