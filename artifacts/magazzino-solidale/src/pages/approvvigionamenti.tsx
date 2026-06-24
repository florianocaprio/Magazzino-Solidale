import { useState } from "react";
import {
  useListApprovvigionamenti,
  useCreateApprovvigionamento,
  useUpdateApprovvigionamento,
  useSubmitApprovvigionamento,
  useListFornitori,
  useListMagazzini,
  useListCentriAscolto,
  getListApprovvigionamentiQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, ShoppingCart, Pencil, Send, CheckCircle2, XCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";

const formSchema = z.object({
  fornitoreId: z.coerce.number().optional(),
  magazzinoId: z.coerce.number().optional(),
  centroAscoltoId: z.coerce.number().optional(),
  dataRichiesta: z.string().min(1),
  dataPrevista: z.string().optional(),
  note: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface OrderRow {
  id: number;
  codice: string;
  stato: string;
  fornitoreId?: number | null;
  fornitoreNome?: string | null;
  magazzinoId?: number | null;
  magazzinoNome?: string | null;
  centroAscoltoId?: number | null;
  centroAscoltoNome?: string | null;
  dataRichiesta: string;
  dataPrevista?: string | null;
  note?: string | null;
}

export default function Approvvigionamenti() {
  const [filterMagazzinoId, setFilterMagazzinoId] = useState("all");
  const [filterCentroId, setFilterCentroId] = useState("all");
  const [filterStato, setFilterStato] = useState("all");

  const listParams: { magazzinoId?: number; centroAscoltoId?: number; stato?: string } = {};
  if (filterMagazzinoId !== "all") listParams.magazzinoId = parseInt(filterMagazzinoId);
  if (filterCentroId !== "all") listParams.centroAscoltoId = parseInt(filterCentroId);
  if (filterStato !== "all") listParams.stato = filterStato;
  const hasParams = Object.keys(listParams).length > 0;
  const filtersActive = hasParams;

  const { data: approvvigionamenti, isLoading } = useListApprovvigionamenti(hasParams ? listParams : undefined);
  const { data: fornitori } = useListFornitori();
  const { data: magazzini } = useListMagazzini();
  const { data: centri } = useListCentriAscolto();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const createApprovvigionamento = useCreateApprovvigionamento();
  const updateApprovvigionamento = useUpdateApprovvigionamento();
  const submitApprovvigionamento = useSubmitApprovvigionamento();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dataRichiesta: new Date().toISOString().substring(0, 10),
      note: "",
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListApprovvigionamentiQueryKey() });

  const openCreate = () => {
    setEditingId(null);
    form.reset({ dataRichiesta: new Date().toISOString().substring(0, 10), note: "" });
    setIsFormOpen(true);
  };

  const openEdit = (a: OrderRow) => {
    setEditingId(a.id);
    form.reset({
      fornitoreId: a.fornitoreId ?? undefined,
      magazzinoId: a.magazzinoId ?? undefined,
      centroAscoltoId: a.centroAscoltoId ?? undefined,
      dataRichiesta: a.dataRichiesta ? a.dataRichiesta.substring(0, 10) : new Date().toISOString().substring(0, 10),
      dataPrevista: a.dataPrevista ? a.dataPrevista.substring(0, 10) : undefined,
      note: a.note ?? "",
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    if (editingId !== null) {
      updateApprovvigionamento.mutate(
        { id: editingId, data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: "Ordine aggiornato" });
            setIsFormOpen(false);
          },
        },
      );
    } else {
      createApprovvigionamento.mutate(
        { data: { ...data, righe: [] } },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: "Bozza salvata" });
            setIsFormOpen(false);
          },
        },
      );
    }
  };

  const handleSottometti = (a: OrderRow) => {
    submitApprovvigionamento.mutate(
      { id: a.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Ordine sottomesso", description: "Email inviata all'amministrazione." });
        },
      },
    );
  };

  const handleCompleta = (a: OrderRow) => {
    updateApprovvigionamento.mutate(
      { id: a.id, data: { stato: "completato" } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Ordine completato" });
        },
      },
    );
  };

  const getStatusBadge = (stato: string) => {
    switch (stato) {
      case "bozza":
        return <Badge variant="secondary">Bozza</Badge>;
      case "sottomesso":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Sottomesso</Badge>;
      case "completato":
        return <Badge variant="outline" className="bg-green-500/10 text-green-700 border-none">Completato</Badge>;
      // legacy values
      case "inviata":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Inviata</Badge>;
      case "confermata":
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Confermata</Badge>;
      case "completata":
        return <Badge variant="outline" className="bg-green-500/10 text-green-700 border-none">Completata</Badge>;
      default:
        return <Badge>{stato}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ordini & Approvvigionamenti</h1>
          <p className="text-muted-foreground">Gestisci gli ordini in entrata e le donazioni programmate.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={approvvigionamenti ?? []}
            columns={[
              { header: "Codice", accessor: (a) => a.codice },
              { header: "Data Richiesta", accessor: (a) => (a.dataRichiesta ? new Date(a.dataRichiesta).toLocaleDateString("it-IT") : "") },
              { header: "Fornitore", accessor: (a) => a.fornitoreNome ?? "" },
              { header: "Magazzino", accessor: (a) => a.magazzinoNome ?? "" },
              { header: "Centro di Ascolto", accessor: (a) => a.centroAscoltoNome ?? "" },
              { header: "Data Prevista", accessor: (a) => (a.dataPrevista ? new Date(a.dataPrevista).toLocaleDateString("it-IT") : "") },
              { header: "Stato", accessor: (a) => a.stato },
            ]}
            filename="approvvigionamenti"
            title="Approvvigionamenti"
          />
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Nuovo Ordine</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Magazzino</Label>
          <Select value={filterMagazzinoId} onValueChange={setFilterMagazzinoId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tutti i magazzini" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i magazzini</SelectItem>
              {(magazzini ?? []).map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Centro di Ascolto</Label>
          <Select value={filterCentroId} onValueChange={setFilterCentroId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tutti i centri" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i centri</SelectItem>
              {(centri ?? []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Stato</Label>
          <Select value={filterStato} onValueChange={setFilterStato}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tutti gli stati" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              <SelectItem value="bozza">Bozza</SelectItem>
              <SelectItem value="sottomesso">Sottomesso</SelectItem>
              <SelectItem value="completato">Completato</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filtersActive && (
          <Button
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            onClick={() => { setFilterMagazzinoId("all"); setFilterCentroId("all"); setFilterStato("all"); }}
          >
            <XCircle className="h-4 w-4" /> Azzera filtri
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codice</TableHead>
                <TableHead>Data Richiesta</TableHead>
                <TableHead>Fornitore</TableHead>
                <TableHead>Magazzino</TableHead>
                <TableHead>Centro di Ascolto</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : approvvigionamenti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Nessun ordine registrato.</TableCell>
                </TableRow>
              ) : approvvigionamenti?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <ShoppingCart className="h-4 w-4 text-muted-foreground" /> {a.codice}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{format(new Date(a.dataRichiesta), "dd MMM yyyy", { locale: it })}</TableCell>
                  <TableCell className="font-medium">{a.fornitoreNome || <span className="text-muted-foreground italic">-</span>}</TableCell>
                  <TableCell className="text-sm">{a.magazzinoNome || <span className="text-muted-foreground italic">-</span>}</TableCell>
                  <TableCell className="text-sm">{a.centroAscoltoNome || <span className="text-muted-foreground italic">-</span>}</TableCell>
                  <TableCell className="text-center">{getStatusBadge(a.stato)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {a.stato === "bozza" && (
                        <>
                          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openEdit(a)}>
                            <Pencil className="h-3.5 w-3.5" /> Modifica
                          </Button>
                          <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={submitApprovvigionamento.isPending}
                            onClick={() => handleSottometti(a)}
                          >
                            <Send className="h-3.5 w-3.5" /> Sottometti
                          </Button>
                        </>
                      )}
                      {a.stato === "sottomesso" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                          disabled={updateApprovvigionamento.isPending}
                          onClick={() => handleCompleta(a)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Completato
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingId !== null ? "Modifica Ordine" : "Nuovo Ordine"}</SheetTitle>
            <SheetDescription>
              {editingId !== null
                ? "Modifica l'ordine. Resta in bozza finché non clicchi Sottometti."
                : "Crea una bozza d'ordine. Potrai modificarla finché non la sottometti."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="fornitoreId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fornitore / Donatore</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {fornitori?.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="magazzinoId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Magazzino</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          {magazzini?.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Centro di Ascolto</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          {centri?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="dataRichiesta" render={({ field }) => (
                    <FormItem><FormLabel>Data Richiesta</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="dataPrevista" render={({ field }) => (
                    <FormItem><FormLabel>Data Prevista Consegna</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note / Materiale richiesto</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={10}
                        placeholder="Elenca tutto il materiale necessario per questo ordine..."
                        className="min-h-[200px] resize-y"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )} />
                <div className="pt-4 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createApprovvigionamento.isPending || updateApprovvigionamento.isPending}>
                    {editingId !== null ? "Salva modifiche" : "Salva bozza"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
