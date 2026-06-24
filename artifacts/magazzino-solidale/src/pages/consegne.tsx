import { useState } from "react";
import { useListConsegne, useCreateConsegna, useCompletaConsegna, useAssociaBolla, useListBolle, useListBeneficiari, useListMagazzini, useListVolontari, useListCentriAscolto, getListConsegneQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { BollaDettaglio } from "@/pages/bolle";
import { Plus, MapPin, Truck, CheckCircle2, Filter, FileText, FileClock, Link2, Download } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";

const formSchema = z.object({
  beneficiarioId: z.coerce.number().min(1),
  tipoConsegna: z.string().min(1),
  dataPrevista: z.string().min(1),
  fasciaOraria: z.string().optional(),
  indirizzoConsegna: z.string().optional(),
  zona: z.string().optional(),
  magazzinoId: z.coerce.number().min(1),
  volontarioId: z.coerce.number().optional(),
  noteOperative: z.string().optional()
});

export default function Consegne() {
  const { t } = useTranslation();
  const [centroFilter, setCentroFilter] = useState("all");
  const [statoFilter, setStatoFilter] = useState("all");
  const [dataFilter, setDataFilter] = useState("");
  const consegneParams: { centroAscoltoId?: number; stato?: string; data?: string } = {};
  if (centroFilter !== "all") consegneParams.centroAscoltoId = parseInt(centroFilter);
  if (statoFilter !== "all") consegneParams.stato = statoFilter;
  if (dataFilter) consegneParams.data = dataFilter;
  const { data: consegne, isLoading } = useListConsegne(
    Object.keys(consegneParams).length > 0 ? consegneParams : undefined
  );
  const [createCentroId, setCreateCentroId] = useState("all");
  const { data: beneficiari } = useListBeneficiari({
    attivo: true,
    ...(createCentroId !== "all" ? { centroAscoltoId: parseInt(createCentroId) } : {}),
  });
  const { data: magazzini } = useListMagazzini();
  const { data: volontari } = useListVolontari();
  const { data: centri } = useListCentriAscolto();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [associatingId, setAssociatingId] = useState<number | null>(null);
  const [selectedBollaId, setSelectedBollaId] = useState<string>("");
  const [viewingBollaId, setViewingBollaId] = useState<number | null>(null);

  const { data: bolle } = useListBolle();

  const createConsegna = useCreateConsegna();
  const completaConsegna = useCompletaConsegna();
  const associaBolla = useAssociaBolla();

  const associatingConsegna = consegne?.find(c => c.id === associatingId) ?? null;
  // bolle selezionabili: stesso beneficiario, non annullate, non già consegnate, non già legate ad altra consegna
  const bolleDisponibili = (bolle ?? []).filter(b =>
    associatingConsegna != null &&
    b.beneficiarioId === associatingConsegna.beneficiarioId &&
    b.stato !== "annullato" &&
    b.stato !== "consegnato" &&
    (b.consegnaId == null || b.consegnaId === associatingConsegna.id)
  );

  const handleAssocia = (bollaId: number | null) => {
    if (!associatingId) return;
    associaBolla.mutate({ id: associatingId, data: { bollaId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: bollaId ? t("consegne.toastBollaAssociata") : t("consegne.toastBollaScollegata") });
        setAssociatingId(null);
        setSelectedBollaId("");
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: t("consegne.toastOpFallita"), description: msg ?? t("consegne.toastErrore"), variant: "destructive" });
      },
    });
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      beneficiarioId: 0, tipoConsegna: "in_sede", dataPrevista: new Date().toISOString().substring(0, 10),
      fasciaOraria: "Mattina", magazzinoId: 0, noteOperative: ""
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createConsegna.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: t("consegne.toastConsegnaProgrammata") });
        setIsFormOpen(false);
      }
    });
  };

  const handleCompleta = () => {
    if (!completingId) return;
    completaConsegna.mutate({ id: completingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: t("consegne.toastConsegnaRegistrata"), description: t("consegne.toastConsegnaRegistrataDesc") });
        setCompletingId(null);
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: t("consegne.toastImpossibileCompletare"), description: msg ?? t("consegne.toastErrore"), variant: "destructive" });
        setCompletingId(null);
      },
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("consegne.title")}</h1>
          <p className="text-muted-foreground">{t("consegne.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={consegne ?? []}
            columns={[
              { header: t("common.code"), accessor: (c) => c.codice },
              { header: t("consegne.colDataPrevista"), accessor: (c) => c.dataPrevista ? new Date(c.dataPrevista).toLocaleDateString("it-IT") : "" },
              { header: t("consegne.colFasciaOraria"), accessor: (c) => c.fasciaOraria },
              { header: t("consegne.beneficiario"), accessor: (c) => c.beneficiarioNome },
              { header: t("common.type"), accessor: (c) => c.tipoConsegna?.replace('_', ' ') },
              { header: t("common.address"), accessor: (c) => c.indirizzoConsegna },
              { header: t("consegne.zona"), accessor: (c) => c.zona },
              { header: t("consegne.magazzino"), accessor: (c) => c.magazzinoNome },
              { header: t("consegne.volontario"), accessor: (c) => c.volontarioNome },
              { header: t("common.status"), accessor: (c) => c.stato },
            ]}
            filename="consegne"
            title={t("consegne.exportTitle")}
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> {t("consegne.planDelivery")}</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={centroFilter} onValueChange={setCentroFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("consegne.filterAllCenters")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("consegne.filterAllCenters")}</SelectItem>
                {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statoFilter} onValueChange={setStatoFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("consegne.filterAllStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("consegne.filterAllStatuses")}</SelectItem>
                <SelectItem value="pianificata">{t("consegne.statoPianificata")}</SelectItem>
                <SelectItem value="effettuata">{t("consegne.statoEffettuata")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dataFilter}
              onChange={(e) => setDataFilter(e.target.value)}
              className="w-[170px]"
              aria-label={t("consegne.filterByDate")}
            />
            {dataFilter && (
              <Button variant="ghost" size="sm" onClick={() => setDataFilter("")}>
                {t("consegne.clearDate")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.code")}</TableHead>
                <TableHead>{t("consegne.thDataFascia")}</TableHead>
                <TableHead>{t("consegne.beneficiario")}</TableHead>
                <TableHead>{t("consegne.thDettagli")}</TableHead>
                <TableHead>{t("consegne.thBolla")}</TableHead>
                <TableHead className="text-center">{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("consegne.thAzione")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : consegne?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">{t("consegne.emptyState")}</TableCell>
                </TableRow>
              ) : consegne?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.codice}</TableCell>
                  <TableCell>
                    <div className="font-medium">{format(new Date(c.dataPrevista), "dd MMM yyyy", { locale: it })}</div>
                    <div className="text-xs text-muted-foreground">{c.fasciaOraria}</div>
                  </TableCell>
                  <TableCell className="font-medium">{c.beneficiarioNome}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-sm">
                      {c.tipoConsegna === 'domicilio' ? (
                        <div className="flex items-center gap-1 text-blue-600">
                          <MapPin className="h-3 w-3" /> {c.indirizzoConsegna || t("consegne.domicilioFallback")} {c.zona ? `(${c.zona})` : ''}
                        </div>
                      ) : c.tipoConsegna === 'diretta' ? (
                        <div className="flex items-center gap-1 text-emerald-600">
                          <Truck className="h-3 w-3" /> {t("consegne.consegnaDiretta")}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-purple-600">
                          <Truck className="h-3 w-3" /> {t("consegne.ritiroIn", { magazzino: c.magazzinoNome })}
                        </div>
                      )}
                      {c.volontarioNome && <div className="text-xs text-muted-foreground">{t("consegne.volontarioPrefix", { name: c.volontarioNome })}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const consegnata = c.stato === 'effettuata';
                      const pronta = c.bollaStato === 'confermato' || c.bollaStato === 'consegnato';
                      const badge = c.bollaStato == null ? (
                        <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                          <FileClock className="h-3 w-3" /> {t("consegne.inPreparazione")}
                        </Badge>
                      ) : pronta ? (
                        <Badge variant="outline" className="gap-1 border-green-200 bg-green-50 text-green-700">
                          <FileText className="h-3 w-3" /> {c.bollaNumero} · {t("consegne.pronta")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                          <FileClock className="h-3 w-3" /> {c.bollaNumero} · {t("consegne.inPreparazione")}
                        </Badge>
                      );
                      return (
                        <button
                          type="button"
                          disabled={consegnata && c.bollaId == null}
                          onClick={() => {
                            if (consegnata) {
                              if (c.bollaId != null) setViewingBollaId(c.bollaId);
                            } else {
                              setAssociatingId(c.id);
                              setSelectedBollaId(c.bollaId ? String(c.bollaId) : "");
                            }
                          }}
                          className="text-left disabled:cursor-default disabled:opacity-100 enabled:hover:opacity-80"
                          title={consegnata ? (c.bollaId != null ? t("consegne.titleViewBolla") : undefined) : t("consegne.titleManageBolla")}
                        >
                          {badge}
                        </button>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={c.stato === 'effettuata' ? 'default' : 'outline'}
                           className={c.stato === 'effettuata' ? 'bg-green-500' : 'border-blue-200 text-blue-700 bg-blue-50'}>
                      {c.stato === 'effettuata' ? t("consegne.badgeConsegnata") : t("consegne.badgePianificata")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.stato === 'effettuata' ? (
                      c.bollaId != null && (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => setViewingBollaId(c.bollaId!)}>
                          <Download className="h-3.5 w-3.5" /> {t("consegne.btnBolla")}
                        </Button>
                      )
                    ) : (
                      (c.bollaStato === 'confermato' || c.bollaStato === 'consegnato') ? (
                        <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700" onClick={() => setCompletingId(c.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("consegne.btnConsegnato")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => { setAssociatingId(c.id); setSelectedBollaId(c.bollaId ? String(c.bollaId) : ""); }}>
                          <Link2 className="h-3.5 w-3.5" /> {t("consegne.btnAssociaBolla")}
                        </Button>
                      )
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={viewingBollaId !== null} onOpenChange={(open) => { if (!open) setViewingBollaId(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>{t("consegne.bollaConsegnaTitle")}</SheetTitle></SheetHeader>
          {viewingBollaId !== null && <BollaDettaglio bollaId={viewingBollaId} />}
        </SheetContent>
      </Sheet>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{t("consegne.planDelivery")}</SheetTitle></SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormItem>
                  <FormLabel>{t("consegne.centroFilterLabel")}</FormLabel>
                  <Select value={createCentroId} onValueChange={(v) => { setCreateCentroId(v); form.setValue("beneficiarioId", 0); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("consegne.allBeneficiari")}</SelectItem>
                      {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>

                <FormField control={form.control} name="beneficiarioId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("consegne.beneficiario")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("consegne.selectPlaceholder")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {beneficiari?.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("consegne.noBeneficiarioForCentro")}</div>
                        ) : beneficiari?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.cognome} {b.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="dataPrevista" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.date")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="fasciaOraria" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("consegne.formFascia")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Mattina">{t("consegne.fasciaMattina")}</SelectItem>
                          <SelectItem value="Pomeriggio">{t("consegne.fasciaPomeriggio")}</SelectItem>
                          <SelectItem value="Sera">{t("consegne.fasciaSera")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="tipoConsegna" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("consegne.formModalita")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="in_sede">{t("consegne.modInSede")}</SelectItem>
                        <SelectItem value="domicilio">{t("consegne.modDomicilio")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                {form.watch("tipoConsegna") === "domicilio" && (
                  <div className="space-y-4 pt-2 border-t">
                    <FormField control={form.control} name="indirizzoConsegna" render={({ field }) => (
                      <FormItem><FormLabel>{t("consegne.formIndirizzo")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="zona" render={({ field }) => (
                      <FormItem><FormLabel>{t("consegne.formZona")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="volontarioId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("consegne.formVolontario")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                          <FormControl><SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="0">{t("common.none")}</SelectItem>
                            {volontari?.filter(v => {
                              if (v.centroAscoltoId == null) return true;
                              const benefCentro = beneficiari?.find(b => b.id === form.watch("beneficiarioId"))?.centroAscoltoId ?? null;
                              return benefCentro != null && v.centroAscoltoId === benefCentro;
                            }).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.nome} {v.cognome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                )}

                <div className="pt-2 border-t">
                  <FormField control={form.control} name="magazzinoId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("consegne.formMagazzino")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder={t("consegne.selectPlaceholder")} /></SelectTrigger></FormControl>
                        <SelectContent>
                          {magazzini?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createConsegna.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!completingId} onOpenChange={(open) => !open && setCompletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("consegne.dialogCompletaTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("consegne.dialogCompletaDesc")}
          </AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCompleta} className="bg-green-600 hover:bg-green-700">{t("consegne.dialogCompletaConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!associatingId} onOpenChange={(open) => { if (!open) { setAssociatingId(null); setSelectedBollaId(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consegne.dialogAssociaTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consegne.dialogAssociaDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-3">
            {bolleDisponibili.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("consegne.noBollaAvailable")} <span className="font-medium">{t("consegne.bolleSection")}</span>.
              </p>
            ) : (
              <Select value={selectedBollaId} onValueChange={setSelectedBollaId}>
                <SelectTrigger><SelectValue placeholder={t("consegne.selectBollaPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {bolleDisponibili.map(b => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.numeroBolla} · {b.stato === 'confermato' ? t("consegne.optPronta") : b.stato === 'consegnato' ? t("consegne.optConsegnata") : t("consegne.optInPreparazione")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            {associatingConsegna?.bollaId != null && (
              <Button variant="outline" className="mr-auto text-destructive" disabled={associaBolla.isPending} onClick={() => handleAssocia(null)}>
                {t("consegne.btnScollega")}
              </Button>
            )}
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              disabled={!selectedBollaId || associaBolla.isPending}
              onClick={() => handleAssocia(selectedBollaId ? parseInt(selectedBollaId) : null)}
            >
              {t("consegne.btnAssocia")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
