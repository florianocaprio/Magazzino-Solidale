import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useListBeneficiari, useCreateBeneficiario, useDeleteBeneficiario, useUpdateBeneficiario, useListCentriAscolto, useGetBeneficiario, getListBeneficiariQueryKey, getGetBeneficiarioQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Search, User, Trash2, MapPin, AlertCircle, Home, Pencil, CreditCard } from "lucide-react";
import { EditBeneficiarioSheet } from "@/pages/beneficiario-dettaglio";
import { generateTesseraPdf, buildTesseraLabels } from "@/lib/tessera-pdf";
import { loadAssociationLogo } from "@/lib/bolla-pdf";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const formSchema = z.object({
  cognome: z.string().min(2),
  nome: z.string().min(2),
  codiceFiscale: z.string().optional(),
  comune: z.string().optional(),
  zonaMunicipio: z.string().optional(),
  numComponenti: z.coerce.number().min(1).default(1),
  priorita: z.string().default("media"),
  centroAscoltoId: z.string().optional(),
  consegnaDomicilio: z.boolean().default(false)
});

const CENTRO_ALL = "__all__";
const PRIORITA_ALL = "__all__";

export default function Beneficiari() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const [search, setSearch] = useState("");
  const [centroFilter, setCentroFilter] = useState<string>(CENTRO_ALL);
  const [prioritaFilter, setPrioritaFilter] = useState<string>(PRIORITA_ALL);
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroFilter(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  const { data: beneficiari, isLoading } = useListBeneficiari({
    search: search || undefined,
    centroAscoltoId: centroFilter !== CENTRO_ALL ? parseInt(centroFilter) : undefined,
    priorita: prioritaFilter !== PRIORITA_ALL ? prioritaFilter : undefined,
  });
  const { data: centri } = useListCentriAscolto();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const createBeneficiario = useCreateBeneficiario();
  const deleteBeneficiario = useDeleteBeneficiario();
  const updateBeneficiario = useUpdateBeneficiario();

  const toggleStatus = (b: { id: number; attivo: boolean }) => {
    updateBeneficiario.mutate({ id: b.id, data: { attivo: !b.attivo } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(b.id) });
        toast({ title: b.attivo ? t("beneficiari.toastDisattivato") : t("beneficiari.toastAttivato") });
      },
    });
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      cognome: "", nome: "", comune: "", zonaMunicipio: "",
      numComponenti: 1, priorita: "media", centroAscoltoId: "", consegnaDomicilio: false
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const { centroAscoltoId, codiceFiscale, ...rest } = data;
    const payload = {
      ...rest,
      centroAscoltoId: centroAscoltoId ? parseInt(centroAscoltoId) : null,
      codiceFiscale: codiceFiscale?.trim() ? codiceFiscale.trim().toUpperCase() : null,
    };
    createBeneficiario.mutate({ data: payload }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
        toast({ title: t("beneficiari.toastAdded") });
        setIsFormOpen(false);
      }
    });
  };

  const getPriorityBadge = (priorita: string) => {
    switch(priorita) {
      case 'bassa': return <Badge variant="outline" className="bg-gray-100 text-gray-700">{t("beneficiari.prioBassa")}</Badge>;
      case 'media': return <Badge variant="outline" className="bg-blue-100 text-blue-700">{t("beneficiari.prioMedia")}</Badge>;
      case 'alta': return <Badge variant="outline" className="bg-amber-100 text-amber-700">{t("beneficiari.prioAlta")}</Badge>;
      case 'urgente': return <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200 shadow-sm"><AlertCircle className="w-3 h-3 mr-1"/>{t("beneficiari.prioUrgente")}</Badge>;
      default: return <Badge>{priorita}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("beneficiari.title")}</h1>
          <p className="text-muted-foreground">{t("beneficiari.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={beneficiari ?? []}
            columns={[
              { header: t("common.code"), accessor: (b) => b.codice },
              { header: t("common.surname"), accessor: (b) => b.cognome },
              { header: t("common.name"), accessor: (b) => b.nome },
              { header: t("common.email"), accessor: (b) => b.email },
              { header: t("common.phone"), accessor: (b) => b.telefono },
              { header: t("beneficiari.comune"), accessor: (b) => b.comune },
              { header: t("beneficiari.zonaMunicipio"), accessor: (b) => b.zonaMunicipio },
              { header: t("beneficiari.centroAscolto"), accessor: (b) => b.centroAscoltoNome },
            ]}
            filename="beneficiari"
            title={t("beneficiari.exportTitle")}
            orientation="landscape"
          />
          <Button onClick={() => { form.setValue("centroAscoltoId", isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : ""); setIsFormOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> {t("beneficiari.newBeneficiario")}</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder={t("beneficiari.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {isGlobal && (
              <Select value={centroFilter} onValueChange={setCentroFilter}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder={t("beneficiari.allCentri")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CENTRO_ALL}>{t("beneficiari.allCentri")}</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={prioritaFilter} onValueChange={setPrioritaFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder={t("beneficiari.allPriorita")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRIORITA_ALL}>{t("beneficiari.allPriorita")}</SelectItem>
                <SelectItem value="urgente">{t("beneficiari.prioUrgente")}</SelectItem>
                <SelectItem value="alta">{t("beneficiari.prioAlta")}</SelectItem>
                <SelectItem value="media">{t("beneficiari.prioMedia")}</SelectItem>
                <SelectItem value="bassa">{t("beneficiari.prioBassa")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("beneficiari.colNominativo")}</TableHead>
                <TableHead>{t("common.code")}</TableHead>
                <TableHead>{t("beneficiari.colZonaComune")}</TableHead>
                {isGlobal && <TableHead>{t("beneficiari.centroAscolto")}</TableHead>}
                <TableHead className="text-center">{t("beneficiari.colComponenti")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.colPriorita")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.colDomicilio")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.colStato")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    {isGlobal && <TableCell><Skeleton className="h-5 w-28" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : beneficiari?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobal ? 9 : 8} className="h-32 text-center text-muted-foreground">{t("beneficiari.empty")}</TableCell>
                </TableRow>
              ) : beneficiari?.map((b) => (
                <TableRow key={b.id} className={!b.attivo ? "opacity-60" : ""}>
                  <TableCell>
                    <Link href={`/beneficiari/${b.id}`} className="font-medium hover:underline text-primary flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {b.cognome} {b.nome}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{b.codice}</TableCell>
                  <TableCell className="text-sm">
                    {b.comune && <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground"/> {b.comune} {b.zonaMunicipio ? `(${b.zonaMunicipio})` : ''}</div>}
                  </TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm text-muted-foreground">
                      {b.centroAscoltoNome ?? <span className="italic">{t("common.none")}</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-center font-medium">{b.numComponenti}</TableCell>
                  <TableCell className="text-center">{getPriorityBadge(b.priorita)}</TableCell>
                  <TableCell className="text-center">
                    {b.consegnaDomicilio && <Home className="h-4 w-4 text-blue-500 mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center">
                      <Switch
                        checked={b.attivo}
                        onCheckedChange={() => toggleStatus(b)}
                        aria-label={b.attivo ? t("beneficiari.disattiva") : t("beneficiari.attiva")}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/beneficiari/${b.id}`} className="cursor-pointer w-full flex items-center">
                            {t("beneficiari.profileDetail")}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditingId(b.id)} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" /> {t("beneficiari.editAnagrafica")}</DropdownMenuItem>
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={async () => {
                            const logo = await loadAssociationLogo();
                            await generateTesseraPdf({
                              beneficiario: { codice: b.codice, nome: b.nome, cognome: b.cognome, codiceFiscale: b.codiceFiscale },
                              labels: buildTesseraLabels(t),
                              associationLogoDataUrl: logo,
                            });
                          }}
                        ><CreditCard className="mr-2 h-4 w-4" /> {t("tessera.generate")}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(b.id)}><Trash2 className="mr-2 h-4 w-4" /> {t("common.delete")}</DropdownMenuItem>
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
          <SheetHeader><SheetTitle>{t("beneficiari.newBeneficiario")}</SheetTitle></SheetHeader>
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
                  <FormField control={form.control} name="comune" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.comune")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="zonaMunicipio" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.zonaMunicipio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="numComponenti" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.numComponenti")}</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="priorita" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiari.prioritaAssistenziale")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="bassa">{t("beneficiari.prioBassa")}</SelectItem>
                          <SelectItem value="media">{t("beneficiari.prioMedia")}</SelectItem>
                          <SelectItem value="alta">{t("beneficiari.prioAlta")}</SelectItem>
                          <SelectItem value="urgente">{t("beneficiari.prioUrgente")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiari.centroRiferimento")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined} disabled={isCentroLocked}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createBeneficiario.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      {editingId != null && <QuickEditBeneficiario id={editingId} onClose={() => setEditingId(null)} />}

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("beneficiari.deleteTitle")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deletingId) {
                deleteBeneficiario.mutate({ id: deletingId }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
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

function QuickEditBeneficiario({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: b } = useGetBeneficiario(id, { query: { queryKey: getGetBeneficiarioQueryKey(id) } });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  if (!b) return null;
  return (
    <EditBeneficiarioSheet
      b={b}
      onClose={onClose}
      onSaved={() => {
        queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(id) });
        toast({ title: t("beneficiari.toastUpdated") });
        onClose();
      }}
    />
  );
}
