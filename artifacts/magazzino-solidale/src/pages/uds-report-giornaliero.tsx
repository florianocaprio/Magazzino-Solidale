import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  useReportUdsInterventiGiornalieri,
  useListCitta,
  useListZoneUds,
  getReportUdsInterventiGiornalieriQueryKey,
  getListZoneUdsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock, FileDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { exportUdsReportGiornalieroPdf } from "@/lib/uds-report-pdf";

const ALL = "all";
type Mode = "day" | "range";

export default function UdsReportGiornaliero() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isGlobalCitta = (user?.cittaId ?? null) == null;
  const lockedZonaId = user?.zonaUdsId ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<Mode>("day");
  const [da, setDa] = useState(today);
  const [a, setA] = useState(today);
  const [cittaId, setCittaId] = useState<string>(ALL);
  const [zonaId, setZonaId] = useState<string>(lockedZonaId != null ? String(lockedZonaId) : ALL);

  useEffect(() => {
    if (lockedZonaId != null) setZonaId(String(lockedZonaId));
  }, [lockedZonaId]);

  const { data: citta } = useListCitta();
  const cittaParam = cittaId === ALL ? undefined : parseInt(cittaId);

  const zoneParams = isGlobalCitta && cittaParam ? { cittaId: cittaParam } : undefined;
  const { data: zone } = useListZoneUds(zoneParams, {
    query: { queryKey: getListZoneUdsQueryKey(zoneParams) },
  });
  const zonaParam = zonaId === ALL ? undefined : parseInt(zonaId);

  const effectiveA = mode === "range" ? a : undefined;
  const params = { da, a: effectiveA, cittaId: cittaParam, zonaUdsId: zonaParam };
  const { data: rows, isLoading } = useReportUdsInterventiGiornalieri(params, {
    query: { queryKey: getReportUdsInterventiGiornalieriQueryKey(params), enabled: !!da },
  });

  const tipoLabel = (tipo: string) => t(`udsReportGiornaliero.tipo_${tipo}`, { defaultValue: tipo });
  const personaLabel = (r: { beneficiarioNome?: string | null; soprannome?: string | null }) => {
    if (!r.beneficiarioNome) return r.soprannome ?? "—";
    return r.soprannome ? `${r.beneficiarioNome} (${r.soprannome})` : r.beneficiarioNome;
  };
  const noteOf = (r: { note?: string | null; noteUds?: string | null; descrizione?: string | null }) =>
    [r.descrizione, r.note, r.noteUds].filter(Boolean).join(" · ");

  const list = rows ?? [];
  const selectedCittaNome = isGlobalCitta
    ? (citta ?? []).find((c) => c.id === cittaParam)?.nome
    : (user?.cittaNome ?? undefined);
  const selectedZonaNome = (zone ?? []).find((z) => z.id === zonaParam)?.nome;

  const periodoLabel = mode === "range" ? `${formatIt(da)} – ${formatIt(a)}` : formatIt(da);

  const handleExportPdf = () => {
    void exportUdsReportGiornalieroPdf({
      filename: `uds_report_${mode === "range" ? `${da}_${a}` : da}`,
      title: t("udsReportGiornaliero.pdfTitle"),
      meta: {
        date: mode === "day" ? formatIt(da) : undefined,
        period: mode === "range" ? `${formatIt(da)} – ${formatIt(a)}` : undefined,
        city: selectedCittaNome,
        zone: selectedZonaNome,
      },
      labels: {
        colN: t("udsReportGiornaliero.colN"),
        colData: t("udsReportGiornaliero.colData"),
        colPersona: t("udsReportGiornaliero.colPersona"),
        colZona: t("udsReportGiornaliero.colZona"),
        colTipo: t("udsReportGiornaliero.colTipo"),
        colNote: t("udsReportGiornaliero.colNote"),
        colOperatore: t("udsReportGiornaliero.colOperatore"),
        legend: t("udsReportGiornaliero.legend"),
        metaDate: t("udsReportGiornaliero.pdfMetaDate"),
        metaPeriod: t("udsReportGiornaliero.pdfMetaPeriod"),
        metaCity: t("udsReportGiornaliero.pdfMetaCity"),
        metaZone: t("udsReportGiornaliero.pdfMetaZone"),
      },
      rows: list.map((r) => ({
        numeroIntervento: r.numeroIntervento,
        primoIntervento: r.primoIntervento,
        data: formatIt(r.dataIntervento),
        persona: personaLabel(r),
        zona: r.zonaNome ?? "—",
        tipo: tipoLabel(r.tipoIntervento),
        note: noteOf(r),
        operatore: r.operatoreCodice ?? "—",
      })),
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("udsReportGiornaliero.title")}</h1>
        <p className="text-muted-foreground">{t("udsReportGiornaliero.subtitle")}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col md:flex-row md:items-end gap-4 pt-6 flex-wrap">
          <div className="space-y-1.5">
            <Label className="text-xs">&nbsp;</Label>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as Mode)}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="day">{t("udsReportGiornaliero.modeDay")}</ToggleGroupItem>
              <ToggleGroupItem value="range">{t("udsReportGiornaliero.modeRange")}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {mode === "day" ? (
            <div className="space-y-1.5">
              <Label htmlFor="da" className="text-xs">{t("udsReportGiornaliero.date")}</Label>
              <Input
                id="da"
                type="date"
                value={da}
                max={today}
                onChange={(e) => setDa(e.target.value)}
                className="w-44"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="da" className="text-xs">{t("udsReportGiornaliero.from")}</Label>
                <Input
                  id="da"
                  type="date"
                  value={da}
                  max={a}
                  onChange={(e) => setDa(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a" className="text-xs">{t("udsReportGiornaliero.to")}</Label>
                <Input
                  id="a"
                  type="date"
                  value={a}
                  min={da}
                  max={today}
                  onChange={(e) => setA(e.target.value)}
                  className="w-40"
                />
              </div>
            </div>
          )}

          {isGlobalCitta && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("udsReportGiornaliero.city")}</Label>
              <Select
                value={cittaId}
                onValueChange={(v) => {
                  setCittaId(v);
                  setZonaId(ALL);
                }}
              >
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("udsReportGiornaliero.allCities")}</SelectItem>
                  {(citta ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("udsReportGiornaliero.zone")}</Label>
            <Select value={zonaId} onValueChange={setZonaId} disabled={lockedZonaId != null}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("udsReportGiornaliero.allZones")}</SelectItem>
                {(zone ?? []).map((z) => (
                  <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:ml-auto">
            <Button onClick={handleExportPdf} disabled={list.length === 0} variant="outline">
              <FileDown className="w-4 h-4 mr-2" />
              {t("udsReportGiornaliero.exportPdf")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" /> {periodoLabel}
          </CardTitle>
          <CardDescription>
            {t("udsReportGiornaliero.countLabel", { count: list.length })} · {t("udsReportGiornaliero.legend")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg">
              {t("udsReportGiornaliero.empty")}
            </p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14 text-center">{t("udsReportGiornaliero.colN")}</TableHead>
                    {mode === "range" && <TableHead className="w-28">{t("udsReportGiornaliero.colData")}</TableHead>}
                    <TableHead>{t("udsReportGiornaliero.colPersona")}</TableHead>
                    <TableHead>{t("udsReportGiornaliero.colZona")}</TableHead>
                    <TableHead>{t("udsReportGiornaliero.colTipo")}</TableHead>
                    <TableHead>{t("udsReportGiornaliero.colNote")}</TableHead>
                    <TableHead>{t("udsReportGiornaliero.colOperatore")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-center font-bold">
                        <span
                          className={r.primoIntervento ? "text-red-600" : undefined}
                          title={r.primoIntervento ? t("udsReportGiornaliero.primoTooltip") : undefined}
                        >
                          {r.numeroIntervento}
                        </span>
                      </TableCell>
                      {mode === "range" && <TableCell>{formatIt(r.dataIntervento)}</TableCell>}
                      <TableCell className="font-medium">{personaLabel(r)}</TableCell>
                      <TableCell>{r.zonaNome ?? "—"}</TableCell>
                      <TableCell>{tipoLabel(r.tipoIntervento)}</TableCell>
                      <TableCell className="max-w-md whitespace-pre-wrap">{noteOf(r) || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{r.operatoreCodice ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatIt(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
