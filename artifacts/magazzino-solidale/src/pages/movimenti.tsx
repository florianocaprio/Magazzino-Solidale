import { useState, useEffect } from "react";
import { useListMovimenti, useCreateMovimento, useListMagazzini, useListProdotti, useListCentriAscolto, getListMovimentiQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, ArrowDownRight, ArrowUpRight, Filter, ScanLine } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";

const formSchema = z.object({
  tipoMovimento: z.string().min(1),
  tipoDettaglio: z.string().min(1),
  dataMovimento: z.string().min(1),
  magazzinoId: z.coerce.number().min(1),
  prodottoId: z.coerce.number().min(1),
  quantita: z.coerce.number().min(0.01),
  unitaMisura: z.string().default("pz"),
  note: z.string().optional()
});

export default function Movimenti() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;

  const [tipoFilter, setTipoFilter] = useState("all");
  const [centroFilter, setCentroFilter] = useState(isCentroLocked ? String(lockedCentroId) : "all");
  const [da, setDa] = useState("");
  const [a, setA] = useState("");

  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroFilter(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  const { data: movimenti, isLoading } = useListMovimenti({
    tipo: tipoFilter !== "all" ? tipoFilter : undefined,
    centroAscoltoId: centroFilter !== "all" ? parseInt(centroFilter) : undefined,
    da: da || undefined,
    a: a || undefined,
  });
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  const { data: centri } = useListCentriAscolto();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [scanProdotto, setScanProdotto] = useState("");

  const createMovimento = useCreateMovimento();

  const handleScanProdotto = (codeOverride?: string) => {
    const code = (codeOverride ?? scanProdotto).trim();
    if (!code) return;
    if (!prodotti) {
      toast({ title: t("common.loading") });
      return;
    }
    const lc = code.toLowerCase();
    const p = prodotti.find(
      x => (x.codiceBarre && x.codiceBarre.toLowerCase() === lc) || x.codice.toLowerCase() === lc,
    );
    if (!p) {
      toast({ title: t("movimenti.scanNotFound"), variant: "destructive" });
      return;
    }
    form.setValue("prodottoId", p.id);
    if (p.unitaMisura) form.setValue("unitaMisura", p.unitaMisura);
    setScanProdotto("");
    toast({ title: t("movimenti.scanFound", { name: p.nome }) });
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipoMovimento: "carico",
      tipoDettaglio: "acquisto",
      dataMovimento: new Date().toISOString().substring(0, 10),
      magazzinoId: 0,
      prodottoId: 0,
      quantita: 1,
      unitaMisura: "pz",
      note: ""
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createMovimento.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMovimentiQueryKey() });
        toast({ title: t("movimenti.toastRegistered") });
        setIsFormOpen(false);
      }
    });
  };

  const causaleLabel = (val: string) => {
    const map: Record<string, string> = {
      acquisto: t("movimenti.causaleAcquisto"),
      donazione: t("movimenti.causaleDonazione"),
      rettifica_inventario: t("movimenti.causaleRettifica"),
      scadenza: t("movimenti.causaleScadenza"),
      smaltimento: t("movimenti.causaleSmaltimento"),
    };
    return map[val] ?? val.replace("_", " ");
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("movimenti.title")}</h1>
          <p className="text-muted-foreground">{t("movimenti.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={movimenti ?? []}
            columns={[
              { header: t("movimenti.colData"), accessor: (m) => m.dataMovimento ? new Date(m.dataMovimento).toLocaleDateString("it-IT") : "" },
              { header: t("movimenti.colTipo"), accessor: (m) => m.tipoMovimento },
              { header: t("movimenti.colCausale"), accessor: (m) => m.tipoDettaglio },
              { header: t("movimenti.colProdotto"), accessor: (m) => m.prodottoNome },
              { header: t("movimenti.colMagazzino"), accessor: (m) => m.magazzinoNome },
              { header: t("movimenti.colQuantita"), accessor: (m) => m.quantita != null ? parseFloat(String(m.quantita)) : "" },
              { header: t("movimenti.colUM"), accessor: (m) => m.unitaMisura },
              { header: t("movimenti.colNote"), accessor: (m) => m.note },
            ]}
            filename="movimenti"
            title={t("movimenti.exportTitle")}
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> {t("movimenti.registerMovement")}</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 self-center">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("movimenti.allMovements")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("movimenti.allMovements")}</SelectItem>
                  <SelectItem value="carico">{t("movimenti.onlyLoads")}</SelectItem>
                  <SelectItem value="scarico">{t("movimenti.onlyUnloads")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("movimenti.filterCentro")}</Label>
              <Select value={centroFilter} onValueChange={setCentroFilter} disabled={isCentroLocked}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("movimenti.allCentri")}</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("movimenti.filterDa")}</Label>
              <Input type="date" value={da} onChange={(e) => setDa(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("movimenti.filterA")}</Label>
              <Input type="date" value={a} onChange={(e) => setA(e.target.value)} className="w-[160px]" />
            </div>
            {(da || a || centroFilter !== "all") && !isCentroLocked && (
              <Button variant="ghost" size="sm" onClick={() => { setDa(""); setA(""); setCentroFilter("all"); }}>
                {t("movimenti.filterReset")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("movimenti.colData")}</TableHead>
                <TableHead>{t("movimenti.colTipo")}</TableHead>
                <TableHead>{t("movimenti.colProdotto")}</TableHead>
                <TableHead>{t("movimenti.colMagazzino")}</TableHead>
                <TableHead className="text-right">{t("movimenti.colQuantita")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : movimenti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">{t("movimenti.noResults")}</TableCell>
                </TableRow>
              ) : movimenti?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm">
                    {format(new Date(m.dataMovimento), "dd MMM yyyy, HH:mm", { locale: it })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {m.tipoMovimento === 'carico' ? (
                        <ArrowDownRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-amber-500" />
                      )}
                      <Badge variant="outline" className="capitalize">
                        {causaleLabel(m.tipoDettaglio)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{m.prodottoNome}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.magazzinoNome}</TableCell>
                  <TableCell className={`text-right font-bold ${m.tipoMovimento === 'carico' ? 'text-green-600' : 'text-amber-600'}`}>
                    {m.tipoMovimento === 'carico' ? '+' : '-'}{m.quantita} <span className="text-xs font-normal text-muted-foreground">{m.unitaMisura}</span>
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
            <SheetTitle>{t("movimenti.registerMovement")}</SheetTitle>
            <SheetDescription>{t("movimenti.dialogDescription")}</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="tipoMovimento" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("movimenti.fldDirezione")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="carico">{t("movimenti.dirCarico")}</SelectItem>
                          <SelectItem value="scarico">{t("movimenti.dirScarico")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="tipoDettaglio" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("movimenti.fldCausale")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="acquisto">{t("movimenti.causaleAcquisto")}</SelectItem>
                          <SelectItem value="donazione">{t("movimenti.causaleDonazione")}</SelectItem>
                          <SelectItem value="rettifica_inventario">{t("movimenti.causaleRettifica")}</SelectItem>
                          <SelectItem value="scadenza">{t("movimenti.causaleScadenza")}</SelectItem>
                          <SelectItem value="smaltimento">{t("movimenti.causaleSmaltimento")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="dataMovimento" render={({ field }) => (
                  <FormItem><FormLabel>{t("movimenti.fldData")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                )} />

                <FormField control={form.control} name="magazzinoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("movimenti.fldMagazzino")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("movimenti.phSeleziona")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {magazzini?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="space-y-2">
                  <Label>{t("movimenti.scanLabel")}</Label>
                  <div className="flex gap-2">
                    <Input
                      value={scanProdotto}
                      onChange={e => setScanProdotto(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleScanProdotto(); } }}
                      placeholder={t("movimenti.scanPlaceholder")}
                    />
                    <Button type="button" variant="secondary" className="gap-2" onClick={() => handleScanProdotto()} disabled={!scanProdotto.trim()}>
                      <ScanLine className="h-4 w-4" /> {t("movimenti.scanButton")}
                    </Button>
                    <BarcodeScannerButton onScan={(v) => { setScanProdotto(v); handleScanProdotto(v); }} />
                  </div>
                </div>

                <FormField control={form.control} name="prodottoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("movimenti.fldProdotto")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("movimenti.phSeleziona")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {prodotti?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="quantita" render={({ field }) => (
                    <FormItem><FormLabel>{t("movimenti.fldQuantita")}</FormLabel><FormControl><Input type="number" step="0.01" min="0.01" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="unitaMisura" render={({ field }) => (
                    <FormItem><FormLabel>{t("movimenti.fldUM")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>{t("movimenti.fldNote")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createMovimento.isPending}>{t("movimenti.submit")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
