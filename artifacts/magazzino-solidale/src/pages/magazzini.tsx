import { useState } from "react";
import { useListMagazzini, useCreateMagazzino, useUpdateMagazzino, useDeleteMagazzino, useListCentriAscolto, useListCitta, getListMagazziniQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { MoreHorizontal, Plus, Pencil, Trash2, MapPin, Building, User } from "lucide-react";
import { EMPORIO_DISABLED_MESSAGE, useModuloFlags } from "@/lib/use-moduli";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";

const formSchema = z.object({
  codice: z.string().optional(),
  nome: z.string().min(3, "Nome troppo corto"),
  indirizzo: z.string().optional(),
  comune: z.string().optional(),
  zona: z.string().optional(),
  responsabile: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email("Email non valida").optional().or(z.literal("")),
  tipoMagazzino: z.enum(["logistico", "emporio", "misto"]).default("logistico"),
  stato: z.string().default("attivo"),
  centroAscoltoId: z.string().optional(),
  cittaId: z.string().optional(),
  note: z.string().optional()
});

const NO_CENTRO = "__none__";
const NO_CITTA = "__nocitta__";

const tipoMagazzinoBadgeClasses: Record<string, string> = {
  logistico: "bg-slate-500/10 text-slate-700 hover:bg-slate-500/20",
  emporio: "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20",
  misto: "bg-sky-500/10 text-sky-700 hover:bg-sky-500/20",
};

export default function Magazzini() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const lockedCittaId = user?.cittaId ?? null;
  const isCittaLocked = lockedCittaId != null;
  const { data: magazzini, isLoading } = useListMagazzini();
  const { emporioAbilitato } = useModuloFlags();
  const { data: centri } = useListCentriAscolto();
  const { data: citta } = useListCitta();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [centroFilter, setCentroFilter] = useState<string>("all");
  const [cittaFilter, setCittaFilter] = useState<string>("all");
  const [tipoFilter, setTipoFilter] = useState<string>("all");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createMagazzino = useCreateMagazzino();
  const updateMagazzino = useUpdateMagazzino();
  const deleteMagazzino = useDeleteMagazzino();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      codice: "", nome: "", indirizzo: "", comune: "", zona: "",
      responsabile: "", telefono: "", email: "", tipoMagazzino: "logistico", stato: "attivo", centroAscoltoId: NO_CENTRO, cittaId: NO_CITTA, note: ""
    }
  });

  const handleEdit = (magazzino: any) => {
    setEditingId(magazzino.id);
    form.reset({
      codice: magazzino.codice,
      nome: magazzino.nome,
      indirizzo: magazzino.indirizzo || "",
      comune: magazzino.comune || "",
      zona: magazzino.zona || "",
      responsabile: magazzino.responsabile || "",
      telefono: magazzino.telefono || "",
      email: magazzino.email || "",
      tipoMagazzino: magazzino.tipoMagazzino || "logistico",
      stato: magazzino.stato,
      centroAscoltoId: magazzino.centroAscoltoId != null ? String(magazzino.centroAscoltoId) : NO_CENTRO,
      cittaId: magazzino.cittaId != null ? String(magazzino.cittaId) : NO_CITTA,
      note: magazzino.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      codice: "", nome: "", indirizzo: "", comune: "", zona: "",
      responsabile: "", telefono: "", email: "", tipoMagazzino: "logistico", stato: "attivo",
      centroAscoltoId: isCentroLocked ? String(lockedCentroId) : NO_CENTRO,
      cittaId: isCittaLocked ? String(lockedCittaId) : NO_CITTA, note: ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const { centroAscoltoId: centroStr, cittaId: cittaStr, ...rest } = data;
    const centroAscoltoId = isCentroLocked
      ? lockedCentroId
      : !centroStr || centroStr === NO_CENTRO
        ? null
        : parseInt(centroStr, 10);
    const cittaId = isCittaLocked
      ? lockedCittaId
      : !cittaStr || cittaStr === NO_CITTA
        ? null
        : parseInt(cittaStr, 10);
    const payload = { ...rest, centroAscoltoId, cittaId };
    if (editingId) {
      updateMagazzino.mutate({ id: editingId, data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMagazziniQueryKey() });
          toast({ title: t("magazzini.toastUpdated") });
          setIsFormOpen(false);
        }
      });
    } else {
      createMagazzino.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMagazziniQueryKey() });
          toast({ title: t("magazzini.toastCreated") });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteMagazzino.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMagazziniQueryKey() });
        toast({ title: t("magazzini.toastDeleted") });
        setDeletingId(null);
      }
    });
  };

  const filtered = magazzini?.filter(m => {
    const matchesSearch =
      m.nome.toLowerCase().includes(search.toLowerCase()) ||
      m.codice.toLowerCase().includes(search.toLowerCase()) ||
      m.comune?.toLowerCase().includes(search.toLowerCase());
    const matchesCentro = centroFilter === "all" || m.centroAscoltoId === parseInt(centroFilter);
    const matchesCitta = cittaFilter === "all" || m.cittaId === parseInt(cittaFilter);
    const matchesTipo = tipoFilter === "all" || (m.tipoMagazzino ?? "logistico") === tipoFilter;
    return matchesSearch && matchesCentro && matchesCitta && matchesTipo;
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("magazzini.title")}</h1>
          <p className="text-muted-foreground">{t("magazzini.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={magazzini ?? []}
            columns={[
              { header: t("common.code"), accessor: (m) => m.codice },
              { header: t("common.name"), accessor: (m) => m.nome },
              { header: t("magazzini.tipoMagazzino"), accessor: (m) => t(`magazzini.tipo_${m.tipoMagazzino ?? "logistico"}`) },
              { header: t("common.address"), accessor: (m) => m.indirizzo },
              { header: t("magazzini.comune"), accessor: (m) => m.comune },
              { header: t("magazzini.zona"), accessor: (m) => m.zona },
              { header: t("magazzini.responsabile"), accessor: (m) => m.responsabile },
              { header: t("common.phone"), accessor: (m) => m.telefono },
              { header: t("common.email"), accessor: (m) => m.email },
              { header: t("common.status"), accessor: (m) => m.stato === 'attivo' ? t("common.active") : t("common.inactive") },
            ]}
            filename="magazzini"
            title={t("magazzini.title")}
            orientation="landscape"
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("magazzini.newWarehouse")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <Input 
              placeholder={t("magazzini.searchPlaceholder")} 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-full sm:w-52">
                  <SelectValue placeholder={t("magazzini.filterTipoMagazzino")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("magazzini.filterTipoMagazzino")}</SelectItem>
                  <SelectItem value="logistico">{t("magazzini.tipo_logistico")}</SelectItem>
                  <SelectItem value="emporio">{t("magazzini.tipo_emporio")}</SelectItem>
                  <SelectItem value="misto">{t("magazzini.tipo_misto")}</SelectItem>
                </SelectContent>
              </Select>
              {!isCittaLocked && (
                <Select value={cittaFilter} onValueChange={setCittaFilter}>
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue placeholder={t("common.tutteCitta")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.tutteCitta")}</SelectItem>
                    {citta?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {isGlobal && (
                <Select value={centroFilter} onValueChange={setCentroFilter}>
                  <SelectTrigger className="w-full sm:w-56">
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">{t("common.code")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("magazzini.tipoMagazzino")}</TableHead>
                <TableHead>{t("magazzini.colPlace")}</TableHead>
                <TableHead>{t("magazzini.colResponsabile")}</TableHead>
                {isGlobal && <TableHead>{t("common.centro")}</TableHead>}
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    {isGlobal && <TableCell><Skeleton className="h-5 w-28" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobal ? 8 : 7} className="h-32 text-center text-muted-foreground">
                    {t("magazzini.noWarehouses")}
                  </TableCell>
                </TableRow>
              ) : filtered?.map((magazzino) => (
                <TableRow key={magazzino.id}>
                  <TableCell className="font-medium text-xs font-mono">{magazzino.codice}</TableCell>
                  <TableCell>
                    <div className="font-medium">{magazzino.nome}</div>
                    {magazzino.note && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{magazzino.note}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={tipoMagazzinoBadgeClasses[magazzino.tipoMagazzino ?? "logistico"] ?? tipoMagazzinoBadgeClasses.logistico}
                    >
                      {t(`magazzini.tipo_${magazzino.tipoMagazzino ?? "logistico"}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {magazzino.comune && (
                        <div className="flex items-center gap-1 text-sm">
                          <Building className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{magazzino.comune} {magazzino.zona ? `(${magazzino.zona})` : ''}</span>
                        </div>
                      )}
                      {magazzino.indirizzo && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          <span className="truncate max-w-[200px]">{magazzino.indirizzo}</span>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {magazzino.responsabile ? (
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{magazzino.responsabile}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">{t("magazzini.notAssigned")}</span>
                    )}
                  </TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm text-muted-foreground">
                      {magazzino.centroAscoltoNome ?? t("common.centroComune")}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant={magazzino.stato === 'attivo' ? 'default' : 'secondary'} 
                           className={magazzino.stato === 'attivo' ? 'bg-green-500/10 text-green-700 hover:bg-green-500/20' : ''}>
                      {magazzino.stato === 'attivo' ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("magazzini.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(magazzino)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(magazzino.id)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t("common.delete")}
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
            <SheetTitle>{editingId ? t("magazzini.editTitle") : t("magazzini.newTitle")}</SheetTitle>
            <SheetDescription>
              {t("magazzini.formDescription")}
            </SheetDescription>
          </SheetHeader>
          
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="codice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.code")}</FormLabel>
                      <FormControl><Input placeholder={t("magazzini.codicePlaceholder")} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="stato" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.status")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("magazzini.selectStatus")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="attivo">{t("common.active")}</SelectItem>
                          <SelectItem value="inattivo">{t("common.inactive")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="tipoMagazzino" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("magazzini.tipoMagazzino")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("magazzini.tipoMagazzino")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="logistico">{t("magazzini.tipo_logistico")}</SelectItem>
                        <SelectItem value="emporio" disabled={!emporioAbilitato}>{t("magazzini.tipo_emporio")}</SelectItem>
                        <SelectItem value="misto" disabled={!emporioAbilitato}>{t("magazzini.tipo_misto")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {!emporioAbilitato && (
                      <p className="text-xs text-muted-foreground">{EMPORIO_DISABLED_MESSAGE}</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.centro")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={isCentroLocked}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
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

                <FormField control={form.control} name="cittaId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("magazzini.citta")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={isCittaLocked}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CITTA}>{t("magazzini.nessunaCitta")}</SelectItem>
                        {citta?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.name")}</FormLabel>
                    <FormControl><Input placeholder={t("magazzini.nomePlaceholder")} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="indirizzo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.address")}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="comune" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("magazzini.comune")}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="zona" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("magazzini.zona")}</FormLabel>
                      <FormControl><Input placeholder={t("magazzini.zonaPlaceholder")} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium mb-4">{t("magazzini.contacts")}</h4>
                  <FormField control={form.control} name="responsabile" render={({ field }) => (
                    <FormItem className="mb-4">
                      <FormLabel>{t("magazzini.responsabile")}</FormLabel>
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
                </div>

                <div className="pt-4 border-t">
                  <FormField control={form.control} name="note" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.notes")}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={createMagazzino.isPending || updateMagazzino.isPending}>
                    {editingId ? t("magazzini.saveChanges") : t("magazzini.createWarehouse")}
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
            <AlertDialogTitle>{t("magazzini.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("magazzini.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
