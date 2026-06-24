import { useState } from "react";
import { useParams } from "wouter";
import { useGetBeneficiario, getGetBeneficiarioQueryKey, useListCentriAscolto, useUpdateBeneficiario, getListBeneficiariQueryKey, type BeneficiarioDettaglio as BeneficiarioDettaglioType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { ExportButtons } from "@/components/export-buttons";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Calendar, Home, MapPin, Phone, Mail, User, Info, Users, Truck, ClipboardList, Building2, Pencil } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const NONE_VALUE = "__none__";

export default function BeneficiarioDettaglio() {
  const { id } = useParams();
  const numId = Number(id);
  const { data: b, isLoading } = useGetBeneficiario(numId, { query: { enabled: !!id, queryKey: getGetBeneficiarioQueryKey(numId) } });
  const { data: centri } = useListCentriAscolto();
  const updateBeneficiario = useUpdateBeneficiario();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);

  const onChangeCentro = (value: string) => {
    const next = value === NONE_VALUE ? null : parseInt(value);
    if (next === (b?.centroAscoltoId ?? null)) return;
    updateBeneficiario.mutate(
      { id: numId, data: { centroAscoltoId: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) });
          queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
          toast({ title: "Centro di Ascolto aggiornato" });
        },
        onError: () => toast({ title: "Errore", description: "Impossibile aggiornare il centro.", variant: "destructive" }),
      },
    );
  };

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
        <div>
          <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}>
            <Pencil className="w-4 h-4" /> Modifica anagrafica
          </Button>
        </div>
      </div>

      {editing && (
        <EditBeneficiarioSheet
          b={b}
          onClose={() => setEditing(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) });
            queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
            toast({ title: "Anagrafica aggiornata" });
            setEditing(false);
          }}
        />
      )}

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
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" /> Centro di Ascolto di riferimento
              </h4>
              <Select
                value={b.centroAscoltoId ? String(b.centroAscoltoId) : NONE_VALUE}
                onValueChange={onChangeCentro}
                disabled={updateBeneficiario.isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Nessuno" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>Nessuno</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1.5">Il centro che tiene in carico il beneficiario.</p>
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

const editSchema = z.object({
  cognome: z.string().min(1, "Obbligatorio"),
  nome: z.string().min(1, "Obbligatorio"),
  dataNascita: z.string().optional(),
  cittadinanza: z.string().optional(),
  residenza: z.string().optional(),
  domicilio: z.string().optional(),
  comune: z.string().optional(),
  zonaMunicipio: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  priorita: z.string(),
  numComponenti: z.coerce.number().min(1),
  consegnaDomicilio: z.boolean(),
  motivoConsegnaDomicilio: z.string().optional(),
  restrizioniAlimentari: z.string().optional(),
});

type EditValues = z.infer<typeof editSchema>;

function EditBeneficiarioSheet({ b, onClose, onSaved }: { b: BeneficiarioDettaglioType; onClose: () => void; onSaved: () => void }) {
  const updateBeneficiario = useUpdateBeneficiario();
  const { toast } = useToast();

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      cognome: b.cognome ?? "",
      nome: b.nome ?? "",
      dataNascita: b.dataNascita ? b.dataNascita.slice(0, 10) : "",
      cittadinanza: b.cittadinanza ?? "",
      residenza: b.residenza ?? "",
      domicilio: b.domicilio ?? "",
      comune: b.comune ?? "",
      zonaMunicipio: b.zonaMunicipio ?? "",
      telefono: b.telefono ?? "",
      email: b.email ?? "",
      priorita: b.priorita ?? "media",
      numComponenti: b.numComponenti ?? 1,
      consegnaDomicilio: b.consegnaDomicilio ?? false,
      motivoConsegnaDomicilio: b.motivoConsegnaDomicilio ?? "",
      restrizioniAlimentari: b.restrizioniAlimentari ?? "",
    },
  });

  const onSubmit = (data: EditValues) => {
    const payload = {
      ...data,
      dataNascita: data.dataNascita || undefined,
    };
    updateBeneficiario.mutate(
      { id: b.id, data: payload },
      {
        onSuccess: () => onSaved(),
        onError: () => toast({ title: "Errore", description: "Impossibile salvare le modifiche.", variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>Modifica anagrafica</SheetTitle></SheetHeader>
        <div className="mt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="cognome" render={({ field }) => (
                  <FormItem><FormLabel>Cognome</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="dataNascita" render={({ field }) => (
                  <FormItem><FormLabel>Data di nascita</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="cittadinanza" render={({ field }) => (
                  <FormItem><FormLabel>Cittadinanza</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <FormField control={form.control} name="residenza" render={({ field }) => (
                <FormItem><FormLabel>Residenza</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="domicilio" render={({ field }) => (
                <FormItem><FormLabel>Domicilio</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="comune" render={({ field }) => (
                  <FormItem><FormLabel>Comune</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="zonaMunicipio" render={({ field }) => (
                  <FormItem><FormLabel>Zona / Municipio</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="telefono" render={({ field }) => (
                  <FormItem><FormLabel>Telefono</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="numComponenti" render={({ field }) => (
                  <FormItem><FormLabel>N. Componenti</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="priorita" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priorità Assistenziale</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="bassa">Bassa</SelectItem>
                        <SelectItem value="media">Media</SelectItem>
                        <SelectItem value="alta">Alta</SelectItem>
                        <SelectItem value="urgente">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="consegnaDomicilio" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel className="mb-0">Consegna a domicilio</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              {form.watch("consegnaDomicilio") && (
                <FormField control={form.control} name="motivoConsegnaDomicilio" render={({ field }) => (
                  <FormItem><FormLabel>Motivo consegna a domicilio</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                )} />
              )}
              <FormField control={form.control} name="restrizioniAlimentari" render={({ field }) => (
                <FormItem><FormLabel>Restrizioni alimentari</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
              )} />

              <div className="pt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
                <Button type="submit" disabled={updateBeneficiario.isPending}>Salva</Button>
              </div>
            </form>
          </Form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
