import { useState } from "react";
import { useListFornitori, useCreateFornitore, useUpdateFornitore, useDeleteFornitore, getListFornitoriQueryKey } from "@workspace/api-client-react";
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
import { MoreHorizontal, Plus, Pencil, Trash2, Mail, Phone, Building } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

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
  note: z.string().optional()
});

export default function Fornitori() {
  const { data: fornitori, isLoading } = useListFornitori();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createFornitore = useCreateFornitore();
  const updateFornitore = useUpdateFornitore();
  const deleteFornitore = useDeleteFornitore();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome: "", tipo: "commerciale", telefono: "", email: "", referente: "", comune: ""
    }
  });

  const handleEdit = (f: any) => {
    setEditingId(f.id);
    form.reset({
      nome: f.nome, tipo: f.tipo, partitaIva: f.partitaIva || "", codiceFiscale: f.codiceFiscale || "",
      indirizzo: f.indirizzo || "", comune: f.comune || "", telefono: f.telefono || "", 
      email: f.email || "", referente: f.referente || "", note: f.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({ nome: "", tipo: "commerciale", telefono: "", email: "", referente: "", comune: "" });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingId) {
      updateFornitore.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFornitoriQueryKey() });
          toast({ title: "Fornitore aggiornato" });
          setIsFormOpen(false);
        }
      });
    } else {
      createFornitore.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFornitoriQueryKey() });
          toast({ title: "Fornitore creato" });
          setIsFormOpen(false);
        }
      });
    }
  };

  const filtered = fornitori?.filter(f => f.nome.toLowerCase().includes(search.toLowerCase()));

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
          <h1 className="text-3xl font-bold tracking-tight">Fornitori e Donatori</h1>
          <p className="text-muted-foreground">Gestisci le fonti di approvvigionamento del magazzino.</p>
        </div>
        <Button onClick={handleCreate} className="gap-2"><Plus className="h-4 w-4" /> Nuovo Fornitore</Button>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <Input placeholder="Cerca per nome..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nominativo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Contatti</TableHead>
                <TableHead>Referente</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
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
                      {f.tipo.replace('_', ' ')}
                    </Badge>
                  </TableCell>
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
                        <DropdownMenuItem onClick={() => handleEdit(f)}><Pencil className="mr-2 h-4 w-4" /> Modifica</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(f.id)}><Trash2 className="mr-2 h-4 w-4" /> Elimina</DropdownMenuItem>
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
          <SheetHeader><SheetTitle>{editingId ? "Modifica Fornitore" : "Nuovo Fornitore"}</SheetTitle></SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>Nominativo / Ragione Sociale</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="tipo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipologia</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="commerciale">Azienda Commerciale</SelectItem>
                        <SelectItem value="donatore_privato">Donatore Privato</SelectItem>
                        <SelectItem value="banco_alimentare">Banco Alimentare</SelectItem>
                        <SelectItem value="ente_pubblico">Ente Pubblico</SelectItem>
                        <SelectItem value="altro">Altro</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="telefono" render={({ field }) => (
                    <FormItem><FormLabel>Telefono</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="referente" render={({ field }) => (
                  <FormItem><FormLabel>Persona di Riferimento</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createFornitore.isPending || updateFornitore.isPending}>Salva</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Elimina fornitore?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deletingId) {
                deleteFornitore.mutate({ id: deletingId }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getListFornitoriQueryKey() });
                    setDeletingId(null);
                  }
                });
              }
            }} className="bg-destructive text-destructive-foreground">Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
