import { useState, useEffect } from "react";
import { useListFornitori, useCreateFornitore, useUpdateFornitore, useDeleteFornitore, useBulkFornitori, useListCentriAscolto, getListFornitoriQueryKey } from "@workspace/api-client-react";
import { BulkImportDialog, matchByName, type MapRowResult } from "@/components/bulk-import-dialog";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Pencil, Trash2, Mail, Phone, Building, Filter, Upload } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";

const formSchema = z.object({
  nome: z.string().min(2),
  tipo: z.string().min(1),
  partitaIva: z.string().optional(),
  codiceFiscale: z.string().optional(),
  indirizzo: z.string().optional(),
  comune: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  referente: z.string().optional(),
  centroAscoltoId: z.string().optional(),
  note: z.string().optional(),
  noteOperative: z.string().optional()
});

export default function Fornitori() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const [centroFilter, setCentroFilter] = useState("all");
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroFilter(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  const { data: fornitori, isLoading } = useListFornitori(
    centroFilter !== "all" ? { centroAscoltoId: parseInt(centroFilter) } : undefined
  );
  const { data: centri } = useListCentriAscolto();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createFornitore = useCreateFornitore();
  const updateFornitore = useUpdateFornitore();
  const deleteFornitore = useDeleteFornitore();
  const bulkFornitori = useBulkFornitori();
  const [isImportOpen, setIsImportOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome: "", tipo: "commerciale", telefono: "", email: "", referente: "", comune: "", centroAscoltoId: "all", noteOperative: ""
    }
  });

  const handleEdit = (f: any) => {
    setEditingId(f.id);
    form.reset({
      nome: f.nome, tipo: f.tipo, partitaIva: f.partitaIva || "", codiceFiscale: f.codiceFiscale || "",
      indirizzo: f.indirizzo || "", comune: f.comune || "", telefono: f.telefono || "", 
      email: f.email || "", referente: f.referente || "", note: f.note || "",
      centroAscoltoId: f.centroAscoltoId != null ? String(f.centroAscoltoId) : "all",
      noteOperative: f.noteOperative || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({ nome: "", tipo: "commerciale", telefono: "", email: "", referente: "", comune: "", centroAscoltoId: isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : "all", noteOperative: "" });
    setIsFormOpen(true);
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const { centroAscoltoId, ...rest } = values;
    const data = {
      ...rest,
      centroAscoltoId: centroAscoltoId && centroAscoltoId !== "all" ? parseInt(centroAscoltoId) : null,
    };
    if (editingId) {
      updateFornitore.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFornitoriQueryKey() });
          toast({ title: t("fornitori.toastUpdated") });
          setIsFormOpen(false);
        }
      });
    } else {
      createFornitore.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFornitoriQueryKey() });
          toast({ title: t("fornitori.toastCreated") });
          setIsFormOpen(false);
        }
      });
    }
  };

  const filtered = fornitori?.filter(f => f.nome.toLowerCase().includes(search.toLowerCase()));
  const centroNome = (id: number | null | undefined) => id != null ? (centri?.find(c => c.id === id)?.nome ?? "-") : "Tutti i centri";

  const tipoColors: Record<string, string> = {
    commerciale: "bg-blue-500/10 text-blue-700",
    donatore_privato: "bg-teal-500/10 text-teal-700",
    banco_alimentare: "bg-amber-500/10 text-amber-700 border-amber-200",
    ente_pubblico: "bg-purple-500/10 text-purple-700",
    altro: "bg-gray-500/10 text-gray-700"
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("fornitori.title")}</h1>
          <p className="text-muted-foreground">{t("fornitori.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={fornitori ?? []}
            columns={[
              { header: t("fornitori.nominativo"), accessor: (f) => f.nome },
              { header: t("common.type"), accessor: (f) => f.tipo ? t(`fornitori.tipi.${f.tipo}`) : "" },
              { header: t("fornitori.comune"), accessor: (f) => f.comune },
              { header: t("common.phone"), accessor: (f) => f.telefono },
              { header: t("common.email"), accessor: (f) => f.email },
              { header: t("fornitori.referente"), accessor: (f) => f.referente },
              { header: t("fornitori.centro"), accessor: (f) => f.centroAscoltoId == null ? t("fornitori.tuttiCentri") : centroNome(f.centroAscoltoId) },
              { header: t("fornitori.noteOperative"), accessor: (f) => f.noteOperative },
            ]}
            filename="fornitori"
            title={t("fornitori.exportTitle")}
          />
          <Button variant="outline" onClick={() => setIsImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> {t("bulkImport.button")}
          </Button>
          <Button onClick={handleCreate} className="gap-2"><Plus className="h-4 w-4" /> {t("fornitori.newFornitore")}</Button>
        </div>
      </div>

      <BulkImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        entityLabel={t("fornitori.title")}
        templateFilename="modello_fornitori"
        columns={[
          { key: "nome", header: t("fornitori.nominativo"), example: "Supermercato Rossi" },
          { key: "tipo", header: t("common.type"), example: "commerciale" },
          { key: "partitaIva", header: "Partita IVA", example: "" },
          { key: "codiceFiscale", header: "Codice Fiscale", example: "" },
          { key: "indirizzo", header: t("common.address"), example: "" },
          { key: "comune", header: t("fornitori.comune"), example: "Milano" },
          { key: "telefono", header: t("common.phone"), example: "021234567" },
          { key: "email", header: t("common.email"), example: "info@example.com" },
          { key: "referente", header: t("fornitori.referente"), example: "" },
          { key: "centro", header: t("fornitori.centro"), example: "" },
          { key: "noteOperative", header: t("fornitori.noteOperative"), example: "" },
        ]}
        mapRow={(r): MapRowResult<Record<string, unknown>> => {
          if (!r.nome) return { error: t("bulkImport.requiredMissing", { field: t("fornitori.nominativo") }) };
          if (!r.tipo) return { error: t("bulkImport.requiredMissing", { field: t("common.type") }) };
          let centroAscoltoId: number | null = null;
          if (r.centro) {
            const c = matchByName(centri, r.centro, (x) => x.nome);
            if (!c) return { error: t("bulkImport.unknownRef", { field: t("fornitori.centro"), value: r.centro }) };
            centroAscoltoId = c.id;
          }
          return {
            data: {
              nome: r.nome,
              tipo: r.tipo,
              partitaIva: r.partitaIva || undefined,
              codiceFiscale: r.codiceFiscale || undefined,
              indirizzo: r.indirizzo || undefined,
              comune: r.comune || undefined,
              telefono: r.telefono || undefined,
              email: r.email || undefined,
              referente: r.referente || undefined,
              centroAscoltoId,
              noteOperative: r.noteOperative || undefined,
            },
          };
        }}
        onImport={async (righe) => bulkFornitori.mutateAsync({ data: { righe: righe as never } })}
        onDone={() => queryClient.invalidateQueries({ queryKey: getListFornitoriQueryKey() })}
      />

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Input placeholder={t("fornitori.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            {isGlobal && (
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={centroFilter} onValueChange={setCentroFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder={t("fornitori.tuttiCentri")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("fornitori.tuttiCentri")}</SelectItem>
                    {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fornitori.nominativo")}</TableHead>
                <TableHead>{t("common.type")}</TableHead>
                {isGlobal && <TableHead>{t("fornitori.centro")}</TableHead>}
                <TableHead>{t("fornitori.contatti")}</TableHead>
                <TableHead>{t("fornitori.referente")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    {isGlobal && <TableCell><Skeleton className="h-5 w-24" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : filtered?.map((f) => (
                <TableRow key={f.id} className={!f.attivo ? "opacity-50" : ""}>
                  <TableCell>
                    <div className="font-medium text-base">{f.nome}</div>
                    {f.comune && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Building className="h-3 w-3" /> {f.comune}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize ${tipoColors[f.tipo] || tipoColors.altro}`}>
                      {t(`fornitori.tipi.${f.tipo}`)}
                    </Badge>
                  </TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm">
                      {f.centroAscoltoId == null
                        ? <span className="text-muted-foreground italic">{t("fornitori.tuttiCentri")}</span>
                        : centroNome(f.centroAscoltoId)}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                      {f.telefono && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {f.telefono}</div>}
                      {f.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {f.email}</div>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{f.referente || "-"}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(f)}><Pencil className="mr-2 h-4 w-4" /> {t("common.edit")}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(f.id)}><Trash2 className="mr-2 h-4 w-4" /> {t("common.delete")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{editingId ? t("fornitori.sheetEditTitle") : t("fornitori.sheetNewTitle")}</SheetTitle></SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("fornitori.nominativoLabel")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="tipo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fornitori.tipologia")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="commerciale">{t("fornitori.tipi.commerciale")}</SelectItem>
                        <SelectItem value="donatore_privato">{t("fornitori.tipi.donatore_privato")}</SelectItem>
                        <SelectItem value="banco_alimentare">{t("fornitori.tipi.banco_alimentare")}</SelectItem>
                        <SelectItem value="ente_pubblico">{t("fornitori.tipi.ente_pubblico")}</SelectItem>
                        <SelectItem value="altro">{t("fornitori.tipi.altro")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="telefono" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.phone")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.email")}</FormLabel><FormControl><Input type="email" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="referente" render={({ field }) => (
                  <FormItem><FormLabel>{t("fornitori.personaRiferimento")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fornitori.centroAscolto")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || "all"} disabled={isCentroLocked}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">{t("fornitori.tuttiCentri")}</SelectItem>
                        {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="noteOperative" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fornitori.noteOperative")}</FormLabel>
                    <FormControl><Textarea rows={4} placeholder={t("fornitori.noteOperativePlaceholder")} {...field} /></FormControl>
                  </FormItem>
                )} />
                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createFornitore.isPending || updateFornitore.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("fornitori.confirmDelete")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deletingId) {
                deleteFornitore.mutate({ id: deletingId }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getListFornitoriQueryKey() });
                    setDeletingId(null);
                  }
                });
              }
            }} className="bg-destructive text-destructive-foreground">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
