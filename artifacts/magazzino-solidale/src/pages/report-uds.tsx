import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  useReportUdsInterventiPerMese,
  useReportUdsInterventiPerTipo,
  useReportUdsInterventiPerZona,
  useReportUdsPersonePerZona,
  useListCitta,
  useListZoneUds,
  getReportUdsInterventiPerMeseQueryKey,
  getReportUdsInterventiPerTipoQueryKey,
  getReportUdsInterventiPerZonaQueryKey,
  getReportUdsPersonePerZonaQueryKey,
  getListZoneUdsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, LineChart, Line } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/export-buttons";
import { CalendarRange, ListChecks, Map as MapIcon, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

const ALL = "all";

export default function ReportUds() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isGlobalCitta = (user?.cittaId ?? null) == null;
  const lockedZonaId = user?.zonaUdsId ?? null;

  const currentYear = new Date().getFullYear();
  const [da, setDa] = useState(`${currentYear}-01-01`);
  const [a, setA] = useState(new Date().toISOString().slice(0, 10));
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

  const baseParams = { da, a, cittaId: cittaParam, zonaUdsId: zonaParam };
  const zonaScopeParams = { da, a, cittaId: cittaParam };
  const personeParams = { cittaId: cittaParam };

  const { data: perMese, isLoading: loadingMese } = useReportUdsInterventiPerMese(baseParams, {
    query: { queryKey: getReportUdsInterventiPerMeseQueryKey(baseParams) },
  });
  const { data: perTipo, isLoading: loadingTipo } = useReportUdsInterventiPerTipo(baseParams, {
    query: { queryKey: getReportUdsInterventiPerTipoQueryKey(baseParams) },
  });
  const { data: perZona, isLoading: loadingZona } = useReportUdsInterventiPerZona(zonaScopeParams, {
    query: { queryKey: getReportUdsInterventiPerZonaQueryKey(zonaScopeParams) },
  });
  const { data: persone, isLoading: loadingPersone } = useReportUdsPersonePerZona(personeParams, {
    query: { queryKey: getReportUdsPersonePerZonaQueryKey(personeParams) },
  });

  const periodoLabel = `${formatIt(da)} – ${formatIt(a)}`;
  const tipoLabel = (tipo: string) => t(`reportUds.tipo_${tipo}`, { defaultValue: tipo });
  const tipoRows = (perTipo ?? []).map((r) => ({ ...r, tipoLabel: tipoLabel(r.tipo) }));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("reportUds.title")}</h1>
        <p className="text-muted-foreground">{t("reportUds.subtitle")}</p>
      </div>

      {/* Filtri globali */}
      <Card>
        <CardContent className="flex flex-col md:flex-row md:items-end gap-4 pt-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="da" className="text-xs">{t("reportUds.from")}</Label>
              <Input id="da" type="date" value={da} max={a} onChange={(e) => setDa(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a" className="text-xs">{t("reportUds.to")}</Label>
              <Input id="a" type="date" value={a} min={da} onChange={(e) => setA(e.target.value)} className="w-40" />
            </div>
          </div>
          {isGlobalCitta && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("reportUds.city")}</Label>
              <Select
                value={cittaId}
                onValueChange={(v) => {
                  setCittaId(v);
                  setZonaId(ALL);
                }}
              >
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("reportUds.allCities")}</SelectItem>
                  {(citta ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!isGlobalCitta || cittaParam != null ? (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("reportUds.zone")}</Label>
              <Select value={zonaId} onValueChange={setZonaId} disabled={lockedZonaId != null}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("reportUds.allZones")}</SelectItem>
                  {(zone ?? []).map((z) => (
                    <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("reportUds.zone")}</Label>
              <Select disabled>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder={t("reportUds.selectCityFirst")} />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Interventi per mese */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-primary" /> {t("reportUds.meseTitle")}
            </CardTitle>
            <CardDescription>{t("reportUds.meseDesc", { periodo: periodoLabel })}</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingMese ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (perMese?.length ?? 0) === 0 ? (
              <EmptyChart label={t("reportUds.empty")} />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={perMese} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mese" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                    <RechartsTooltip />
                    <Line type="monotone" dataKey="totInterventi" name={t("reportUds.meseName")} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Interventi per tipo */}
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-primary" /> {t("reportUds.tipoTitle")}
              </CardTitle>
              <CardDescription>{t("reportUds.tipoDesc", { periodo: periodoLabel })}</CardDescription>
            </div>
            <ExportButtons
              rows={tipoRows}
              columns={[
                { header: t("reportUds.tipoCol"), accessor: (r) => r.tipoLabel },
                { header: t("reportUds.countCol"), accessor: (r) => r.totInterventi },
              ]}
              filename={`uds_interventi_per_tipo_${da}_${a}`}
              title={t("reportUds.tipoTitle")}
              subtitle={t("reportUds.periodoSubtitle", { periodo: periodoLabel })}
            />
          </CardHeader>
          <CardContent>
            {loadingTipo ? (
              <Skeleton className="h-[300px] w-full" />
            ) : tipoRows.length === 0 ? (
              <EmptyChart label={t("reportUds.empty")} />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tipoRows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="tipoLabel" axisLine={false} tickLine={false} fontSize={11} interval={0} />
                    <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                    <RechartsTooltip />
                    <Bar dataKey="totInterventi" name={t("reportUds.countCol")} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Interventi per zona */}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapIcon className="w-5 h-5 text-primary" /> {t("reportUds.zonaTitle")}
            </CardTitle>
            <CardDescription>{t("reportUds.zonaDesc", { periodo: periodoLabel })}</CardDescription>
          </div>
          <ExportButtons
            rows={perZona ?? []}
            columns={[
              { header: t("reportUds.zonaCol"), accessor: (z) => z.zonaNome },
              { header: t("reportUds.countCol"), accessor: (z) => z.totInterventi },
            ]}
            filename={`uds_interventi_per_zona_${da}_${a}`}
            title={t("reportUds.zonaTitle")}
            subtitle={t("reportUds.periodoSubtitle", { periodo: periodoLabel })}
          />
        </CardHeader>
        <CardContent>
          {loadingZona ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (perZona?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg">{t("reportUds.empty")}</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={perZona} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="zonaNome" axisLine={false} tickLine={false} fontSize={11} interval={0} />
                    <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                    <RechartsTooltip />
                    <Bar dataKey="totInterventi" name={t("reportUds.countCol")} fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("reportUds.zonaCol")}</TableHead>
                      <TableHead className="text-right">{t("reportUds.countCol")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(perZona ?? []).map((z) => (
                      <TableRow key={z.zonaId ?? z.zonaNome}>
                        <TableCell className="font-medium flex items-center gap-2"><MapIcon className="w-4 h-4 text-muted-foreground" />{z.zonaNome}</TableCell>
                        <TableCell className="text-right font-medium">{z.totInterventi}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Persone UDS per zona */}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> {t("reportUds.personeTitle")}
            </CardTitle>
            <CardDescription>{t("reportUds.personeDesc")}</CardDescription>
          </div>
          <ExportButtons
            rows={persone ?? []}
            columns={[
              { header: t("reportUds.zonaCol"), accessor: (p) => p.zonaNome },
              { header: t("reportUds.soloUds"), accessor: (p) => p.soloUds },
              { header: t("reportUds.udsConCentro"), accessor: (p) => p.udsConCentro },
              { header: t("reportUds.totale"), accessor: (p) => p.totale },
            ]}
            filename="uds_persone_per_zona"
            title={t("reportUds.personeTitle")}
          />
        </CardHeader>
        <CardContent>
          {loadingPersone ? (
            <Skeleton className="h-[200px] w-full" />
          ) : (persone?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg">{t("reportUds.empty")}</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("reportUds.zonaCol")}</TableHead>
                    <TableHead className="text-right">{t("reportUds.soloUds")}</TableHead>
                    <TableHead className="text-right">{t("reportUds.udsConCentro")}</TableHead>
                    <TableHead className="text-right">{t("reportUds.totale")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(persone ?? []).map((p) => (
                    <TableRow key={p.zonaId ?? p.zonaNome}>
                      <TableCell className="font-medium flex items-center gap-2"><MapIcon className="w-4 h-4 text-muted-foreground" />{p.zonaNome}</TableCell>
                      <TableCell className="text-right">{p.soloUds}</TableCell>
                      <TableCell className="text-right">{p.udsConCentro}</TableCell>
                      <TableCell className="text-right font-medium">{p.totale}</TableCell>
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

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[300px] w-full flex items-center justify-center text-sm text-muted-foreground border rounded-lg">
      {label}
    </div>
  );
}
