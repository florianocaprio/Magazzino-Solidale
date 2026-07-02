import { useState } from "react";
import {
  useListProdotti,
  useCreateProdotto,
  useUpdateProdotto,
  useDeleteProdotto,
  useListMagazzini,
  useListLotti,
  useListFornitori,
  useBulkProdotti,
  useCreateLotto,
  useCreateMovimento,
  getListProdottiQueryKey,
  getListGiacenzeQueryKey,
  getListLottiQueryKey,
  getListMovimentiQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
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
import { Label } from "@/components/ui/label";
import { ExportButtons } from "@/components/export-buttons";
import { generateProdottiBarcodePdf } from "@/lib/prodotti-barcode-pdf";
import { BulkImportDialog, matchByName, parseBoolCell, type MapRowResult } from "@/components/bulk-import-dialog";
import { MoreHorizontal, Plus, Pencil, Trash2, Filter, PackagePlus, Barcode, Upload } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import * as z from "zod";

const makeFormSchema = (t: (key: string) => string) => {
  const optionalNonNegativeNumber = z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().min(0, t("prodotti.errQuantitaNonNegative")).nullable(),
  );

  return z.object({
    codice: z.string().optional(),
    nome: z.string().min(2, t("prodotti.errNomeShort")),
    descrizione: z.string().optional(),
    tipoProdotto: z.string().min(1, t("common.requiredField")),
    unitaMisura: z.string().min(1, t("common.requiredField")),
    codiceBarre: z.string().optional(),
    gestioneLotto: z.boolean().default(false),
    gestioneScadenza: z.boolean().default(false),
    fsePlus: z.boolean().default(false),
    scortaMinima: z.coerce.number().min(0).default(0),
    scortaConsigliata: z.coerce.number().min(0).default(0),
    abilitatoEmporio: z.boolean().default(false),
    creditoSolidaleValore: z.coerce.number().min(0, t("prodotti.errCreditoSolidaleNonNegative")).default(0),
    quantitaMassimaPerSpesa: optionalNonNegativeNumber,
    quantitaMassimaMensile: optionalNonNegativeNumber,
    note: z.string().optional()
  });
};

type FormValues = z.infer<ReturnType<typeof makeFormSchema>>;

const apiErrorMessage = (e: unknown) =>
  (e as { data?: { error?: string } })?.data?.error ??
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
  "Operazione non riuscita";

type OptionalBulkNumberResult = { ok: true; value: number | undefined } | { ok: false; error: string };

function parseOptionalBulkNumber(
  value: string | undefined,
  field: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): OptionalBulkNumberResult {
  if (!value) return { ok: true, value: undefined };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: t("bulkImport.invalidNumber", { field }) };
  return { ok: true, value: n };
}

const makeCaricoSchema = (t: (key: string) => string) => z.object({
  magazzinoId: z.string().min(1, t("prodotti.errSelectMagazzino")),
  quantita: z.coerce.number().positive(t("prodotti.errQuantitaPositive")),
  dataCarico: z.string().min(1, t("common.requiredField")),
  causale: z.string().min(1, t("common.requiredField")),
  provenienza: z.enum(["fseplus", "fornitore"]),
  fornitoreId: z.string().optional(),
  codiceLotto: z.string().optional(),
  dataScadenza: z.string().optional(),
  note: z.string().optional(),
}).refine((d) => d.provenienza !== "fornitore" || (d.fornitoreId && d.fornitoreId.length > 0), {
  message: t("prodotti.errSelectFornitore"),
  path: ["fornitoreId"],
});

type CaricoValues = z.infer<ReturnType<typeof makeCaricoSchema>>;

type Prodotto = {
  id: number;
  nome: string;
  unitaMisura: string;
  gestioneLotto: boolean;
  gestioneScadenza: boolean;
  fsePlus: boolean;
  fornitoreId: number | null;
};

