import { useEffect, useRef, useState } from "react";
import type { MapsMarker } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type Position = { lat: number; lng: number };
type GoogleMapsRuntime = {
  Map: new (element: HTMLElement, options: { center: Position; zoom: number }) => { setCenter(value: Position): void };
  Marker: new (options: { map: unknown; position: Position; title: string }) => { addListener(event: "click", callback: () => void): void };
  Geocoder: new () => { geocode(request: { address: string }): Promise<{ results: Array<{ geometry: { location: { lat(): number; lng(): number } } }> }> };
};

type GeocodingStats = {
  total: number;
  attempted: number;
  localized: number;
  failed: number;
  notAttempted: number;
};

export const MAX_MAP_MARKERS = 100;
export const GEOCODING_CONCURRENCY = 5;

const geocodeCache = new Map<string, Position>();

declare global {
  interface Window {
    google?: { maps: GoogleMapsRuntime };
    __mapsLoader?: Promise<GoogleMapsRuntime>;
  }
}

export function normalizeMapsAddress(address: string): string {
  return address.trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

export function clearMapsGeocodeCacheForTests(): void {
  geocodeCache.clear();
}

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsRuntime> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__mapsLoader) return window.__mapsLoader;
  const loader = new Promise<GoogleMapsRuntime>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
    script.async = true;
    script.onerror = () => {
      script.remove();
      reject(new Error("Google Maps non disponibile"));
    };
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else {
        script.remove();
        reject(new Error("Google Maps non inizializzato"));
      }
    };
    document.head.appendChild(script);
  });
  window.__mapsLoader = loader.catch((error) => {
    delete window.__mapsLoader;
    throw error;
  });
  return window.__mapsLoader;
}

async function runBounded<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(GEOCODING_CONCURRENCY, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(workers);
}

export function GoogleOperationalMap({ markers, apiKey, onMarkerSelect, onUnavailable }: { markers: MapsMarker[]; apiKey: string; onMarkerSelect: (marker: MapsMarker) => void; onUnavailable?: () => void }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [stats, setStats] = useState<GeocodingStats>({
    total: markers.length,
    attempted: 0,
    localized: 0,
    failed: 0,
    notAttempted: Math.max(0, markers.length - MAX_MAP_MARKERS),
  });

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;
    setError(false);
    const selected = markers.slice(0, MAX_MAP_MARKERS);
    setStats({
      total: markers.length,
      attempted: selected.length,
      localized: 0,
      failed: 0,
      notAttempted: markers.length - selected.length,
    });
    loadGoogleMaps(apiKey).then(async (maps) => {
      if (cancelled || !containerRef.current) return;
      const map = new maps.Map(containerRef.current, { center: { lat: 41.9028, lng: 12.4964 }, zoom: 6 });
      const geocoder = new maps.Geocoder();
      const grouped = new Map<string, MapsMarker[]>();
      for (const marker of selected) {
        const key = normalizeMapsAddress(marker.address);
        const current = grouped.get(key) ?? [];
        current.push(marker);
        grouped.set(key, current);
      }
      const resolved = new Map<string, Position | null>();
      await runBounded([...grouped.entries()], async ([key, groupedMarkers]) => {
        const cached = geocodeCache.get(key);
        if (cached) {
          resolved.set(key, cached);
          return;
        }
        try {
          const { results } = await geocoder.geocode({ address: groupedMarkers[0].address });
          const location = results[0]?.geometry.location;
          if (!location) {
            resolved.set(key, null);
            return;
          }
          const position = { lat: location.lat(), lng: location.lng() };
          geocodeCache.set(key, position);
          resolved.set(key, position);
        } catch {
          resolved.set(key, null);
        }
      });
      if (cancelled) return;
      let firstPosition: Position | null = null;
      let localized = 0;
      for (const [key, groupedMarkers] of grouped) {
        const position = resolved.get(key);
        if (!position) continue;
        firstPosition ??= position;
        localized += groupedMarkers.length;
        for (const marker of groupedMarkers) {
          const googleMarker = new maps.Marker({ map, position, title: marker.title });
          googleMarker.addListener("click", () => onMarkerSelect(marker));
        }
      }
      if (firstPosition) map.setCenter(firstPosition);
      setStats({
        total: markers.length,
        attempted: selected.length,
        localized,
        failed: selected.length - localized,
        notAttempted: markers.length - selected.length,
      });
    }).catch(() => {
      if (!cancelled) {
        setError(true);
        onUnavailable?.();
      }
    });
    return () => { cancelled = true; };
  }, [apiKey, markers, onMarkerSelect, onUnavailable, retryToken]);

  return (
    <div className="space-y-2">
      {markers.length > MAX_MAP_MARKERS && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          {t("maps.markerLimitWarning", { total: markers.length, limit: MAX_MAP_MARKERS, notAttempted: markers.length - MAX_MAP_MARKERS })}
        </div>
      )}
      {error ? (
        <div className="rounded-md border p-4 text-sm">
          <p>{t("maps.listFallback")}</p>
          <Button className="mt-3" type="button" variant="outline" onClick={() => {
            setError(false);
            setRetryToken((value) => value + 1);
          }}>
            {t("maps.retryMap")}
          </Button>
        </div>
      ) : (
        <div ref={containerRef} className="h-[420px] w-full rounded-lg border" aria-label="Mappa operativa Google Maps" />
      )}
      <p className="text-xs text-muted-foreground" role="status">
        {t("maps.geocodingStats", stats)}
      </p>
    </div>
  );
}
