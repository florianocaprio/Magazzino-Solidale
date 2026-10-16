import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useCreateRichiestaMagazzino,
  useGetRichiestaMagazzino,
  getGetRichiestaMagazzinoQueryKey,
  useCancelRichiestaMagazzino,
  useListRichiesteMagazzino,
  useListTrasferimentiMensa,
  useListMagazziniMensa,
  getListMagazziniMensaQueryKey,
  useConfermaTrasferimento,
  useSegnalaMancatoArrivoTrasferimento,
  useGetTrasferimento,
  getDocumentoTrasferimento,
  getListRichiesteMagazzinoQueryKey,
  getListTrasferimentiMensaQueryKey,
  getGetTrasferimentoQueryKey,
  type MensaTrasferimentoSummary,
  type RichiestaMagazzinoCreatePriorita,
  type RichiestaMagazzinoCommandResult,
  type RichiestaMagazzinoStato,
  type RichiestaMagazzino,
} from "@workspace/api-client-react";
import { MensaSelect, useMensaContext } from "./mensa-operational-context";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { useAuth } from "@/lib/auth";
import { useCommandIntentRegistry } from "@/lib/command-intent";
import { invalidateRequestWorkflowViews } from "@/lib/bolla-query-invalidation";
import { mensaErrorMessage } from "@/lib/mensa-ui";
import { generateTrasferimentoPdf } from "@/lib/trasferimento-pdf";
import { linkedDocumentSelection } from "@/lib/richiesta-documento-navigation";

const requestStatusClasses: Record<RichiestaMagazzinoStato, string> = {
  inviata:
    "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200",
  presa_in_carico:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  chiusa:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  annullata:
    "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
};

// Presentation only: Mensa transfers are outside administrative request closure.
// Never infer completion from dispatch, an old document or a local mutation.
function requestDisplayStatus(
  row: RichiestaMagazzino,
): RichiestaMagazzinoStato {
  return row.stato === "presa_in_carico" &&
    row.documentoCorrente?.corrente === true &&
    row.documentoCorrente.tipoDocumento === "trasferimento" &&
    row.documentoCorrente.statoDocumento === "completato"
    ? "chiusa"
    : row.stato;
}

export function MensaRifornimenti() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const context = useMensaContext()!;
  const search = useSearch();
  const params = new URLSearchParams(search);
  const requestId = Number(params.get("richiestaId"));
  const hasRequest = params.has("richiestaId");
  const validId = Number.isSafeInteger(requestId) && requestId > 0;
  const returnTo = params.get("returnTo");
  const safeReturn =
    returnTo && /^\/report\/[a-z-]+(?:\?|$)/.test(returnTo) ? returnTo : null;
  const focused = useGetRichiestaMagazzino(requestId, {
    query: {
      queryKey: [
        ...getGetRichiestaMagazzinoQueryKey(requestId),
        "mensa-actor",
        user?.id,
        context.areaId,
        user?.permessi,
      ],
      enabled: hasRequest && validId,
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: "always",
    },
  });
  // Never display retained query data after a denial or while revalidating the
  // canonical request. Resolve the exact aggregate, not the first list page.
  const selected =
    hasRequest &&
    !focused.isError &&
    !focused.isFetching &&
    focused.data?.id === requestId &&
    context.mense.some((m) => m.id === focused.data?.mensaId)
      ? focused.data
      : undefined;
  const [mensaId, setMensaId] = useState<number | null>(null);
  const effectiveMensa = hasRequest ? (selected?.mensaId ?? null) : mensaId;
  return (
    <div className="space-y-5 p-6">
      {safeReturn && (
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={safeReturn}
        >
          {t("mensa.backToReport")}
        </Link>
      )}
      {hasRequest ? (
        focused.isFetching ? (
          <p role="status">{t("common.loading")}</p>
        ) : !selected ? (
          <p role="alert">{t("mensa.requestUnavailable")}</p>
        ) : (
          <h2 className="font-semibold">
            {context.mense.find((m) => m.id === selected.mensaId)?.nome} ·{" "}
            {selected.codice}
          </h2>
        )
      ) : (
        <MensaSelect historical value={mensaId} onChange={setMensaId} />
      )}
      {effectiveMensa != null && (
        <Rifornimenti
          key={`${effectiveMensa}:${hasRequest ? requestId : "list"}`}
          mensaId={effectiveMensa}
          focusedRequest={selected}
        />
      )}
    </div>
  );
}

