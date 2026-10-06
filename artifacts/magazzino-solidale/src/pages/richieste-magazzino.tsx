import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createRichiestaMagazzino,
  updateRichiestaMagazzino,
  takeRichiestaMagazzino,
  cancelRichiestaMagazzino,
  createRichiestaMagazzinoDocumento,
  getListRichiesteMagazzinoQueryKey,
  useGetRichiestaMagazzino,
  getGetRichiestaMagazzinoQueryKey,
  getGetRichiestaMagazzinoStoricoQueryKey,
  getListBeneficiariQueryKey,
  useGetIntervento,
  getGetInterventoQueryKey,
  useGetRichiestaMagazzinoStorico,
  useListBeneficiari,
  useListMagazzini,
  getListMagazziniQueryKey,
  useListProdotti,
  getListProdottiQueryKey,
  useListRichiesteMagazzino,
  type RichiestaMagazzino,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { invalidateRequestWorkflowViews } from "@/lib/bolla-query-invalidation";
import { DocumentoOperativoDettaglioComune } from "@/components/documento-operativo";
import {
  parseDocumentoSelection,
  documentoSelectionValue,
  type DocumentoOperativoSelection,
} from "@/lib/documenti-operativi-url";
import {
  linkedDocumentSelection,
  requestAllowsDocument,
} from "@/lib/richiesta-documento-navigation";
import {
  useUnsavedChangesGuard,
  UnsavedChangesDialog,
} from "@/hooks/use-unsaved-changes-guard";
import {
  interventionRequestPrefill,
  interventionReturnUrl,
} from "@/lib/m5c1-request-prefill";
import { useConfigurazioneAmbienteFlags } from "@/lib/use-moduli";
import { useCommandIntentRegistry } from "@/lib/command-intent";
import { RigheEditor, newRiga, type RigaDraft } from "@/pages/trasferimenti";
import {
  transferRowsForPayload,
  transferRowsHaveRequiredLots,
} from "@/lib/trasferimento-draft";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const queryId = (name: string): number | null => {
  const value = new URLSearchParams(window.location.search).get(name);
  return value &&
    /^[1-9][0-9]*$/.test(value) &&
    Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;
};

function message(error: unknown, fallback: string) {
  const value = error as {
    data?: { error?: unknown };
    response?: { data?: { error?: unknown } };
    message?: unknown;
  } | null;
  return (
    [value?.data?.error, value?.response?.data?.error, value?.message].find(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    ) ?? fallback
  );
}

