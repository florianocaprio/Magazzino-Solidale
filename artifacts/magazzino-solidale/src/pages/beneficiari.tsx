import { useState } from "react";
import { Link } from "wouter";
import { useListBeneficiari, useCreateBeneficiario, useDeleteBeneficiario, useListCentriAscolto, useGetBeneficiario, getListBeneficiariQueryKey, getGetBeneficiarioQueryKey } from "@workspace/api-client-react";
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
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Search, User, Trash2, MapPin, AlertCircle, Home, Pencil } from "lucide-react";
import { EditBeneficiarioSheet } from "@/pages/beneficiario-dettaglio";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const formSchema = z.object({
  cognome: z.string().min(2),
  nome: z.string().min(2),
  comune: z.string().optional(),
  zonaMunicipio: z.string().optional(),
  numComponenti: z.coerce.number().min(1).default(1),
  priorita: z.string().default("media"),
  centroAscoltoId: z.string().optional(),
  consegnaDomicilio: z.boolean().default(false)
});

const CENTRO_ALL = "__all__";

export default function Beneficiari() {
  const [search, setSearch] = useState("");
  const [centroFilter, setCentroFilter] = useState<string>(CENTRO_ALL);
  const { data: beneficiari, isLoading } = useListBeneficiari({
    search: search || undefined,
    centroAscoltoId: centroFilter !== CENTRO_ALL ? parseInt(centroFilter) : undefined,
  });
  const { data: centri } = useListCentriAscolto();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const createBeneficiario = useCreateBeneficiario();
  const deleteBeneficiario = useDeleteBeneficiario();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      cognome: "", nome: "", comune: "", zonaMunicipio: "",
      numComponenti: 1, priorita: "media", centroAscoltoId: "", consegnaDomicilio: false
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const { centroAscoltoId, ...rest } = data;
    const payload = { ...rest, centroAscoltoId: centroAscoltoId ? parseInt(centroAscoltoId) : null };
    createBeneficiario.mutate({ data: payload }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
        toast({ title: "Beneficiario aggiunto" });
        setIsFormOpen(false);
      }
    });
  };

  const getPriorityBadge = (priorita: string) => {
    switch(priorita) {
      case 'bassa': return <Badge variant="outline" className="bg-gray-100 text-gray-700">Bassa</Badge>;
      case 'media': return <Badge variant="outline" className="bg-blue-100 text-blue-700">Media</Badge>;
      case 'alta': return <Badge variant="outline" className="bg-amber-100 text-amber-700">Alta</Badge>;
      case 'urgente': return <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200 shadow-sm"><AlertCircle className="w-3 h-3 mr-1"/>Urgente</Badge>;
      default: return <Badge>{priorita}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Beneficiari</h1>
          <p className="text-muted-foreground">Persone e nuclei familiari assistiti.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={beneficiari ?? []}
            columns={[
              { header: "Codice", accessor: (b) => b.codice },
              { header: "Cognome", accessor: (b) => b.cognome },
              { header: "Nome", accessor: (b) => b.nome },
              { header: "Email", accessor: (b) => b.email },
              { header: "Telefono", accessor: (b) => b.telefono },
              { header: "Comune", accessor: (b) => b.comune },
              { header: "Zona / Municipio", accessor: (b) => b.zonaMunicipio },
              { header: "Centro di Ascolto", accessor: (b) => b.centroAscoltoNome },
            ]}
            filename="beneficiari"
            title="Elenco Beneficiari"
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Nuovo Beneficiario</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Cerca per cognome o nome..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={centroFilter} onValueChange={setCentroFilter}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Tutti i centri di ascolto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CENTRO_ALL}>Tutti i centri di ascolto</SelectItem>
                {centri?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nominativo</TableHead>
                <TableHead>Codice</TableHead>
                <TableHead>Zona / Comune</TableHead>
                <TableHead className="text-center">Componenti</TableHead>
                <TableHead className="text-center">Priorità</TableHead>
                <TableHead className="text-center">Domicilio</TableHead>
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
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : beneficiari?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Nessun beneficiario trovato.</TableCell>
                </TableRow>
              ) : beneficiari?.map((b) => (
                <TableRow key={b.id}>
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
                  <TableCell className="text-center font-medium">{b.numComponenti}</TableCell>
                  <TableCell className="text-center">{getPriorityBadge(b.priorita)}</TableCell>
                  <TableCell className="text-center">
                    {b.consegnaDomicilio && <Home className="h-4 w-4 text-blue-500 mx-auto" />}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/beneficiari/${b.id}`} className="cursor-pointer w-full flex items-center">
                            Dettaglio Profilo
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditingId(b.id)} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" /> Modifica anagrafica</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(b.id)}><Trash2 className="mr-2 h-4 w-4" /> Elimina</DropdownMenuItem>
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
          <SheetHeader><SheetTitle>Nuovo Beneficiario</SheetTitle></SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="cognome" render={({ field }) => (
                    <FormItem><FormLabel>Cognome</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="comune" render={({ field }) => (
                    <FormItem><FormLabel>Comune</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="zonaMunicipio" render={({ field }) => (
                    <FormItem><FormLabel>Zona / Municipio</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="numComponenti" render={({ field }) => (
                    <FormItem><FormLabel>N. Componenti</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="priorita" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priorità Assistenziale</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="bassa">Bassa</SelectItem>
                          <SelectItem value="media">Media</SelectItem>
                          <SelectItem value="alta">Alta</SelectItem>
                          <SelectItem value="urgente">Urgente</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Centro di Ascolto di riferimento</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createBeneficiario.isPending}>Salva</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      {editingId != null && <QuickEditBeneficiario id={editingId} onClose={() => setEditingId(null)} />}

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Elimina beneficiario?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deletingId) {
                deleteBeneficiario.mutate({ id: deletingId }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
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

function QuickEditBeneficiario({ id, onClose }: { id: number; onClose: () => void }) {
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
        toast({ title: "Anagrafica aggiornata" });
        onClose();
      }}
    />
  );
}
