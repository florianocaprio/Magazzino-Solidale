import { useState } from "react";
import { useListCitta, useCreateCitta, useUpdateCitta, useDeleteCitta, getListCittaQueryKey } from "@workspace/api-client-react";
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
import { MoreHorizontal, Plus, Pencil, Trash2, MapPin } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";

function makeSchema(t: (k: string) => string) {
  return z.object({
    nome: z.string().min(1, t("common.requiredField")),
    provincia: z.string().optional(),
    sigla: z.string().max(2).optional(),
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

export default function Citta() {
  const { t } = useTranslation();
  const schema = makeSchema(t);
  const { data: citta, isLoading } = useListCitta();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createCitta = useCreateCitta();
  const updateCitta = useUpdateCitta();
  const deleteCitta = useDeleteCitta();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nome: "", provincia: "", sigla: "", attivo: true, note: "" },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListCittaQueryKey() });

  const handleCreate = () => {
    setEditingId(null);
    form.reset({ nome: "", provincia: "", sigla: "", attivo: true, note: "" });
    setIsFormOpen(true);
  };

  const handleEdit = (c: any) => {
    setEditingId(c.id);
    form.reset({ nome: c.nome, provincia: c.provincia || "", sigla: c.sigla || "", attivo: c.attivo, note: c.note || "" });
    setIsFormOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    if (editingId) {
      updateCitta.mutate({ id: editingId, data }, {
        onSuccess: () => {
          invalidate();
          toast({ title: t("citta.toastUpdated") });
          setIsFormOpen(false);
        },
      });
    } else {
      createCitta.mutate({ data }, {
        onSuccess: () => {
          invalidate();
          toast({ title: t("citta.toastCreated") });
          setIsFormOpen(false);
        },
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteCitta.mutate({ id: deletingId }, {
      onSuccess: () => {
        invalidate();
        toast({ title: t("citta.toastDeleted") });
        setDeletingId(null);
      },
      onError: (err) => {
        toast({ title: t("citta.deleteTitle"), description: extractError(err, t("citta.deleteDescription")), variant: "destructive" });
        setDeletingId(null);
      },
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("citta.title")}</h1>
          <p className="text-muted-foreground">{t("citta.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={citta ?? []}
            columns={[
              { header: t("common.name"), accessor: (c) => c.nome },
              { header: t("citta.provincia"), accessor: (c) => c.provincia },
              { header: t("citta.attivoLabel"), accessor: (c) => (c.attivo ? t("common.yes") : t("common.no")) },
              { header: t("common.notes"), accessor: (c) => c.note },
            ]}
            filename="citta"
            title={t("citta.title")}
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("citta.newCitta")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("citta.provincia")}</TableHead>
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
              ) : citta?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    {t("citta.noCitta")}
                  </TableCell>
                </TableRow>
              ) : citta?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <MapPin className="h-4 w-4 text-muted-foreground" /> {c.nome}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{c.provincia || "-"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.note || "-"}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={c.attivo ? "bg-green-500/10 text-green-700 border-none" : "bg-muted text-muted-foreground"}>
                      {c.attivo ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("citta.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(c)}>
                          <Pencil className="mr-2 h-4 w-4" /> {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(c.id)}>
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
            <SheetTitle>{editingId ? t("citta.editTitle") : t("citta.newTitle")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="provincia" render={({ field }) => (
                  <FormItem><FormLabel>{t("citta.provincia")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="sigla" render={({ field }) => (
                  <FormItem><FormLabel>{t("citta.sigla")}</FormLabel><FormControl><Input {...field} maxLength={2} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.notes")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="attivo" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="m-0">{t("citta.cittaAttiva")}</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createCitta.isPending || updateCitta.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("citta.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("citta.deleteDescription")}</AlertDialogDescription>
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
