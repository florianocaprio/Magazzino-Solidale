import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapsMarker } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export const MAX_MAP_MARKERS = 100;
type LocatedMarker = MapsMarker & { latitude?: number | null; longitude?: number | null; locationStatus?: string };
const DEFAULT_CENTER: L.LatLngExpression = [41.9028, 12.4964];
const LAYER_MARKER: Record<MapsMarker["layer"], string> = {
  "sociale.interventi_pianificati": "I", "pacchi.consegne": "C", "pacchi.ritiri_non_effettuati": "R", "centro.punti_operativi": "P",
};

function icon(marker: MapsMarker) {
  return L.divIcon({ className: "", html: `<span class="maps-leaflet-marker maps-leaflet-marker-${marker.layer.replace(/[^a-z]+/g, "-")}">${LAYER_MARKER[marker.layer]}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
}

export function LeafletOperationalMap({ markers, onMarkerSelect, tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png", tileAttribution = "© OpenStreetMap contributors", onUnavailable }: { markers: LocatedMarker[]; onMarkerSelect: (marker: MapsMarker) => void; tileUrl?: string; tileAttribution?: string; onUnavailable?: () => void }) {
  const { t } = useTranslation(); const containerRef = useRef<HTMLDivElement>(null); const mapRef = useRef<L.Map | null>(null); const [error, setError] = useState(false);
  const selected = markers.slice(0, MAX_MAP_MARKERS);
  const localized = selected.filter((marker) => Number.isFinite(marker.latitude) && Number.isFinite(marker.longitude));
  useEffect(() => {
    if (!containerRef.current) return;
    try {
      mapRef.current?.remove();
      const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, 6); mapRef.current = map;
      L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);
      const bounds: L.LatLngTuple[] = [];
      for (const marker of localized) {
        const point: L.LatLngTuple = [marker.latitude!, marker.longitude!]; bounds.push(point);
        L.marker(point, { icon: icon(marker), title: marker.title }).bindTooltip(`${marker.title} · ${marker.status}`).on("click", () => onMarkerSelect(marker)).addTo(map);
      }
      if (bounds.length === 1) map.setView(bounds[0], 14); else if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
      setError(false);
    } catch { setError(true); onUnavailable?.(); }
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, [localized, onMarkerSelect, onUnavailable, tileAttribution, tileUrl]);
  if (error) return <div className="rounded-md border p-4 text-sm"><p>{t("maps.listFallback")}</p><Button className="mt-3" type="button" variant="outline" onClick={() => setError(false)}>{t("maps.retryMap")}</Button></div>;
  return <div className="space-y-2"><div ref={containerRef} className="h-[420px] w-full rounded-lg border" aria-label="Mappa operativa OpenStreetMap" /><p className="text-xs text-muted-foreground" role="status">{t("maps.geocodingStats", { total: markers.length, attempted: selected.length, localized: localized.length, failed: selected.length - localized.length, notAttempted: markers.length - selected.length })}</p></div>;
}
