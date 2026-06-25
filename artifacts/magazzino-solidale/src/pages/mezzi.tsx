import { useState } from "react";
import { useListMezzi, useCreateMezzo, useUpdateMezzo, useDeleteMezzo, useListVolontari, useListCentriAscolto, getListMezziQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
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
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Pencil, Trash2, Calendar } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";

const NO_CENTRO = "__none__";
const NO_VOLONTARIO = "__none__";

export default function Mezzi() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const formSchema = z.object({
    codice: z.string().min(2, t("mezzi.valCodice")),
    tipo: z.string().min(1, t("mezzi.valTipo")),
    targa: z.string().optional(),
    proprieta: z.string().default("associazione"),
    proprietarioNome: z.string().optional(),
    volontarioId: z.string().optional(),
    centroAscoltoId: z.string().optional(),
    capacitaColli: z.coerce.number().optional(),
    capacitaKg: z.coerce.number().optional(),
    scadenzaAssicurazione: z.string().optional(),
    scadenzaRevisione: z.string().optional(),
    note: z.string().optional()
  });
  const { data: mezzi, isLoading } = useListMezzi();
  const { data: volontari } = useListVolontari();
  const { data: centri } = useListCentriAscolto();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [centroFilter, setCentroFilter] = useState<string>("all");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createMezzo = useCreateMezzo();
  const updateMezzo = useUpdateMezzo();
  const deleteMezzo = useDeleteMezzo();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      codice: "", tipo: "furgone", targa: "", proprieta: "associazione", proprietarioNome: "",
      volontarioId: NO_VOLONTARIO, centroAscoltoId: NO_CENTRO, note: ""
    }
  });

  const proprietaWatch = form.watch("proprieta");

  const handleEdit = (mezzo: any) => {
    setEditingId(mezzo.id);
    form.reset({
      codice: mezzo.codice,
      tipo: mezzo.tipo,
      targa: mezzo.targa || "",
      proprieta: mezzo.proprieta,
      proprietarioNome: mezzo.proprietarioNome || "",
      volontarioId: mezzo.volontarioId != null ? String(mezzo.volontarioId) : NO_VOLONTARIO,
      centroAscoltoId: mezzo.centroAscoltoId != null ? String(mezzo.centroAscoltoId) : NO_CENTRO,
      capacitaColli: mezzo.capacitaColli || 0,
      capacitaKg: mezzo.capacitaKg || 0,
      scadenzaAssicurazione: mezzo.scadenzaAssicurazione ? mezzo.scadenzaAssicurazione.substring(0, 10) : "",
      scadenzaRevisione: mezzo.scadenzaRevisione ? mezzo.scadenzaRevisione.substring(0, 10) : "",
      note: mezzo.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      codice: "", tipo: "furgone", targa: "", proprieta: "associazione", proprietarioNome: "",
      volontarioId: NO_VOLONTARIO,
      centroAscoltoId: isCentroLocked ? String(lockedCentroId) : NO_CENTRO, note: ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const { volontarioId: volStr, centroAscoltoId: centroStr, ...rest } = data;
    const isVolontario = data.proprieta === "volontario";
    const volontarioId = isVolontario && volStr && volStr !== NO_VOLONTARIO ? parseInt(volStr, 10) : null;
    const centroAscoltoId = isVolontario
      ? null
      : isCentroLocked
        ? lockedCentroId
        : !centroStr || centroStr === NO_CENTRO
          ? null
          : parseInt(centroStr, 10);
    const payload = { ...rest, volontarioId, centroAscoltoId };
    if (editingId) {
      updateMezzo.mutate({ id: editingId, data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMezziQueryKey() });
          toast({ title: t("mezzi.toastUpdated") });
          setIsFormOpen(false);
        }
      });
    } else {
      createMezzo.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMezziQueryKey() });
          toast({ title: t("mezzi.toastCreated") });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteMezzo.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMezziQueryKey() });
        toast({ title: t("mezzi.toastDeleted") });
        setDeletingId(null);
      }
    });
  };

  const isExpiringSoon = (dateStr?: string | null) => {
    if (!dateStr) return false;
    const diff = new Date(dateStr).getTime() - new Date().getTime();
    return diff < 30 * 24 * 60 * 60 * 1000;
  };

  const filtered = mezzi?.filter(m =>
    centroFilter === "all" || m.effectiveCentroId === parseInt(centroFilter)
  );

  const tipoLabel = (tipo?: string | null) => tipo ? t(`mezzi.tipos.${tipo}`, { defaultValue: tipo.replace('_', ' ') }) : "";
  const proprietaLabel = (p?: string | null) => p ? t(`mezzi.proprietaOpts.${p}`, { defaultValue: p.replace('_', ' ') }) : "";
  const statoLabel = (s?: string | null) => s ? t(`mezzi.stati.${s}`, { defaultValue: s.replace('_', ' ') }) : "";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("mezzi.title")}</h1>
          <p className="text-muted-foreground">{t("mezzi.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={mezzi ?? []}
            columns={[
              { header: t("common.code"), accessor: (m) => m.codice },
              { header: t("common.type"), accessor: (m) => tipoLabel(m.tipo) },
              { header: t("mezzi.targa"), accessor: (m) => m.targa },
              { header: t("mezzi.proprieta"), accessor: (m) => proprietaLabel(m.proprieta) },
              { header: t("mezzi.proprietario"), accessor: (m) => m.proprietarioNome },
              { header: t("mezzi.capacitaColli"), accessor: (m) => m.capacitaColli != null ? m.capacitaColli : "" },
              { header: t("mezzi.capacitaKg"), accessor: (m) => m.capacitaKg != null ? m.capacitaKg : "" },
              { header: t("mezzi.scadAssicurazione"), accessor: (m) => m.scadenzaAssicurazione ? new Date(m.scadenzaAssicurazione).toLocaleDateString("it-IT") : "" },
              { header: t("mezzi.scadRevisione"), accessor: (m) => m.scadenzaRevisione ? new Date(m.scadenzaRevisione).toLocaleDateString("it-IT") : "" },
              { header: t("common.status"), accessor: (m) => statoLabel(m.stato) },
            ]}
            filename="mezzi"
            title={t("mezzi.exportTitle")}
            orientation="landscape"
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("mezzi.newMezzo")}
          </Button>
        </div>
      </div>

      <Card>
        {isGlobal && (
          <CardHeader className="py-4 border-b">
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
          </CardHeader>
        )}
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">{t("common.code")}</TableHead>
                <TableHead>{t("mezzi.thTipoTarga")}</TableHead>
                <TableHead>{t("mezzi.proprieta")}</TableHead>
                {isGlobal && <TableHead>{t("common.centro")}</TableHead>}
                <TableHead>{t("mezzi.thCapacita")}</TableHead>
                <TableHead>{t("mezzi.thScadenze")}</TableHead>
                <TableHead className="text-center">{t("common.status")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    {isGlobal && <TableCell><Skeleton className="h-5 w-24" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobal ? 8 : 7} className="h-32 text-center text-muted-foreground">
                    {t("mezzi.empty")}
                  </TableCell>
                </TableRow>
              ) : filtered?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-sm font-medium">{m.codice}</TableCell>
                  <TableCell>
                    <div className="font-medium capitalize">{tipoLabel(m.tipo)}</div>
                    {m.targa && <div className="text-xs font-mono text-muted-foreground uppercase">{m.targa}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="capitalize text-sm">{proprietaLabel(m.proprieta)}</div>
                    {m.proprietarioNome && <div className="text-xs text-muted-foreground">{m.proprietarioNome}</div>}
                  </TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm text-muted-foreground">
                      {m.effectiveCentroNome ?? t("common.centroComune")}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground">
                    {m.capacitaColli ? `${m.capacitaColli} ${t("mezzi.colliUnit")}` : '-'} / {m.capacitaKg ? `${m.capacitaKg} kg` : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-xs">
                      {m.scadenzaAssicurazione && (
                        <div className={`flex items-center gap-1 ${isExpiringSoon(m.scadenzaAssicurazione) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          <Calendar className="h-3 w-3" /> {t("mezzi.assicShort")} {format(new Date(m.scadenzaAssicurazione), "dd/MM/yy")}
                        </div>
                      )}
                      {m.scadenzaRevisione && (
                        <div className={`flex items-center gap-1 ${isExpiringSoon(m.scadenzaRevisione) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          <Calendar className="h-3 w-3" /> {t("mezzi.revisShort")} {format(new Date(m.scadenzaRevisione), "dd/MM/yy")}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={m.stato === 'disponibile' ? 'outline' : 'secondary'} className={
                      m.stato === 'disponibile' ? 'bg-green-500/10 text-green-700 border-none' : 
                      m.stato === 'in_uso' ? 'bg-blue-500/10 text-blue-700' : 'bg-destructive/10 text-destructive'
                    }>
                      {statoLabel(m.stato)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("mezzi.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(m)}>
                          <Pencil className="mr-2 h-4 w-4" /> {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(m.id)}>
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
            <SheetTitle>{editingId ? t("mezzi.sheetEditTitle") : t("mezzi.sheetNewTitle")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="codice" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.code")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="targa" render={({ field }) => (
                    <FormItem><FormLabel>{t("mezzi.targa")}</FormLabel><FormControl><Input className="uppercase" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="tipo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("mezzi.tipoVeicolo")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="furgone">{t("mezzi.tipos.furgone")}</SelectItem>
                        <SelectItem value="auto">{t("mezzi.tipos.auto")}</SelectItem>
                        <SelectItem value="cargo_bike">{t("mezzi.tipos.cargo_bike")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                
                <div className="pt-4 border-t space-y-4">
                  <FormField control={form.control} name="proprieta" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("mezzi.proprieta")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="associazione">{t("mezzi.proprietaOpts.associazione")}</SelectItem>
                          <SelectItem value="noleggio">{t("mezzi.proprietaOpts.noleggio")}</SelectItem>
                          <SelectItem value="volontario">{t("mezzi.proprietaOpts.volontario")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="proprietarioNome" render={({ field }) => (
                    <FormItem><FormLabel>{t("mezzi.nomeProprietario")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />

                  {proprietaWatch === "volontario" ? (
                    <FormField control={form.control} name="volontarioId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("mezzi.proprietaOpts.volontario")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NO_VOLONTARIO}>{t("common.centroComune")}</SelectItem>
                            {volontari?.map((v) => (
                              <SelectItem key={v.id} value={String(v.id)}>
                                {[v.nome, v.cognome].filter(Boolean).join(" ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{t("mezzi.centroFromVolontario")}</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  ) : (
                    <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("common.centro")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={isCentroLocked}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NO_CENTRO}>{t("common.centroComune")}</SelectItem>
                            {centri?.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isCentroLocked && (
                          <p className="text-xs text-muted-foreground">{t("common.centroLocked")}</p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <FormField control={form.control} name="scadenzaAssicurazione" render={({ field }) => (
                    <FormItem><FormLabel>{t("mezzi.scadenzaAssicurazione")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="scadenzaRevisione" render={({ field }) => (
                    <FormItem><FormLabel>{t("mezzi.scadenzaRevisione")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createMezzo.isPending || updateMezzo.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("mezzi.confirmDelete")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
