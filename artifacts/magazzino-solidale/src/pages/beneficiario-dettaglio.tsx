import { useState, useMemo } from "react";
import { useParams } from "wouter";
import { useGetBeneficiario, getGetBeneficiarioQueryKey, useListCentriAscolto, useUpdateBeneficiario, useAddNucleoFamiliare, useDeleteNucleoFamiliare, useListCitta, useListZoneUds, getListBeneficiariQueryKey, getListCittaQueryKey, type BeneficiarioDettaglio as BeneficiarioDettaglioType } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ExportButtons } from "@/components/export-buttons";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Calendar, Home, MapPin, Phone, Mail, User, Info, Users, Truck, ClipboardList, Building2, Pencil, Plus, Trash2, CreditCard } from "lucide-react";
import { generateTesseraPdf, buildTesseraLabels } from "@/lib/tessera-pdf";
import { SchedaExportButtons } from "@/components/scheda-export";
import { loadAssociationLogo } from "@/lib/bolla-pdf";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const NONE_VALUE = "__none__";

function calcEta(dataNascita?: string | null): number | null {
  if (!dataNascita) return null;
  const d = new Date(dataNascita);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let eta = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) eta--;
  return eta;
}

const SESSO_LABEL: Record<string, string> = { M: "M", F: "F" };

