import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getListLottiLogiciQueryKey,
  useArchiveLottoLogico,
  useCloseLottoLogico,
  useCreateLottoLogico,
  useListAreeOperative,
  useListFornitori,
  useListLotti,
  useListLottiLogici,
  useListMagazzini,
  useListProdotti,
  useRettificaLotto,
  useReopenLottoLogico,
  useUpdateLottoLogico,
  type Lotto,
  type LottoLogico,
} from "@workspace/api-client-react";
import { errorMessage } from "@/lib/api-error";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { filterPhysicalLots, physicalLotState } from "@/lib/carico-lotti";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

type LotDraft = {
  codice: string;
  descrizione: string;
  dataInizio: string;
  dataFine: string;
  note: string;
};
const emptyDraft = (): LotDraft => ({
  codice: "",
  descrizione: "",
  dataInizio: "",
  dataFine: "",
  note: "",
});

export function ActivityDialog({
  open,
  onOpenChange,
  areaId,
  areaName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areaId: number | null;
  areaName: string;
  onCreated?: (lot: LottoLogico) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateLottoLogico();
  const [draft, setDraft] = useState<LotDraft>(emptyDraft);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    onOpenChange(false);
    setDraft(emptyDraft());
    setAttempted(false);
    setError(null);
  };
  const submit = async () => {
    setAttempted(true);
    if (areaId == null || !draft.codice.trim() || !draft.descrizione.trim())
      return;
    try {
      const lot = await create.mutateAsync({
        data: {
          areaOperativaId: areaId,
          codice: draft.codice.trim(),
          descrizione: draft.descrizione.trim(),
          dataInizio: draft.dataInizio || null,
          dataFine: draft.dataFine || null,
          note: draft.note.trim() || null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/lotti-logici"] });
      await onCreated?.(lot);
      close();
    } catch (cause) {
      const message = errorMessage(cause, t("caricoPratiche.error"));
      setError(message);
      toast({
        title: t("caricoPratiche.error"),
        description: message,
        variant: "destructive",
      });
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("caricoPratiche.newActivityTitle")}</DialogTitle>
          <DialogDescription>
            {t("caricoPratiche.activityArea", { area: areaName })}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3">
          <div>
            <Label htmlFor="new-activity-code">
              {t("caricoPratiche.activityCodePrompt")} *
            </Label>
            <Input
              id="new-activity-code"
              maxLength={80}
              value={draft.codice}
              aria-invalid={attempted && !draft.codice.trim()}
              onChange={(e) =>
                setDraft((value) => ({ ...value, codice: e.target.value }))
              }
            />
            {attempted && !draft.codice.trim() && (
              <p className="text-sm text-destructive">
                {t("caricoPratiche.activityCodeRequired")}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="new-activity-description">
              {t("caricoPratiche.activityDescriptionPrompt")} *
            </Label>
            <Input
              id="new-activity-description"
              maxLength={200}
              value={draft.descrizione}
              aria-invalid={attempted && !draft.descrizione.trim()}
              onChange={(e) =>
                setDraft((value) => ({ ...value, descrizione: e.target.value }))
              }
            />
            {attempted && !draft.descrizione.trim() && (
              <p className="text-sm text-destructive">
                {t("caricoPratiche.activityDescriptionRequired")}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-activity-start">
                {t("uxCaricoLotti.startDate")}
              </Label>
              <Input
                id="new-activity-start"
                type="date"
                value={draft.dataInizio}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    dataInizio: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="new-activity-end">
                {t("uxCaricoLotti.endDate")}
              </Label>
              <Input
                id="new-activity-end"
                type="date"
                value={draft.dataFine}
                onChange={(e) =>
                  setDraft((value) => ({ ...value, dataFine: e.target.value }))
                }
              />
            </div>
          </div>
          <div>
            <Label htmlFor="new-activity-notes">
              {t("caricoPratiche.notes")}
            </Label>
            <Textarea
              id="new-activity-notes"
              value={draft.note}
              onChange={(e) =>
                setDraft((value) => ({ ...value, note: e.target.value }))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("barcodeScanner.cancel")}
          </Button>
          <Button
            disabled={create.isPending || areaId == null}
            onClick={() => void submit()}
          >
            {t("caricoPratiche.createActivity")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CaricoMerceTabs({
  active,
}: {
  active: "carichi" | "raccolte" | "lotti";
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("uxCaricoLotti.tabs")}
      className="flex flex-wrap gap-2 border-b px-4 pt-4 md:px-6"
    >
      {(["carichi", "raccolte", "lotti"] as const).map((tab) => (
        <Button
          key={tab}
          asChild
          variant={active === tab ? "default" : "ghost"}
          className="rounded-b-none"
        >
          <Link
            href={`/carico-merce?tab=${tab}`}
            aria-current={active === tab ? "page" : undefined}
          >
            {t(`uxCaricoLotti.tab${tab[0].toUpperCase()}${tab.slice(1)}`)}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

function RettificaDialog({
  lotto,
  onClose,
}: {
  lotto: Lotto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const mutation = useRettificaLotto();
  const [delta, setDelta] = useState("");
  const [causale, setCausale] = useState<
    "inventario_fisico" | "errore_registrazione" | "deterioramento" | "altro"
  >("inventario_fisico");
  const [motivazione, setMotivazione] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valid =
    /^-?\d+(?:[.,]\d{1,6})?$/.test(delta.trim()) &&
    !/^-?0+(?:[.,]0+)?$/.test(delta.trim()) &&
    (causale !== "altro" || Boolean(motivazione.trim()));
  const submit = async () => {
    if (!valid) return;
    try {
      await mutation.mutateAsync({
        id: lotto.id,
        data: {
          delta: delta.replace(",", "."),
          causale,
          motivazione: motivazione || undefined,
          note: note || undefined,
        },
      });
      for (const key of ["/api/lotti", "/api/giacenze", "/api/movimenti"])
        await queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: t("uxCaricoLotti.adjusted") });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("uxCaricoLotti.adjustFailed")));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("uxCaricoLotti.adjust")}</DialogTitle>
          <DialogDescription>
            {t("uxCaricoLotti.adjustHelp", {
              code: lotto.codiceLotto ?? `#${lotto.id}`,
              residual: lotto.quantitaResiduaPrecisa,
            })}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3">
          <div>
            <Label htmlFor="physical-adjust-delta">
              {t("uxCaricoLotti.adjustDelta")}
            </Label>
            <Input
              id="physical-adjust-delta"
              inputMode="decimal"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("uxCaricoLotti.adjustCause")}</Label>
            <Select
              value={causale}
              onValueChange={(value) => setCausale(value as typeof causale)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "inventario_fisico",
                  "errore_registrazione",
                  "deterioramento",
                  "altro",
                ].map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`uxCaricoLotti.cause${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {causale === "altro" && (
            <div>
              <Label htmlFor="physical-adjust-reason">
                {t("uxCaricoLotti.adjustReason")}
              </Label>
              <Input
                id="physical-adjust-reason"
                value={motivazione}
                onChange={(e) => setMotivazione(e.target.value)}
              />
            </div>
          )}
          <div>
            <Label htmlFor="physical-adjust-notes">
              {t("caricoPratiche.notes")}
            </Label>
            <Input
              id="physical-adjust-notes"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("barcodeScanner.cancel")}
          </Button>
          <Button
            disabled={!valid || mutation.isPending}
            onClick={() => void submit()}
          >
            {t("uxCaricoLotti.adjustConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RaccolteTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("magazzino.stock.receive");
  const { data: areas = [] } = useListAreeOperative();
  const [area, setArea] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("aperto");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<LottoLogico | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LotDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const areaId = Number(area || areas.find((item) => item.attivo)?.id || 0);
  const query = useListLottiLogici(
    { areaOperativaId: areaId || undefined, includeStorico: true },
    {
      query: {
        enabled: areaId > 0,
        queryKey: getListLottiLogiciQueryKey({
          areaOperativaId: areaId || undefined,
          includeStorico: true,
        }),
      },
    },
  );
  const update = useUpdateLottoLogico();
  const close = useCloseLottoLogico();
  const reopen = useReopenLottoLogico();
  const archive = useArchiveLottoLogico();
  const visible = (query.data ?? []).filter((lot) => {
    if (
      !includeArchived &&
      status !== "archiviato" &&
      lot.stato === "archiviato"
    )
      return false;
    if (
      status !== "all" &&
      !(status === "aperto" && lot.isGenerale) &&
      lot.stato !== status
    )
      return false;
    const term = search.trim().toLocaleLowerCase();
    return (
      !term ||
      `${lot.codice} ${lot.descrizione}`.toLocaleLowerCase().includes(term)
    );
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/lotti-logici"] });
    await query.refetch();
  };
  const execute = async (action: "save" | "close" | "reopen" | "archive") => {
    if (!selected || selected.isGenerale || !canEdit) return;
    const reason =
      action === "reopen" ? window.prompt(t("caricoPratiche.reason")) : null;
    if (action === "reopen" && !reason?.trim()) return;
    try {
      if (action === "save")
        await update.mutateAsync({
          id: selected.id,
          data: {
            codice: draft.codice.trim(),
            descrizione: draft.descrizione.trim(),
            dataInizio: draft.dataInizio || null,
            dataFine: draft.dataFine || null,
            note: draft.note.trim() || null,
          },
        });
      if (action === "close")
        await close.mutateAsync({ id: selected.id, data: {} });
      if (action === "reopen")
        await reopen.mutateAsync({
          id: selected.id,
          data: { motivo: reason!.trim() },
        });
      if (action === "archive")
        await archive.mutateAsync({ id: selected.id, data: {} });
      setError(null);
      setEditing(false);
      setSelected(null);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, t("caricoPratiche.error")));
    }
  };
  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {t("uxCaricoLotti.tabRaccolte")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("uxCaricoLotti.logicalHelp")}
          </p>
        </div>
        {canEdit && (
          <Button disabled={!areaId} onClick={() => setCreating(true)}>
            {t("caricoPratiche.newActivity")}
          </Button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Select value={String(areaId || "")} onValueChange={setArea}>
          <SelectTrigger aria-label={t("caricoPratiche.area")}>
            <SelectValue placeholder={t("caricoPratiche.selectArea")} />
          </SelectTrigger>
          <SelectContent>
            {areas
              .filter((item) => item.attivo)
              .map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.nome}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Input
          aria-label={t("uxCaricoLotti.searchActivity")}
          placeholder={t("uxCaricoLotti.searchActivity")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label={t("caricoPratiche.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="aperto">{t("uxCaricoLotti.open")}</SelectItem>
            <SelectItem value="chiuso">{t("uxCaricoLotti.closed")}</SelectItem>
            <SelectItem value="archiviato">
              {t("uxCaricoLotti.archived")}
            </SelectItem>
            <SelectItem value="all">
              {t("caricoPratiche.allStatuses")}
            </SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeArchived}
            onCheckedChange={(value) => setIncludeArchived(value === true)}
          />
          {t("uxCaricoLotti.includeArchived")}
        </label>
      </div>
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(query.error, t("caricoPratiche.error"))}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3">
        {visible.map((lot) => (
          <Card key={lot.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
              <div>
                <div className="font-medium">
                  {lot.codice} · {lot.descrizione}{" "}
                  {lot.isGenerale && (
                    <Badge>{t("uxCaricoLotti.general")}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {areas.find((item) => item.id === lot.areaOperativaId)
                    ?.nome ?? "—"}{" "}
                  · {lot.dataInizio ?? "—"} → {lot.dataFine ?? "—"} ·{" "}
                  {lot.stato}
                </p>
                <p className="text-sm">
                  {t("uxCaricoLotti.residual")}: {lot.quantitaResiduaPrecisa} ·{" "}
                  {lot.maiCaricato
                    ? t("uxCaricoLotti.neverLoaded")
                    : lot.esaurito
                      ? t("uxCaricoLotti.exhausted")
                      : t("uxCaricoLotti.loaded")}{" "}
                  {lot.inTransito && `· ${t("uxCaricoLotti.inTransit")}`}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(lot);
                  setEditing(false);
                  setError(null);
                  setDraft({
                    codice: lot.codice,
                    descrizione: lot.descrizione,
                    dataInizio: lot.dataInizio ?? "",
                    dataFine: lot.dataFine ?? "",
                    note: lot.note ?? "",
                  });
                }}
              >
                {t("uxCaricoLotti.details")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {!query.isLoading && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("uxCaricoLotti.noActivities")}
        </p>
      )}
      <ActivityDialog
        open={creating}
        onOpenChange={setCreating}
        areaId={areaId || null}
        areaName={areas.find((item) => item.id === areaId)?.nome ?? ""}
        onCreated={refresh}
      />
      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setEditing(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected?.codice} · {selected?.descrizione}
            </DialogTitle>
            <DialogDescription>
              {selected?.stato} · {selected?.quantitaResiduaPrecisa}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {editing ? (
            <div className="grid gap-3">
              <Input
                aria-label={t("caricoPratiche.activityCodePrompt")}
                value={draft.codice}
                onChange={(e) =>
                  setDraft((value) => ({ ...value, codice: e.target.value }))
                }
              />
              <Input
                aria-label={t("caricoPratiche.activityDescriptionPrompt")}
                value={draft.descrizione}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    descrizione: e.target.value,
                  }))
                }
              />
              <Input
                aria-label={t("uxCaricoLotti.startDate")}
                type="date"
                value={draft.dataInizio}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    dataInizio: e.target.value,
                  }))
                }
              />
              <Input
                aria-label={t("uxCaricoLotti.endDate")}
                type="date"
                value={draft.dataFine}
                onChange={(e) =>
                  setDraft((value) => ({ ...value, dataFine: e.target.value }))
                }
              />
              <Textarea
                aria-label={t("caricoPratiche.notes")}
                value={draft.note}
                onChange={(e) =>
                  setDraft((value) => ({ ...value, note: e.target.value }))
                }
              />
            </div>
          ) : (
            <p className="text-sm">{selected?.note || "—"}</p>
          )}
          <DialogFooter>
            {selected && canEdit && !selected.isGenerale && (
              <>
                {editing ? (
                  <Button
                    disabled={!draft.codice.trim() || !draft.descrizione.trim()}
                    onClick={() => void execute("save")}
                  >
                    {t("uxCaricoLotti.save")}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    {t("uxCaricoLotti.edit")}
                  </Button>
                )}
                {selected.stato === "aperto" && (
                  <Button
                    variant="outline"
                    onClick={() => void execute("close")}
                  >
                    {t("uxCaricoLotti.close")}
                  </Button>
                )}
                {selected.stato === "chiuso" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => void execute("reopen")}
                    >
                      {t("uxCaricoLotti.reopen")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void execute("archive")}
                    >
                      {t("uxCaricoLotti.archive")}
                    </Button>
                  </>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function LottiFisiciTab() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canAdjust = hasPermission("magazzino.stock.adjust");
  const { data: areas = [] } = useListAreeOperative();
  const { data: warehouses = [] } = useListMagazzini();
  const { data: products = [] } = useListProdotti();
  const { data: suppliers = [] } = useListFornitori();
  const [area, setArea] = useState("");
  const legacySearch = new URLSearchParams(window.location.search);
  const [warehouse, setWarehouse] = useState(
    legacySearch.get("magazzinoId") ?? "all",
  );
  const [product, setProduct] = useState(
    legacySearch.get("prodottoId") ?? "all",
  );
  const [activity, setActivity] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [fund, setFund] = useState(legacySearch.get("fondoOrigine") ?? "all");
  const [status, setStatus] = useState(
    legacySearch.get("inScadenza") === "true" ? "expiring" : "all",
  );
  const [expiry, setExpiry] = useState("");
  const [search, setSearch] = useState("");
  const [includeExhausted, setIncludeExhausted] = useState(false);
  const [adjustLot, setAdjustLot] = useState<Lotto | null>(null);
  const areaId =
    area === "all"
      ? 0
      : Number(area || areas.find((item) => item.attivo)?.id || 0);
  useEffect(() => {
    if (!area && warehouse !== "all") {
      const match = warehouses.find((item) => item.id === Number(warehouse));
      if (match?.areaOperativaId) setArea(String(match.areaOperativaId));
    }
  }, [area, warehouse, warehouses]);
  const query = useListLotti({ includeEsauriti: includeExhausted });
  const logicalQuery = useListLottiLogici(
    { areaOperativaId: areaId || undefined, includeStorico: true },
    {
      query: {
        enabled: areaId > 0,
        queryKey: getListLottiLogiciQueryKey({
          areaOperativaId: areaId || undefined,
          includeStorico: true,
        }),
      },
    },
  );
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Rome",
  });
  const visible = useMemo(
    () =>
      filterPhysicalLots(query.data ?? [], {
        areaId,
        warehouse,
        product,
        activity,
        supplier,
        fund,
        status,
        expiry,
        search,
        today,
      }),
    [
      query.data,
      areaId,
      warehouse,
      product,
      activity,
      supplier,
      fund,
      status,
      expiry,
      search,
      today,
    ],
  );
  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("uxCaricoLotti.tabLotti")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("uxCaricoLotti.physicalHelp")}
          </p>
        </div>
        <Button asChild>
          <Link href="/carico-merce?tab=carichi">
            {t("uxCaricoLotti.registerNewLoad")}
          </Link>
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          value={area === "all" ? "all" : String(areaId || "")}
          onValueChange={(value) => {
            setArea(value);
            setWarehouse("all");
            setActivity("all");
          }}
        >
          <SelectTrigger aria-label={t("caricoPratiche.area")}>
            <SelectValue placeholder={t("caricoPratiche.selectArea")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("uxCaricoLotti.allAreas")}</SelectItem>
            {areas
              .filter((item) => item.attivo)
              .map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.nome}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={warehouse} onValueChange={setWarehouse}>
          <SelectTrigger aria-label={t("caricoPratiche.warehouse")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("caricoPratiche.allWarehouses")}
            </SelectItem>
            {warehouses
              .filter((item) => !areaId || item.areaOperativaId === areaId)
              .map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.nome}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={product} onValueChange={setProduct}>
          <SelectTrigger aria-label={t("uxCaricoLotti.product")}>
            <SelectValue placeholder={t("uxCaricoLotti.product")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("uxCaricoLotti.allProducts")}
            </SelectItem>
            {products.map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.codice} · {item.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={activity} onValueChange={setActivity}>
          <SelectTrigger aria-label={t("caricoPratiche.activity")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("uxCaricoLotti.allActivities")}
            </SelectItem>
            {(logicalQuery.data ?? []).map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.codice} · {item.descrizione}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={supplier} onValueChange={setSupplier}>
          <SelectTrigger aria-label={t("uxCaricoLotti.supplier")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("uxCaricoLotti.allSuppliers")}
            </SelectItem>
            {suppliers
              .filter(
                (item) =>
                  !areaId ||
                  item.areaOperativaId == null ||
                  item.areaOperativaId === areaId,
              )
              .map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.nome}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={fund} onValueChange={setFund}>
          <SelectTrigger aria-label={t("caricoPratiche.fund")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("uxCaricoLotti.allFunds")}</SelectItem>
            {[
              ...new Set((query.data ?? []).map((lot) => lot.fondoOrigine)),
            ].map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label={t("caricoPratiche.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("caricoPratiche.allStatuses")}
            </SelectItem>
            {[
              "available",
              "expiring",
              "expired",
              "exhausted",
              "unavailable",
            ].map((item) => (
              <SelectItem key={item} value={item}>
                {t(`uxCaricoLotti.${item}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={expiry}
          aria-label={t("caricoPratiche.expiry")}
          onChange={(e) => setExpiry(e.target.value)}
        />
        <Input
          className="sm:col-span-2"
          value={search}
          aria-label={t("uxCaricoLotti.searchPhysical")}
          placeholder={t("uxCaricoLotti.searchPhysical")}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeExhausted}
            onCheckedChange={(value) => setIncludeExhausted(value === true)}
          />
          {t("uxCaricoLotti.includeExhausted")}
        </label>
      </div>
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(query.error, t("caricoPratiche.error"))}
          </AlertDescription>
        </Alert>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1150px] text-left text-sm">
          <thead>
            <tr className="border-b">
              {[
                "product",
                "physicalCode",
                "expiry",
                "warehouse",
                "area",
                "activity",
                "provenance",
                "supplier",
                "document",
                "fund",
                "loadedQuantity",
                "residual",
                "reserved",
                "availableQuantity",
                "status",
                ...(canAdjust ? ["actions"] : []),
              ].map((key) => (
                <th key={key} className="p-2 font-medium">
                  {t(`uxCaricoLotti.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((lot) => (
              <tr key={lot.id} className="border-b align-top">
                <td className="p-2">
                  {lot.prodottoNome}
                  <div className="text-muted-foreground">
                    {lot.prodottoCodice}
                  </div>
                </td>
                <td className="p-2">{lot.codiceLotto ?? "—"}</td>
                <td className="p-2">{lot.dataScadenza ?? "—"}</td>
                <td className="p-2">{lot.magazzinoNome ?? "—"}</td>
                <td className="p-2">
                  {areas.find((item) => item.id === lot.areaOperativaId)
                    ?.nome ?? t("uxCaricoLotti.legacyArea")}
                </td>
                <td className="p-2">
                  {lot.lottoLogicoDescrizione ?? t("uxCaricoLotti.legacy")}
                </td>
                <td className="p-2">
                  {lot.provenienze?.length
                    ? lot.provenienze
                        .map((origin) =>
                          t(`caricoPratiche.origin${origin}`, {
                            defaultValue: origin,
                          }),
                        )
                        .join(" + ")
                    : t("uxCaricoLotti.unknownProvenance")}
                  {Boolean(lot.lineageCarichi?.length) && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-primary">
                        {t("uxCaricoLotti.loadHistory", {
                          count: lot.lineageCarichi?.length,
                        })}
                      </summary>
                      <ul className="mt-1 space-y-1">
                        {lot.lineageCarichi?.map((event, index) => (
                          <li key={`${event.caricoId}-${index}`}>
                            #{event.caricoId} · {event.dataCarico} ·{" "}
                            {t(`caricoPratiche.origin${event.origineCarico}`, {
                              defaultValue: event.origineCarico,
                            })}{" "}
                            · {event.quantitaOperativa}{" "}
                            {event.unitaMisuraOperativa}
                            {event.fornitoreNome
                              ? ` · ${event.fornitoreNome}`
                              : ""}
                            {event.numeroDocumento
                              ? ` · ${event.numeroDocumento}`
                              : ""}
                            {event.statoCarico === "stornato"
                              ? ` · ${t("uxCaricoLotti.reversed")}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="p-2">{lot.fornitoreNome ?? "—"}</td>
                <td className="p-2">
                  {lot.documentiCarico?.length
                    ? lot.documentiCarico
                        .map(
                          (doc) =>
                            `${doc.numero}${doc.data ? ` (${doc.data})` : ""}`,
                        )
                        .join(" · ")
                    : (lot.documentoCarico ?? "—")}
                </td>
                <td className="p-2">{lot.fondoOrigine}</td>
                <td className="p-2">{lot.quantitaCaricataPrecisa}</td>
                <td className="p-2">{lot.quantitaResiduaPrecisa}</td>
                <td className="p-2">{lot.quantitaPrenotataPrecisa ?? "—"}</td>
                <td className="p-2">{lot.disponibileRealePrecisa}</td>
                <td className="p-2">
                  <Badge variant="outline">
                    {t(`uxCaricoLotti.${physicalLotState(lot, today)}`)}
                  </Badge>
                </td>
                {canAdjust && (
                  <td className="p-2">
                    {warehouses.find((item) => item.id === lot.magazzinoId)
                      ?.stato === "attivo" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAdjustLot(lot)}
                      >
                        {t("uxCaricoLotti.adjust")}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!query.isLoading && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("uxCaricoLotti.noPhysicalLots")}
        </p>
      )}
      {adjustLot && (
        <RettificaDialog lotto={adjustLot} onClose={() => setAdjustLot(null)} />
      )}
    </div>
  );
}
