import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useListVolontari, useCreateVolontario, useUpdateVolontario, useDeleteVolontario, useBulkVolontari, getListVolontariQueryKey, useListCentriAscolto, useListRuoliVolontari } from "@workspace/api-client-react";
import { BulkImportDialog, matchByName, parseBoolCell, type MapRowResult } from "@/components/bulk-import-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Pencil, Trash2, Mail, Phone, CheckCircle2, XCircle, Upload } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";

export default function Volontari() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const formSchema = z.object({
    nome: z.string().min(2, t("volontari.valNome")),
    cognome: z.string().min(2, t("volontari.valCognome")),
    matricola: z.string().min(1, t("volontari.valMatricola")),
    telefono: z.string().optional(),
    email: z.string().email(t("volontari.valEmail")).optional().or(z.literal("")),
    ruolo: z.string().min(1, t("volontari.valRuolo")),
    patente: z.boolean().default(false),
    mezzoPersonale: z.boolean().default(false),
    maxConsegneTurno: z.coerce.number().min(1).default(5),
    centroAscoltoId: z.number().nullable().default(null),
    note: z.string().optional()
  });
  const { data: volontari, isLoading } = useListVolontari();
  const { data: centri } = useListCentriAscolto();
  const { data: ruoliVolontari } = useListRuoliVolontari();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [centroFilter, setCentroFilter] = useState<string>("all");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createVolontario = useCreateVolontario();
  const updateVolontario = useUpdateVolontario();
  const deleteVolontario = useDeleteVolontario();
  const bulkVolontari = useBulkVolontari();
  const [isImportOpen, setIsImportOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome: "", cognome: "", matricola: "", telefono: "", email: "",
      ruolo: "magazziniere", patente: false, mezzoPersonale: false,
      maxConsegneTurno: 5, centroAscoltoId: null, note: ""
    }
  });

  const handleEdit = (volontario: any) => {
    setEditingId(volontario.id);
    form.reset({
      nome: volontario.nome,
      cognome: volontario.cognome,
      matricola: volontario.matricola || "",
      telefono: volontario.telefono || "",
      email: volontario.email || "",
      ruolo: volontario.ruolo,
      patente: volontario.patente,
      mezzoPersonale: volontario.mezzoPersonale,
      maxConsegneTurno: volontario.maxConsegneTurno,
      centroAscoltoId: volontario.centroAscoltoId ?? null,
      note: volontario.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      nome: "", cognome: "", matricola: "", telefono: "", email: "",
      ruolo: "magazziniere", patente: false, mezzoPersonale: false,
      maxConsegneTurno: 5, centroAscoltoId: isCentroLocked && lockedCentroId != null ? lockedCentroId : null, note: ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingId) {
      updateVolontario.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
          toast({ title: t("volontari.toastUpdated") });
          setIsFormOpen(false);
        }
      });
    } else {
      createVolontario.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
          toast({ title: t("volontari.toastCreated") });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteVolontario.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
        toast({ title: t("volontari.toastDeleted") });
        setDeletingId(null);
      }
    });
  };

  const toggleStatus = (volontario: any) => {
    updateVolontario.mutate({ id: volontario.id, data: { attivo: !volontario.attivo } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
      }
    });
  };

  const filtered = volontari?.filter(v => {
    const matchesSearch =
      v.nome.toLowerCase().includes(search.toLowerCase()) ||
      v.cognome.toLowerCase().includes(search.toLowerCase());
    const matchesCentro = centroFilter === "all" || v.centroAscoltoId === parseInt(centroFilter);
    return matchesSearch && matchesCentro;
  });

  const roleLabel = (ruolo: string) => t(`volontari.roles.${ruolo}`, { defaultValue: ruolo.replace('_', ' ') });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("volontari.title")}</h1>
          <p className="text-muted-foreground">{t("volontari.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={volontari ?? []}
            columns={[
              { header: t("common.name"), accessor: (v) => v.nome },
              { header: t("common.surname"), accessor: (v) => v.cognome },
              { header: t("volontari.centroAscolto"), accessor: (v) => v.centroAscoltoNome ?? t("volontari.tuttiCentri") },
              { header: t("common.email"), accessor: (v) => v.email },
              { header: t("common.phone"), accessor: (v) => v.telefono },
              { header: t("volontari.ruolo"), accessor: (v) => roleLabel(v.ruolo) },
              { header: t("volontari.patente"), accessor: (v) => (v.patente ? t("common.yes") : t("common.no")) },
              { header: t("common.active"), accessor: (v) => (v.attivo ? t("common.yes") : t("common.no")) },
            ]}
            filename="volontari"
            title={t("volontari.exportTitle")}
            orientation="landscape"
          />
          <Button variant="outline" onClick={() => setIsImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> {t("bulkImport.button")}
          </Button>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("volontari.newVolontario")}
          </Button>
        </div>
      </div>

      <BulkImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        entityLabel={t("volontari.title")}
        templateFilename="modello_volontari"
        columns={[
          { key: "nome", header: t("common.name"), example: "Mario" },
          { key: "cognome", header: t("common.surname"), example: "Rossi" },
          { key: "matricola", header: t("volontari.matricola"), example: "MR-001" },
          { key: "ruolo", header: t("volontari.ruolo"), example: "magazziniere" },
          { key: "telefono", header: t("common.phone"), example: "3331234567" },
          { key: "email", header: t("common.email"), example: "mario.rossi@example.com" },
          { key: "patente", header: t("volontari.patente"), example: "No" },
          { key: "mezzoPersonale", header: t("volontari.mezzoPersonale"), example: "No" },
          { key: "maxConsegneTurno", header: t("volontari.maxConsegne"), example: 5 },
          { key: "centro", header: t("volontari.centroAscolto"), example: "" },
          { key: "note", header: t("common.notes"), example: "" },
        ]}
        mapRow={(r): MapRowResult<Record<string, unknown>> => {
          if (!r.nome) return { error: t("bulkImport.requiredMissing", { field: t("common.name") }) };
          if (!r.cognome) return { error: t("bulkImport.requiredMissing", { field: t("common.surname") }) };
          if (!r.matricola) return { error: t("bulkImport.requiredMissing", { field: t("volontari.matricola") }) };
          if (!r.ruolo) return { error: t("bulkImport.requiredMissing", { field: t("volontari.ruolo") }) };
          let centroAscoltoId: number | null = null;
          if (r.centro) {
            const c = matchByName(centri, r.centro, (x) => x.nome);
            if (!c) return { error: t("bulkImport.unknownRef", { field: t("volontari.centroAscolto"), value: r.centro }) };
            centroAscoltoId = c.id;
          }
          let maxConsegneTurno: number | undefined;
          if (r.maxConsegneTurno) {
            const n = Number(r.maxConsegneTurno);
            if (Number.isNaN(n)) return { error: t("bulkImport.invalidNumber", { field: t("volontari.maxConsegne") }) };
            maxConsegneTurno = n;
          }
          return {
            data: {
              nome: r.nome,
              cognome: r.cognome,
              matricola: r.matricola,
              ruolo: r.ruolo,
              telefono: r.telefono || undefined,
              email: r.email || undefined,
              patente: parseBoolCell(r.patente),
              mezzoPersonale: parseBoolCell(r.mezzoPersonale),
              maxConsegneTurno,
              centroAscoltoId,
              note: r.note || undefined,
            },
          };
        }}
        onImport={async (righe) => bulkVolontari.mutateAsync({ data: { righe: righe as never } })}
        onDone={() => queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() })}
      />

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-wrap items-center gap-3">
            <Input 
              placeholder={t("volontari.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            {isGlobal && (
              <Select value={centroFilter} onValueChange={setCentroFilter}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder={t("common.tuttiCentri")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.tuttiCentri")}</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                {isGlobal && <TableHead>{t("volontari.centroAscolto")}</TableHead>}
                <TableHead>{t("volontari.contatti")}</TableHead>
                <TableHead>{t("volontari.ruolo")}</TableHead>
                <TableHead className="text-center">{t("volontari.patente")}</TableHead>
                <TableHead className="text-center">{t("volontari.mezzoProprio")}</TableHead>
                <TableHead className="text-center">{t("common.status")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    {isGlobal && <TableCell><Skeleton className="h-5 w-28" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobal ? 8 : 7} className="h-32 text-center text-muted-foreground">
                    {t("volontari.empty")}
                  </TableCell>
                </TableRow>
              ) : filtered?.map((v) => (
                <TableRow key={v.id} className={!v.attivo ? "opacity-60" : ""}>
                  <TableCell>
                    <div className="font-medium">{v.nome} {v.cognome}</div>
                  </TableCell>
                  {isGlobal && (
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{v.centroAscoltoNome ?? t("volontari.tuttiCentri")}</span>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                      {v.telefono && <div className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {v.telefono}</div>}
                      {v.email && <div className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {v.email}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {roleLabel(v.ruolo)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {v.patente ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" /> : <XCircle className="h-4 w-4 text-muted mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    {v.mezzoPersonale ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" /> : <XCircle className="h-4 w-4 text-muted mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch checked={v.attivo} onCheckedChange={() => toggleStatus(v)} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("volontari.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(v)}>
                          <Pencil className="mr-2 h-4 w-4" /> {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(v.id)}>
                          <Trash2 className="mr-2 h-4 w-4" /> {t("common.delete")}
                        </DropdownMenuItem>
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
          <SheetHeader>
            <SheetTitle>{editingId ? t("volontari.sheetEditTitle") : t("volontari.sheetNewTitle")}</SheetTitle>
            <SheetDescription>{t("volontari.sheetDesc")}</SheetDescription>
          </SheetHeader>
          
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.name")}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="cognome" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.surname")}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="matricola" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("volontari.matricola")}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="telefono" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.phone")}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.email")}</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="ruolo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("volontari.ruoloPrincipale")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {ruoliVolontari
                          ?.filter((r) => r.attivo || r.nome === field.value)
                          .map((r) => (
                            <SelectItem key={r.id} value={r.nome}>{roleLabel(r.nome)}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("volontari.centroAscolto")}</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "all" ? null : Number(v))}
                      value={field.value == null ? "all" : String(field.value)}
                      disabled={isCentroLocked}
                    >
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="all">{t("volontari.tuttiCentri")}</SelectItem>
                        {centri?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("volontari.centroHint")}</p>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="space-y-4 pt-4 border-t">
                  <FormField control={form.control} name="patente" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel>{t("volontari.patenteB")}</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="mezzoPersonale" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel>{t("volontari.mezzoPersonale")}</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="maxConsegneTurno" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("volontari.maxConsegne")}</FormLabel>
                    <FormControl><Input type="number" min="1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createVolontario.isPending || updateVolontario.isPending}>
                    {editingId ? t("volontari.saveChanges") : t("volontari.createBtn")}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("volontari.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("volontari.confirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