function CaricoForm({ prodotto, onClose }: { prodotto: Prodotto; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: magazzini } = useListMagazzini();
  const { data: fornitori } = useListFornitori();
  const createLotto = useCreateLotto();
  const createMovimento = useCreateMovimento();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const caricoSchema = makeCaricoSchema(t);

  const form = useForm<CaricoValues>({
    resolver: zodResolver(caricoSchema),
    defaultValues: {
      magazzinoId: "",
      quantita: 0,
      dataCarico: new Date().toISOString().split("T")[0],
      causale: "donazione",
      provenienza: prodotto.fsePlus ? "fseplus" : "fornitore",
      fornitoreId: !prodotto.fsePlus && prodotto.fornitoreId ? String(prodotto.fornitoreId) : "",
      codiceLotto: "",
      dataScadenza: "",
      note: "",
    },
  });

  const provenienza = form.watch("provenienza");

  const submitting = createLotto.isPending || createMovimento.isPending;

  const onSubmit = (data: CaricoValues) => {
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
                  title: t("prodotti.toastCaricoTitle"),
                  description: t("prodotti.toastCaricoDesc", { quantita: data.quantita, um: prodotto.unitaMisura, nome: prodotto.nome }),
                });
                onClose();
              },
              onError: () => {
                // The lotto (and therefore the stock) was already created; only the
                // audit movement failed. Refresh stock and warn — do NOT keep the form
                // open, or re-submitting would load the quantity a second time.
                invalidateStock();
                toast({
                  title: t("prodotti.toastCaricoIncompletoTitle"),
                  description: t("prodotti.toastCaricoIncompletoDesc"),
                  variant: "destructive",
                });
                onClose();
              },
            },
          );
        },
        onError: () =>
          toast({ title: t("prodotti.toastErrorTitle"), description: t("prodotti.toastCaricoError"), variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("prodotti.loadTitle")}</SheetTitle>
          <SheetDescription>
            {t("prodotti.loadDescription", { nome: prodotto.nome })}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="magazzinoId" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("prodotti.loadMagazzino")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("prodotti.selectMagazzino")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {magazzini?.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="quantita" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("prodotti.quantityWithUm", { um: prodotto.unitaMisura })}</FormLabel>
                    <FormControl><Input type="number" min="0" step="any" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dataCarico" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("prodotti.dataCarico")}</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="causale" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("prodotti.causale")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("prodotti.selectCausale")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="donazione">{t("prodotti.causale_donazione")}</SelectItem>
                      <SelectItem value="acquisto">{t("prodotti.causale_acquisto")}</SelectItem>
                      <SelectItem value="rettifica_inventario">{t("prodotti.causale_rettifica")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="provenienza" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("prodotti.provenienza")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="fseplus">{t("prodotti.provenienza_fseplus")}</SelectItem>
                      <SelectItem value="fornitore">{t("prodotti.provenienza_fornitore")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {provenienza === "fornitore" && (
                <FormField control={form.control} name="fornitoreId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("prodotti.fornitore")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder={t("prodotti.selectFornitore")} /></SelectTrigger>
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

              {(prodotto.gestioneLotto || prodotto.gestioneScadenza) && (
                <div className="grid grid-cols-2 gap-4">
                  {prodotto.gestioneLotto && (
                    <FormField control={form.control} name="codiceLotto" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("prodotti.codiceLotto")}</FormLabel>
                        <FormControl><Input placeholder={t("prodotti.optional")} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                  {prodotto.gestioneScadenza && (
                    <FormField control={form.control} name="dataScadenza" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("prodotti.dataScadenza")}</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </div>
              )}

              <FormField control={form.control} name="note" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.notes")}</FormLabel>
                  <FormControl><Input placeholder={t("prodotti.optional")} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="pt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={submitting} className="gap-2">
                  <PackagePlus className="h-4 w-4" /> {t("prodotti.registraCarico")}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProdottoLotti({ prodottoId }: { prodottoId: number }) {
  const { t } = useTranslation();
  const { data: lotti, isLoading } = useListLotti(
    { prodottoId },
    { query: { queryKey: getListLottiQueryKey({ prodottoId }) } },
  );

  return (
    <div className="pt-4 border-t space-y-2">
      <Label className="text-sm font-medium">{t("prodotti.lottiTitle")}</Label>
      {isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : !lotti || lotti.length === 0 ? (
        <p className="text-[0.8rem] text-muted-foreground">{t("prodotti.noLotti")}</p>
      ) : (
        <div className="rounded-lg border divide-y">
          {lotti.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {l.codiceLotto || <span className="text-muted-foreground italic">{t("prodotti.senzaCodice")}</span>}
                  <span className="text-muted-foreground font-normal"> · {l.magazzinoNome}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("prodotti.residuoLabel")} {l.quantitaResidua}
                  {l.dataScadenza ? ` · ${t("prodotti.scadShort")} ${new Date(l.dataScadenza).toLocaleDateString("it-IT")}` : ""}
                </div>
              </div>
              {l.fsePlus ? (
                <Badge variant="outline" className="border-none bg-blue-500/15 text-blue-700 shrink-0">FSE+</Badge>
              ) : l.fornitoreNome ? (
                <Badge variant="outline" className="shrink-0">{l.fornitoreNome}</Badge>
              ) : (
                <span className="text-muted-foreground text-xs italic shrink-0">{t("prodotti.provenienzaNd")}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Prodotti() {
  const { t } = useTranslation();
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
  const [caricoProdotto, setCaricoProdotto] = useState<Prodotto | null>(null);

  const createProdotto = useCreateProdotto();
  const updateProdotto = useUpdateProdotto();
  const deleteProdotto = useDeleteProdotto();
  const bulkProdotti = useBulkProdotti();
  const { data: fornitori } = useListFornitori();
  const [isImportOpen, setIsImportOpen] = useState(false);

  const formSchema = makeFormSchema(t);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      codice: "", nome: "", descrizione: "", tipoProdotto: "alimentare",
      unitaMisura: "pz", gestioneLotto: false, gestioneScadenza: false, fsePlus: false,
      scortaMinima: 0, scortaConsigliata: 0, abilitatoEmporio: false, creditoSolidaleValore: 0,
      quantitaMassimaPerSpesa: null, quantitaMassimaMensile: null, note: "", codiceBarre: ""
    }
  });
  const abilitatoEmporio = form.watch("abilitatoEmporio");

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
      fsePlus: prodotto.fsePlus,
      scortaMinima: prodotto.scortaMinima,
      scortaConsigliata: prodotto.scortaConsigliata,
      abilitatoEmporio: prodotto.abilitatoEmporio ?? false,
      creditoSolidaleValore: prodotto.creditoSolidaleValore ?? 0,
      quantitaMassimaPerSpesa: prodotto.quantitaMassimaPerSpesa ?? null,
      quantitaMassimaMensile: prodotto.quantitaMassimaMensile ?? null,
      note: prodotto.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      codice: "", nome: "", descrizione: "", tipoProdotto: "alimentare",
      unitaMisura: "pz", gestioneLotto: false, gestioneScadenza: false, fsePlus: false,
      scortaMinima: 0, scortaConsigliata: 0, abilitatoEmporio: false, creditoSolidaleValore: 0,
      quantitaMassimaPerSpesa: null, quantitaMassimaMensile: null, note: "", codiceBarre: ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    form.clearErrors("codice");
    form.clearErrors("codiceBarre");
    const handleError = (err: unknown) => {
      const message = apiErrorMessage(err);
      if (message.toLowerCase().includes("codice a barre")) {
        form.setError("codiceBarre", { type: "server", message });
      } else if (message.toLowerCase().includes("codice prodotto")) {
        form.setError("codice", { type: "server", message });
      }
      toast({ title: t("prodotti.toastErrorTitle"), description: message, variant: "destructive" });
    };
    if (editingId) {
      updateProdotto.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProdottiQueryKey() });
          toast({ title: t("prodotti.toastUpdated") });
          setIsFormOpen(false);
        },
        onError: handleError,
      });
    } else {
      createProdotto.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProdottiQueryKey() });
          toast({ title: t("prodotti.toastCreated") });
          setIsFormOpen(false);
        },
        onError: handleError,
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteProdotto.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProdottiQueryKey() });
        toast({ title: t("prodotti.toastDeleted") });
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
          <h1 className="text-3xl font-bold tracking-tight">{t("prodotti.title")}</h1>
          <p className="text-muted-foreground">{t("prodotti.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={prodotti ?? []}
            columns={[
              { header: t("common.code"), accessor: (p) => p.codice },
              { header: t("common.name"), accessor: (p) => p.nome },
              { header: t("common.type"), accessor: (p) => p.tipoProdotto },
              { header: t("prodotti.colUm"), accessor: (p) => p.unitaMisura },
              { header: t("prodotti.colScortaMinima"), accessor: (p) => p.scortaMinima != null ? parseFloat(String(p.scortaMinima)) : "" },
              { header: t("prodotti.abilitatoEmporio"), accessor: (p) => p.abilitatoEmporio ? t("common.yes") : t("common.no") },
              { header: t("prodotti.creditoSolidaleValore"), accessor: (p) => p.creditoSolidaleValore ?? 0 },
              { header: t("prodotti.quantitaMassimaPerSpesa"), accessor: (p) => p.quantitaMassimaPerSpesa ?? "" },
              { header: t("prodotti.quantitaMassimaMensile"), accessor: (p) => p.quantitaMassimaMensile ?? "" },
            ]}
            filename="prodotti"
            title={t("prodotti.title")}
          />
          <Button
            variant="outline"
            className="gap-2"
            disabled={(prodotti ?? []).length === 0}
            onClick={() =>
              generateProdottiBarcodePdf(
                (prodotti ?? []).map((p) => ({
                  nome: p.nome,
                  tipo: t(`prodotti.type_${p.tipoProdotto}`, p.tipoProdotto.replace("_", " ")),
                  um: p.unitaMisura,
                  code: p.codiceBarre || p.codice,
                })),
                {
                  title: t("prodotti.barcodeListTitle"),
                  tipoLabel: t("prodotti.barcodeTipo"),
                  umLabel: t("prodotti.barcodeUm"),
                },
              )
            }
          >
            <Barcode className="h-4 w-4" /> {t("prodotti.exportBarcodes")}
          </Button>
          <Button variant="outline" onClick={() => setIsImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> {t("bulkImport.button")}
          </Button>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("prodotti.newProduct")}
          </Button>
        </div>
      </div>

      <BulkImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        entityLabel={t("prodotti.title")}
        templateFilename="modello_prodotti"
        columns={[
          { key: "codice", header: t("common.code"), example: "PRD-001" },
          { key: "nome", header: t("common.name"), example: "Pasta 500g" },
          { key: "tipoProdotto", header: t("common.type"), example: "alimentare" },
          { key: "unitaMisura", header: t("prodotti.colUm"), example: "pz" },
          { key: "descrizione", header: t("common.description"), example: "" },
          { key: "codiceBarre", header: t("prodotti.barcode"), example: "" },
          { key: "gestioneLotto", header: t("prodotti.gestioneLotto"), example: "No" },
          { key: "gestioneScadenza", header: t("prodotti.gestioneScadenza"), example: "No" },
          { key: "fsePlus", header: "FSE+", example: "No" },
          { key: "scortaMinima", header: t("prodotti.colScortaMinima"), example: 0 },
          { key: "scortaConsigliata", header: t("prodotti.scortaConsigliata"), example: 0 },
          { key: "abilitatoEmporio", header: t("prodotti.abilitatoEmporio"), example: "No" },
          { key: "creditoSolidaleValore", header: t("prodotti.creditoSolidaleValore"), example: 0 },
          { key: "quantitaMassimaPerSpesa", header: t("prodotti.quantitaMassimaPerSpesa"), example: "" },
          { key: "quantitaMassimaMensile", header: t("prodotti.quantitaMassimaMensile"), example: "" },
          { key: "fornitore", header: t("prodotti.fornitore"), example: "" },
        ]}
        mapRow={(r): MapRowResult<Record<string, unknown>> => {
          if (!r.nome) return { error: t("bulkImport.requiredMissing", { field: t("common.name") }) };
          if (!r.tipoProdotto) return { error: t("bulkImport.requiredMissing", { field: t("common.type") }) };
          if (!r.unitaMisura) return { error: t("bulkImport.requiredMissing", { field: t("prodotti.colUm") }) };
          let fornitoreId: number | undefined;
          if (r.fornitore) {
            const f = matchByName(fornitori, r.fornitore, (x) => x.nome);
            if (!f) return { error: t("bulkImport.unknownRef", { field: t("prodotti.fornitore"), value: r.fornitore }) };
            fornitoreId = f.id;
          }
          let scortaMinima: number | undefined;
          if (r.scortaMinima) {
            const n = Number(r.scortaMinima);
            if (Number.isNaN(n)) return { error: t("bulkImport.invalidNumber", { field: t("prodotti.colScortaMinima") }) };
            scortaMinima = n;
          }
          let scortaConsigliata: number | undefined;
          if (r.scortaConsigliata) {
            const n = Number(r.scortaConsigliata);
            if (Number.isNaN(n)) return { error: t("bulkImport.invalidNumber", { field: t("prodotti.scortaConsigliata") }) };
            scortaConsigliata = n;
          }
          const creditoSolidaleValore = parseOptionalBulkNumber(
            r.creditoSolidaleValore,
            t("prodotti.creditoSolidaleValore"),
            t,
          );
          if (!creditoSolidaleValore.ok) return { error: creditoSolidaleValore.error };
          const quantitaMassimaPerSpesa = parseOptionalBulkNumber(
            r.quantitaMassimaPerSpesa,
            t("prodotti.quantitaMassimaPerSpesa"),
            t,
          );
          if (!quantitaMassimaPerSpesa.ok) return { error: quantitaMassimaPerSpesa.error };
          const quantitaMassimaMensile = parseOptionalBulkNumber(
            r.quantitaMassimaMensile,
            t("prodotti.quantitaMassimaMensile"),
            t,
          );
          if (!quantitaMassimaMensile.ok) return { error: quantitaMassimaMensile.error };
          return {
            data: {
              codice: r.codice || undefined,
              nome: r.nome,
              tipoProdotto: r.tipoProdotto,
              unitaMisura: r.unitaMisura,
              descrizione: r.descrizione || undefined,
              codiceBarre: r.codiceBarre || undefined,
              gestioneLotto: parseBoolCell(r.gestioneLotto),
              gestioneScadenza: parseBoolCell(r.gestioneScadenza),
              fsePlus: parseBoolCell(r.fsePlus),
              scortaMinima,
              scortaConsigliata,
              abilitatoEmporio: parseBoolCell(r.abilitatoEmporio),
              creditoSolidaleValore: creditoSolidaleValore.value,
              quantitaMassimaPerSpesa: quantitaMassimaPerSpesa.value,
              quantitaMassimaMensile: quantitaMassimaMensile.value,
              fornitoreId,
            },
          };
        }}
        onImport={async (righe) => bulkProdotti.mutateAsync({ data: { righe: righe as never } })}
        onDone={() => queryClient.invalidateQueries({ queryKey: getListProdottiQueryKey() })}
      />

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <Input 
              placeholder={t("prodotti.searchPlaceholder")} 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("prodotti.allTypes")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("prodotti.allTypes")}</SelectItem>
                  <SelectItem value="alimentare">{t("prodotti.type_alimentare")}</SelectItem>
                  <SelectItem value="igiene">{t("prodotti.type_igiene")}</SelectItem>
                  <SelectItem value="vestiario">{t("prodotti.type_vestiario")}</SelectItem>
                  <SelectItem value="medicinali">{t("prodotti.type_medicinali")}</SelectItem>
                  <SelectItem value="scarpe">{t("prodotti.type_scarpe")}</SelectItem>
                  <SelectItem value="sanitario">{t("prodotti.type_sanitario")}</SelectItem>
                  <SelectItem value="altro">{t("prodotti.type_altro")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">{t("common.code")}</TableHead>
                <TableHead>{t("prodotti.colProdotto")}</TableHead>
                <TableHead>{t("common.type")}</TableHead>
                <TableHead>{t("prodotti.colUm")}</TableHead>
                <TableHead className="text-right">{t("prodotti.colScortaMinima")}</TableHead>
                <TableHead className="text-center">{t("prodotti.colProprieta")}</TableHead>
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
                    {t("prodotti.noProductsFound")}
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
                      {t(`prodotti.type_${prodotto.tipoProdotto}`, prodotto.tipoProdotto.replace('_', ' '))}
                    </Badge>
                  </TableCell>
                  <TableCell>{prodotto.unitaMisura}</TableCell>
                  <TableCell className="text-right">{prodotto.scortaMinima}</TableCell>
                  <TableCell>
                    <div className="flex justify-center gap-1">
                      {prodotto.gestioneScadenza && (
                        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-200">{t("prodotti.badgeScadenza")}</Badge>
                      )}
                      {prodotto.gestioneLotto && (
                        <Badge variant="outline" className="text-xs">{t("prodotti.badgeLotto")}</Badge>
                      )}
                      {prodotto.abilitatoEmporio && (
                        <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-200">
                          {t("prodotti.badgeEmporio")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("prodotti.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setCaricoProdotto({
                          id: prodotto.id,
                          nome: prodotto.nome,
                          unitaMisura: prodotto.unitaMisura,
                          gestioneLotto: prodotto.gestioneLotto,
                          gestioneScadenza: prodotto.gestioneScadenza,
                          fsePlus: prodotto.fsePlus,
                          fornitoreId: prodotto.fornitoreId ?? null,
                        })}>
                          <PackagePlus className="mr-2 h-4 w-4" />
                          {t("prodotti.loadToWarehouse")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(prodotto)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(prodotto.id)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t("common.delete")}
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
            <SheetTitle>{editingId ? t("prodotti.editProduct") : t("prodotti.newProduct")}</SheetTitle>
            <SheetDescription>
              {t("prodotti.formDescription")}
            </SheetDescription>
          </SheetHeader>
          
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="codice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.code")}</FormLabel>
                      <FormControl><Input placeholder={t("prodotti.codePlaceholder")} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="codiceBarre" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("prodotti.barcode")}</FormLabel>
                      <div className="flex gap-2">
                        <FormControl><Input placeholder={t("prodotti.optional")} {...field} /></FormControl>
                        <BarcodeScannerButton onScan={(v) => field.onChange(v)} />
                      </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.name")}</FormLabel>
                    <FormControl><Input placeholder={t("prodotti.namePlaceholder")} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="tipoProdotto" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.type")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("prodotti.selectType")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="alimentare">{t("prodotti.type_alimentare")}</SelectItem>
                          <SelectItem value="igiene">{t("prodotti.type_igiene")}</SelectItem>
                          <SelectItem value="vestiario">{t("prodotti.type_vestiario")}</SelectItem>
                          <SelectItem value="medicinali">{t("prodotti.type_medicinali")}</SelectItem>
                          <SelectItem value="scarpe">{t("prodotti.type_scarpe")}</SelectItem>
                          <SelectItem value="sanitario">{t("prodotti.type_sanitario")}</SelectItem>
                          <SelectItem value="altro">{t("prodotti.type_altro")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="unitaMisura" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("prodotti.unitOfMeasure")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("prodotti.selectUm")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pz">{t("prodotti.um_pz")}</SelectItem>
                          <SelectItem value="kg">{t("prodotti.um_kg")}</SelectItem>
                          <SelectItem value="l">{t("prodotti.um_l")}</SelectItem>
                          <SelectItem value="cf">{t("prodotti.um_cf")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="scortaMinima" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("prodotti.scortaMinima")}</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="scortaConsigliata" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("prodotti.scortaConsigliata")}</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="space-y-4 pt-4 border-t">
                  <div>
                    <h4 className="text-sm font-medium">{t("prodotti.emporioSection")}</h4>
                    <p className="text-[0.8rem] text-muted-foreground">{t("prodotti.creditoSolidaleHelp")}</p>
                  </div>

                  <FormField control={form.control} name="abilitatoEmporio" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>{t("prodotti.abilitatoEmporio")}</FormLabel>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="creditoSolidaleValore" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("prodotti.creditoSolidaleValore")}</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" step="0.01" disabled={!abilitatoEmporio} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="quantitaMassimaPerSpesa" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("prodotti.quantitaMassimaPerSpesa")}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={!abilitatoEmporio}
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="quantitaMassimaMensile" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("prodotti.quantitaMassimaMensile")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={!abilitatoEmporio}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="space-y-4 pt-4 border-t">
                  <FormField control={form.control} name="gestioneScadenza" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>{t("prodotti.gestioneScadenza")}</FormLabel>
                        <p className="text-[0.8rem] text-muted-foreground">{t("prodotti.gestioneScadenzaDesc")}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="gestioneLotto" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>{t("prodotti.gestioneLotto")}</FormLabel>
                        <p className="text-[0.8rem] text-muted-foreground">{t("prodotti.gestioneLottoDesc")}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="fsePlus" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>{t("prodotti.fsePlus")}</FormLabel>
                        <p className="text-[0.8rem] text-muted-foreground">{t("prodotti.fsePlusDesc")}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                {editingId && <ProdottoLotti prodottoId={editingId} />}

                <div className="pt-4 border-t">
                  <FormField control={form.control} name="descrizione" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("prodotti.descrizioneExtra")}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={createProdotto.isPending || updateProdotto.isPending}>
                    {editingId ? t("prodotti.saveChanges") : t("prodotti.createProduct")}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      {caricoProdotto && (
        <CaricoForm prodotto={caricoProdotto} onClose={() => setCaricoProdotto(null)} />
      )}

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("prodotti.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("prodotti.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
