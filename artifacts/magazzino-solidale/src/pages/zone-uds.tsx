import { useMemo, useState } from "react";
import { useListZoneUds, useCreateZonaUds, useUpdateZonaUds, useDeleteZonaUds, useListCitta, getListZoneUdsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Pencil, Trash2, Map } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";

const ALL_CITTA = "__all__";

function makeSchema(t: (k: string) => string) {
  return z.object({
    cittaId: z.coerce.number().int().positive(t("zoneUds.selectCitta")),
    nome: z.string().min(1, t("common.requiredField")),
    attivo: z.boolean().default(true),
    note: z.string().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

function extractError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

export default function ZoneUds() {
  const { t } = useTranslation();
  const schema = useMemo(() => makeSchema(t), [t]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [cittaFilter, setCittaFilter] = useState<string>(ALL_CITTA);
  const filterId = cittaFilter === ALL_CITTA ? undefined : parseInt(cittaFilter, 10);

  const { data: citta } = useListCitta();
  const { data: zone, isLoading } = useListZoneUds(filterId != null ? { cittaId: filterId } : undefined);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createZona = useCreateZonaUds();
  const updateZona = useUpdateZonaUds();
  const deleteZona = useDeleteZonaUds();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { cittaId: undefined as unknown as number, nome: "", attivo: true, note: "" },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListZoneUdsQueryKey() });
  const hasCitta = (citta?.length ?? 0) > 0;

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      cittaId: (filterId ?? citta?.[0]?.id ?? undefined) as unknown as number,
      nome: "",
      attivo: true,
      note: "",
    });
    setIsFormOpen(true);
  };

  const handleEdit = (z2: any) => {
    setEditingId(z2.id);
    form.reset({ cittaId: z2.cittaId, nome: z2.nome, attivo: z2.attivo, note: z2.note || "" });
    setIsFormOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    if (editingId) {
      updateZona.mutate({ id: editingId, data }, {
        onSuccess: () => {
          invalidate();
          toast({ title: t("zoneUds.toastUpdated") });
          setIsFormOpen(false);
        },
      });
    } else {
      createZona.mutate({ data }, {
        onSuccess: () => {
          invalidate();
          toast({ title: t("zoneUds.toastCreated") });
          setIsFormOpen(false);
        },
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteZona.mutate({ id: deletingId }, {
      onSuccess: () => {
        invalidate();
        toast({ title: t("zoneUds.toastDeleted") });
        setDeletingId(null);
      },
      onError: (err) => {
        toast({ title: t("zoneUds.deleteTitle"), description: extractError(err, t("zoneUds.deleteDescription")), variant: "destructive" });
        setDeletingId(null);
      },
    });
  };

  const cittaNameById = (id: number) => citta?.find((c) => c.id === id)?.nome ?? "-";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("zoneUds.title")}</h1>
          <p className="text-muted-foreground">{t("zoneUds.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={cittaFilter} onValueChange={setCittaFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t("zoneUds.filterCitta")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CITTA}>{t("zoneUds.allCitta")}</SelectItem>
              {citta?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ExportButtons
            rows={zone ?? []}
            columns={[
              { header: t("common.name"), accessor: (z2) => z2.nome },
              { header: t("zoneUds.citta"), accessor: (z2) => z2.cittaNome ?? cittaNameById(z2.cittaId) },
              { header: t("zoneUds.attivoLabel"), accessor: (z2) => (z2.attivo ? t("common.yes") : t("common.no")) },
              { header: t("common.notes"), accessor: (z2) => z2.note },
            ]}
            filename="zone_uds"
            title={t("zoneUds.title")}
          />
          <Button onClick={handleCreate} className="gap-2" disabled={!hasCitta}>
            <Plus className="h-4 w-4" /> {t("zoneUds.newZona")}
          </Button>
        </div>
      </div>

      {!hasCitta && !isLoading && (
        <p className="text-sm text-muted-foreground">{t("zoneUds.noCittaFirst")}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("zoneUds.citta")}</TableHead>
                <TableHead>{t("common.notes")}</TableHead>
                <TableHead className="text-center">{t("common.status")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : zone?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    {t("zoneUds.noZone")}
                  </TableCell>
                </TableRow>
              ) : zone?.map((z2) => (
                <TableRow key={z2.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <Map className="h-4 w-4 text-muted-foreground" /> {z2.nome}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{z2.cittaNome ?? cittaNameById(z2.cittaId)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{z2.note || "-"}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={z2.attivo ? "bg-green-500/10 text-green-700 border-none" : "bg-muted text-muted-foreground"}>
                      {z2.attivo ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("zoneUds.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(z2)}>
                          <Pencil className="mr-2 h-4 w-4" /> {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(z2.id)}>
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
            <SheetTitle>{editingId ? t("zoneUds.editTitle") : t("zoneUds.newTitle")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="cittaId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("zoneUds.citta")}</FormLabel>
                    <Select
                      value={field.value != null ? String(field.value) : undefined}
                      onValueChange={(v) => field.onChange(parseInt(v, 10))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("zoneUds.selectCitta")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {citta?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.notes")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="attivo" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="m-0">{t("zoneUds.zonaAttiva")}</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createZona.isPending || updateZona.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("zoneUds.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("zoneUds.deleteDescription")}</AlertDialogDescription>
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