export default function RichiesteMagazzino() {
  const { t } = useTranslation();
  const { hasArea, hasPermission } = useAuth();
  const { isModuloAttivo } = useConfigurazioneAmbienteFlags();
  const queryClient = useQueryClient();
  const intents = useCommandIntentRegistry();
  const [, navigate] = useLocation();
  const search = useSearch();
  const canSocial =
    hasArea("sociale") &&
    isModuloAttivo("CENTRO_ASCOLTO") &&
    hasPermission("richieste_magazzino.create");
  const canEdit =
    hasArea("sociale") &&
    isModuloAttivo("CENTRO_ASCOLTO") &&
    hasPermission("richieste_magazzino.update");
  const canTake =
    hasArea("magazzino") && hasPermission("richieste_magazzino.take");
  const canCancel = hasPermission("richieste_magazzino.cancel");
  const canPrepare =
    hasArea("magazzino") && hasPermission("richieste_magazzino.prepare");
  const contextBeneficiaryId = queryId("beneficiarioId");
  const contextInterventionId = queryId("interventoId");
  const contextRequestId = queryId("richiestaId");
  const contextLoaded = useRef<number | null>(null);
  const listSearch = new URLSearchParams(search);
  const status = (
    ["chiusa", "annullata"].includes(listSearch.get("vista") ?? "")
      ? listSearch.get("vista")
      : "aperte"
  ) as "aperte" | "chiusa" | "annullata";
  const rawPage = Number(listSearch.get("page"));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const setPage = (value: number) => {
    const params = new URLSearchParams(window.location.search);
    if (value === 1) params.delete("page");
    else params.set("page", String(value));
    navigate(`${window.location.pathname}?${params.toString()}`);
  };
  const setStatus = (value: typeof status) =>
    navigationGuard.requestClose(() => {
      const params = new URLSearchParams(window.location.search);
      params.set("vista", value);
      params.delete("page");
      params.delete("richiestaId");
      params.delete("documento");
      navigate(`${window.location.pathname}?${params.toString()}`);
    });
  const [selectedId, setSelectedId] = useState<number | null>(contextRequestId);
  const [creating, setCreating] = useState(
    Boolean(contextBeneficiaryId || contextInterventionId),
  );
  const [beneficiaryId, setBeneficiaryId] = useState<number | null>(
    contextBeneficiaryId,
  );
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
  const [bisogno, setBisogno] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<
    "bassa" | "normale" | "alta" | "urgente"
  >("normale");
  const [desiredDate, setDesiredDate] = useState("");
  const [modality, setModality] = useState<
    "da_definire" | "ritiro" | "domicilio"
  >("da_definire");
  const [edit, setEdit] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [transferRows, setTransferRows] = useState<RigaDraft[]>([newRiga()]);
  const [documentDirty, setDocumentDirty] = useState(false);
  const documentSelection = parseDocumentoSelection(
    new URLSearchParams(search).get("documento"),
  );
  const dirty = documentDirty || edit || !!warehouseId || cancelOpen;
  const navigationGuard = useUnsavedChangesGuard(dirty);
  const safeLocation = useRef(
    window.location.pathname + window.location.search,
  );
  useEffect(() => {
    safeLocation.current = window.location.pathname + window.location.search;
  }, [search]);
  useEffect(() => {
    const onBack = () => {
      if (dirty && !window.confirm(t("common.unsavedChangesDesc"))) {
        navigate(safeLocation.current, { replace: true });
      }
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [dirty, navigate, t]);
  const openDocument = (selection: DocumentoOperativoSelection | null) =>
    navigationGuard.requestClose(() => {
      const params = new URLSearchParams(window.location.search);
      if (selection)
        params.set("documento", documentoSelectionValue(selection));
      else params.delete("documento");
      setDocumentDirty(false);
      navigate(`${window.location.pathname}?${params.toString()}`);
    });
  useEffect(() => {
    setSelectedId(queryId("richiestaId"));
    setEdit(false);
    setError("");
    setConfirmation("");
    setCancelOpen(false);
    setCancelReason("");
    setCancelNote("");
    setWarehouseId("");
    setTransferRows([newRiga()]);
  }, [contextRequestId]);
  const selectRequest = (id: number | null) => {
    const params = new URLSearchParams(window.location.search);
    params.delete("documento");
    if (id == null) params.delete("richiestaId");
    else params.set("richiestaId", String(id));
    setSelectedId(id);
    navigate(
      `${window.location.pathname}${params.size ? "?" + params.toString() : ""}`,
      { replace: id == null },
    );
  };
  const contextIntervention = useGetIntervento(contextInterventionId ?? 0, {
    query: {
      queryKey: getGetInterventoQueryKey(contextInterventionId ?? 0),
      enabled: contextInterventionId != null && canSocial,
    },
  });
  useEffect(() => {
    const intervention = contextIntervention.data;
    if (!intervention || contextLoaded.current === intervention.id) return;
    contextLoaded.current = intervention.id;
    const defaults = interventionRequestPrefill(intervention);
    setBeneficiaryId(defaults.beneficiarioId);
    setPriority(defaults.priorita);
    setDesiredDate(defaults.dataDesiderata);
    setModality(defaults.modalitaPreferita);
  }, [contextIntervention.data]);
  const listParams = useMemo(
    () => ({
      page,
      limit: 30,
      stato: status,
      ...(contextBeneficiaryId ? { beneficiarioId: contextBeneficiaryId } : {}),
    }),
    [page, status, contextBeneficiaryId],
  );
  const list = useListRichiesteMagazzino(listParams, {
    query: {
      queryKey: getListRichiesteMagazzinoQueryKey(listParams),
      staleTime: 0,
      refetchOnWindowFocus: "always",
    },
  });
  const interventionParams = {
    stato: "aperte" as const,
    interventoId: contextInterventionId ?? undefined,
    limit: 1,
  };
  const activeForIntervention = useListRichiesteMagazzino(interventionParams, {
    query: {
      queryKey: getListRichiesteMagazzinoQueryKey(interventionParams),
      enabled: contextInterventionId != null,
    },
  });
  const detail = useGetRichiestaMagazzino(selectedId ?? 0, {
    query: {
      queryKey: getGetRichiestaMagazzinoQueryKey(selectedId ?? 0),
      enabled: selectedId != null,
      staleTime: 0,
      refetchOnWindowFocus: "always",
    },
  });
  const history = useGetRichiestaMagazzinoStorico(selectedId ?? 0, {
    query: {
      queryKey: getGetRichiestaMagazzinoStoricoQueryKey(selectedId ?? 0),
      enabled: selectedId != null,
      staleTime: 0,
      refetchOnWindowFocus: "always",
    },
  });
  useEffect(() => {
    const failure = detail.error as {
      status?: number;
      response?: { status?: number };
    } | null;
    const code = failure?.status ?? failure?.response?.status;
    if (
      selectedId != null &&
      detail.isError &&
      (code === 403 || code === 404)
    ) {
      const deniedId = selectedId;
      selectRequest(null);
      queryClient.removeQueries({
        queryKey: getGetRichiestaMagazzinoQueryKey(deniedId),
      });
      queryClient.removeQueries({
        queryKey: getGetRichiestaMagazzinoStoricoQueryKey(deniedId),
      });
      setError(t("richiesteMagazzino.loadError"));
    }
  }, [detail.isError, detail.error, selectedId, queryClient, t]);
  const beneficiaryParams = {
    search: beneficiarySearch || undefined,
    limit: 30,
  };
  const beneficiaries = useListBeneficiari(beneficiaryParams, {
    query: {
      queryKey: getListBeneficiariQueryKey(beneficiaryParams),
      enabled: creating && canSocial && beneficiaryId == null,
    },
  });
  const personParams = {
    stato: "aperte" as const,
    beneficiarioId: beneficiaryId ?? undefined,
    limit: 10,
  };
  const existingForPerson = useListRichiesteMagazzino(personParams, {
    query: {
      queryKey: getListRichiesteMagazzinoQueryKey(personParams),
      enabled: creating && beneficiaryId != null,
    },
  });
  const row = detail.isError ? undefined : detail.data;
  const allowedDocument =
    documentSelection &&
    row &&
    requestAllowsDocument(documentSelection, [
      ...(row.documentoCorrente ? [row.documentoCorrente] : []),
      ...(row.documentiPrecedenti ?? []),
    ]);
  const activeRequest =
    row?.stato === "inviata" || row?.stato === "presa_in_carico";
  const preExit =
    !row?.documentoCorrente ||
    (row.documentoCorrente.tipoDocumento === "bolla"
      ? ["bozza", "confermato"]
      : ["richiesto", "preparato"]
    ).includes(row.documentoCorrente.statoDocumento ?? "");
  const mayCancel =
    canCancel &&
    activeRequest &&
    preExit &&
    ((hasArea("sociale") &&
      row?.tipoDestinatario === "beneficiario" &&
      isModuloAttivo("CENTRO_ASCOLTO")) ||
      (row?.stato === "presa_in_carico" && hasArea("magazzino")));
  const mayPrepare =
    row?.stato === "presa_in_carico" &&
    !row.documentoCorrente &&
    canPrepare &&
    hasPermission(
      row.tipoDestinatario === "magazzino"
        ? "magazzino.transfers.create"
        : "bolle.manage",
    ) &&
    isModuloAttivo(
      row.tipoDestinatario === "magazzino" ? "TRASFERIMENTI" : "BOLLE",
    );
  const warehouses = useListMagazzini({
    query: { enabled: canPrepare, queryKey: getListMagazziniQueryKey() },
  });
  const products = useListProdotti(undefined, {
    query: { enabled: canPrepare, queryKey: getListProdottiQueryKey() },
  });
  const chosenWarehouse = warehouses.data?.find(
    (item) => item.id === Number(warehouseId),
  );
  const transferInput = transferRows.filter(
    (item) => item.prodottoId && item.quantita,
  );
  const transferReady =
    row?.tipoDestinatario !== "magazzino" ||
    (transferInput.length > 0 &&
      transferInput.length === transferRows.length &&
      transferRowsHaveRequiredLots(transferInput, products.data));

  const refresh = async (id?: number) => {
    await invalidateRequestWorkflowViews(queryClient);
    await queryClient.invalidateQueries({
      queryKey: getListRichiesteMagazzinoQueryKey(),
    });
    if (id != null) {
      await queryClient.invalidateQueries({
        queryKey: getGetRichiestaMagazzinoQueryKey(id),
      });
      await queryClient.invalidateQueries({
        queryKey: getGetRichiestaMagazzinoStoricoQueryKey(id),
      });
    }
  };

  const execute = async <T,>(
    slot: string,
    semantic: Record<string, unknown>,
    payload: Record<string, unknown>,
    call: (body: any) => Promise<T>,
  ): Promise<T | null> => {
    setError("");
    setPending(true);
    const intent = intents.prepare(slot, semantic, payload);
    try {
      const result = await call(intent);
      intents.complete(slot);
      await refresh(selectedId ?? undefined);
      return result;
    } catch (cause) {
      intents.fail(slot, cause);
      setError(message(cause, t("richiesteMagazzino.commandError")));
      const status = (cause as { status?: number })?.status;
      if (status === 403 || status === 404) {
        if (selectedId != null) {
          queryClient.removeQueries({
            queryKey: getGetRichiestaMagazzinoQueryKey(selectedId),
          });
          queryClient.removeQueries({
            queryKey: getGetRichiestaMagazzinoStoricoQueryKey(selectedId),
          });
        }
        selectRequest(null);
        setEdit(false);
        setWarehouseId("");
        setTransferRows([newRiga()]);
        await refresh();
      } else if (status === 409) await refresh(selectedId ?? undefined);
      return null;
    } finally {
      setPending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!beneficiaryId || !bisogno.trim()) {
      setError(t("richiesteMagazzino.required"));
      return;
    }
    if (contextInterventionId && !contextIntervention.data) {
      setError(t("richiesteMagazzino.interventionLoadError"));
      return;
    }
    if (
      contextInterventionId &&
      (activeForIntervention.isLoading ||
        activeForIntervention.isError ||
        activeForIntervention.data?.items.length)
    ) {
      setError(t("richiesteMagazzino.alreadyOpen"));
      return;
    }
    const payload = {
      tipoDestinatario: "beneficiario" as const,
      beneficiarioId: beneficiaryId,
      sorgente: contextInterventionId
        ? ("intervento_sociale" as const)
        : ("beneficiario" as const),
      interventoId: contextInterventionId ?? undefined,
      bisogno: bisogno.trim(),
      noteOperative: note.trim() || null,
      priorita: priority,
      dataDesiderata: desiredDate || null,
      modalitaPreferita: modality,
    };
    const ok = await execute("richiesta:create", payload, payload, (body) =>
      createRichiestaMagazzino(body),
    );
    if (ok) {
      setCreating(false);
      setConfirmation(t("richiesteMagazzino.sent"));
      setBisogno("");
      setNote("");
      if (contextInterventionId && contextIntervention.data) {
        await queryClient.invalidateQueries({
          queryKey: getGetInterventoQueryKey(contextInterventionId),
        });
        navigate(interventionReturnUrl(contextIntervention.data));
      }
    }
  };

  const beginEdit = (value: RichiestaMagazzino) => {
    setBisogno(value.bisogno);
    setNote(value.noteOperative ?? "");
    setPriority(value.priorita);
    setDesiredDate(
      value.dataDesiderata ? String(value.dataDesiderata).slice(0, 10) : "",
    );
    setModality(value.modalitaPreferita);
    setEdit(true);
    setError("");
  };
  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!row || !bisogno.trim()) {
      setError(t("richiesteMagazzino.required"));
      return;
    }
    const payload = {
      versione: row.versione,
      bisogno: bisogno.trim(),
      noteOperative: note.trim() || null,
      priorita: priority,
      dataDesiderata: desiredDate || null,
      modalitaPreferita: modality,
    };
    const ok = await execute(
      `richiesta:${row.id}:update`,
      payload,
      payload,
      (body) => updateRichiestaMagazzino(row.id, body),
    );
    if (ok) setEdit(false);
  };
  const take = async () => {
    if (!row) return;
    await execute(
      `richiesta:${row.id}:take`,
      { versione: row.versione },
      { versione: row.versione },
      (body) => takeRichiestaMagazzino(row.id, body),
    );
  };
  const cancel = async () => {
    if (!row || !cancelReason.trim()) {
      setError(t("richiesteMagazzino.reasonRequired"));
      return;
    }
    const payload = {
      versione: row.versione,
      motivo: cancelReason.trim(),
      nota: cancelNote.trim() || null,
    };
    const ok = await execute(
      `richiesta:${row.id}:cancel`,
      payload,
      payload,
      (body) => cancelRichiestaMagazzino(row.id, body),
    );
    if (ok) {
      setCancelReason("");
      setCancelNote("");
      setCancelOpen(false);
      setConfirmation(t("richiesteMagazzino.cancelledConfirmation"));
    }
  };

  const prepareDocument = async () => {
    if (!row || !chosenWarehouse || !transferReady) return;
    const payload = {
      versione: row.versione,
      magazzinoId: chosenWarehouse.id,
      ...(row.tipoDestinatario === "magazzino"
        ? { righe: transferRowsForPayload(transferInput) }
        : {}),
    };
    const ok = await execute(
      `richiesta:${row.id}:documento`,
      payload,
      payload,
      (body) => createRichiestaMagazzinoDocumento(row.id, body),
    );
    if (ok) {
      setWarehouseId("");
      setTransferRows([newRiga()]);
      setConfirmation(t("richiesteMagazzino.documentCreated"));
      setDocumentDirty(false);
      const params = new URLSearchParams(window.location.search);
      params.set(
        "documento",
        documentoSelectionValue({ tipo: ok.tipoDocumento, id: ok.documentoId }),
      );
      navigate(`${window.location.pathname}?${params.toString()}`);
    }
  };

  return (
    <div
      className="space-y-6 p-4 md:p-6"
      data-testid="richieste-magazzino-page"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("richiesteMagazzino.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("richiesteMagazzino.subtitle")}
          </p>
        </div>
        {canSocial && (
          <Button
            onClick={() => {
              setCreating(true);
              setEdit(false);
              setError("");
            }}
          >
            {t("richiesteMagazzino.new")}
          </Button>
        )}
      </header>
      {confirmation && (
        <p role="status" className="rounded border border-green-300 p-3">
          {confirmation}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded border border-destructive p-3 text-destructive"
        >
          {error}
        </p>
      )}
      {creating && canSocial && (
        <Card>
          <CardHeader>
            <CardTitle>{t("richiesteMagazzino.new")}</CardTitle>
          </CardHeader>
          <CardContent>
            {contextInterventionId &&
            (activeForIntervention.isLoading ||
              contextIntervention.isLoading) ? (
              <p>{t("common.loading")}</p>
            ) : contextInterventionId &&
              (activeForIntervention.isError || contextIntervention.isError) ? (
              <p role="alert">{t("richiesteMagazzino.loadError")}</p>
            ) : activeForIntervention.data?.items[0] ? (
              <p>
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    selectRequest(activeForIntervention.data!.items[0].id);
                    setCreating(false);
                  }}
                >
                  {t("richiesteMagazzino.openExisting")}
                </button>
              </p>
            ) : (
              <form className="grid gap-4" onSubmit={submit}>
                {beneficiaryId == null ? (
                  <div className="grid gap-2">
                    <Label htmlFor="rm-search">
                      {t("richiesteMagazzino.beneficiary")}
                    </Label>
                    <Input
                      id="rm-search"
                      value={beneficiarySearch}
                      onChange={(event) =>
                        setBeneficiarySearch(event.target.value)
                      }
                      placeholder={t("richiesteMagazzino.searchBeneficiary")}
                    />
                    <select
                      aria-label={t("richiesteMagazzino.beneficiary")}
                      className="rounded border p-2"
                      value=""
                      onChange={(event) =>
                        setBeneficiaryId(Number(event.target.value))
                      }
                    >
                      <option value="">
                        {t("richiesteMagazzino.chooseBeneficiary")}
                      </option>
                      {beneficiaries.data?.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.codice} — {person.cognome} {person.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p>
                    {t("richiesteMagazzino.beneficiary")} #{beneficiaryId}{" "}
                    {!contextInterventionId && (
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => setBeneficiaryId(null)}
                      >
                        {t("common.edit")}
                      </Button>
                    )}
                  </p>
                )}
                {existingForPerson.data?.items.length ? (
                  <div className="rounded border p-3 text-sm">
                    <p>{t("richiesteMagazzino.existingForPerson")}</p>
                    {existingForPerson.data.items.map((request) => (
                      <button
                        type="button"
                        key={request.id}
                        className="block underline"
                        onClick={() => {
                          selectRequest(request.id);
                          setCreating(false);
                        }}
                      >
                        {request.codice} — {request.stato}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="rm-need">
                    {t("richiesteMagazzino.need")}
                  </Label>
                  <Textarea
                    id="rm-need"
                    required
                    maxLength={2000}
                    value={bisogno}
                    onChange={(event) => setBisogno(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="rm-priority">
                    {t("richiesteMagazzino.priority")}
                  </Label>
                  <select
                    id="rm-priority"
                    className="rounded border p-2"
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value as typeof priority)
                    }
                  >
                    {(["bassa", "normale", "alta", "urgente"] as const).map(
                      (value) => (
                        <option key={value} value={value}>
                          {t(`richiesteMagazzino.${value}`)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="rm-date">
                    {t("richiesteMagazzino.desiredDate")}
                  </Label>
                  <Input
                    id="rm-date"
                    type="date"
                    value={desiredDate}
                    onChange={(event) => setDesiredDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="rm-mode">
                    {t("richiesteMagazzino.modality")}
                  </Label>
                  <select
                    id="rm-mode"
                    className="rounded border p-2"
                    value={modality}
                    onChange={(event) =>
                      setModality(event.target.value as typeof modality)
                    }
                  >
                    {(["da_definire", "ritiro", "domicilio"] as const).map(
                      (value) => (
                        <option key={value} value={value}>
                          {t(`richiesteMagazzino.${value}`)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="rm-notes">
                    {t("richiesteMagazzino.notes")}
                  </Label>
                  <Textarea
                    id="rm-notes"
                    maxLength={2000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("richiesteMagazzino.notesVisible")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={pending || !beneficiaryId || !bisogno.trim()}
                  >
                    {t("richiesteMagazzino.send")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreating(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("richiesteMagazzino.queue")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={status === "aperte" ? "default" : "outline"}
              onClick={() => {
                setStatus("aperte");
              }}
            >
              {t("richiesteMagazzino.open")}
            </Button>
            <Button
              variant={status === "chiusa" ? "default" : "outline"}
              onClick={() => {
                setStatus("chiusa");
              }}
            >
              {t("richiesteMagazzino.closed")}
            </Button>
            <Button
              variant={status === "annullata" ? "default" : "outline"}
              onClick={() => {
                setStatus("annullata");
              }}
            >
              {t("richiesteMagazzino.cancelled")}
            </Button>
          </div>
          {list.isLoading ? (
            <p>{t("common.loading")}</p>
          ) : list.isError ? (
            <p role="alert">{t("richiesteMagazzino.loadError")}</p>
          ) : !list.data?.items.length ? (
            <p>{t("richiesteMagazzino.empty")}</p>
          ) : (
            <div className="space-y-2">
              {list.data.items.map((request) => (
                <button
                  type="button"
                  key={request.id}
                  className="w-full rounded border p-3 text-start hover:bg-muted"
                  onClick={() => {
                    selectRequest(request.id);
                    setEdit(false);
                    setCreating(false);
                    setError("");
                  }}
                >
                  <span className="font-medium">
                    {request.codice} — {request.destinatarioNomeSnapshot}
                  </span>
                  <span className="ml-2 text-xs">
                    {t(`richiesteMagazzino.${request.stato}`)}
                  </span>
                  {request.documentoCorrente && (
                    <span className="ml-2 text-xs">
                      {request.documentoCorrente.codice} ·{" "}
                      {t(
                        `richiesteMagazzino.progress.${request.documentoCorrente.avanzamento}`,
                      )}
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {request.areaNomeSnapshot} ·{" "}
                    {request.centroNomeSnapshot ?? "—"} ·{" "}
                    {t(`richiesteMagazzino.${request.priorita}`)}
                    {request.dataDesiderata
                      ? ` · ${String(request.dataDesiderata).slice(0, 10)}`
                      : ""}
                    {request.presoInCaricoCodiceSnapshot
                      ? ` · ${t("richiesteMagazzino.takenBy")}: ${request.presoInCaricoCodiceSnapshot}`
                      : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t("richiesteMagazzino.previous")}
            </Button>
            <span>
              {page} · {list.data?.total ?? 0}
            </span>
            <Button
              variant="outline"
              disabled={!list.data || page * 30 >= list.data.total}
              onClick={() => setPage(page + 1)}
            >
              {t("richiesteMagazzino.next")}
            </Button>
          </div>
        </CardContent>
      </Card>
      {selectedId != null && (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) navigationGuard.requestClose(() => selectRequest(null));
          }}
        >
          <SheetContent
            side="right"
            className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-2xl"
            data-testid="richiesta-sheet"
          >
            <SheetHeader className="shrink-0 border-b p-6 pr-12">
              <SheetTitle>{row?.codice ?? t("common.loading")}</SheetTitle>
              <SheetDescription>
                {row?.destinatarioNomeSnapshot ?? t("richiesteMagazzino.title")}
              </SheetDescription>
              {row && (
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge>{t(`richiesteMagazzino.${row.stato}`)}</Badge>
                  <span>{t(`richiesteMagazzino.${row.priorita}`)}</span>
                  <span>
                    {row.areaNomeSnapshot} · {row.centroNomeSnapshot ?? "—"}
                  </span>
                </div>
              )}
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
              {error && <p role="alert">{error}</p>}
              {confirmation && <p role="status">{confirmation}</p>}
              {detail.isError ? (
                <p role="alert">{t("richiesteMagazzino.loadError")}</p>
              ) : row && documentSelection ? (
                allowedDocument ? (
                  <DocumentoOperativoDettaglioComune
                    key={documentoSelectionValue(documentSelection)}
                    selection={documentSelection}
                    onClose={() => openDocument(null)}
                    onBackToRequest={() => openDocument(null)}
                    onDraftDirtyChange={setDocumentDirty}
                  />
                ) : (
                  <p role="alert">{t("bolle.documentoNonTrovato")}</p>
                )
              ) : row ? (
                <>
                  <p>
                    {row.destinatarioNomeSnapshot} · {row.areaNomeSnapshot} ·{" "}
                    {row.centroNomeSnapshot ?? "—"}
                  </p>
                  <p className="whitespace-pre-wrap">{row.bisogno}</p>
                  {row.dataDesiderata && (
                    <p>
                      {t("richiesteMagazzino.desiredDate")}:{" "}
                      {String(row.dataDesiderata).slice(0, 10)}
                    </p>
                  )}
                  {row.noteOperative && (
                    <p className="whitespace-pre-wrap text-sm">
                      {row.noteOperative}
                    </p>
                  )}
                  <p className="text-sm">
                    {t(`richiesteMagazzino.${row.stato}`)} ·{" "}
                    {t(`richiesteMagazzino.${row.priorita}`)} ·{" "}
                    {t(`richiesteMagazzino.${row.modalitaPreferita}`)} ·{" "}
                    {t("richiesteMagazzino.version")} {row.versione}
                  </p>
                  {row.documentoCorrente ? (
                    <section className="rounded border p-3 space-y-2">
                      <h2 className="font-medium">
                        {t("richiesteMagazzino.currentDocument")}
                      </h2>
                      <p>
                        {row.documentoCorrente.codice} ·{" "}
                        {t(
                          `richiesteMagazzino.progress.${row.documentoCorrente.avanzamento}`,
                        )}
                      </p>
                      {row.documentoCorrente.percorsoDocumento && (
                        <Button
                          variant="link"
                          className="underline"
                          onClick={() =>
                            openDocument(
                              linkedDocumentSelection(
                                row.documentoCorrente?.percorsoDocumento,
                              ),
                            )
                          }
                        >
                          {t("richiesteMagazzino.openDocument")}
                        </Button>
                      )}
                    </section>
                  ) : row.stato === "presa_in_carico" &&
                    canPrepare &&
                    hasPermission(
                      row.tipoDestinatario === "magazzino"
                        ? "magazzino.transfers.create"
                        : "bolle.manage",
                    ) &&
                    isModuloAttivo(
                      row.tipoDestinatario === "magazzino"
                        ? "TRASFERIMENTI"
                        : "BOLLE",
                    ) ? (
                    <section
                      className="rounded border p-3 space-y-3"
                      data-testid="m5b-prepare-document"
                    >
                      <h2 className="font-medium">
                        {row.tipoDestinatario === "magazzino"
                          ? t("richiesteMagazzino.prepareDocument")
                          : t("richiesteMagazzino.chooseWarehouseCreateBolla")}
                      </h2>
                      <p className="text-sm">
                        {t("richiesteMagazzino.recipient")}:{" "}
                        {row.destinatarioNomeSnapshot} ·{" "}
                        {t(
                          `richiesteMagazzino.recipientType.${row.tipoDestinatario}`,
                        )}
                      </p>
                      <div className="grid gap-2">
                        <Label htmlFor="rm-warehouse">
                          {t("richiesteMagazzino.fulfilmentWarehouse")}
                        </Label>
                        <select
                          id="rm-warehouse"
                          className="rounded border p-2"
                          value={warehouseId}
                          onChange={(event) =>
                            setWarehouseId(event.target.value)
                          }
                        >
                          <option value="">
                            {t("richiesteMagazzino.chooseWarehouse")}
                          </option>
                          {warehouses.data
                            ?.filter(
                              (item) =>
                                item.stato === "attivo" &&
                                item.areaOperativaId === row.areaOperativaId &&
                                item.id !== row.magazzinoDestinatarioId &&
                                (row.centroAscoltoId == null ||
                                  item.centroAscoltoId == null ||
                                  item.centroAscoltoId === row.centroAscoltoId),
                            )
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.nome}
                              </option>
                            ))}
                        </select>
                      </div>
                      {row.tipoDestinatario === "magazzino" &&
                        chosenWarehouse && (
                          <RigheEditor
                            magazzinoId={chosenWarehouse.id}
                            areaOperativaId={row.areaOperativaId}
                            righe={transferRows}
                            setRighe={setTransferRows}
                          />
                        )}
                    </section>
                  ) : row.stato === "presa_in_carico" ? (
                    <p className="text-sm text-muted-foreground">
                      {t("richiesteMagazzino.toPrepare")}
                    </p>
                  ) : null}
                  {row.documentiPrecedenti?.length ? (
                    <section className="rounded border p-3 space-y-2">
                      <h2 className="font-medium">
                        {t("richiesteMagazzino.previousDocuments")}
                      </h2>
                      {row.documentiPrecedenti.map((document) => (
                        <p key={document.relazioneId} className="text-sm">
                          {document.codice} ·{" "}
                          {t(
                            `richiesteMagazzino.progress.${document.avanzamento}`,
                          )}{" "}
                          {document.percorsoDocumento && (
                            <Button
                              variant="link"
                              className="underline"
                              onClick={() =>
                                openDocument(
                                  linkedDocumentSelection(
                                    document.percorsoDocumento,
                                  ),
                                )
                              }
                            >
                              {t("richiesteMagazzino.openDocument")}
                            </Button>
                          )}
                        </p>
                      ))}
                    </section>
                  ) : null}
                  {row.interventoId != null &&
                    hasArea("sociale") &&
                    hasPermission("sociale.interventi.view") &&
                    isModuloAttivo("CENTRO_ASCOLTO") && (
                      <p>
                        <Link
                          className="underline"
                          href={`/interventi?interventoId=${row.interventoId}`}
                        >
                          {t("richiesteMagazzino.sourceIntervention")}
                        </Link>
                      </p>
                    )}
                  {edit && (
                    <form
                      className="grid gap-3 rounded border p-3"
                      onSubmit={saveEdit}
                    >
                      <Label htmlFor="rm-edit-need">
                        {t("richiesteMagazzino.need")}
                      </Label>
                      <Textarea
                        id="rm-edit-need"
                        required
                        maxLength={2000}
                        value={bisogno}
                        onChange={(event) => setBisogno(event.target.value)}
                      />
                      <Label htmlFor="rm-edit-notes">
                        {t("richiesteMagazzino.notes")}
                      </Label>
                      <Textarea
                        id="rm-edit-notes"
                        maxLength={2000}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                      <Label htmlFor="rm-edit-priority">
                        {t("richiesteMagazzino.priority")}
                      </Label>
                      <select
                        id="rm-edit-priority"
                        className="rounded border p-2"
                        value={priority}
                        onChange={(event) =>
                          setPriority(event.target.value as typeof priority)
                        }
                      >
                        {(["bassa", "normale", "alta", "urgente"] as const).map(
                          (value) => (
                            <option key={value} value={value}>
                              {t(`richiesteMagazzino.${value}`)}
                            </option>
                          ),
                        )}
                      </select>
                      <Label htmlFor="rm-edit-date">
                        {t("richiesteMagazzino.desiredDate")}
                      </Label>
                      <Input
                        id="rm-edit-date"
                        type="date"
                        value={desiredDate}
                        onChange={(event) => setDesiredDate(event.target.value)}
                      />
                      <Label htmlFor="rm-edit-mode">
                        {t("richiesteMagazzino.modality")}
                      </Label>
                      <select
                        id="rm-edit-mode"
                        className="rounded border p-2"
                        value={modality}
                        onChange={(event) =>
                          setModality(event.target.value as typeof modality)
                        }
                      >
                        {(["da_definire", "ritiro", "domicilio"] as const).map(
                          (value) => (
                            <option key={value} value={value}>
                              {t(`richiesteMagazzino.${value}`)}
                            </option>
                          ),
                        )}
                      </select>
                      <div className="flex gap-2">
                        <Button type="submit" disabled={pending}>
                          {t("common.save")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEdit(false)}
                        >
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </form>
                  )}
                  <section>
                    <h2 className="font-medium">
                      {t("richiesteMagazzino.history")}
                    </h2>
                    {history.data?.map((event) => (
                      <p key={event.id} className="text-xs">
                        {event.azione} · {event.actorCodeSnapshot} ·{" "}
                        {String(event.registratoAt)}
                        {event.motivo && (
                          <span className="block whitespace-pre-wrap">
                            {event.motivo}
                          </span>
                        )}
                        {typeof event.changes?.nota === "string" && (
                          <span className="block whitespace-pre-wrap">
                            {event.changes.nota}
                          </span>
                        )}
                      </p>
                    ))}
                  </section>
                </>
              ) : (
                <p>{t("common.loading")}</p>
              )}
            </div>
            {row && !documentSelection && (
              <footer className="shrink-0 border-t bg-background p-4">
                <div className="flex flex-wrap gap-2">
                  {row.stato === "inviata" && canEdit && (
                    <Button variant="outline" onClick={() => beginEdit(row)}>
                      {t("common.edit")}
                    </Button>
                  )}
                  {row.stato === "inviata" && canTake && (
                    <Button disabled={pending} onClick={take}>
                      {t("richiesteMagazzino.take")}
                    </Button>
                  )}
                  {mayPrepare && (
                    <Button
                      disabled={pending || !chosenWarehouse || !transferReady}
                      onClick={prepareDocument}
                    >
                      {row.tipoDestinatario === "magazzino"
                        ? t("richiesteMagazzino.prepareDocument")
                        : t("richiesteMagazzino.createBolla")}
                    </Button>
                  )}
                  {mayCancel && (
                    <Button
                      variant="destructive"
                      disabled={pending}
                      onClick={() => setCancelOpen(true)}
                    >
                      {t("richiesteMagazzino.cancelRequest")}
                    </Button>
                  )}
                </div>
                {activeRequest && !preExit && (
                  <p className="mt-2 text-sm">
                    {t("richiesteMagazzino.cancelAfterExit")}
                  </p>
                )}
                {activeRequest &&
                  !preExit &&
                  row.documentoCorrente?.percorsoDocumento && (
                    <Button
                      variant="link"
                      className="underline"
                      onClick={() =>
                        openDocument(
                          linkedDocumentSelection(
                            row.documentoCorrente?.percorsoDocumento,
                          ),
                        )
                      }
                    >
                      {t("richiesteMagazzino.openDocument")}
                    </Button>
                  )}
              </footer>
            )}
            <Dialog
              open={cancelOpen}
              onOpenChange={(open) => {
                if (!pending) setCancelOpen(open);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {t("richiesteMagazzino.cancelRequest")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("richiesteMagazzino.cancelAudit")}
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void cancel();
                  }}
                >
                  {row?.documentoCorrente && (
                    <p>{t("richiesteMagazzino.cancelLinkedDocument")}</p>
                  )}
                  <Label htmlFor="rm-cancel-reason">
                    {t("richiesteMagazzino.cancelReason")} *
                  </Label>
                  <Textarea
                    id="rm-cancel-reason"
                    required
                    maxLength={500}
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                  />
                  <Label htmlFor="rm-cancel-note">
                    {t("richiesteMagazzino.cancelNote")}
                  </Label>
                  <Textarea
                    id="rm-cancel-note"
                    maxLength={2000}
                    value={cancelNote}
                    onChange={(event) => setCancelNote(event.target.value)}
                  />
                  {error && <p role="alert">{error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setCancelOpen(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={pending || !cancelReason.trim()}
                    >
                      {t("richiesteMagazzino.confirmCancel")}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </SheetContent>
        </Sheet>
      )}
      <UnsavedChangesDialog guard={navigationGuard} />
    </div>
  );
}
