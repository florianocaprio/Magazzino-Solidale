import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapsMarker } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  reportInvalidMapsTileUrl,
  resolveMapsTileAttribution,
  resolveMapsTileUrl,
} from "@/lib/maps-runtime-config";

export const MAX_MAP_MARKERS = 100;

type LocatedMarker = MapsMarker & {
  latitude?: number | null;
  longitude?: number | null;
  locationStatus?: string;
};

type TileLoadState = "loading" | "available" | "error";

type LeafletOperationalMapProps = {
  markers: LocatedMarker[];
  selectedMarkerId?: string | null;
  onMarkerSelect: (marker: MapsMarker) => void;
  tileUrl?: string;
  tileAttribution?: string;
  onUnavailable?: () => void;
};

const DEFAULT_CENTER: L.LatLngExpression = [41.9028, 12.4964];
const TILE_ERROR_THRESHOLD = 3;
const TILE_LOAD_TIMEOUT_MS = 8_000;
const LAYER_MARKER: Record<MapsMarker["layer"], string> = {
  "sociale.interventi_pianificati": "I",
  "pacchi.consegne": "C",
  "pacchi.ritiri_non_effettuati": "R",
  "centro.punti_operativi": "P",
};

function icon(marker: MapsMarker): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span class="maps-leaflet-marker maps-leaflet-marker-${marker.layer.replace(/[^a-z]+/g, "-")}">${LAYER_MARKER[marker.layer]}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

