import { useState, useEffect } from "react";
import { useListInterventi, useCreateIntervento, useUpdateIntervento, useListBeneficiari, useListCentriAscolto, getListInterventiQueryKey, type Intervento } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, Filter, ClipboardList, Calendar, StickyNote } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";

const formSchema = z.object({
  beneficiarioId: z.coerce.number().min(1),
  tipoIntervento: z.string().min(1),
  dataIntervento: z.string().min(1),
  descrizione: z.string().min(1),
  esito: z.string().optional(),
  note: z.string().optional(),
  prossimAzione: z.string().optional(),
  dataFollowup: z.string().optional(),
  scadenzaIsee: z.string().optional(),
  scadenzaRinnovo: z.string().optional(),
  scadenzaAutodichiarazioneIndigenza: z.string().optional()
});

export default function Interventi() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const [tipoFilter, setTipoFilter] = useState("all");
  const [centroFilter, setCentroFilter] = useState("all");
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroFilter(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  const { data: interventi, isLoading } = useListInterventi({
    tipo: tipoFilter !== "all" ? tipoFilter : undefined,
    centroAscoltoId: centroFilter !== "all" ? parseInt(centroFilter) : undefined,
  });
  const { data: beneficiari } = useListBeneficiari();
  const { data: centri } = useListCentriAscolto();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);

  const createIntervento = useCreateIntervento();
  const updateIntervento = useUpdateIntervento();
  const [noteEditing, setNoteEditing] = useState<Intervento | null>(null);
  const [noteText, setNoteText] = useState("");

  const saveNote = () => {
    if (!noteEditing) return;
    updateIntervento.mutate(
      { id: noteEditing.id, data: { note: noteText } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInterventiQueryKey() });
          toast({ title: t("interventi.toastNoteSaved") });
          setNoteEditing(null);
        },
      },
    );
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      beneficiarioId: 0,
      tipoIntervento: "colloquio",
      dataIntervento: new Date().toISOString().substring(0, 10),
      descrizione: "",
      esito: "",
      note: "",
      prossimAzione: "",
      dataFollowup: "",
      scadenzaIsee: "",
      scadenzaRinnovo: "",
      scadenzaAutodichiarazioneIndigenza: ""
    }
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const data = {
      ...values,
      dataFollowup: values.dataFollowup || undefined,
      scadenzaIsee: values.scadenzaIsee || undefined,
      scadenzaRinnovo: values.scadenzaRinnovo || undefined,
      scadenzaAutodichiarazioneIndigenza: values.scadenzaAutodichiarazioneIndigenza || undefined,
    };
    createIntervento.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInterventiQueryKey() });
        toast({ title: t("interventi.toastRegistered") });
        setIsFormOpen(false);
      }
    });
  };

  const getSingleBadge = (tipo: string) => {
    switch(tipo) {
      case 'colloquio': return <Badge key={tipo} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">{t("interventi.colloquio")}</Badge>;
      case 'pacco_alimentare': return <Badge key={tipo} variant="outline" className="bg-green-50 text-green-700 border-green-200">{t("interventi.paccoAlimentare")}</Badge>;
      case 'vestiti':
      case 'vestiario': return <Badge key={tipo} variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">{t("interventi.badgeVestiti")}</Badge>;
      case 'igiene': return <Badge key={tipo} variant="outline" className="bg-cyan-50 text-cyan-700 border-cyan-200">{t("interventi.igiene")}</Badge>;
      case 'medicinali': return <Badge key={tipo} variant="outline" className="bg-red-50 text-red-700 border-red-200">{t("interventi.medicinali")}</Badge>;
      default: return <Badge key={tipo} variant="outline" className="capitalize">{tipo.replace('_', ' ')}</Badge>;
    }
  };

  const getTipoBadge = (tipo: string) => {
    const tipi = tipo.split(",").map(t => t.trim()).filter(Boolean);
    return <div className="flex flex-wrap gap-1">{tipi.map(getSingleBadge)}</div>;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("interventi.title")}</h1>
          <p className="text-muted-foreground">{t("interventi.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={interventi ?? []}
            columns={[
              { header: t("interventi.beneficiario"), accessor: (i) => i.beneficiarioNome },
              { header: t("common.date"), accessor: (i) => i.dataIntervento ? new Date(i.dataIntervento).toLocaleDateString("it-IT") : "" },
              { header: t("interventi.tipoIntervento"), accessor: (i) => i.tipoIntervento },
              { header: t("interventi.operatore"), accessor: (i) => i.operatoreCodice },
              { header: t("common.description"), accessor: (i) => i.descrizione },
              { header: t("interventi.esito"), accessor: (i) => i.esito },
              { header: t("interventi.scadenzaIseeCol"), accessor: (i) => i.scadenzaIsee ? new Date(i.scadenzaIsee).toLocaleDateString("it-IT") : "" },
              { header: t("interventi.scadenzaRinnovoCol"), accessor: (i) => i.scadenzaRinnovo ? new Date(i.scadenzaRinnovo).toLocaleDateString("it-IT") : "" },
              { header: t("interventi.scadenzaAutodichCol"), accessor: (i) => i.scadenzaAutodichiarazioneIndigenza ? new Date(i.scadenzaAutodichiarazioneIndigenza).toLocaleDateString("it-IT") : "" },
            ]}
            filename="interventi"
            title={t("interventi.exportTitle")}
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> {t("interventi.registerIntervention")}</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("interventi.filterAllTypes")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("interventi.filterAllTypes")}</SelectItem>
                <SelectItem value="colloquio">{t("interventi.colloqui")}</SelectItem>
                <SelectItem value="pacco_alimentare">{t("interventi.paccoAlimentare")}</SelectItem>
                <SelectItem value="vestiario">{t("interventi.vestiario")}</SelectItem>
                <SelectItem value="orientamento">{t("interventi.orientamento")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={centroFilter} onValueChange={setCentroFilter} disabled={isCentroLocked}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("interventi.filterAllCenters")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("interventi.filterAllCenters")}</SelectItem>
                {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("interventi.beneficiario")}</TableHead>
                <TableHead>{t("interventi.tipoIntervento")}</TableHead>
                <TableHead>{t("interventi.operatore")}</TableHead>
                <TableHead>{t("common.description")}</TableHead>
                <TableHead>{t("interventi.thScadenze")}</TableHead>
                <TableHead>{t("interventi.thFollowup")}</TableHead>
                <TableHead className="text-right">{t("interventi.thAzioni")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : interventi?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">{t("interventi.emptyState")}</TableCell>
                </TableRow>
              ) : interventi?.map((i) => (
                <TableRow key={i.id} className={i.note ? "bg-amber-50/60" : ""}>
                  <TableCell className="text-sm font-medium">
                    {format(new Date(i.dataIntervento), "dd/MM/yyyy")}
                  </TableCell>
                  <TableCell className="font-medium">{i.beneficiarioNome}</TableCell>
                  <TableCell>{getTipoBadge(i.tipoIntervento)}</TableCell>
                  <TableCell className="text-sm">
                    {i.operatoreCodice ? (
                      <Badge variant="secondary" className="font-mono">{i.operatoreCodice}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[300px]">
                    {i.descrizione}
                  </TableCell>
                  <TableCell className="text-xs">
                    {(i.scadenzaIsee || i.scadenzaRinnovo || i.scadenzaAutodichiarazioneIndigenza) ? (
                      <div className="flex flex-col gap-0.5">
                        {i.scadenzaIsee && <span><span className="text-muted-foreground">{t("interventi.labelIsee")}</span> {format(new Date(i.scadenzaIsee), "dd/MM/yyyy")}</span>}
                        {i.scadenzaRinnovo && <span><span className="text-muted-foreground">{t("interventi.labelRinnovo")}</span> {format(new Date(i.scadenzaRinnovo), "dd/MM/yyyy")}</span>}
                        {i.scadenzaAutodichiarazioneIndigenza && <span><span className="text-muted-foreground">{t("interventi.labelAutodich")}</span> {format(new Date(i.scadenzaAutodichiarazioneIndigenza), "dd/MM/yyyy")}</span>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.dataFollowup ? (
                      <div className="flex items-center gap-1 text-amber-600">
                        <Calendar className="h-3 w-3" /> {format(new Date(i.dataFollowup), "dd/MM")}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={i.note ? "secondary" : "ghost"}
                      size="sm"
                      className={`gap-1 ${i.note ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : ""}`}
                      onClick={() => { setNoteEditing(i); setNoteText(i.note ?? ""); }}
                    >
                      <StickyNote className="h-3.5 w-3.5" />
                      {i.note ? t("interventi.editNote") : t("interventi.addNote")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("interventi.newIntervention")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="beneficiarioId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("interventi.beneficiario")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("interventi.selectPlaceholder")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {beneficiari?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.cognome} {b.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="tipoIntervento" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.type")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="colloquio">{t("interventi.colloquio")}</SelectItem>
                          <SelectItem value="pacco_alimentare">{t("interventi.paccoAlimentare")}</SelectItem>
                          <SelectItem value="vestiario">{t("interventi.vestiario")}</SelectItem>
                          <SelectItem value="orientamento">{t("interventi.orientamento")}</SelectItem>
                          <SelectItem value="altro">{t("interventi.optAltro")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="dataIntervento" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.date")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="descrizione" render={({ field }) => (
                  <FormItem><FormLabel>{t("interventi.descrizioneLabel")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="esito" render={({ field }) => (
                  <FormItem><FormLabel>{t("interventi.esito")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>{t("interventi.noteFormLabel")}</FormLabel><FormControl><Textarea rows={3} placeholder={t("interventi.notePlaceholder")} {...field} /></FormControl></FormItem>
                )} />
                
                <div className="pt-4 border-t space-y-4">
                  <FormField control={form.control} name="prossimAzione" render={({ field }) => (
                    <FormItem><FormLabel>{t("interventi.prossimaAzione")}</FormLabel><FormControl><Input placeholder={t("interventi.prossimaAzionePlaceholder")} {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="dataFollowup" render={({ field }) => (
                    <FormItem><FormLabel>{t("interventi.dataFollowup")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="pt-4 border-t space-y-4">
                  <h4 className="text-sm font-semibold text-muted-foreground">{t("interventi.scadenzeDocumenti")}</h4>
                  <FormField control={form.control} name="scadenzaIsee" render={({ field }) => (
                    <FormItem><FormLabel>{t("interventi.scadenzaIseeCol")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="scadenzaRinnovo" render={({ field }) => (
                    <FormItem><FormLabel>{t("interventi.scadenzaRinnovoForm")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="scadenzaAutodichiarazioneIndigenza" render={({ field }) => (
                    <FormItem><FormLabel>{t("interventi.scadenzaAutodichForm")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createIntervento.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={noteEditing != null} onOpenChange={(open) => !open && setNoteEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("interventi.noteDialogTitle")}</DialogTitle>
          </DialogHeader>
          {noteEditing && (
            <p className="text-sm text-muted-foreground -mt-2">
              {noteEditing.beneficiarioNome} · {format(new Date(noteEditing.dataIntervento), "dd/MM/yyyy")}
            </p>
          )}
          <Textarea
            rows={5}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={t("interventi.notePlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={saveNote} disabled={updateIntervento.isPending}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
