import { useState } from "react";
import { useListProdotti, useCreateProdotto, useUpdateProdotto, useDeleteProdotto, getListProdottiQueryKey } from "@workspace/api-client-react";
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
import { MoreHorizontal, Plus, Pencil, Trash2, Filter } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const formSchema = z.object({
  codice: z.string().min(2, "Codice troppo corto"),
  nome: z.string().min(2, "Nome troppo corto"),
  descrizione: z.string().optional(),
  tipoProdotto: z.string().min(1, "Campo obbligatorio"),
  unitaMisura: z.string().min(1, "Campo obbligatorio"),
  codiceBarre: z.string().optional(),
  gestioneLotto: z.boolean().default(false),
  gestioneScadenza: z.boolean().default(false),
  scortaMinima: z.coerce.number().min(0).default(0),
  scortaConsigliata: z.coerce.number().min(0).default(0),
  note: z.string().optional()
});

export default function Prodotti() {
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState("all");
  
  const { data: prodotti, isLoading } = useListProdotti({ 
    search: search || undefined,
    tipo: tipoFilter !== "all" ? tipoFilter : undefined
  });
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createProdotto = useCreateProdotto();
  const updateProdotto = useUpdateProdotto();
  const deleteProdotto = useDeleteProdotto();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      codice: "", nome: "", descrizione: "", tipoProdotto: "alimentare",
      unitaMisura: "pz", gestioneLotto: false, gestioneScadenza: false,
      scortaMinima: 0, scortaConsigliata: 0, note: "", codiceBarre: ""
    }
  });

  const handleEdit = (prodotto: any) => {
    setEditingId(prodotto.id);
    form.reset({
      codice: prodotto.codice,
      nome: prodotto.nome,
      descrizione: prodotto.descrizione || "",
      tipoProdotto: prodotto.tipoProdotto,
      unitaMisura: prodotto.unitaMisura,
      codiceBarre: prodotto.codiceBarre || "",
      gestioneLotto: prodotto.gestioneLotto,
      gestioneScadenza: prodotto.gestioneScadenza,
      scortaMinima: prodotto.scortaMinima,
      scortaConsigliata: prodotto.scortaConsigliata,
      note: prodotto.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      codice: "", nome: "", descrizione: "", tipoProdotto: "alimentare",
      unitaMisura: "pz", gestioneLotto: false, gestioneScadenza: false,
      scortaMinima: 0, scortaConsigliata: 0, note: "", codiceBarre: ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingId) {
      updateProdotto.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProdottiQueryKey() });
          toast({ title: "Prodotto aggiornato" });
          setIsFormOpen(false);
        }
      });
    } else {
      createProdotto.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProdottiQueryKey() });
          toast({ title: "Prodotto creato" });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteProdotto.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProdottiQueryKey() });
        toast({ title: "Prodotto eliminato" });
        setDeletingId(null);
      }
    });
  };

  const tipoColors: Record<string, string> = {
    alimentare: "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20",
    igiene: "bg-teal-500/10 text-teal-700 hover:bg-teal-500/20",
    vestiario: "bg-purple-500/10 text-purple-700 hover:bg-purple-500/20",
    medicinali: "bg-red-500/10 text-red-700 hover:bg-red-500/20",
    scarpe: "bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20",
    sanitario: "bg-red-500/10 text-red-700 hover:bg-red-500/20",
    altro: "bg-gray-500/10 text-gray-700 hover:bg-gray-500/20",
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Catalogo Prodotti</h1>
          <p className="text-muted-foreground">Gestisci i beni distribuiti dall'associazione.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={prodotti ?? []}
            columns={[
              { header: "Codice", accessor: (p) => p.codice },
              { header: "Nome", accessor: (p) => p.nome },
              { header: "Tipo", accessor: (p) => p.tipoProdotto },
              { header: "U.M.", accessor: (p) => p.unitaMisura },
              { header: "Scorta Minima", accessor: (p) => p.scortaMinima != null ? parseFloat(String(p.scortaMinima)) : "" },
            ]}
            filename="prodotti"
            title="Catalogo Prodotti"
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Nuovo Prodotto
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <Input 
              placeholder="Cerca per nome o codice..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Tutti i tipi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i tipi</SelectItem>
                  <SelectItem value="alimentare">Alimentare</SelectItem>
                  <SelectItem value="igiene">Igiene</SelectItem>
                  <SelectItem value="vestiario">Vestiario</SelectItem>
                  <SelectItem value="medicinali">Medicinali</SelectItem>
                  <SelectItem value="scarpe">Scarpe</SelectItem>
                  <SelectItem value="sanitario">Sanitario</SelectItem>
                  <SelectItem value="altro">Altro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Codice</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>U.M.</TableHead>
                <TableHead className="text-right">Scorta Minima</TableHead>
                <TableHead className="text-center">Proprietà</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : prodotti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Nessun prodotto trovato.
                  </TableCell>
                </TableRow>
              ) : prodotti?.map((prodotto) => (
                <TableRow key={prodotto.id}>
                  <TableCell className="font-medium text-xs font-mono">{prodotto.codice}</TableCell>
                  <TableCell>
                    <div className="font-medium">{prodotto.nome}</div>
                    {prodotto.descrizione && <div className="text-xs text-muted-foreground truncate max-w-[250px]">{prodotto.descrizione}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`capitalize ${tipoColors[prodotto.tipoProdotto] || tipoColors.altro}`}>
                      {prodotto.tipoProdotto.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{prodotto.unitaMisura}</TableCell>
                  <TableCell className="text-right">{prodotto.scortaMinima}</TableCell>
                  <TableCell>
                    <div className="flex justify-center gap-1">
                      {prodotto.gestioneScadenza && (
                        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-200">Scadenza</Badge>
                      )}
                      {prodotto.gestioneLotto && (
                        <Badge variant="outline" className="text-xs">Lotto</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Apri menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(prodotto)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Modifica
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(prodotto.id)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Elimina
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
            <SheetTitle>{editingId ? "Modifica Prodotto" : "Nuovo Prodotto"}</SheetTitle>
            <SheetDescription>
              Definisci l'anagrafica del bene nel catalogo.
            </SheetDescription>
          </SheetHeader>
          
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="codice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Codice</FormLabel>
                      <FormControl><Input placeholder="Es: ALI-001" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="codiceBarre" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Codice a Barre</FormLabel>
                      <FormControl><Input placeholder="Opzionale" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl><Input placeholder="Pasta di semola 500g" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="tipoProdotto" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="alimentare">Alimentare</SelectItem>
                          <SelectItem value="igiene">Igiene</SelectItem>
                          <SelectItem value="vestiario">Vestiario</SelectItem>
                          <SelectItem value="medicinali">Medicinali</SelectItem>
                          <SelectItem value="scarpe">Scarpe</SelectItem>
                          <SelectItem value="sanitario">Sanitario</SelectItem>
                          <SelectItem value="altro">Altro</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="unitaMisura" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unità Misura</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona U.M." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pz">Pezzi (pz)</SelectItem>
                          <SelectItem value="kg">Chilogrammi (kg)</SelectItem>
                          <SelectItem value="l">Litri (l)</SelectItem>
                          <SelectItem value="cf">Confezioni (cf)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="scortaMinima" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Scorta Minima</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="scortaConsigliata" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Scorta Consigliata</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="space-y-4 pt-4 border-t">
                  <FormField control={form.control} name="gestioneScadenza" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Gestione Scadenza</FormLabel>
                        <p className="text-[0.8rem] text-muted-foreground">Traccia la data di scadenza (es. alimentari)</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="gestioneLotto" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Gestione Lotto</FormLabel>
                        <p className="text-[0.8rem] text-muted-foreground">Traccia il codice lotto di produzione</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                <div className="pt-4 border-t">
                  <FormField control={form.control} name="descrizione" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrizione Extra</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                    Annulla
                  </Button>
                  <Button type="submit" disabled={createProdotto.isPending || updateProdotto.isPending}>
                    {editingId ? "Salva Modifiche" : "Crea Prodotto"}
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
            <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
            <AlertDialogDescription>
              Stai per eliminare questo prodotto. Potrebbe causare problemi se ci sono giacenze o movimenti collegati.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
