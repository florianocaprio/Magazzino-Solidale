import { useState } from "react";
import { useListTipologieFornitore, useCreateTipologiaFornitore, useUpdateTipologiaFornitore, useDeleteTipologiaFornitore, getListTipologieFornitoreQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Pencil, Trash2, Truck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";

function makeSchema(t: (k: string) => string) {
  return z.object({
    nome: z.string().min(1, t("common.requiredField")),
    attivo: z.boolean().default(true),
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

export default function TipologieFornitore() {
  const { t } = useTranslation();
  const schema = makeSchema(t);
  const { data: tipi, isLoading } = useListTipologieFornitore();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Built-in type keys are translated via the shared fornitori labels; admin-added
  // custom names display as typed.
  const tipoLabel = (nome: string) => t(`fornitori.tipi.${nome}`, { defaultValue: nome.replace(/_/g, " ") });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createTipo = useCreateTipologiaFornitore();
  const updateTipo = useUpdateTipologiaFornitore();
  const deleteTipo = useDeleteTipologiaFornitore();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nome: "", attivo: true },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTipologieFornitoreQueryKey() });

  const handleCreate = () => {
    setEditingId(null);
    form.reset({ nome: "", attivo: true });
    setIsFormOpen(true);
  };

  const handleEdit = (r: { id: number; nome: string; attivo: boolean }) => {
    setEditingId(r.id);
    form.reset({ nome: r.nome, attivo: r.attivo });
    setIsFormOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    if (editingId) {
      updateTipo.mutate({ id: editingId, data }, {
        onSuccess: () => {
          invalidate();
          toast({ title: t("tipologieFornitore.toastUpdated") });
          setIsFormOpen(false);
        },
        onError: (err) => {
          toast({ title: t("tipologieFornitore.title"), description: extractError(err, t("tipologieFornitore.saveError")), variant: "destructive" });
        },
      });
    } else {
      createTipo.mutate({ data }, {
        onSuccess: () => {
          invalidate();
          toast({ title: t("tipologieFornitore.toastCreated") });
          setIsFormOpen(false);
        },
        onError: (err) => {
          toast({ title: t("tipologieFornitore.title"), description: extractError(err, t("tipologieFornitore.saveError")), variant: "destructive" });
        },
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteTipo.mutate({ id: deletingId }, {
      onSuccess: () => {
        invalidate();
        toast({ title: t("tipologieFornitore.toastDeleted") });
        setDeletingId(null);
      },
      onError: (err) => {
        toast({ title: t("tipologieFornitore.deleteTitle"), description: extractError(err, t("tipologieFornitore.deleteDescription")), variant: "destructive" });
        setDeletingId(null);
      },
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("tipologieFornitore.title")}</h1>
          <p className="text-muted-foreground">{t("tipologieFornitore.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={tipi ?? []}
            columns={[
              { header: t("tipologieFornitore.nomeTipo"), accessor: (r) => tipoLabel(r.nome) },
              { header: t("common.status"), accessor: (r) => (r.attivo ? t("common.active") : t("common.inactive")) },
            ]}
            filename="tipologie-fornitore"
            title={t("tipologieFornitore.title")}
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("tipologieFornitore.newTipo")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("tipologieFornitore.nomeTipo")}</TableHead>
                <TableHead className="text-center">{t("common.status")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : tipi?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                    {t("tipologieFornitore.noTipi")}
                  </TableCell>
                </TableRow>
              ) : tipi?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium capitalize">
                      <Truck className="h-4 w-4 text-muted-foreground" /> {tipoLabel(r.nome)}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={r.attivo ? "bg-green-500/10 text-green-700 border-none" : "bg-muted text-muted-foreground"}>
                      {r.attivo ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("tipologieFornitore.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(r)}>
                          <Pencil className="mr-2 h-4 w-4" /> {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(r.id)}>
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
            <SheetTitle>{editingId ? t("tipologieFornitore.editTitle") : t("tipologieFornitore.newTitle")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("tipologieFornitore.nomeTipo")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="attivo" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="m-0">{t("tipologieFornitore.tipoAttivo")}</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createTipo.isPending || updateTipo.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tipologieFornitore.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("tipologieFornitore.deleteDescription")}</AlertDialogDescription>
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