export default function BeneficiarioDettaglio() {
  const { t } = useTranslation();
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
          toast({ title: t("beneficiarioDettaglio.toastCentroUpdated") });
        },
        onError: () => toast({ title: t("beneficiarioDettaglio.error"), description: t("beneficiarioDettaglio.errorCentro"), variant: "destructive" }),
      },
    );
  };

  const onToggleUds = (next: boolean) => {
    updateBeneficiario.mutate(
      { id: numId, data: { uds: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) });
          queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
          toast({ title: t("beneficiarioDettaglio.toastUdsUpdated") });
        },
        onError: () => toast({ title: t("beneficiarioDettaglio.error"), description: t("beneficiarioDettaglio.errorUds"), variant: "destructive" }),
      },
    );
  };

  if (isLoading) return <div className="p-6 space-y-6 max-w-7xl mx-auto"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!b) return <div className="p-6">{t("beneficiarioDettaglio.notFound")}</div>;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight">{b.cognome} {b.nome}</h1>
            <Badge variant="outline" className="font-mono text-muted-foreground">{b.codice}</Badge>
            {!b.attivo && <Badge variant="destructive">{t("common.inactive")}</Badge>}
          </div>
          <p className="text-muted-foreground flex items-center gap-2">
            {b.priorita === 'urgente' && <AlertCircle className="w-4 h-4 text-red-500" />}
            {t("beneficiarioDettaglio.priorityLabel")} <span className="font-medium capitalize">{b.priorita}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={async () => {
              const logo = await loadAssociationLogo();
              await generateTesseraPdf({
                beneficiario: { codice: b.codice, nome: b.nome, cognome: b.cognome, codiceFiscale: b.codiceFiscale },
                labels: buildTesseraLabels(t),
                associationLogoDataUrl: logo,
              });
            }}
          >
            <CreditCard className="w-4 h-4" /> {t("tessera.generate")}
          </Button>
          <SchedaExportButtons b={b} size="default" />
          <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}>
            <Pencil className="w-4 h-4" /> {t("beneficiarioDettaglio.editAnagrafica")}
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
            toast({ title: t("beneficiarioDettaglio.toastUpdated") });
            setEditing(false);
          }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">{t("beneficiarioDettaglio.anagraficaContatti")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <div className="font-medium">{b.domicilio || b.residenza || t("beneficiarioDettaglio.addressNotSpecified")}</div>
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
                <span>{b.cittadinanza || t("beneficiarioDettaglio.cittadinanzaNotSpec")}</span>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>{t("beneficiarioDettaglio.bornOn", { date: b.dataNascita ? format(new Date(b.dataNascita), "dd/MM/yyyy") : "-" })}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-border mt-4">
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" /> {t("beneficiarioDettaglio.centroRiferimento")}
              </h4>
              <Select
                value={b.centroAscoltoId ? String(b.centroAscoltoId) : NONE_VALUE}
                onValueChange={onChangeCentro}
                disabled={updateBeneficiario.isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("common.none")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("common.none")}</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1.5">{t("beneficiarioDettaglio.centroHelp")}</p>

              <div className="flex items-center justify-between mt-4">
                <div className="space-y-0.5 pr-3">
                  <span className="text-sm font-medium">{t("beneficiarioDettaglio.udsLabel")}</span>
                  <p className="text-xs text-muted-foreground">{t("beneficiarioDettaglio.udsHelp")}</p>
                </div>
                <Switch checked={b.uds} onCheckedChange={onToggleUds} disabled={updateBeneficiario.isPending} />
              </div>
            </div>

            <div className="pt-4 border-t border-border mt-4">
              <h4 className="text-sm font-semibold mb-2">{t("beneficiarioDettaglio.noteAssistenziali")}</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("beneficiarioDettaglio.consegnaDomicilioLabel")}</span>
                  <span className="font-medium">{b.consegnaDomicilio ? t("common.yes") : t("common.no")}</span>
                </div>
                {b.motivoConsegnaDomicilio && (
                  <p className="text-xs text-muted-foreground italic ml-2 border-l-2 pl-2 border-primary/20">{b.motivoConsegnaDomicilio}</p>
                )}
                {b.restrizioniAlimentari && (
                  <div className="bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 p-2 rounded text-xs">
                    <strong>{t("beneficiarioDettaglio.restrizioni")}</strong> {b.restrizioniAlimentari}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2">
          <Tabs defaultValue="nucleo">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="nucleo" className="gap-2"><Users className="w-4 h-4" /> {t("beneficiarioDettaglio.tabNucleo", { count: b.numComponenti })}</TabsTrigger>
              <TabsTrigger value="interventi" className="gap-2"><ClipboardList className="w-4 h-4" /> {t("beneficiarioDettaglio.tabInterventi")}</TabsTrigger>
              <TabsTrigger value="consegne" className="gap-2"><Truck className="w-4 h-4" /> {t("beneficiarioDettaglio.tabConsegne")}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="nucleo" className="mt-4">
              <NucleoSection
                b={b}
                onChanged={() => queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) })}
              />
            </TabsContent>
            
            <TabsContent value="interventi" className="mt-4">
              <Card>
                <CardHeader className="py-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-base">{t("beneficiarioDettaglio.storicoInterventi")}</CardTitle>
                  <ExportButtons
                    rows={b.interventi ?? []}
                    columns={[
                      { header: t("common.date"), accessor: (i) => i.dataIntervento ? new Date(i.dataIntervento).toLocaleDateString("it-IT") : "" },
                      { header: t("beneficiarioDettaglio.colTipoIntervento"), accessor: (i) => i.tipoIntervento },
                      { header: t("beneficiarioDettaglio.colDescrizione"), accessor: (i) => i.descrizione },
                      { header: t("beneficiarioDettaglio.colEsito"), accessor: (i) => i.esito },
                      { header: t("beneficiarioDettaglio.colProssimaAzione"), accessor: (i) => i.prossimAzione },
                    ]}
                    filename={`interventi_${b.cognome}`}
                    title={t("beneficiarioDettaglio.exportInterventiTitle", { name: `${b.cognome} ${b.nome}` })}
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
                            {i.esito && <p className="text-xs text-muted-foreground mt-2 border-t pt-2"><strong>{t("beneficiarioDettaglio.esito")}</strong> {i.esito}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">{t("beneficiarioDettaglio.noInterventi")}</p>
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
                              {t("beneficiarioDettaglio.prevista", { date: format(new Date(c.dataPrevista), "dd/MM/yyyy") })}
                            </div>
                          </div>
                          <Badge variant={
                            c.stato === 'effettuata' ? 'default' : 
                            c.stato === 'annullata' ? 'destructive' : 'secondary'
                          } className={c.stato === 'effettuata' ? 'bg-green-500 hover:bg-green-600' : ''}>
                            {c.stato === 'effettuata' ? t("beneficiarioDettaglio.statoConsegnata") : c.stato === 'pianificata' ? t("beneficiarioDettaglio.statoPianificata") : c.stato}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">{t("beneficiarioDettaglio.noConsegne")}</p>
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

const makeEditSchema = (t: (k: string) => string) => z.object({
  cognome: z.string().min(1, t("beneficiarioDettaglio.required")),
  nome: z.string().min(1, t("beneficiarioDettaglio.required")),
  codiceFiscale: z.string().optional(),
  dataNascita: z.string().optional(),
  sesso: z.string().optional(),
  cittadinanza: z.string().optional(),
  areaProvenienza: z.string().min(1, t("beneficiarioDettaglio.required")),
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
  uds: z.boolean().default(false),
  cittaId: z.string().optional(),
  zonaUdsId: z.string().optional(),
});

type EditValues = z.infer<ReturnType<typeof makeEditSchema>>;

export function EditBeneficiarioSheet({ b, onClose, onSaved }: { b: BeneficiarioDettaglioType; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const updateBeneficiario = useUpdateBeneficiario();
  const { toast } = useToast();
  const editSchema = useMemo(() => makeEditSchema(t), [t]);
  const { user } = useAuth();
  const isCittaGlobal = user?.cittaId == null;
  const { data: cittaList } = useListCitta({ query: { queryKey: getListCittaQueryKey(), enabled: isCittaGlobal } });

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      cognome: b.cognome ?? "",
      nome: b.nome ?? "",
      codiceFiscale: b.codiceFiscale ?? "",
      dataNascita: b.dataNascita ? b.dataNascita.slice(0, 10) : "",
      sesso: b.sesso ?? "",
      cittadinanza: b.cittadinanza ?? "",
      areaProvenienza: b.areaProvenienza ?? "",
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
      uds: b.uds ?? false,
      cittaId: b.cittaId != null ? String(b.cittaId) : "",
      zonaUdsId: b.zonaUdsId != null ? String(b.zonaUdsId) : "",
    },
  });

  const watchUds = form.watch("uds");
  const formCitta = isCittaGlobal
    ? (form.watch("cittaId") ? parseInt(form.watch("cittaId")!) : undefined)
    : (user?.cittaId ?? undefined);
  const { data: udsZone } = useListZoneUds(
    formCitta ? { cittaId: formCitta } : undefined,
    { query: { queryKey: ["zoneUds", "editBenefForm", formCitta], enabled: watchUds && formCitta != null } },
  );

  const onSubmit = (data: EditValues) => {
    const { uds, cittaId, zonaUdsId, ...rest } = data;
    // A città-global admin must pin a città when flagging a person as UDS.
    if (uds && isCittaGlobal && !cittaId) {
      form.setError("cittaId", { type: "manual", message: t("common.requiredField") });
      return;
    }
    const payload: Record<string, unknown> = {
      ...rest,
      uds,
      dataNascita: data.dataNascita || undefined,
      sesso: data.sesso || undefined,
      areaProvenienza: data.areaProvenienza || undefined,
      codiceFiscale: data.codiceFiscale?.trim() ? data.codiceFiscale.trim().toUpperCase() : null,
    };
    if (uds) {
      if (isCittaGlobal && cittaId) payload.cittaId = parseInt(cittaId);
      payload.zonaUdsId = zonaUdsId && zonaUdsId !== NONE_VALUE ? parseInt(zonaUdsId) : null;
    }
    updateBeneficiario.mutate(
      { id: b.id, data: payload as never },
      {
        onSuccess: () => onSaved(),
        onError: () => toast({ title: t("beneficiarioDettaglio.error"), description: t("beneficiarioDettaglio.errorSave"), variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>{t("beneficiarioDettaglio.editAnagrafica")}</SheetTitle></SheetHeader>
        <div className="mt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.name")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="cognome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.surname")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <FormField control={form.control} name="codiceFiscale" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.codiceFiscale")}</FormLabel><FormControl><Input {...field} className="font-mono uppercase" maxLength={16} /></FormControl></FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="dataNascita" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.dataNascita")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="sesso" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiarioDettaglio.sesso")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="M">{t("beneficiarioDettaglio.maschio")}</SelectItem>
                        <SelectItem value="F">{t("beneficiarioDettaglio.femmina")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="cittadinanza" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.cittadinanza")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="areaProvenienza" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiarioDettaglio.areaProvenienza")} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="UE">UE</SelectItem>
                        <SelectItem value="Extra-UE">Extra-UE</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="residenza" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.residenza")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="domicilio" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.domicilio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="comune" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.comune")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="zonaMunicipio" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.zonaMunicipio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="telefono" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.phone")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.email")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="numComponenti" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.numComponenti")}</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="priorita" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiarioDettaglio.prioritaAssistenziale")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="bassa">{t("beneficiarioDettaglio.prioBassa")}</SelectItem>
                        <SelectItem value="media">{t("beneficiarioDettaglio.prioMedia")}</SelectItem>
                        <SelectItem value="alta">{t("beneficiarioDettaglio.prioAlta")}</SelectItem>
                        <SelectItem value="urgente">{t("beneficiarioDettaglio.prioUrgente")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="consegnaDomicilio" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel className="mb-0">{t("beneficiarioDettaglio.consegnaDomicilio")}</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              {form.watch("consegnaDomicilio") && (
                <FormField control={form.control} name="motivoConsegnaDomicilio" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.motivoConsegna")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                )} />
              )}
              <FormField control={form.control} name="restrizioniAlimentari" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.restrizioniAlimentari")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
              )} />

              <div className="rounded-md border p-3 space-y-3">
                <FormField control={form.control} name="uds" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <FormLabel className="!mt-0">{t("beneficiari.udsToggle")}</FormLabel>
                      <p className="text-xs text-muted-foreground">{t("beneficiari.udsToggleHint")}</p>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                {watchUds && (
                  <>
                    {isCittaGlobal && (
                      <FormField control={form.control} name="cittaId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("udsAnagrafica.fCitta")}</FormLabel>
                          <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); form.setValue("zonaUdsId", NONE_VALUE); }}>
                            <FormControl><SelectTrigger><SelectValue placeholder={t("udsAnagrafica.fCitta")} /></SelectTrigger></FormControl>
                            <SelectContent>
                              {cittaList?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    <FormField control={form.control} name="zonaUdsId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("udsAnagrafica.fZona")}</FormLabel>
                        <Select value={field.value || NONE_VALUE} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue placeholder={t("udsAnagrafica.allZone")} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NONE_VALUE}>{t("udsAnagrafica.allZone")}</SelectItem>
                            {udsZone?.map(z => <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </>
                )}
              </div>

              <div className="pt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={updateBeneficiario.isPending}>{t("common.save")}</Button>
              </div>
            </form>
          </Form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const makeMembroSchema = (t: (k: string) => string) => z.object({
  nome: z.string().min(1, t("beneficiarioDettaglio.required")),
  cognome: z.string().optional(),
  relazione: z.string().optional(),
  dataNascita: z.string().optional(),
  sesso: z.string().optional(),
  areaProvenienza: z.string().optional(),
  note: z.string().optional(),
});
type MembroValues = z.infer<ReturnType<typeof makeMembroSchema>>;

function NucleoSection({ b, onChanged }: { b: BeneficiarioDettaglioType; onChanged: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const addMembro = useAddNucleoFamiliare();
  const deleteMembro = useDeleteNucleoFamiliare();
  const membroSchema = useMemo(() => makeMembroSchema(t), [t]);

  const form = useForm<MembroValues>({
    resolver: zodResolver(membroSchema),
    defaultValues: { nome: "", cognome: "", relazione: "", dataNascita: "", sesso: "", areaProvenienza: "", note: "" },
  });

  const onAdd = (data: MembroValues) => {
    addMembro.mutate(
      {
        id: b.id,
        data: {
          nome: data.nome,
          cognome: data.cognome || undefined,
          relazione: data.relazione || undefined,
          dataNascita: data.dataNascita || undefined,
          sesso: data.sesso || undefined,
          areaProvenienza: data.areaProvenienza || undefined,
          note: data.note || undefined,
        },
      },
      {
        onSuccess: () => {
          setAdding(false);
          form.reset();
          onChanged();
          toast({ title: t("beneficiarioDettaglio.toastMembroAdded") });
        },
        onError: () => toast({ title: t("beneficiarioDettaglio.error"), description: t("beneficiarioDettaglio.errorMembroAdd"), variant: "destructive" }),
      },
    );
  };

  const onDelete = (membroId: number) => {
    deleteMembro.mutate(
      { id: b.id, membroId },
      {
        onSuccess: () => {
          onChanged();
          toast({ title: t("beneficiarioDettaglio.toastMembroRemoved") });
        },
        onError: () => toast({ title: t("beneficiarioDettaglio.error"), description: t("beneficiarioDettaglio.errorMembroRemove"), variant: "destructive" }),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="py-4 flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t("beneficiarioDettaglio.composizione")}</CardTitle>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> {t("beneficiarioDettaglio.aggiungiComponente")}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 mb-6">
          <Badge variant="secondary">{t("beneficiarioDettaglio.minori")}: {b.numMinori}</Badge>
          <Badge variant="secondary">{t("beneficiarioDettaglio.anziani")}: {b.numAnziani}</Badge>
          <Badge variant="secondary">{t("beneficiarioDettaglio.disabili")}: {b.numDisabili}</Badge>
        </div>

        {b.nucleo && b.nucleo.length > 0 ? (
          <div className="space-y-4">
            {b.nucleo.map((m) => {
              const eta = calcEta(m.dataNascita);
              return (
                <div key={m.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {m.nome} {m.cognome}
                      {m.sesso && <Badge variant="outline" className="text-[10px]">{SESSO_LABEL[m.sesso] ?? m.sesso}</Badge>}
                      {m.areaProvenienza && <Badge variant="outline" className="text-[10px]">{m.areaProvenienza}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-3">
                      <span>{t("beneficiarioDettaglio.relazione")}: {m.relazione || '-'}</span>
                      {eta !== null && <span>{t("beneficiarioDettaglio.eta", { eta })}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs space-y-1">
                      {m.tagliiaVestiti && <div>{t("beneficiarioDettaglio.taglia")}: <span className="font-medium">{m.tagliiaVestiti}</span></div>}
                      {m.numeroScarpe && <div>{t("beneficiarioDettaglio.scarpe")}: <span className="font-medium">{m.numeroScarpe}</span></div>}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(m.id)}
                      disabled={deleteMembro.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">{t("beneficiarioDettaglio.noComponenti")}</p>
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={(open) => { if (!open) { setAdding(false); form.reset(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("beneficiarioDettaglio.aggiungiComponente")}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onAdd)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.name")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="cognome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.surname")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="relazione" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.relazione")}</FormLabel><FormControl><Input placeholder={t("beneficiarioDettaglio.relazionePlaceholder")} {...field} /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="dataNascita" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.dataNascita")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="sesso" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiarioDettaglio.sesso")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="M">{t("beneficiarioDettaglio.maschio")}</SelectItem>
                        <SelectItem value="F">{t("beneficiarioDettaglio.femmina")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="areaProvenienza" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("beneficiarioDettaglio.areaProvenienza")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="UE">UE</SelectItem>
                      <SelectItem value="Extra-UE">Extra-UE</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="note" render={({ field }) => (
                <FormItem><FormLabel>{t("common.notes")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setAdding(false); form.reset(); }}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={addMembro.isPending}>{t("common.add")}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
