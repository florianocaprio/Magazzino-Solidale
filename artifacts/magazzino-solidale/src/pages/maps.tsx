import { useCallback, useMemo, useState } from "react";
import {
  getMapsRouteConsegna,
  getGetMapsConsegneQueryKey,
  getGetMapsInterventiSocialiQueryKey,
  getGetMapsPuntiOperativiQueryKey,
  getGetMapsRitiriNonEffettuatiQueryKey,
  useGetMapsCapabilities,
  useGetMapsConsegne,
  useGetMapsInterventiSociali,
  useGetMapsPuntiOperativi,
  useGetMapsRitiriNonEffettuati,
  type MapsLayerCode,
  type MapsMarker,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Map, MapPin, Navigation, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { GoogleOperationalMap } from "@/components/maps/google-operational-map";

const LAYER_LABELS: Record<MapsLayerCode, string> = {
  "sociale.interventi_pianificati": "maps.layerSocialInterventions",
  "pacchi.consegne": "maps.layerDeliveries",
  "pacchi.ritiri_non_effettuati": "maps.layerMissedPickups",
  "centro.punti_operativi": "maps.layerOperationalPoints",
};

function todayRome(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function entityUrl(marker: MapsMarker): string | null {
  if (marker.entityType === "intervento") return "/interventi";
  if (marker.entityType === "consegna") return "/consegne";
  if (marker.entityType === "bolla") return "/bolle";
  if (marker.entityType === "magazzino") return "/magazzini";
  if (marker.entityType === "centro_ascolto") return "/centri-ascolto";
  return null;
}

export default function MapsOperativa() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const today = useMemo(todayRome, []);
  const [da, setDa] = useState(today);
  const [a, setA] = useState(addDays(today, 7));
  const { data: capabilities, isLoading: loadingCapabilities } = useGetMapsCapabilities();
  const available = capabilities?.layers ?? [];
  const [disabled, setDisabled] = useState<Set<MapsLayerCode>>(new Set());
  const [selectedMarker, setSelectedMarker] = useState<MapsMarker | null>(null);
  const enabled = (code: MapsLayerCode) => available.some((layer) => layer.code === code) && !disabled.has(code);
  const range = { da, a };
  const social = useGetMapsInterventiSociali(range, { query: { queryKey: getGetMapsInterventiSocialiQueryKey(range), enabled: enabled("sociale.interventi_pianificati") } });
  const deliveries = useGetMapsConsegne(range, { query: { queryKey: getGetMapsConsegneQueryKey(range), enabled: enabled("pacchi.consegne") } });
  const missed = useGetMapsRitiriNonEffettuati(range, { query: { queryKey: getGetMapsRitiriNonEffettuatiQueryKey(range), enabled: enabled("pacchi.ritiri_non_effettuati") } });
  const points = useGetMapsPuntiOperativi({ query: { queryKey: getGetMapsPuntiOperativiQueryKey(), enabled: enabled("centro.punti_operativi") } });
  const markers = useMemo(
    () => [social.data, deliveries.data, missed.data, points.data].flatMap((rows) => rows ?? []),
    [social.data, deliveries.data, missed.data, points.data],
  );
  const isLoading = social.isLoading || deliveries.isLoading || missed.isLoading || points.isLoading;
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? "";

  const toggle = (code: MapsLayerCode) => setDisabled((current) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  const openRoute = async (marker: MapsMarker) => {
    try {
      const route = await getMapsRouteConsegna(marker.entityId);
      window.open(route.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      const description = (error as { data?: { error?: string } })?.data?.error ?? t("maps.routeUnavailable");
      toast({ title: t("maps.routeError"), description, variant: "destructive" });
    }
  };
  const onMapUnavailable = useCallback(
    () => toast({ title: t("maps.googleUnavailable"), description: t("maps.listFallback") }),
    [t, toast],
  );

  if (loadingCapabilities) return <div className="p-6 space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!capabilities?.operational || available.length === 0) {
    return <div className="p-6"><Card><CardContent className="py-10 text-center text-muted-foreground">{t("maps.noLayers")}</CardContent></Card></div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><Map className="h-7 w-7" /> {t("maps.title")}</h1>
        <p className="text-muted-foreground">{t("maps.subtitle")}</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("maps.filters")}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-1"><Label htmlFor="maps-da">{t("maps.from")}</Label><Input id="maps-da" type="date" value={da} onChange={(event) => setDa(event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="maps-a">{t("maps.to")}</Label><Input id="maps-a" type="date" value={a} onChange={(event) => setA(event.target.value)} /></div>
          <div className="flex flex-1 flex-wrap items-end gap-4">
            {available.map((layer) => <Label key={layer.code} className="flex items-center gap-2 rounded-md border px-3 py-2"><Switch checked={enabled(layer.code)} onCheckedChange={() => toggle(layer.code)} />{t(LAYER_LABELS[layer.code])}</Label>)}
          </div>
        </CardContent>
      </Card>
      {apiKey ? (
        <GoogleOperationalMap markers={markers} apiKey={apiKey} onMarkerSelect={setSelectedMarker} onUnavailable={onMapUnavailable} />
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("maps.noApiKey")}</div>
      )}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4" />{t("maps.operationalList")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? <Skeleton className="h-24 w-full" /> : markers.length === 0 ? <p className="py-8 text-center text-muted-foreground">{t("maps.empty")}</p> : markers.map((marker) => (
            <div key={marker.id} className="flex flex-col justify-between gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{marker.title}</p><Badge variant="outline">{marker.status}</Badge></div><p className="truncate text-sm text-muted-foreground">{marker.address}</p>{marker.date && <p className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3 w-3" />{new Date(marker.date).toLocaleString()}</p>}</div>
              <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedMarker(marker)}>{t("maps.markerDetails")}</Button>{marker.actions.includes("route") && <Button size="sm" className="gap-1" onClick={() => openRoute(marker)}><Navigation className="h-4 w-4" />{t("maps.openRoute")}</Button>}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Sheet open={selectedMarker != null} onOpenChange={(open) => { if (!open) setSelectedMarker(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selectedMarker && <>
            <SheetHeader>
              <SheetTitle>{selectedMarker.title}</SheetTitle>
              <SheetDescription>{selectedMarker.subtitle ?? t(LAYER_LABELS[selectedMarker.layer])}</SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <div><p className="text-xs uppercase text-muted-foreground">{t("maps.status")}</p><Badge variant="outline">{selectedMarker.status}</Badge></div>
              {selectedMarker.date && <div><p className="text-xs uppercase text-muted-foreground">{t("maps.date")}</p><p className="text-sm">{new Date(selectedMarker.date).toLocaleString()}</p></div>}
              <div><p className="text-xs uppercase text-muted-foreground">{t("maps.address")}</p><p className="text-sm">{selectedMarker.address}</p></div>
              <div className="flex flex-col gap-2 pt-2">
                {entityUrl(selectedMarker) && <Button asChild variant="outline"><Link href={selectedMarker.entityType === "bolla" ? `/bolle?bollaId=${selectedMarker.entityId}` : entityUrl(selectedMarker)!}>{t("maps.openOwner")}</Link></Button>}
                {selectedMarker.actions.includes("route") && <Button className="gap-2" onClick={() => openRoute(selectedMarker)}><Navigation className="h-4 w-4" />{t("maps.openRoute")}</Button>}
                {selectedMarker.actions.includes("convert_delivery") && <Button asChild><Link href={`/bolle?bollaId=${selectedMarker.entityId}`}>{t("maps.convertDelivery")}</Link></Button>}
              </div>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