function Rifornimenti({
  mensaId,
  focusedRequest,
}: {
  mensaId: number;
  focusedRequest?: RichiestaMagazzino;
}) {
  const { t } = useTranslation();
  const { hasPermission, user } = useAuth();
  const context = useMensaContext()!;
  const active = context.mense.some((m) => m.id === mensaId && m.attiva);
  const canRequest =
    hasPermission("mensa.transfers.request") ||
    hasPermission("mensa.transfers.manage");
  const [supplierId, setSupplierId] = useState("");
  const supplierParams = { areaOperativaId: context.areaId, mensaId };
  const suppliers = useListMagazziniMensa(supplierParams, {
    query: {
      queryKey: [
        ...getListMagazziniMensaQueryKey(supplierParams),
        "actor",
        JSON.stringify([
          user?.id,
          user?.areaOperativaId,
          user?.centroAscoltoId,
          user?.permessi,
          user?.aree,
          user?.isAdmin,
        ]),
      ],
      enabled: active && canRequest,
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: "always",
    },
  });
  const supplier =
    !suppliers.isError && !suppliers.isLoading
      ? suppliers.data?.find((item) => String(item.id) === supplierId)
      : undefined;
  useEffect(() => {
    if (
      suppliers.isError ||
      (suppliers.data &&
        !suppliers.data.some((item) => String(item.id) === supplierId))
    )
      setSupplierId("");
  }, [suppliers.data, suppliers.isError, supplierId]);
  const [bisogno, setBisogno] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [priority, setPriority] =
    useState<RichiestaMagazzinoCreatePriorita>("normale");
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sentRequest, setSentRequest] =
    useState<RichiestaMagazzinoCommandResult | null>(null);
  const dismissSent = () => {
    setSentRequest(null);
    setSuccess("");
  };
  useEffect(() => {
    setSentRequest(null);
    setSuccess("");
  }, [context.areaInteraction]);
  const [page, setPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const dirty = Boolean(
    supplierId || bisogno || note || date || priority !== "normale" || pending,
  );
  const { setDirty } = context;
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  const client = useQueryClient();
  const intents = useCommandIntentRegistry();
  const requestParams = {
    mensaId,
    areaOperativaId: context.areaId,
    page: requestPage,
    limit: 20,
  };
  const transferParams = {
    mensaId,
    areaOperativaId: context.areaId,
    page,
    pageSize: 20,
  };
  const requests = useListRichiesteMagazzino(requestParams, {
    query: {
      queryKey: getListRichiesteMagazzinoQueryKey(requestParams),
      staleTime: 0,
      retry: false,
    },
  });
  const transfers = useListTrasferimentiMensa(transferParams, {
    query: {
      queryKey: getListTrasferimentiMensaQueryKey(transferParams),
      staleTime: 0,
      retry: false,
    },
  });
  const rows = Array.isArray(transfers.data)
    ? transfers.data
    : (transfers.data?.items ?? []);
  const total = Array.isArray(transfers.data)
    ? transfers.data.length
    : (transfers.data?.total ?? 0);
  const create = useCreateRichiestaMagazzino();
  const cancel = useCancelRichiestaMagazzino();
  const receive = useConfermaTrasferimento();
  const missing = useSegnalaMancatoArrivoTrasferimento();
  const detail = useGetTrasferimento(documentId ?? 0, {
    query: {
      queryKey: getGetTrasferimentoQueryKey(documentId ?? 0),
      enabled: documentId != null,
      retry: false,
    },
  });
  const refresh = async () => {
    await Promise.all([
      invalidateRequestWorkflowViews(client),
      ...[
        "/api/mensa/trasferimenti",
        "/api/mensa/mense",
        "/api/mensa/logistica/magazzini",
        "/api/mensa/logistica/giacenze",
        "/api/trasferimenti",
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    ]);
  };
  const command = async <T,>(
    slot: string,
    action: () => Promise<T>,
    onSuccess?: (result: T) => void,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const result = await action();
      intents.complete(slot);
      if (alive.current) {
        onSuccess?.(result);
        setSuccess(t("mensa.operationSaved"));
      }
      // Refetch/PDF errors never repeat a successfully committed command.
      await refresh();
    } catch (err) {
      intents.fail(slot, err);
      if (alive.current)
        setError(mensaErrorMessage(err, t("mensa.actionFailed")));
      await client.invalidateQueries({ queryKey: ["/api/mensa/mense"] });
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  };
  const submit = () => {
    setAttempted(true);
    if (!bisogno.trim() || !supplier) return;
    const slot = `mensa:${mensaId}:request`;
    const payload = {
      mensaId,
      magazzinoRichiestoId: supplier.id,
      areaOperativaId: context.areaId,
      tipoDestinatario: "magazzino" as const,
      sorgente: "operativa" as const,
      bisogno: bisogno.trim(),
      noteOperative: note.trim() || null,
      dataDesiderata: date || null,
      priorita: priority,
    };
    void command(
      slot,
      () =>
        create.mutateAsync({ data: intents.prepare(slot, payload, payload) }),
      (created) => {
        setSentRequest(created);
        setRequestPage(1);
        setBisogno("");
        setSupplierId("");
        setNote("");
        setDate("");
        setPriority("normale");
        setAttempted(false);
      },
    );
  };
  const confirm = (row: MensaTrasferimentoSummary) => {
    const slot = `transfer:${row.id}:receive`;
    void command(slot, () =>
      receive.mutateAsync({
        id: row.id,
        data: intents.prepare(slot, {}, { versione: row.versione }),
      }),
    );
  };
  const reportMissing = (row: MensaTrasferimentoSummary) => {
    const motivo = window.prompt(t("mensa.missingReason"))?.trim();
    if (!motivo) return;
    const slot = `transfer:${row.id}:missing`;
    void command(slot, () =>
      missing.mutateAsync({
        id: row.id,
        data: intents.prepare(
          slot,
          { motivo },
          { versione: row.versione, motivo },
        ),
      }),
    );
  };
  const canReceive =
    hasPermission("mensa.transfers.receive") ||
    hasPermission("mensa.transfers.manage");
  return (
    <>
      <Button variant="outline" onClick={() => void refresh()}>
        {t("mensa.refreshContext")}
      </Button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {success && !sentRequest && <p role="status">{success}</p>}
      {sentRequest && canRequest && active && (
        <Card
          className="border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950"
          onClick={dismissSent}
        >
          <CardContent className="space-y-3 p-6">
            <div role="status" aria-live="polite" className="space-y-2">
              <CheckCircle2
                aria-hidden="true"
                className="h-10 w-10 text-emerald-700 dark:text-emerald-300"
              />
              <h2 className="text-xl font-semibold">
                {t("mensa.requestSent")}
              </h2>
              <p>{sentRequest.codice}</p>
              <p>{t("mensa.requestSentHint")}</p>
            </div>
            <Button variant="outline" onClick={dismissSent}>
              {t("mensa.newRequest")}
            </Button>
          </CardContent>
        </Card>
      )}
      {canRequest && active && !sentRequest && !focusedRequest && (
        <Card>
          <CardHeader>
            <CardTitle>{t("mensa.newRequest")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Label htmlFor="mensa-supplier">
                {t("mensa.requestedWarehouse")} *
              </Label>
              <select
                id="mensa-supplier"
                value={supplier ? supplierId : ""}
                onChange={(e) => setSupplierId(e.target.value)}
                aria-invalid={attempted && !supplier}
                aria-describedby="mensa-supplier-hint"
                disabled={pending || suppliers.isLoading || suppliers.isError}
                className={`w-full rounded-md border bg-background p-2 ${attempted && !supplier ? "border-destructive" : ""}`}
              >
                <option value="">{t("mensa.chooseRequestedWarehouse")}</option>
                {!suppliers.isError &&
                  suppliers.data?.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.nome}
                    </option>
                  ))}
              </select>
              <p
                id="mensa-supplier-hint"
                className="text-sm text-muted-foreground"
              >
                {t("mensa.requestedWarehouseHint")}
              </p>
              {suppliers.isError ? (
                <p role="alert" className="text-destructive">
                  {mensaErrorMessage(
                    suppliers.error,
                    t("mensa.warehousesLoadError"),
                  )}
                </p>
              ) : suppliers.isLoading ? (
                <p role="status">{t("common.loading")}</p>
              ) : !suppliers.data?.length ? (
                <p role="status">{t("mensa.noSupplyWarehouses")}</p>
              ) : (
                attempted &&
                !supplier && (
                  <p role="alert" className="text-destructive">
                    {t("mensa.chooseRequestedWarehouse")}
                  </p>
                )
              )}
              <Label htmlFor="mensa-needs">{t("mensa.needs")} *</Label>
              <Textarea
                id="mensa-needs"
                maxLength={2000}
                value={bisogno}
                onChange={(e) => setBisogno(e.target.value)}
                aria-invalid={attempted && !bisogno.trim()}
                className={
                  attempted && !bisogno.trim() ? "border-destructive" : ""
                }
              />
              {attempted && !bisogno.trim() && (
                <p role="alert" className="text-destructive">
                  {t("mensa.needsRequired")}
                </p>
              )}
              <Label htmlFor="mensa-desired-date">
                {t("mensa.desiredDate")}
              </Label>
              <Input
                id="mensa-desired-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <Label htmlFor="mensa-priority">{t("mensa.priority")}</Label>
              <Select
                value={priority}
                onValueChange={(v) => {
                  if (["bassa", "normale", "alta", "urgente"].includes(v))
                    setPriority(v as RichiestaMagazzinoCreatePriorita);
                }}
              >
                <SelectTrigger id="mensa-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["bassa", "normale", "alta", "urgente"] as const).map(
                    (p) => (
                      <SelectItem key={p} value={p}>
                        {t(`richieste.priorita.${p}`, { defaultValue: p })}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <Label htmlFor="mensa-notes">{t("mensa.operationalNotes")}</Label>
              <Textarea
                id="mensa-notes"
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button disabled={pending} type="submit">
                {t("mensa.sendRequest")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("mensa.requests")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {requests.isError ? (
            <p role="alert">
              {mensaErrorMessage(requests.error, t("mensa.loadError"))}
            </p>
          ) : requests.isLoading ? (
            <p role="status">{t("common.loading")}</p>
          ) : !focusedRequest && !requests.data?.items.length ? (
            <p>{t("mensa.empty")}</p>
          ) : (
            (focusedRequest
              ? [focusedRequest]
              : (requests.data?.items ?? [])
            ).map((row) => (
              <article
                className="rounded border p-3 space-y-2"
                key={row.id}
                aria-label={row.codice}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{row.codice}</h3>
                  <Badge
                    variant="outline"
                    className={requestStatusClasses[requestDisplayStatus(row)]}
                  >
                    {t(`mensa.requestStatus.${requestDisplayStatus(row)}`)}
                  </Badge>
                </div>
                <p className="whitespace-pre-wrap">{row.bisogno}</p>
                {row.magazzinoRichiestoNomeSnapshot && (
                  <p>
                    {t("mensa.requestedWarehouse")}:{" "}
                    {row.magazzinoRichiestoNomeSnapshot}
                  </p>
                )}
                <p>
                  {row.dataDesiderata} · {row.priorita}
                </p>
                {row.noteOperative && <p>{row.noteOperative}</p>}
                {row.documentoCorrente && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const linked = linkedDocumentSelection(
                        row.documentoCorrente?.percorsoDocumento,
                      );
                      if (linked?.tipo === "trasferimento")
                        setDocumentId(linked.id);
                    }}
                  >
                    {t("mensa.supply")}: {row.documentoCorrente.codice} ·{" "}
                    {row.documentoCorrente.statoDocumento}
                  </Button>
                )}
                {canRequest &&
                  requestDisplayStatus(row) !== "chiusa" &&
                  ["inviata", "presa_in_carico"].includes(row.stato) && (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const motivo = window
                          .prompt(t("mensa.cancelRequestReason"))
                          ?.trim();
                        if (!motivo) return;
                        const slot = `request:${row.id}:cancel`;
                        void command(slot, () =>
                          cancel.mutateAsync({
                            id: row.id,
                            data: intents.prepare(
                              slot,
                              { motivo },
                              { versione: row.versione, motivo },
                            ),
                          }),
                        );
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                  )}
              </article>
            ))
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={requestPage === 1}
              onClick={() => setRequestPage((p) => p - 1)}
            >
              {t("common.previous")}
            </Button>
            <Button
              variant="outline"
              disabled={requestPage * 20 >= (requests.data?.total ?? 0)}
              onClick={() => setRequestPage((p) => p + 1)}
            >
              {t("common.next")}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("mensa.incomingTransfers")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {transfers.isError ? (
            <p role="alert">
              {mensaErrorMessage(transfers.error, t("mensa.loadError"))}
            </p>
          ) : transfers.isLoading ? (
            <p role="status">{t("common.loading")}</p>
          ) : !rows.length ? (
            <p>{t("mensa.empty")}</p>
          ) : (
            rows.map((row) => (
              <article key={row.id} className="rounded border p-3 space-y-2">
                <h3 className="font-semibold">
                  {row.codice} · {row.stato.replaceAll("_", " ")}
                </h3>
                <p>
                  {row.magazzinoOrigineNome} → {row.mensaNome} ·{" "}
                  {row.dataRichiesta}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDocumentId(row.id)}
                  >
                    {t("mensa.viewSupply")}
                  </Button>
                  {active && canReceive && row.stato === "in_transito" && (
                    <>
                      <Button disabled={pending} onClick={() => confirm(row)}>
                        {t("mensa.confirmReceipt")}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => reportMissing(row)}
                      >
                        {t("mensa.reportMissing")}
                      </Button>
                    </>
                  )}
                </div>
              </article>
            ))
          )}
          <p className="text-sm text-muted-foreground">
            {t("mensa.legacyTransferNotice")}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("common.previous")}
            </Button>
            <Button
              variant="outline"
              disabled={page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("common.next")}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Sheet
        open={documentId != null}
        onOpenChange={(open) => {
          if (!open) setDocumentId(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("mensa.supply")}</SheetTitle>
            <SheetDescription>{t("mensa.supplyDescription")}</SheetDescription>
          </SheetHeader>
          {detail.isError ? (
            <p role="alert">
              {mensaErrorMessage(detail.error, t("mensa.loadError"))}
            </p>
          ) : (
            detail.data && (
              <div className="space-y-3 py-4">
                <h3>{detail.data.codice}</h3>
                <p>{detail.data.stato}</p>
                {(detail.data.righe ?? []).map((r) => (
                  <p key={r.id}>
                    {r.prodottoNome}: {r.quantita} {r.unitaMisura}
                    {r.codiceLotto ? ` · ${r.codiceLotto}` : ""}
                  </p>
                ))}
                {detail.data.note && <p>{detail.data.note}</p>}
                <Button
                  onClick={async () => {
                    try {
                      await generateTrasferimentoPdf({
                        trasferimento: await getDocumentoTrasferimento(
                          detail.data.id,
                        ),
                      });
                    } catch (err) {
                      if (alive.current)
                        setError(mensaErrorMessage(err, t("mensa.loadError")));
                    }
                  }}
                >
                  PDF
                </Button>
              </div>
            )
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