export function LeafletOperationalMap({
  markers,
  selectedMarkerId,
  onMarkerSelect,
  tileUrl,
  tileAttribution,
  onUnavailable,
}: LeafletOperationalMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef(new Map<string, L.Marker>());
  const onUnavailableRef = useRef(onUnavailable);
  const [mapGeneration, setMapGeneration] = useState(0);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapInitializationError, setMapInitializationError] = useState(false);
  const [tileAttempt, setTileAttempt] = useState(0);
  const [tileState, setTileState] = useState<TileLoadState>("loading");

  const selected = useMemo(() => markers.slice(0, MAX_MAP_MARKERS), [markers]);
  const localized = useMemo(
    () =>
      selected.filter(
        (marker) =>
          Number.isFinite(marker.latitude) && Number.isFinite(marker.longitude),
      ),
    [selected],
  );
  const resolvedTileUrl = useMemo(() => resolveMapsTileUrl(tileUrl), [tileUrl]);
  const resolvedAttribution = useMemo(
    () => resolveMapsTileAttribution(tileAttribution),
    [tileAttribution],
  );

  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    reportInvalidMapsTileUrl(tileUrl);
  }, [tileUrl]);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        touchZoom: true,
        dragging: true,
      }).setView(DEFAULT_CENTER, 6, { animate: false });
      const markerLayer = L.layerGroup().addTo(map);
      mapRef.current = map;
      markerLayerRef.current = markerLayer;
      setMapInitializationError(false);
      setMapGeneration((generation) => generation + 1);
    } catch (error) {
      console.warn("Inizializzazione mappa MAPS non riuscita.", {
        reason: error instanceof Error ? error.name : "unknown",
      });
      setMapInitializationError(true);
      onUnavailableRef.current?.();
    }

    return () => {
      markerRefs.current.clear();
      markerLayerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mapAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || mapGeneration === 0) return;

    let animationFrame = 0;
    const invalidateSize = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false, pan: false });
      });
    };
    const initialTimer = window.setTimeout(invalidateSize, 0);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(invalidateSize);

    observer?.observe(container);
    window.addEventListener("resize", invalidateSize);

    return () => {
      window.clearTimeout(initialTimer);
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", invalidateSize);
    };
  }, [mapGeneration]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapGeneration === 0) return;

    let loaded = false;
    let reported = false;
    let errorCount = 0;
    let successfulTileCount = 0;
    let timeout = 0;

    const clearLoadTimeout = () => window.clearTimeout(timeout);
    const markUnavailable = (reason: "timeout" | "tile-errors") => {
      if ((reason === "timeout" && loaded) || reported) return;
      reported = true;
      clearLoadTimeout();
      setTileState("error");
      console.warn("Cartografia MAPS non disponibile.", { reason });
      onUnavailableRef.current?.();
    };
    const scheduleLoadTimeout = () => {
      clearLoadTimeout();
      timeout = window.setTimeout(
        () => markUnavailable("timeout"),
        TILE_LOAD_TIMEOUT_MS,
      );
    };
    const markAvailable = () => {
      loaded = true;
      clearLoadTimeout();
      setTileState("available");
    };
    const handlers: L.LeafletEventHandlerFnMap = {
      loading: () => {
        loaded = false;
        errorCount = 0;
        successfulTileCount = 0;
        setTileState("loading");
        scheduleLoadTimeout();
      },
      tileload: () => {
        successfulTileCount += 1;
        markAvailable();
      },
      load: () => {
        if (successfulTileCount > 0) markAvailable();
        else if (errorCount > 0) markUnavailable("tile-errors");
      },
      tileerror: () => {
        errorCount += 1;
        if (errorCount >= TILE_ERROR_THRESHOLD) markUnavailable("tile-errors");
      },
    };

    setTileState("loading");
    const tileLayer = L.tileLayer(resolvedTileUrl, {
      attribution: resolvedAttribution,
      maxZoom: 19,
    });
    tileLayer.on(handlers);
    tileLayer.addTo(map);
    scheduleLoadTimeout();

    return () => {
      clearLoadTimeout();
      tileLayer.off(handlers);
      tileLayer.remove();
    };
  }, [mapGeneration, resolvedAttribution, resolvedTileUrl, tileAttempt]);

  useEffect(() => {
    const markerLayer = markerLayerRef.current;
    if (!markerLayer || mapGeneration === 0) return;

    markerLayer.clearLayers();
    markerRefs.current.clear();
    const listeners: Array<{ marker: L.Marker; select: () => void }> = [];

    for (const marker of localized) {
      const point: L.LatLngTuple = [marker.latitude!, marker.longitude!];
      const select = () => onMarkerSelect(marker);
      const leafletMarker = L.marker(point, {
        icon: icon(marker),
        title: marker.title,
      })
        .bindTooltip(`${marker.title} · ${marker.status}`)
        .on("click", select)
        .addTo(markerLayer);
      markerRefs.current.set(marker.id, leafletMarker);
      listeners.push({ marker: leafletMarker, select });
    }

    return () => {
      for (const listener of listeners) {
        listener.marker.off("click", listener.select);
      }
      markerLayer.clearLayers();
      markerRefs.current.clear();
    };
  }, [localized, mapGeneration, onMarkerSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapGeneration === 0) return;

    const selectedMarker = localized.find(
      (marker) => marker.id === selectedMarkerId,
    );
    if (selectedMarker) {
      const point: L.LatLngTuple = [
        selectedMarker.latitude!,
        selectedMarker.longitude!,
      ];
      map.setView(point, 16, { animate: false });
      markerRefs.current.get(selectedMarker.id)?.openTooltip();
      return;
    }

    const bounds = localized.map(
      (marker): L.LatLngTuple => [marker.latitude!, marker.longitude!],
    );
    if (bounds.length === 1) {
      map.setView(bounds[0], 14, { animate: false });
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14, animate: false });
    }
  }, [localized, mapGeneration, selectedMarkerId]);

  if (mapInitializationError) {
    return (
      <div className="rounded-md border p-4 text-sm" role="alert">
        <p>{t("maps.mapUnavailable")}</p>
        <p className="mt-1 text-muted-foreground">{t("maps.listFallback")}</p>
        <Button
          className="mt-3 min-h-11"
          type="button"
          variant="outline"
          onClick={() => {
            setMapInitializationError(false);
            setMapAttempt((attempt) => attempt + 1);
          }}
        >
          {t("maps.retryMap")}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="relative isolate min-w-0 overflow-hidden rounded-lg border">
        <div
          ref={containerRef}
          className="h-[380px] w-full min-w-0 sm:h-[420px]"
          aria-label="Mappa operativa OpenStreetMap"
          data-tile-state={tileState}
        />
        {tileState === "error" && (
          <div
            className="absolute inset-x-3 top-3 z-[1000] rounded-md border border-amber-300 bg-background/95 p-3 text-sm shadow-md"
            data-testid="maps-tile-error"
            role="alert"
          >
            <p className="font-medium">{t("maps.cartographyUnavailable")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("maps.listFallback")}
            </p>
            <Button
              className="mt-3 min-h-11"
              type="button"
              variant="outline"
              onClick={() => setTileAttempt((attempt) => attempt + 1)}
            >
              {t("maps.retryCartography")}
            </Button>
          </div>
        )}
      </div>
      {tileState === "available" && (
        <span className="sr-only" role="status">
          {t("maps.cartographyAvailable")}
        </span>
      )}
      <p className="text-xs text-muted-foreground" role="status">
        {t("maps.geocodingStats", {
          total: markers.length,
          attempted: selected.length,
          localized: localized.length,
          failed: selected.length - localized.length,
          notAttempted: markers.length - selected.length,
        })}
      </p>
    </div>
  );
}
