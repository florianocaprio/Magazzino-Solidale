import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLottiProduttore,
  getListLottiProduttoreQueryKey,
  getGetLottoProduttoreQueryKey,
  usePreregisterLottoProduttore,
  useGetLottoProduttore,
  useListProdotti,
  useListAreeOperative,
  type LottoProduttoreInput,
} from "@workspace/api-client-react";
import { ProducerLotOriginBadge } from "./producer-lot-origin-badge";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { formatMagazzinoQuantity } from "@/lib/magazzino-quantity";
import { newCommandKey } from "@/lib/carico-merce";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";
import { Alert, AlertDescription } from "./ui/alert";
import { BarcodeScannerButton } from "./barcode-scanner-button";
export default function LottiProduttorePanel({ areaId }: { areaId: number }) {
  const { t, i18n } = useTranslation();
  const { hasPermission, user } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const { data: products = [] } = useListProdotti();
  const { data: areas = [] } = useListAreeOperative();
  const [origin, setOrigin] = useState("all"),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [error, setError] = useState("");
  const [form, setForm] = useState({
    areaOperativaId: areaId,
    prodottoId: 0,
    codiceLotto: "",
    dataScadenza: "",
    produttore: "",
    note: "",
  });
  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [areaId]);
  const retry = useRef<string | null>(null);
  const list = useListLottiProduttore(
    {
      areaOperativaId: areaId,
      origine:
        origin === "all"
          ? undefined
          : (origin as "MANUALE" | "AUTOMATICO" | "IMPORTATO"),
      q: q || undefined,
      page,
    },
    {
      query: {
        queryKey: getListLottiProduttoreQueryKey({
          areaOperativaId: areaId,
          origine:
            origin === "all"
              ? undefined
              : (origin as "MANUALE" | "AUTOMATICO" | "IMPORTATO"),
          q: q || undefined,
          page,
        }),
        enabled: areaId > 0,
      },
    },
  );
  const detail = useGetLottoProduttore(selected ?? 0, {
    query: {
      queryKey: getGetLottoProduttoreQueryKey(selected ?? 0),
      enabled: selected != null,
    },
  });
  const create = usePreregisterLottoProduttore();
  const product = products.find((p) => p.id === form.prodottoId);
  const setField = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    retry.current = null;
    setError("");
    setForm((f) => ({ ...f, [key]: value }));
  };
  const quantity = (value: string) =>
    formatMagazzinoQuantity(value, i18n.resolvedLanguage ?? i18n.language);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>{t("blocco07.registry")}</CardTitle>
        {hasPermission("magazzino.stock.receive") && (
          <Button
            onClick={() => {
              setError("");
              retry.current = null;
              setForm({
                areaOperativaId: user?.areaOperativaId ?? areaId,
                prodottoId: 0,
                codiceLotto: "",
                dataScadenza: "",
                produttore: "",
                note: "",
              });
              setOpen(true);
            }}
          >
            {t("blocco07.preregister")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            aria-label={t("blocco07.lookup")}
            placeholder={t("blocco07.lookup")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={origin}
            onValueChange={(v) => {
              setOrigin(v);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label={t("blocco07.origin")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["all", "MANUALE", "AUTOMATICO", "IMPORTATO"].map((v) => (
                <SelectItem key={v} value={v}>
                  {t(
                    `blocco07.${v === "all" ? "all" : v === "MANUALE" ? "manual" : v === "AUTOMATICO" ? "automatic" : "imported"}`,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!areaId && <p>{t("caricoPratiche.selectArea")}</p>}
        {list.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(list.error, t("common.readfailed"))}
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">{t("blocco07.scope")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {!list.isError &&
            list.data?.items.map((master) => (
              <div
                key={master.id}
                className="min-w-0 space-y-2 rounded-md border p-3"
                data-testid={`producer-master-${master.id}`}
              >
                <strong className="break-words">
                  {master.prodottoNome} ·{" "}
                  {master.codiceOriginale ?? master.riferimentoInterno}
                </strong>
                <div>
                  <ProducerLotOriginBadge origin={master.origine} />
                </div>
                {!master.codiceOriginale && (
                  <p className="text-xs text-muted-foreground">
                    {t("blocco07.internalReference")}
                  </p>
                )}
                <p className="text-sm">
                  {master.statoPartite === "MAI_CARICATO"
                    ? t("blocco07.neverLoaded")
                    : master.statoPartite === "NESSUNA_PARTITA_VISIBILE"
                      ? t("blocco07.noVisible")
                      : `${t("uxCaricoLotti.residual")}: ${quantity(master.residuo)} ${master.unitaMisura}`}
                </p>
                <Button
                  variant="outline"
                  onClick={() => setSelected(master.id)}
                >
                  {t("blocco07.detail")}
                </Button>
              </div>
            ))}
        </div>
        {areaId > 0 &&
          !list.isLoading &&
          !list.isError &&
          list.data?.items.length === 0 && <p>{t("blocco07.noMatches")}</p>}
        <div className="flex gap-2">
          <Button
            variant="outline"
            aria-label={`${t("common.back")} ${page - 1}`}
            disabled={page === 1 || list.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            ←
          </Button>
          <span className="self-center">{page}</span>
          <Button
            variant="outline"
            aria-label={`${t("blocco07.registry")} ${page + 1}`}
            disabled={!list.data?.hasMore || list.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </Button>
        </div>
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!create.isPending) setOpen(next);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("blocco07.preregister")}</DialogTitle>
            <DialogDescription>{t("blocco07.noStock")}</DialogDescription>
          </DialogHeader>
          <form
            className="min-w-0 space-y-3 [&>div]:min-w-0"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              retry.current ??= newCommandKey();
              try {
                const payload: LottoProduttoreInput = {
                  ...form,
                  codiceLotto: form.codiceLotto.trim() || null,
                  dataScadenza: form.dataScadenza || null,
                  produttore: form.produttore.trim() || null,
                  note: form.note.trim() || null,
                  idempotencyKey: retry.current,
                };
                await create.mutateAsync({ data: payload });
                retry.current = null;
                await client.invalidateQueries({
                  queryKey: ["/api/lotti-produttore"],
                });
                setOpen(false);
                toast({ title: t("blocco07.saved") });
              } catch (err) {
                setError(errorMessage(err, t("caricoPratiche.error")));
              }
            }}
          >
            <div>
              <Label htmlFor="master-area">{t("caricoPratiche.area")} *</Label>
              <Select
                value={String(form.areaOperativaId || "")}
                disabled={create.isPending || user?.areaOperativaId != null}
                onValueChange={(v) => setField("areaOperativaId", Number(v))}
              >
                <SelectTrigger
                  className="min-w-0 [&>span]:min-w-0 [&>span]:truncate"
                  id="master-area"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {areas
                    .filter((a) => a.attivo)
                    .map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="master-product">
                {t("uxCaricoLotti.product")} *
              </Label>
              <Select
                value={String(form.prodottoId || "")}
                disabled={create.isPending}
                onValueChange={(v) => setField("prodottoId", Number(v))}
              >
                <SelectTrigger
                  className="min-w-0 [&>span]:min-w-0 [&>span]:truncate"
                  id="master-product"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {products
                    .filter((p) => p.attivo)
                    .map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.nome} · {p.codice}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="master-code">
                {t("caricoPratiche.physicalLot")}
                {product?.lottoFisicoObbligatorio ? " *" : ""}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="master-code"
                  maxLength={80}
                  value={form.codiceLotto}
                  required={product?.lottoFisicoObbligatorio}
                  disabled={create.isPending}
                  onChange={(e) => setField("codiceLotto", e.target.value)}
                />
                <BarcodeScannerButton
                  disabled={create.isPending}
                  onScan={(code) => setField("codiceLotto", code)}
                />
              </div>
              {!form.codiceLotto && !product?.lottoFisicoObbligatorio && (
                <p className="text-xs text-muted-foreground">
                  {t("blocco07.internalReference")}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="master-expiry">
                {t("caricoPratiche.expiry")}
                {product?.gestioneScadenza ? " *" : ""}
              </Label>
              <Input
                id="master-expiry"
                type="date"
                value={form.dataScadenza}
                disabled={create.isPending}
                required={product?.gestioneScadenza}
                onChange={(e) => setField("dataScadenza", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="master-manufacturer">
                {t("blocco07.producer")}
              </Label>
              <Input
                id="master-manufacturer"
                maxLength={200}
                value={form.produttore}
                disabled={create.isPending}
                onChange={(e) => setField("produttore", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="master-notes">{t("caricoPratiche.notes")}</Label>
              <Textarea
                id="master-notes"
                maxLength={4000}
                value={form.note}
                disabled={create.isPending}
                onChange={(e) => setField("note", e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              disabled={
                create.isPending || !form.areaOperativaId || !form.prodottoId
              }
            >
              {t("blocco07.preregister")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={selected != null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("blocco07.detail")}</DialogTitle>
            <DialogDescription>{t("blocco07.scope")}</DialogDescription>
          </DialogHeader>
          {detail.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {errorMessage(detail.error, t("common.readfailed"))}
              </AlertDescription>
            </Alert>
          )}
          {!detail.isError && detail.data && (
            <div className="min-w-0 space-y-3 break-words">
              <strong>
                {detail.data.prodottoNome} ·{" "}
                {detail.data.codiceOriginale ?? detail.data.riferimentoInterno}
              </strong>
              <div>
                <ProducerLotOriginBadge origin={detail.data.origine} />
              </div>
              <p>
                {t("blocco07.producer")}: {detail.data.produttore ?? "—"}
              </p>
              <p>
                {t("caricoPratiche.expiry")}: {detail.data.dataScadenza ?? "—"}
              </p>
              <p>
                {t("blocco07.author")}: {detail.data.autore ?? "—"}
              </p>
              <p>
                {t("blocco07.created")}:{" "}
                {detail.data.primaCreazioneAt
                  ? new Date(detail.data.primaCreazioneAt).toLocaleString()
                  : "—"}
              </p>
              <p>
                {t("blocco07.associated")}:{" "}
                {new Date(detail.data.dataAssociazione).toLocaleString()}
              </p>
              {detail.data.fonte && <p>{detail.data.fonte}</p>}
              <p className="whitespace-pre-wrap break-words">
                {detail.data.note}
              </p>
              <p>
                {t("uxCaricoLotti.residual")}: {quantity(detail.data.residuo)} ·{" "}
                {t("uxCaricoLotti.reserved")}: {quantity(detail.data.prenotato)}{" "}
                · {t("uxCaricoLotti.availableQuantity")}:{" "}
                {quantity(detail.data.disponibile)} {detail.data.unitaMisura}
              </p>
              {detail.data.partite.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap gap-2 rounded border p-2"
                >
                  <a
                    className="text-primary underline"
                    href={`/carico-merce?tab=lotti&magazzinoId=${p.magazzinoId}&prodottoId=${detail.data!.prodottoId}&lottoId=${p.id}`}
                  >
                    #{p.id}
                  </a>
                  <span>
                    {p.magazzinoNome} · {p.fondoOrigine} ·{" "}
                    {quantity(p.quantitaResidua)} {detail.data!.unitaMisura}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
