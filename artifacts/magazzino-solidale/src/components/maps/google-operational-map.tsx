import { useEffect, useRef, useState } from "react";
import type { MapsMarker } from "@workspace/api-client-react";

type GoogleMapsRuntime = {
  Map: new (element: HTMLElement, options: { center: { lat: number; lng: number }; zoom: number }) => { setCenter(value: { lat: number; lng: number }): void };
  Marker: new (options: { map: unknown; position: { lat: number; lng: number }; title: string }) => { addListener(event: "click", callback: () => void): void };
  Geocoder: new () => { geocode(request: { address: string }): Promise<{ results: Array<{ geometry: { location: { lat(): number; lng(): number } } }> }> };
};

declare global {
  interface Window {
    google?: { maps: GoogleMapsRuntime };
    __mapsLoader?: Promise<GoogleMapsRuntime>;
  }
}

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsRuntime> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__mapsLoader) return window.__mapsLoader;
  window.__mapsLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps non disponibile"));
    script.onload = () => window.google?.maps ? resolve(window.google.maps) : reject(new Error("Google Maps non inizializzato"));
    document.head.appendChild(script);
  });
  return window.__mapsLoader;
}

export function GoogleOperationalMap({ markers, apiKey, onMarkerSelect, onUnavailable }: { markers: MapsMarker[]; apiKey: string; onMarkerSelect: (marker: MapsMarker) => void; onUnavailable?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;
    loadGoogleMaps(apiKey).then(async (maps) => {
      if (cancelled || !containerRef.current) return;
      const map = new maps.Map(containerRef.current, { center: { lat: 41.9028, lng: 12.4964 }, zoom: 6 });
      const geocoder = new maps.Geocoder();
      let firstPosition: { lat: number; lng: number } | null = null;
      // Geocodifica solo i layer attivati e solo durante questa visualizzazione.
      // Nessun risultato viene persistito o inviato al backend.
      for (const marker of markers.slice(0, 100)) {
        if (cancelled) return;
        try {
          const { results } = await geocoder.geocode({ address: marker.address });
          const location = results[0]?.geometry.location;
          if (!location) continue;
          const position = { lat: location.lat(), lng: location.lng() };
          firstPosition ??= position;
          const googleMarker = new maps.Marker({ map, position, title: marker.title });
          googleMarker.addListener("click", () => onMarkerSelect(marker));
        } catch {
          // Un indirizzo non geocodificabile non deve interrompere gli altri layer.
        }
      }
      if (firstPosition) map.setCenter(firstPosition);
    }).catch(() => {
      if (!cancelled) {
        setError(true);
        onUnavailable?.();
      }
    });
    return () => { cancelled = true; };
  }, [apiKey, markers, onMarkerSelect, onUnavailable]);

  if (error) return null;
  return <div ref={containerRef} className="h-[420px] w-full rounded-lg border" aria-label="Mappa operativa Google Maps" />;
}
