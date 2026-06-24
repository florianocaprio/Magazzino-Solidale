import { useState } from "react";
import {
  useReportGiacenzePerMagazzino,
  useReportConsegnePerMese,
  useReportConsegnePerCentro,
  useReportBeneficiariPerZona,
  useReportFsePlus,
  useListMagazzini,
  useListCentriAscolto,
  getReportGiacenzePerMagazzinoQueryKey,
  getReportConsegnePerMeseQueryKey,
  getReportConsegnePerCentroQueryKey,
  getReportBeneficiariPerZonaQueryKey,
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

const ALL = "all";

export default function Report() {
  const currentYear = new Date().getFullYear();
  const [da, setDa] = useState(`${currentYear}-01-01`);
  const [a, setA] = useState(new Date().toISOString().slice(0, 10));
  const [magazzinoId, setMagazzinoId] = useState<string>(ALL);
  const [centroId, setCentroId] = useState<string>(ALL);
  const [fseAnno, setFseAnno] = useState(currentYear);

  const { data: magazzini } = useListMagazzini();
  const { data: centri } = useListCentriAscolto();

  const magParam = magazzinoId === ALL ? undefined : parseInt(magazzinoId);
  const centroParam = centroId === ALL ? undefined : parseInt(centroId);

  const consegneParams = { da, a, magazzinoId: magParam, centroAscoltoId: centroParam };
  const { data: consegne, isLoading: isLoadingConsegne } = useReportConsegnePerMese(consegneParams, {
    query: { queryKey: getReportConsegnePerMeseQueryKey(consegneParams) },
  });

  const giacenzeParams = { magazzinoId: magParam };
  const { data: giacenze, isLoading: isLoadingGiacenze } = useReportGiacenzePerMagazzino(giacenzeParams, {
    query: { queryKey: getReportGiacenzePerMagazzinoQueryKey(giacenzeParams) },
  });

  const zonaParams = { centroAscoltoId: centroParam };
  const { data: beneficiari, isLoading: isLoadingBeneficiari } = useReportBeneficiariPerZona(zonaParams, {
    query: { queryKey: getReportBeneficiariPerZonaQueryKey(zonaParams) },
  });

  const perCentroParams = { da, a };
  const { data: perCentro, isLoading: isLoadingPerCentro } = useReportConsegnePerCentro(perCentroParams, {
    query: { queryKey: getReportConsegnePerCentroQueryKey(perCentroParams) },
  });

  const { data: fse, isLoading: isLoadingFse } = useReportFsePlus(
    { anno: fseAnno },
    { query: { queryKey: getReportFsePlusQueryKey({ anno: fseAnno }) } },
  );

  const anniDisponibili = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const periodoLabel = `${formatIt(da)} – ${formatIt(a)}`;

  const perCentroFiltrato = centroParam ? (perCentro ?? []).filter((c) => c.centroId === centroParam) : (perCentro ?? []);

  const personeChart = fse
    ? [
        { categoria: "Maschi UE", value: fse.persone.ueMaschi },
        { categoria: "Femmine UE", value: fse.persone.ueFemmine },
        { categoria: "Maschi Extra-UE", value: fse.persone.extraUeMaschi },
        { categoria: "Femmine Extra-UE", value: fse.persone.extraUeFemmine },
      ]
    : [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analisi e Report</h1>
        <p className="text-muted-foreground">Dati aggregati sulle attività dell'associazione.</p>
      </div>

      {/* Filtri globali */}
      <Card>
        <CardContent className="flex flex-col md:flex-row md:items-end gap-4 pt-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="da" className="text-xs">Dal</Label>
              <Input id="da" type="date" value={da} max={a} onChange={(e) => setDa(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a" className="text-xs">Al</Label>
              <Input id="a" type="date" value={a} min={da} onChange={(e) => setA(e.target.value)} className="w-40" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Magazzino</Label>
            <Select value={magazzinoId} onValueChange={setMagazzinoId}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutti i magazzini</SelectItem>
                {(magazzini ?? []).map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Centro di Ascolto</Label>
            <Select value={centroId} onValueChange={setCentroId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutti i centri</SelectItem>
                {(centri ?? []).map((c) => (
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
            <CardTitle>Consegne nel Periodo</CardTitle>
            <CardDescription>Andamento mensile delle consegne effettuate · {periodoLabel}</CardDescription>
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
                    <Line type="monotone" dataKey="consegneEffettuate" name="Effettuate" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="consegneMancate" name="Mancate" stroke="hsl(var(--destructive))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prodotti Sottoscorta per Magazzino</CardTitle>
            <CardDescription>Confronto tra articoli totali e critici (giacenze attuali)</CardDescription>
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
                    <Bar dataKey="totProdotti" name="Totale Articoli" fill="hsl(var(--primary) / 0.2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="prodottiSottoscorta" name="Sottoscorta" fill="hsl(var(--amber-500))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Distribuzione Beneficiari per Zona</CardTitle>
            <CardDescription>Concentrazione delle famiglie assistite e consegne a domicilio</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingBeneficiari ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (beneficiari?.length ?? 0) === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={beneficiari} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="zona" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                    <RechartsTooltip />
                    <Bar dataKey="totBeneficiari" name="Totale Beneficiari" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="consegneDomicilio" name="Di cui a Domicilio" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
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
              <HeartHandshake className="w-5 h-5 text-primary" /> Consegne per Centro di Ascolto
            </CardTitle>
            <CardDescription>Consegne effettuate dirette dal centro vs con i volontari · {periodoLabel}</CardDescription>
          </div>
          <ExportButtons
            rows={perCentroFiltrato}
            columns={[
              { header: "Centro di Ascolto", accessor: (c) => c.centroNome },
              { header: "Dirette dal centro", accessor: (c) => c.dirette },
              { header: "Con volontari", accessor: (c) => c.conVolontari },
              { header: "Totale", accessor: (c) => c.totale },
            ]}
            filename={`consegne_per_centro_${da}_${a}`}
            title="Consegne per Centro di Ascolto"
            subtitle={`Periodo: ${periodoLabel}`}
          />
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoadingPerCentro ? (
            <Skeleton className="h-[300px] w-full" />
          ) : perCentroFiltrato.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg">Nessuna consegna effettuata nel periodo selezionato.</p>
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
                    <Bar dataKey="dirette" name="Dirette dal centro" stackId="x" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="conVolontari" name="Con volontari" stackId="x" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Centro di Ascolto</TableHead>
                      <TableHead className="text-right">Dirette</TableHead>
                      <TableHead className="text-right">Con volontari</TableHead>
                      <TableHead className="text-right">Totale</TableHead>
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
                <Package className="w-5 h-5 text-primary" /> Rendicontazione FSE+ (Fondo Sociale Europeo Plus)
              </CardTitle>
              <CardDescription>Riepilogo annuale prodotti FSE+ distribuiti e persone raggiunte</CardDescription>
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
                  { header: "Prodotto", accessor: (p) => p.prodottoNome },
                  { header: "Unità", accessor: (p) => p.unitaMisura },
                  { header: "Quantità totale", accessor: (p) => p.quantitaTotale },
                  { header: "Peso (kg)", accessor: (p) => p.pesoKg },
                ]}
                filename={`report_fse_plus_${fseAnno}`}
                title={`Report FSE+ ${fseAnno}`}
                subtitle={`Persone raggiunte: ${fse?.personeTotali ?? 0} — Peso totale: ${(fse?.pesoTotaleKg ?? 0).toFixed(1)} kg`}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoadingFse ? (
              <Skeleton className="h-[400px] w-full" />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KpiCard icon={<Weight className="w-5 h-5" />} label="Peso totale distribuito" value={`${(fse?.pesoTotaleKg ?? 0).toFixed(1)} kg`} />
                  <KpiCard icon={<Package className="w-5 h-5" />} label="Tipologie di prodotto" value={String(fse?.prodotti.length ?? 0)} />
                  <KpiCard icon={<Users className="w-5 h-5" />} label="Nuclei familiari raggiunti" value={String(fse?.beneficiariTotali ?? 0)} />
                  <KpiCard icon={<Users className="w-5 h-5" />} label="Persone totali raggiunte" value={String(fse?.personeTotali ?? 0)} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-semibold mb-3">Prodotti FSE+ distribuiti</h3>
                    {fse && fse.prodotti.length > 0 ? (
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Prodotto</TableHead>
                              <TableHead className="text-right">Quantità</TableHead>
                              <TableHead className="text-right">Peso (kg)</TableHead>
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
                      <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg">Nessun prodotto FSE+ distribuito nell'anno selezionato.</p>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-3">Persone raggiunte per sesso e provenienza</h3>
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={personeChart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="categoria" axisLine={false} tickLine={false} fontSize={11} interval={0} />
                          <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                          <RechartsTooltip />
                          <Bar dataKey="value" name="Persone" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">Dettaglio persone raggiunte</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Categoria</TableHead>
                          <TableHead className="text-right">Adulti</TableHead>
                          <TableHead className="text-right">Minori</TableHead>
                          <TableHead className="text-right">Totale</TableHead>
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
