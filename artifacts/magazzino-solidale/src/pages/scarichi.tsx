import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  useListScarichi,
  useCreateScarico,
  useListMagazzini,
  useListCentriAscolto,
  useListGiacenze,
  useListProdotti,
  useGetImpostazioniStampa,
  getListScarichiQueryKey,
  getListGiacenzeQueryKey,
  getListLottiQueryKey,
  getListMovimentiQueryKey,
  type Scarico,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { Plus, Trash2, Download, CheckCircle, PackageMinus, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { generateScaricoPdf } from "@/lib/scarico-pdf";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";
import { useTranslation } from "react-i18next";

const CAUSALI = ["deteriorata", "rubata", "scaduta", "altro"] as const;

interface RigaDraft {
  key: string;
  prodottoId: string;
  quantita: string;
  unitaMisura: string;
}

function newRiga(): RigaDraft {
  return { key: Math.random().toString(36).slice(2), prodottoId: "", quantita: "", unitaMisura: "pz" };
}

// ─── Editor righe (dipende dal magazzino) ────────────────────────────────────

function RigheEditor({
  magazzinoId,
  righe,
  setRighe,
}: {
  magazzinoId: number;
  righe: RigaDraft[];
  setRighe: (r: RigaDraft[]) => void;
}) {
  const { t } = useTranslation();
  const { data: giacenze } = useListGiacenze(
    { magazzinoId },
    { query: { enabled: !!magazzinoId, queryKey: getListGiacenzeQueryKey({ magazzinoId }) } },
  );
  const { data: prodotti } = useListProdotti();
  const { toast } = useToast();

  const update = (key: string, patch: Partial<RigaDraft>) =>
    setRighe(righe.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRighe(righe.filter((r) => r.key !== key));

  const usedIds = righe.map((r) => r.prodottoId).filter(Boolean);

  const handleScanAdd = (code: string) => {
    const lc = code.trim().toLowerCase();
    if (!lc) return;
    const p = prodotti?.find(
      (x) => (x.codiceBarre && x.codiceBarre.toLowerCase() === lc) || x.codice.toLowerCase() === lc,
    );
    if (!p) {
      toast({ title: t("scarichi.scanNotFound"), variant: "destructive" });
      return;
    }
    const g = giacenze?.find((x) => x.prodottoId === p.id);
    if (!g || Math.max(0, g.disponibileReale) <= 0) {
      toast({ title: t("scarichi.scanNoStock", { name: p.nome }), variant: "destructive" });
      return;
    }
    if (righe.some((r) => r.prodottoId === String(p.id))) {
      toast({ title: t("scarichi.scanAlready", { name: p.nome }) });
      return;
    }
    setRighe([...righe, { ...newRiga(), prodottoId: String(p.id), unitaMisura: g.unitaMisura ?? "pz" }]);
    toast({ title: t("scarichi.scanAdded", { name: p.nome }) });
  };

  return (
    <div className="space-y-3">
      {(!giacenze || giacenze.length === 0) && (
        <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
          {t("scarichi.noProdotti")}
        </p>
      )}

      {!!giacenze && giacenze.length > 0 && (
        <BarcodeScannerButton
          withLabel
          variant="secondary"
          className="w-full"
          onScan={handleScanAdd}
        />
      )}

      {righe.map((r) => {
        const giac = giacenze?.find((g) => g.prodottoId === parseInt(r.prodottoId));
        const max = Math.max(0, giac?.disponibileReale ?? 0);
        const qNum = parseFloat(r.quantita || "0");
        const eccede = !!r.prodottoId && qNum > max;
        return (
          <div key={r.key} className="rounded-lg border p-3 space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <Label className="text-xs">{t("scarichi.prodotto")}</Label>
                <Select
                  value={r.prodottoId}
                  onValueChange={(v) => {
                    const g = giacenze?.find((x) => x.prodottoId === parseInt(v));
                    update(r.key, { prodottoId: v, unitaMisura: g?.unitaMisura ?? "pz", quantita: "" });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={t("scarichi.selezionaProdotto")} /></SelectTrigger>
                  <SelectContent>
                    {giacenze
                      ?.filter((g) => g.prodottoId === parseInt(r.prodottoId) || !usedIds.includes(String(g.prodottoId)))
                      .map((g) => (
                        <SelectItem key={g.prodottoId} value={String(g.prodottoId)}>
                          {g.prodottoNome} — {Math.max(0, g.disponibileReale)} {g.unitaMisura} {t("scarichi.disponibileSuffix")}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mt-6 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => remove(r.key)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">{t("common.quantity")}</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={max || undefined}
                  value={r.quantita}
                  onChange={(e) => update(r.key, { quantita: e.target.value })}
                  placeholder="0"
                  className={eccede ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {r.prodottoId && (
                  <p className={`text-xs ${eccede ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    {eccede
                      ? t("scarichi.massimoDisponibile", { max })
                      : t("scarichi.disponibile", { max, um: giac?.unitaMisura ?? "" })}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">{t("scarichi.unitaMisura")}</Label>
                <Select value={r.unitaMisura} onValueChange={(v) => update(r.key, { unitaMisura: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["pz", "kg", "g", "lt", "ml", "conf", "scatola", "busta"].map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        onClick={() => setRighe([...righe, newRiga()])}
        disabled={!giacenze || giacenze.length === 0}
      >
        <Plus className="h-4 w-4" /> {t("scarichi.aggiungiProdotto")}
      </Button>
    </div>
  );
}

// ─── Form nuovo scarico ──────────────────────────────────────────────────────

function NuovoScaricoForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (s: Scarico) => void;
}) {
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const [magazzinoId, setMagazzinoId] = useState("");
  const [centroAscoltoId, setCentroAscoltoId] = useState("");
  const [causale, setCausale] = useState("");
  const [causaleAltro, setCausaleAltro] = useState("");
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState<RigaDraft[]>([newRiga()]);
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroAscoltoId(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);

  const { t } = useTranslation();
  const { data: magazzini } = useListMagazzini();
  const { data: centri } = useListCentriAscolto();
  const createScarico = useCreateScarico();
  const { toast } = useToast();

  const magazzinoIdNum = magazzinoId ? parseInt(magazzinoId) : 0;
  const { data: giacenze } = useListGiacenze(
    { magazzinoId: magazzinoIdNum },
    { query: { enabled: !!magazzinoId, queryKey: getListGiacenzeQueryKey({ magazzinoId: magazzinoIdNum }) } },
  );

  const reset = () => {
    setMagazzinoId("");
    setCentroAscoltoId(isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : "");
    setCausale("");
    setCausaleAltro("");
    setNote("");
    setRighe([newRiga()]);
  };

  const righeValide = righe.filter((r) => r.prodottoId && parseFloat(r.quantita || "0") > 0);
  const hasEccesso = righeValide.some((r) => {
    const giac = giacenze?.find((g) => g.prodottoId === parseInt(r.prodottoId));
    return parseFloat(r.quantita) > Math.max(0, giac?.disponibileReale ?? 0);
  });
  const canSubmit =
    !!magazzinoId &&
    !!causale &&
    (causale !== "altro" || !!causaleAltro.trim()) &&
    righeValide.length > 0 &&
    !hasEccesso &&
    !createScarico.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    createScarico.mutate(
      {
        data: {
          magazzinoId: parseInt(magazzinoId),
          centroAscoltoId: centroAscoltoId ? parseInt(centroAscoltoId) : null,
          dataScarico: new Date().toISOString().split("T")[0],
          causale: causale as "deteriorata" | "rubata" | "scaduta" | "altro",
          causaleAltro: causale === "altro" ? causaleAltro.trim() : undefined,
          note: note || undefined,
          righe: righeValide.map((r) => ({
            prodottoId: parseInt(r.prodottoId),
            quantita: parseFloat(r.quantita),
            unitaMisura: r.unitaMisura,
          })),
        },
      },
      {
        onSuccess: (s) => {
          reset();
          onClose();
          onCreated(s);
        },
        onError: () =>
          toast({ title: t("scarichi.errorTitle"), description: t("scarichi.errorCreate"), variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("scarichi.formTitle")}</SheetTitle>
          <SheetDescription>
            {t("scarichi.formDescription")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-5">
          <div className="space-y-2">
            <Label>{t("scarichi.magazzino")}</Label>
            <Select value={magazzinoId} onValueChange={(v) => { setMagazzinoId(v); setRighe([newRiga()]); }}>
              <SelectTrigger><SelectValue placeholder={t("scarichi.selectMagazzino")} /></SelectTrigger>
              <SelectContent>
                {magazzini?.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("scarichi.centro")}</Label>
            <Select value={centroAscoltoId || "none"} onValueChange={(v) => setCentroAscoltoId(v === "none" ? "" : v)} disabled={isCentroLocked}>
              <SelectTrigger><SelectValue placeholder={t("scarichi.selectCentro")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("scarichi.nessunCentro")}</SelectItem>
                {centri?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("scarichi.causale")}</Label>
            <Select value={causale} onValueChange={setCausale}>
              <SelectTrigger><SelectValue placeholder={t("scarichi.selectCausale")} /></SelectTrigger>
              <SelectContent>
                {CAUSALI.map((c) => (
                  <SelectItem key={c} value={c}>{t(`scarichi.causali.${c}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {causale === "altro" && (
              <Input
                value={causaleAltro}
                onChange={(e) => setCausaleAltro(e.target.value)}
                placeholder={t("scarichi.causaleAltroPlaceholder")}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("scarichi.prodottiDaScaricare")}</Label>
            {magazzinoId ? (
              <RigheEditor magazzinoId={parseInt(magazzinoId)} righe={righe} setRighe={setRighe} />
            ) : (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
                {t("scarichi.selezionaPrimaMagazzino")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("scarichi.noteOpzionale")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("scarichi.notePlaceholder")} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pb-4">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
            <PackageMinus className="h-4 w-4" /> {t("scarichi.registra")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function Scarichi() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const { data: scarichi, isLoading } = useListScarichi();
  const { data: centri } = useListCentriAscolto();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: impostazioni } = useGetImpostazioniStampa();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [created, setCreated] = useState<Scarico | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [centroFilter, setCentroFilter] = useState("all");
  const [sortAsc, setSortAsc] = useState(false);
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroFilter(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);

  const displayed = (scarichi ?? [])
    .filter((s) =>
      centroFilter === "all"
        ? true
        : centroFilter === "none"
          ? s.centroAscoltoId == null
          : s.centroAscoltoId === parseInt(centroFilter),
    )
    .slice()
    .sort((a, b) => {
      const d = new Date(a.dataScarico).getTime() - new Date(b.dataScarico).getTime();
      return sortAsc ? d : -d;
    });

  const causaleDisplay = (s: Pick<Scarico, "causale" | "causaleAltro">): string => {
    if (s.causale === "altro") return s.causaleAltro?.trim() || t("scarichi.causali.altro");
    return t(`scarichi.causali.${s.causale}`, { defaultValue: s.causale });
  };

  const downloadBolla = async (s: Scarico) => {
    setDownloadingId(s.id);
    try {
      const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
      await generateScaricoPdf({
        scarico: s,
        footer: impostazioni?.footerBolla ?? null,
        associationLogoDataUrl: logoDataUrl,
        branding,
      });
    } catch {
      toast({ title: t("scarichi.errorTitle"), description: t("scarichi.errorBolla"), variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCreated = (s: Scarico) => {
    queryClient.invalidateQueries({ queryKey: getListScarichiQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListLottiQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMovimentiQueryKey() });
    setCreated(s);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("scarichi.title")}</h1>
          <p className="text-muted-foreground">{t("scarichi.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {isGlobal && (
            <Select value={centroFilter} onValueChange={setCentroFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("scarichi.filterTuttiCentri")}</SelectItem>
                <SelectItem value="none">{t("scarichi.senzaCentro")}</SelectItem>
                {centri?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ExportButtons
            rows={displayed}
            columns={[
              { header: t("common.code"), accessor: (s) => s.codice },
              { header: t("common.date"), accessor: (s) => s.dataScarico ? new Date(s.dataScarico).toLocaleDateString("it-IT") : "" },
              { header: t("scarichi.colMagazzino"), accessor: (s) => s.magazzinoNome },
              { header: t("scarichi.colCentro"), accessor: (s) => s.centroAscoltoNome ?? "" },
              { header: t("scarichi.colCausale"), accessor: (s) => causaleDisplay(s) },
              { header: t("scarichi.colArticoli"), accessor: (s) => s.righe?.length ?? 0 },
            ]}
            filename="scarichi"
            title={t("scarichi.exportTitle")}
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> {t("common.new")}</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.code")}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={() => setSortAsc((v) => !v)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {t("common.date")} <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </TableHead>
                <TableHead>{t("scarichi.colMagazzino")}</TableHead>
                {isGlobal && <TableHead>{t("scarichi.colCentro")}</TableHead>}
                <TableHead>{t("scarichi.colCausale")}</TableHead>
                <TableHead>{t("scarichi.colArticoli")}</TableHead>
                <TableHead className="text-right w-[140px]">{t("scarichi.colAzione")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    {isGlobal && <TableCell><Skeleton className="h-5 w-28" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobal ? 7 : 6} className="h-32 text-center text-muted-foreground">{t("scarichi.emptyState")}</TableCell>
                </TableRow>
              ) : displayed.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-sm font-medium">{s.codice}</TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(s.dataScarico), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{s.magazzinoNome}</TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm">
                      {s.centroAscoltoNome ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      {causaleDisplay(s)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t("scarichi.articoliCount", { count: s.righe?.length || 0 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => downloadBolla(s)}
                      disabled={downloadingId === s.id}
                    >
                      <Download className="h-3.5 w-3.5" /> {t("scarichi.bolla")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NuovoScaricoForm open={isFormOpen} onClose={() => setIsFormOpen(false)} onCreated={handleCreated} />

      {/* Conferma creazione + download bolla */}
      <Dialog open={!!created} onOpenChange={(o) => { if (!o) setCreated(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" /> {t("scarichi.bollaCreata")}
            </DialogTitle>
          </DialogHeader>
          {created && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                {t("scarichi.createdPrefix")} <span className="font-mono font-medium text-foreground">{created.codice}</span> {t("scarichi.createdSuffix")}
              </p>
              <div className="rounded-lg border p-3 text-sm flex items-center gap-2">
                <span className="font-medium">{created.magazzinoNome}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{causaleDisplay(created)}</span>
                <span className="ml-auto text-muted-foreground">{t("scarichi.articoliCount", { count: created.righe?.length || 0 })}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>{t("common.close")}</Button>
            <Button
              className="gap-2"
              disabled={!created || downloadingId === created.id}
              onClick={() => created && downloadBolla(created)}
            >
              <Download className="h-4 w-4" /> {t("scarichi.scaricaBolla")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
