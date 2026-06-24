import { useState } from "react";
import {
  useListLotti,
  useListMagazzini,
  useListProdotti,
  useListFornitori,
  useCreateLotto,
  useCreateMovimento,
  getListGiacenzeQueryKey,
  getListLottiQueryKey,
  getListMovimentiQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ExportButtons } from "@/components/export-buttons";
import { Calendar, Filter, Plus, Info } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { it } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const nuovoLottoSchema = z.object({
  prodottoId: z.string().min(1),
  magazzinoId: z.string().min(1),
  quantita: z.coerce.number().positive(),
  dataCarico: z.string().min(1),
  causale: z.string().min(1),
  provenienza: z.enum(["fseplus", "fornitore"]),
  fornitoreId: z.string().optional(),
  codiceLotto: z.string().optional(),
  dataScadenza: z.string().optional(),
  note: z.string().optional(),
});

type NuovoLottoValues = z.infer<typeof nuovoLottoSchema>;

function NuovoLottoDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  const { data: fornitori } = useListFornitori();
  const createLotto = useCreateLotto();
  const createMovimento = useCreateMovimento();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const schema = useMemo(() => z.object({
    prodottoId: z.string().min(1, t("lotti.valProdotto")),
    magazzinoId: z.string().min(1, t("lotti.valMagazzino")),
    quantita: z.coerce.number().positive(t("lotti.valQuantita")),
    dataCarico: z.string().min(1, t("common.requiredField")),
    causale: z.string().min(1, t("common.requiredField")),
    provenienza: z.enum(["fseplus", "fornitore"]),
    fornitoreId: z.string().optional(),
    codiceLotto: z.string().optional(),
    dataScadenza: z.string().optional(),
    note: z.string().optional(),
  }).refine((d) => d.provenienza !== "fornitore" || (d.fornitoreId && d.fornitoreId.length > 0), {
    message: t("lotti.valFornitore"),
    path: ["fornitoreId"],
  }), [t]);

  const form = useForm<NuovoLottoValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      prodottoId: "",
      magazzinoId: "",
      quantita: 0,
      dataCarico: new Date().toISOString().split("T")[0],
      causale: "donazione",
      provenienza: "fornitore",
      fornitoreId: "",
      codiceLotto: "",
      dataScadenza: "",
      note: "",
    },
  });

  const provenienza = form.watch("provenienza");

  const onProdottoChange = (value: string) => {
    form.setValue("prodottoId", value);
    const prodotto = prodotti?.find((p) => p.id.toString() === value);
    if (!prodotto) return;
    if (prodotto.fsePlus) {
      form.setValue("provenienza", "fseplus");
      form.setValue("fornitoreId", "");
    } else if (prodotto.fornitoreId) {
      form.setValue("provenienza", "fornitore");
      form.setValue("fornitoreId", prodotto.fornitoreId.toString());
    } else {
      form.setValue("provenienza", "fornitore");
      form.setValue("fornitoreId", "");
    }
  };

  const submitting = createLotto.isPending || createMovimento.isPending;

  const onSubmit = (data: NuovoLottoValues) => {
    const prodotto = prodotti?.find((p) => p.id.toString() === data.prodottoId);
    if (!prodotto) {
      toast({ title: t("lotti.toastErrorTitle"), description: t("lotti.toastProdottoNonValido"), variant: "destructive" });
      return;
    }
    createLotto.mutate(
      {
        data: {
          prodottoId: prodotto.id,
          magazzinoId: parseInt(data.magazzinoId),
          dataCarico: data.dataCarico,
          quantitaCaricata: data.quantita,
          fsePlus: data.provenienza === "fseplus",
          fornitoreId: data.provenienza === "fornitore" && data.fornitoreId ? parseInt(data.fornitoreId) : undefined,
          codiceLotto: data.codiceLotto || undefined,
          dataScadenza: data.dataScadenza || undefined,
          note: data.note || undefined,
        },
      },
      {
        onSuccess: (lotto) => {
          const invalidateStock = () => {
            queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListLottiQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListMovimentiQueryKey() });
          };
          createMovimento.mutate(
            {
              data: {
                tipoMovimento: "carico",
                tipoDettaglio: data.causale,
                dataMovimento: data.dataCarico,
                magazzinoId: parseInt(data.magazzinoId),
                prodottoId: prodotto.id,
                lottoId: lotto.id,
                quantita: data.quantita,
                unitaMisura: prodotto.unitaMisura,
                note: data.note || undefined,
              },
            },
            {
              onSuccess: () => {
                invalidateStock();
                toast({
                  title: t("lotti.toastLottoCaricato"),
                  description: t("lotti.toastLottoCaricatoDesc", { qty: data.quantita, um: prodotto.unitaMisura, nome: prodotto.nome }),
                });
                onClose();
              },
              onError: () => {
                invalidateStock();
                toast({
                  title: t("lotti.toastLogIncompleto"),
                  description: t("lotti.toastLogIncompletoDesc"),
                  variant: "destructive",
                });
                onClose();
              },
            },
          );
        },
        onError: () =>
          toast({ title: t("lotti.toastErrorTitle"), description: t("lotti.toastImpossibileCreare"), variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("lotti.dialogTitle")}</SheetTitle>
          <SheetDescription>
            {t("lotti.dialogDescription")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {t("lotti.infoText")} <strong>{t("lotti.infoStrong")}</strong>.
          </span>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <FormField control={form.control} name="prodottoId" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldProdotto")}</FormLabel>
                <Select onValueChange={onProdottoChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder={t("lotti.phProdotto")} /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {prodotti?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="magazzinoId" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldMagazzino")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder={t("lotti.phMagazzino")} /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {magazzini?.map((m) => (
                      <SelectItem key={m.id} value={m.id.toString()}>{m.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="quantita" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldQuantita")}</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="dataCarico" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldDataCarico")}</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="causale" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldCausale")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="donazione">{t("lotti.causaleDonazione")}</SelectItem>
                    <SelectItem value="acquisto">{t("lotti.causaleAcquisto")}</SelectItem>
                    <SelectItem value="rettifica_inventario">{t("lotti.causaleRettifica")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="provenienza" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldProvenienza")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="fseplus">{t("lotti.provFseplus")}</SelectItem>
                    <SelectItem value="fornitore">{t("lotti.provFornitore")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {provenienza === "fornitore" && (
              <FormField control={form.control} name="fornitoreId" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("lotti.fldFornitore")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder={t("lotti.phFornitore")} /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {fornitori?.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="codiceLotto" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldCodiceLotto")} <span className="text-muted-foreground font-normal">{t("lotti.optional")}</span></FormLabel>
                <FormControl><Input placeholder={t("lotti.phCodiceLotto")} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="dataScadenza" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldDataScadenza")} <span className="text-muted-foreground font-normal">{t("lotti.optional")}</span></FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="note" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lotti.fldNote")} <span className="text-muted-foreground font-normal">{t("lotti.optional")}</span></FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={submitting}>{submitting ? t("common.saving") : t("lotti.submit")}</Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

export default function Lotti() {
  const { t } = useTranslation();
  const [magazzinoId, setMagazzinoId] = useState<string>("all");
  const [prodottoId, setProdottoId] = useState<string>("all");
  const [inScadenza, setInScadenza] = useState(false);
  const [nuovoOpen, setNuovoOpen] = useState(false);
  
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  
  const { data: lotti, isLoading } = useListLotti({
    magazzinoId: magazzinoId !== "all" ? Number(magazzinoId) : undefined,
    prodottoId: prodottoId !== "all" ? Number(prodottoId) : undefined,
    inScadenza: inScadenza || undefined
  });

  const getExpiryStatus = (dateStr: string | null | undefined) => {
    if (!dateStr) return { key: "noExpiry", label: t("lotti.statusNoExpiry"), color: "text-muted-foreground", badge: "bg-gray-100 text-gray-800" };
    
    const expiryDate = new Date(dateStr);
    const daysLeft = differenceInDays(expiryDate, new Date());
    
    if (daysLeft < 0) return { key: "expired", label: t("lotti.statusExpired"), color: "text-destructive font-bold", badge: "bg-destructive text-destructive-foreground" };
    if (daysLeft <= 7) return { key: "critical", label: t("lotti.statusCritical"), color: "text-destructive font-semibold", badge: "bg-destructive/90 text-destructive-foreground" };
    if (daysLeft <= 30) return { key: "warning", label: t("lotti.statusWarning"), color: "text-amber-600 font-medium", badge: "bg-amber-500 text-white" };
    return { key: "regular", label: t("lotti.statusRegular"), color: "text-green-600", badge: "bg-green-500/20 text-green-700" };
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("lotti.title")}</h1>
          <p className="text-muted-foreground">{t("lotti.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={lotti ?? []}
            columns={[
              { header: t("lotti.colCodLotto"), accessor: (l) => l.codiceLotto },
              { header: t("lotti.colProdotto"), accessor: (l) => l.prodottoNome },
              { header: t("lotti.colMagazzino"), accessor: (l) => l.magazzinoNome },
              { header: t("lotti.colProvenienza"), accessor: (l) => l.fsePlus ? "FSE+" : (l.fornitoreNome ?? "") },
              { header: t("lotti.colDataScadenza"), accessor: (l) => l.dataScadenza ? new Date(l.dataScadenza).toLocaleDateString("it-IT") : "" },
              { header: t("lotti.colQtaIniziale"), accessor: (l) => l.quantitaCaricata != null ? parseFloat(String(l.quantitaCaricata)) : "" },
              { header: t("lotti.colQtaResidua"), accessor: (l) => l.quantitaResidua != null ? parseFloat(String(l.quantitaResidua)) : "" },
            ]}
            filename="lotti"
            title={t("lotti.exportTitle")}
            orientation="landscape"
          />
          <Button onClick={() => setNuovoOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t("lotti.newLot")}
          </Button>
        </div>
      </div>

      {nuovoOpen && <NuovoLottoDialog onClose={() => setNuovoOpen(false)} />}

      <Card>
        <CardHeader className="py-4 border-b bg-muted/20">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("lotti.allWarehouses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("lotti.allWarehouses")}</SelectItem>
                  {magazzini?.map(m => (
                    <SelectItem key={m.id} value={m.id.toString()}>{m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <Select value={prodottoId} onValueChange={setProdottoId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t("lotti.allProducts")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("lotti.allProducts")}</SelectItem>
                  {prodotti?.filter(p => p.gestioneScadenza || p.gestioneLotto).map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2 ml-auto bg-amber-500/10 px-3 py-1.5 rounded-md border border-amber-500/20">
              <Switch id="scadenza" checked={inScadenza} onCheckedChange={setInScadenza} />
              <Label htmlFor="scadenza" className="text-amber-700 font-medium cursor-pointer">
                {t("lotti.expiringOnly")}
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("lotti.colCodLotto")}</TableHead>
                <TableHead>{t("lotti.colProdotto")}</TableHead>
                <TableHead>{t("lotti.colMagazzino")}</TableHead>
                <TableHead>{t("lotti.colProvenienza")}</TableHead>
                <TableHead>{t("lotti.colDataScadenza")}</TableHead>
                <TableHead className="text-right">{t("lotti.colQtaIniziale")}</TableHead>
                <TableHead className="text-right">{t("lotti.colQtaResidua")}</TableHead>
                <TableHead className="w-[100px] text-center">{t("lotti.colStato")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : lotti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    {t("lotti.noResults")}
                  </TableCell>
                </TableRow>
              ) : lotti?.map((lotto) => {
                const status = getExpiryStatus(lotto.dataScadenza);
                // Highlight row if critical
                const isCritical = status.key === "critical" || status.key === "expired";
                const isWarning = status.key === "warning";
                
                return (
                  <TableRow key={lotto.id} className={isCritical ? "bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20" : isWarning ? "bg-amber-50/30 hover:bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <TableCell className="font-mono text-xs font-medium">
                      {lotto.codiceLotto || <span className="text-muted-foreground italic">{t("lotti.na")}</span>}
                    </TableCell>
                    <TableCell className="font-medium">{lotto.prodottoNome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lotto.magazzinoNome}</TableCell>
                    <TableCell>
                      {lotto.fsePlus ? (
                        <Badge variant="outline" className="border-none bg-blue-500/15 text-blue-700">FSE+</Badge>
                      ) : lotto.fornitoreNome ? (
                        <span className="text-sm">{lotto.fornitoreNome}</span>
                      ) : (
                        <span className="text-muted-foreground text-sm italic">{t("lotti.na")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {lotto.dataScadenza ? (
                        <div className={`flex items-center gap-2 text-sm ${status.color}`}>
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(lotto.dataScadenza), "dd MMM yyyy", { locale: it })}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm italic">{t("lotti.notProvided")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{lotto.quantitaCaricata}</TableCell>
                    <TableCell className="text-right font-bold">{lotto.quantitaResidua}</TableCell>
                    <TableCell className="text-center">
                      {lotto.dataScadenza && (
                        <Badge variant="outline" className={`border-none ${status.badge}`}>
                          {status.label}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
