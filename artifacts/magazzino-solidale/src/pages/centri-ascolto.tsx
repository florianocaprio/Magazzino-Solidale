import { useState } from "react";
import { useListCentriAscolto, useCreateCentroAscolto, useUpdateCentroAscolto, useDeleteCentroAscolto, getListCentriAscoltoQueryKey } from "@workspace/api-client-react";
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
import { MoreHorizontal, Plus, Pencil, Trash2, Building2, Users } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";

const formSchema = z.object({
  nome: z.string().min(2, "Nome obbligatorio"),
  logoUrl: z.string().optional(),
  indirizzo: z.string().optional(),
  comune: z.string().optional(),
  responsabile: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  attivo: z.boolean().default(true),
  note: z.string().optional()
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CentriAscolto() {
  const { t } = useTranslation();
  const { data: centri, isLoading } = useListCentriAscolto();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createCentro = useCreateCentroAscolto();
  const updateCentro = useUpdateCentroAscolto();
  const deleteCentro = useDeleteCentroAscolto();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome: "", logoUrl: "", indirizzo: "", comune: "", responsabile: "", telefono: "", email: "", attivo: true, note: ""
    }
  });

  const handleCreate = () => {
    setEditingId(null);
    form.reset({ nome: "", logoUrl: "", indirizzo: "", comune: "", responsabile: "", telefono: "", email: "", attivo: true, note: "" });
    setIsFormOpen(true);
  };

  const handleEdit = (c: any) => {
    setEditingId(c.id);
    form.reset({
      nome: c.nome,
      logoUrl: c.logoUrl || "",
      indirizzo: c.indirizzo || "",
      comune: c.comune || "",
      responsabile: c.responsabile || "",
      telefono: c.telefono || "",
      email: c.email || "",
      attivo: c.attivo,
      note: c.note || ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingId) {
      updateCentro.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCentriAscoltoQueryKey() });
          toast({ title: t("centriAscolto.toastUpdated") });
          setIsFormOpen(false);
        }
      });
    } else {
      createCentro.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCentriAscoltoQueryKey() });
          toast({ title: t("centriAscolto.toastCreated") });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteCentro.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCentriAscoltoQueryKey() });
        toast({ title: t("centriAscolto.toastDeleted") });
        setDeletingId(null);
      }
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("centriAscolto.title")}</h1>
          <p className="text-muted-foreground">{t("centriAscolto.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={centri ?? []}
            columns={[
              { header: t("common.name"), accessor: (c) => c.nome },
              { header: t("common.address"), accessor: (c) => c.indirizzo },
              { header: t("centriAscolto.comune"), accessor: (c) => c.comune },
              { header: t("centriAscolto.responsabile"), accessor: (c) => c.responsabile },
              { header: t("common.phone"), accessor: (c) => c.telefono },
              { header: t("common.email"), accessor: (c) => c.email },
              { header: t("centriAscolto.attivoLabel"), accessor: (c) => c.attivo ? t("common.yes") : t("common.no") },
            ]}
            filename="centri_ascolto"
            title={t("centriAscolto.title")}
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("centriAscolto.newCentro")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("centriAscolto.comune")}</TableHead>
                <TableHead>{t("centriAscolto.responsabile")}</TableHead>
                <TableHead>{t("centriAscolto.contatti")}</TableHead>
                <TableHead className="text-center">{t("centriAscolto.beneficiari")}</TableHead>
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
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : centri?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    {t("centriAscolto.noCentri")}
                  </TableCell>
                </TableRow>
              ) : centri?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <Building2 className="h-4 w-4 text-muted-foreground" /> {c.nome}
                    </div>
                    {c.indirizzo && <div className="text-xs text-muted-foreground ml-6">{c.indirizzo}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{c.comune || '-'}</TableCell>
                  <TableCell className="text-sm">{c.responsabile || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.telefono && <div>{c.telefono}</div>}
                    {c.email && <div className="text-xs">{c.email}</div>}
                    {!c.telefono && !c.email && '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="inline-flex items-center gap-1 text-sm font-medium">
                      <Users className="h-3 w-3 text-muted-foreground" /> {c.beneficiariCount}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={c.attivo ? 'bg-green-500/10 text-green-700 border-none' : 'bg-muted text-muted-foreground'}>
                      {c.attivo ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("centriAscolto.openMenu")}</span>
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
            <SheetTitle>{editingId ? t("centriAscolto.editTitle") : t("centriAscolto.newTitle")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="logoUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("centriAscolto.logoLabel")}</FormLabel>
                    <div className="flex items-center gap-3">
                      {field.value ? (
                        <img src={field.value} alt={t("centriAscolto.logoAlt")} className="h-14 w-14 object-contain rounded border bg-white" />
                      ) : (
                        <div className="h-14 w-14 rounded border border-dashed flex items-center justify-center text-muted-foreground">
                          <Building2 className="h-5 w-5" />
                        </div>
                      )}
                      <div className="flex flex-col gap-1.5">
                        <FormControl>
                          <Input
                            type="file"
                            accept="image/*"
                            className="text-xs"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 500 * 1024) {
                                toast({ title: t("centriAscolto.logoTooBig"), description: t("centriAscolto.logoTooBigDesc"), variant: "destructive" });
                                return;
                              }
                              field.onChange(await fileToDataUrl(file));
                            }}
                          />
                        </FormControl>
                        {field.value && (
                          <Button type="button" variant="ghost" size="sm" className="h-7 justify-start px-2 text-destructive hover:text-destructive" onClick={() => field.onChange("")}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> {t("centriAscolto.removeLogo")}
                          </Button>
                        )}
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="indirizzo" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.address")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="comune" render={({ field }) => (
                  <FormItem><FormLabel>{t("centriAscolto.comune")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="responsabile" render={({ field }) => (
                  <FormItem><FormLabel>{t("centriAscolto.responsabile")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="telefono" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.phone")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.email")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.notes")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="attivo" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="m-0">{t("centriAscolto.centroAttivo")}</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createCentro.isPending || updateCentro.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("centriAscolto.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("centriAscolto.deleteDescription")}
            </AlertDialogDescription>
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
