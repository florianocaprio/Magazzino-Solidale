import { useParams } from "wouter";
import { useGetBeneficiario, getGetBeneficiarioQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportButtons } from "@/components/export-buttons";
import { AlertCircle, Calendar, Home, MapPin, Phone, Mail, User, Info, Users, Truck, ClipboardList } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";

export default function BeneficiarioDettaglio() {
  const { id } = useParams();
  const numId = Number(id);
  const { data: b, isLoading } = useGetBeneficiario(numId, { query: { enabled: !!id, queryKey: getGetBeneficiarioQueryKey(numId) } });

  if (isLoading) return <div className="p-6 space-y-6 max-w-7xl mx-auto"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!b) return <div className="p-6">Beneficiario non trovato.</div>;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight">{b.cognome} {b.nome}</h1>
            <Badge variant="outline" className="font-mono text-muted-foreground">{b.codice}</Badge>
            {!b.attivo && <Badge variant="destructive">Inattivo</Badge>}
          </div>
          <p className="text-muted-foreground flex items-center gap-2">
            {b.priorita === 'urgente' && <AlertCircle className="w-4 h-4 text-red-500" />}
            Priorità: <span className="font-medium capitalize">{b.priorita}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Anagrafica & Contatti</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <div className="font-medium">{b.domicilio || b.residenza || "Indirizzo non specificato"}</div>
                  <div className="text-muted-foreground">{b.comune} {b.zonaMunicipio ? `(${b.zonaMunicipio})` : ''}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{b.telefono || "-"}</span>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span>{b.email || "-"}</span>
              </div>
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-muted-foreground" />
                <span>{b.cittadinanza || "Cittadinanza non spec."}</span>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>Nato/a il {b.dataNascita ? format(new Date(b.dataNascita), "dd/MM/yyyy") : "-"}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-border mt-4">
              <h4 className="text-sm font-semibold mb-2">Note Assistenziali</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Consegna a domicilio:</span>
                  <span className="font-medium">{b.consegnaDomicilio ? "Sì" : "No"}</span>
                </div>
                {b.motivoConsegnaDomicilio && (
                  <p className="text-xs text-muted-foreground italic ml-2 border-l-2 pl-2 border-primary/20">{b.motivoConsegnaDomicilio}</p>
                )}
                {b.restrizioniAlimentari && (
                  <div className="bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 p-2 rounded text-xs">
                    <strong>Restrizioni:</strong> {b.restrizioniAlimentari}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2">
          <Tabs defaultValue="nucleo">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="nucleo" className="gap-2"><Users className="w-4 h-4" /> Nucleo ({b.numComponenti})</TabsTrigger>
              <TabsTrigger value="interventi" className="gap-2"><ClipboardList className="w-4 h-4" /> Interventi</TabsTrigger>
              <TabsTrigger value="consegne" className="gap-2"><Truck className="w-4 h-4" /> Consegne</TabsTrigger>
            </TabsList>
            
            <TabsContent value="nucleo" className="mt-4">
              <Card>
                <CardHeader className="py-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Composizione Nucleo Familiare</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4 mb-6">
                    <Badge variant="secondary">Minori: {b.numMinori}</Badge>
                    <Badge variant="secondary">Anziani: {b.numAnziani}</Badge>
                    <Badge variant="secondary">Disabili: {b.numDisabili}</Badge>
                  </div>
                  
                  {b.nucleo && b.nucleo.length > 0 ? (
                    <div className="space-y-4">
                      {b.nucleo.map((m, i) => (
                        <div key={i} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                          <div>
                            <div className="font-medium">{m.nome} {m.cognome}</div>
                            <div className="text-xs text-muted-foreground flex gap-3">
                              <span>Relazione: {m.relazione || '-'}</span>
                              {m.dataNascita && <span>Nato/a: {format(new Date(m.dataNascita), "yyyy")}</span>}
                            </div>
                          </div>
                          <div className="text-right text-xs space-y-1">
                            {m.tagliiaVestiti && <div>Taglia: <span className="font-medium">{m.tagliiaVestiti}</span></div>}
                            {m.numeroScarpe && <div>Scarpe: <span className="font-medium">{m.numeroScarpe}</span></div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">Nessun componente aggiunto al nucleo.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="interventi" className="mt-4">
              <Card>
                <CardHeader className="py-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Storico Interventi</CardTitle>
                  <ExportButtons
                    rows={b.interventi ?? []}
                    columns={[
                      { header: "Data", accessor: (i) => i.dataIntervento ? new Date(i.dataIntervento).toLocaleDateString("it-IT") : "" },
                      { header: "Tipo Intervento", accessor: (i) => i.tipoIntervento },
                      { header: "Descrizione", accessor: (i) => i.descrizione },
                      { header: "Esito", accessor: (i) => i.esito },
                      { header: "Prossima Azione", accessor: (i) => i.prossimAzione },
                    ]}
                    filename={`interventi_${b.cognome}`}
                    title={`Interventi - ${b.cognome} ${b.nome}`}
                    orientation="landscape"
                  />
                </CardHeader>
                <CardContent className="pt-6">
                  {b.interventi && b.interventi.length > 0 ? (
                    <div className="space-y-4 border-l-2 border-muted pl-4 ml-2">
                      {b.interventi.map((i) => (
                        <div key={i.id} className="relative">
                          <div className="absolute -left-6 mt-1.5 w-3 h-3 bg-primary rounded-full ring-4 ring-background"></div>
                          <div className="text-sm font-medium text-muted-foreground mb-1">
                            {format(new Date(i.dataIntervento), "dd MMM yyyy", { locale: it })}
                          </div>
                          <div className="bg-muted/30 p-3 rounded-md border">
                            <div className="flex justify-between items-start mb-2">
                              <Badge className="capitalize bg-primary/10 text-primary hover:bg-primary/20">{i.tipoIntervento.replace('_', ' ')}</Badge>
                            </div>
                            <p className="text-sm">{i.descrizione}</p>
                            {i.esito && <p className="text-xs text-muted-foreground mt-2 border-t pt-2"><strong>Esito:</strong> {i.esito}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">Nessun intervento registrato.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="consegne" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {b.consegne && b.consegne.length > 0 ? (
                    <div className="space-y-3">
                      {b.consegne.map((c) => (
                        <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <div className="font-medium text-sm flex items-center gap-2">
                              {c.codice} 
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {c.tipoConsegna.replace('_', ' ')}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Prevista: {format(new Date(c.dataPrevista), "dd/MM/yyyy")}
                            </div>
                          </div>
                          <Badge variant={
                            c.stato === 'completata' ? 'default' : 
                            c.stato === 'annullata' ? 'destructive' : 'secondary'
                          } className={c.stato === 'completata' ? 'bg-green-500 hover:bg-green-600' : ''}>
                            {c.stato}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">Nessuna consegna registrata.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
