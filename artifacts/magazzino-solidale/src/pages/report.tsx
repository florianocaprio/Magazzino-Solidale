import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  useReportGiacenzePerMagazzino,
  useReportConsegnePerMese,
  useReportConsegnePerCentro,
  useReportFsePlus,
  useListMagazzini,
  useListCentriAscolto,
  useListCitta,
  getReportGiacenzePerMagazzinoQueryKey,
  getReportConsegnePerMeseQueryKey,
  getReportConsegnePerCentroQueryKey,
  getReportFsePlusQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, LineChart, Line, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/export-buttons";
import { Package, Users, Weight, Building2, HeartHandshake } from "lucide-react";
import { useTranslation } from "react-i18next";

const ALL = "all";

export default function Report() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobalCitta = (user?.cittaId ?? null) == null;
  const currentYear = new Date().getFullYear();
  const [da, setDa] = useState(`${currentYear}-01-01`);
  const [a, setA] = useState(new Date().toISOString().slice(0, 10));
  const [cittaId, setCittaId] = useState<string>(ALL);
  const [magazzinoId, setMagazzinoId] = useState<string>(ALL);
  const [centroId, setCentroId] = useState<string>(ALL);
  const [fseAnno, setFseAnno] = useState(currentYear);
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroId(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);

  const { data: citta } = useListCitta();
  const { data: magazzini } = useListMagazzini();
  const { data: centri } = useListCentriAscolto();

  const cittaParam = cittaId === ALL ? null : parseInt(cittaId);
  const magazziniVisibili = (magazzini ?? []).filter((m) => cittaParam == null || m.cittaId === cittaParam);
  const centriVisibili = (centri ?? []).filter((c) => cittaParam == null || c.cittaId === cittaParam);

  const magParam = magazzinoId === ALL ? undefined : parseInt(magazzinoId);
  const centroParam = centroId === ALL ? undefined : parseInt(centroId);
  const cittaQuery = cittaParam ?? undefined;

  const consegneParams = { da, a, magazzinoId: magParam, centroAscoltoId: centroParam, cittaId: cittaQuery };
  const { data: consegne, isLoading: isLoadingConsegne } = useReportConsegnePerMese(consegneParams, {
    query: { queryKey: getReportConsegnePerMeseQueryKey(consegneParams) },
  });

  const giacenzeParams = { magazzinoId: magParam, cittaId: cittaQuery };
  const { data: giacenze, isLoading: isLoadingGiacenze } = useReportGiacenzePerMagazzino(giacenzeParams, {
    query: { queryKey: getReportGiacenzePerMagazzinoQueryKey(giacenzeParams) },
  });

  const perCentroParams = { da, a, cittaId: cittaQuery };
  const { data: perCentro, isLoading: isLoadingPerCentro } = useReportConsegnePerCentro(perCentroParams, {
    query: { queryKey: getReportConsegnePerCentroQueryKey(perCentroParams) },
  });

  const fseParams = { anno: fseAnno, cittaId: cittaQuery };
  const { data: fse, isLoading: isLoadingFse } = useReportFsePlus(
    fseParams,
    { query: { queryKey: getReportFsePlusQueryKey(fseParams) } },
  );

  const anniDisponibili = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const periodoLabel = `${formatIt(da)} – ${formatIt(a)}`;

  const perCentroFiltrato = centroParam ? (perCentro ?? []).filter((c) => c.centroId === centroParam) : (perCentro ?? []);

  const personeChart = fse
    ? [
        { categoria: t("report.catUeMaschi"), value: fse.persone.ueMaschi },
        { categoria: t("report.catUeFemmine"), value: fse.persone.ueFemmine },
        { categoria: t("report.catExtraUeMaschi"), value: fse.persone.extraUeMaschi },
        { categoria: t("report.catExtraUeFemmine"), value: fse.persone.extraUeFemmine },
      ]
    : [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("report.title")}</h1>
        <p className="text-muted-foreground">{t("report.subtitle")}</p>
      </div>

      {/* Filtri globali */}
      <Card>
        <CardContent className="flex flex-col md:flex-row md:items-end gap-4 pt-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="da" className="text-xs">{t("report.from")}</Label>
              <Input id="da" type="date" value={da} max={a} onChange={(e) => setDa(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a" className="text-xs">{t("report.to")}</Label>
              <Input id="a" type="date" value={a} min={da} onChange={(e) => setA(e.target.value)} className="w-40" />
            </div>
          </div>
          {isGlobalCitta && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("report.area")}</Label>
              <Select
                value={cittaId}
                onValueChange={(v) => {
                  setCittaId(v);
                  setMagazzinoId(ALL);
                  if (!isCentroLocked) setCentroId(ALL);
                }}
              >
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("report.allAreas")}</SelectItem>
                  {(citta ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("report.warehouse")}</Label>
            <Select value={magazzinoId} onValueChange={setMagazzinoId}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("report.allWarehouses")}</SelectItem>
                {magazziniVisibili.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("report.listeningCentre")}</Label>
            <Select value={centroId} onValueChange={setCentroId} disabled={isCentroLocked}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("report.allCentres")}</SelectItem>
                {centriVisibili.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("report.consegneTitle")}</CardTitle>
            <CardDescription>{t("report.consegneDesc", { periodo: periodoLabel })}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingConsegne ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (consegne?.length ?? 0) === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={consegne} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mese" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                    <RechartsTooltip />
                    <Line type="monotone" dataKey="consegneEffettuate" name={t("report.effettuate")} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="consegneMancate" name={t("report.mancate")} stroke="hsl(var(--destructive))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("report.sottoscortaTitle")}</CardTitle>
            <CardDescription>{t("report.sottoscortaDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingGiacenze ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (giacenze?.length ?? 0) === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={giacenze} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="magazzinoNome" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                    <RechartsTooltip />
                    <Bar dataKey="totProdotti" name={t("report.totaleArticoli")} fill="hsl(var(--primary) / 0.2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="prodottiSottoscorta" name={t("report.sottoscorta")} fill="hsl(var(--amber-500))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Consegne per Centro di Ascolto: dirette vs con volontari */}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HeartHandshake className="w-5 h-5 text-primary" /> {t("report.perCentroTitle")}
            </CardTitle>
            <CardDescription>{t("report.perCentroDesc", { periodo: periodoLabel })}</CardDescription>
          </div>
          <ExportButtons
            rows={perCentroFiltrato}
            columns={[
              { header: t("report.centro"), accessor: (c) => c.centroNome },
              { header: t("report.diretteDalCentro"), accessor: (c) => c.dirette },
              { header: t("report.conVolontari"), accessor: (c) => c.conVolontari },
              { header: t("common.total"), accessor: (c) => c.totale },
            ]}
            filename={`consegne_per_centro_${da}_${a}`}
            title={t("report.perCentroTitle")}
            subtitle={t("report.periodoSubtitle", { periodo: periodoLabel })}
          />
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoadingPerCentro ? (
            <Skeleton className="h-[300px] w-full" />
          ) : perCentroFiltrato.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg">{t("report.perCentroEmpty")}</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={perCentroFiltrato} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="centroNome" axisLine={false} tickLine={false} fontSize={11} interval={0} />
                    <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                    <RechartsTooltip />
                    <Legend />
                    <Bar dataKey="dirette" name={t("report.diretteDalCentro")} stackId="x" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="conVolontari" name={t("report.conVolontari")} stackId="x" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("report.centro")}</TableHead>
                      <TableHead className="text-right">{t("report.dirette")}</TableHead>
                      <TableHead className="text-right">{t("report.conVolontari")}</TableHead>
                      <TableHead className="text-right">{t("common.total")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {perCentroFiltrato.map((c) => (
                      <TableRow key={c.centroId ?? c.centroNome}>
                        <TableCell className="font-medium flex items-center gap-2"><Building2 className="w-4 h-4 text-muted-foreground" />{c.centroNome}</TableCell>
                        <TableCell className="text-right">{c.dirette}</TableCell>
                        <TableCell className="text-right">{c.conVolontari}</TableCell>
                        <TableCell className="text-right font-medium">{c.totale}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="pt-2">
        <Card className="border-primary/30">
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" /> {t("report.fseTitle")}
              </CardTitle>
              <CardDescription>{t("report.fseDesc")}</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Select value={String(fseAnno)} onValueChange={(v) => setFseAnno(parseInt(v))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {anniDisponibili.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ExportButtons
                rows={fse?.prodotti ?? []}
                columns={[
                  { header: t("report.prodotto"), accessor: (p) => p.prodottoNome },
                  { header: t("report.unita"), accessor: (p) => p.unitaMisura },
                  { header: t("report.quantitaTotale"), accessor: (p) => p.quantitaTotale },
                  { header: t("report.pesoKg"), accessor: (p) => p.pesoKg },
                ]}
                filename={`report_fse_plus_${fseAnno}`}
                title={t("report.fseExportTitle", { anno: fseAnno })}
                subtitle={t("report.fseExportSubtitle", { persone: fse?.personeTotali ?? 0, peso: (fse?.pesoTotaleKg ?? 0).toFixed(1) })}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoadingFse ? (
              <Skeleton className="h-[400px] w-full" />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KpiCard icon={<Weight className="w-5 h-5" />} label={t("report.kpiPeso")} value={`${(fse?.pesoTotaleKg ?? 0).toFixed(1)} kg`} />
                  <KpiCard icon={<Package className="w-5 h-5" />} label={t("report.kpiTipologie")} value={String(fse?.prodotti.length ?? 0)} />
                  <KpiCard icon={<Users className="w-5 h-5" />} label={t("report.kpiNuclei")} value={String(fse?.beneficiariTotali ?? 0)} />
                  <KpiCard icon={<Users className="w-5 h-5" />} label={t("report.kpiPersone")} value={String(fse?.personeTotali ?? 0)} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-semibold mb-3">{t("report.prodottiDistribuiti")}</h3>
                    {fse && fse.prodotti.length > 0 ? (
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("report.prodotto")}</TableHead>
                              <TableHead className="text-right">{t("common.quantity")}</TableHead>
                              <TableHead className="text-right">{t("report.pesoKg")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {fse.prodotti.map((p) => (
                              <TableRow key={p.prodottoId}>
                                <TableCell className="font-medium">{p.prodottoNome}</TableCell>
                                <TableCell className="text-right">{p.quantitaTotale} {p.unitaMisura}</TableCell>
                                <TableCell className="text-right">{p.pesoKg.toFixed(1)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg">{t("report.emptyProdotti")}</p>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-3">{t("report.personeChartTitle")}</h3>
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={personeChart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="categoria" axisLine={false} tickLine={false} fontSize={11} interval={0} />
                          <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                          <RechartsTooltip />
                          <Bar dataKey="value" name={t("report.personeChartName")} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">{t("report.dettaglioPersone")}</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("report.categoria")}</TableHead>
                          <TableHead className="text-right">{t("report.adulti")}</TableHead>
                          <TableHead className="text-right">{t("report.minori")}</TableHead>
                          <TableHead className="text-right">{t("common.total")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium flex items-center gap-2"><Badge variant="outline">M</Badge> Maschi</TableCell>
                          <TableCell className="text-right">{fse?.persone.maschiAdulti ?? 0}</TableCell>
                          <TableCell className="text-right">{fse?.persone.maschiMinori ?? 0}</TableCell>
                          <TableCell className="text-right font-medium">{fse?.persone.maschi ?? 0}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium flex items-center gap-2"><Badge variant="outline">F</Badge> Femmine</TableCell>
                          <TableCell className="text-right">{fse?.persone.femmineAdulte ?? 0}</TableCell>
                          <TableCell className="text-right">{fse?.persone.femmineMinori ?? 0}</TableCell>
                          <TableCell className="text-right font-medium">{fse?.persone.femmine ?? 0}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">UE</TableCell>
                          <TableCell className="text-right text-muted-foreground" colSpan={2}>M: {fse?.persone.ueMaschi ?? 0} · F: {fse?.persone.ueFemmine ?? 0}</TableCell>
                          <TableCell className="text-right font-medium">{fse?.persone.ue ?? 0}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Extra-UE</TableCell>
                          <TableCell className="text-right text-muted-foreground" colSpan={2}>M: {fse?.persone.extraUeMaschi ?? 0} · F: {fse?.persone.extraUeFemmine ?? 0}</TableCell>
                          <TableCell className="text-right font-medium">{fse?.persone.extraUe ?? 0}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatIt(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function EmptyChart() {
  return (
    <div className="h-[300px] w-full flex items-center justify-center text-sm text-muted-foreground border rounded-lg">
      Nessun dato per i filtri selezionati.
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4 bg-card">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
