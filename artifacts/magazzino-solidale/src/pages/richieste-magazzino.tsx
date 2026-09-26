import { useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createRichiestaMagazzino,
  updateRichiestaMagazzino,
  takeRichiestaMagazzino,
  cancelRichiestaMagazzino,
  getListRichiesteMagazzinoQueryKey,
  useGetRichiestaMagazzino,
  getGetRichiestaMagazzinoQueryKey,
  getGetRichiestaMagazzinoStoricoQueryKey,
  getListBeneficiariQueryKey,
  useGetRichiestaMagazzinoStorico,
  useListBeneficiari,
  useListRichiesteMagazzino,
  type RichiestaMagazzino,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useConfigurazioneAmbienteFlags } from "@/lib/use-moduli";
import { useCommandIntentRegistry } from "@/lib/command-intent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  return (error as { data?: { error?: string } })?.data?.error ?? fallback;
}

export default function RichiesteMagazzino() {
  const { t } = useTranslation();
  const { hasArea, hasPermission } = useAuth();
  const { isModuloAttivo } = useConfigurazioneAmbienteFlags();
  const queryClient = useQueryClient();
  const intents = useCommandIntentRegistry();
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
  const contextBeneficiaryId = queryId("beneficiarioId");
  const contextInterventionId = queryId("interventoId");
  const contextRequestId = queryId("richiestaId");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"aperte" | "annullata">("aperte");
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const listParams = useMemo(
    () => ({
      page,
      limit: 30,
      stato: status,
      ...(contextBeneficiaryId ? { beneficiarioId: contextBeneficiaryId } : {}),
    }),
    [page, status, contextBeneficiaryId],
  );
  const list = useListRichiesteMagazzino(listParams);
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
    },
  });
  const history = useGetRichiestaMagazzinoStorico(selectedId ?? 0, {
    query: {
      queryKey: getGetRichiestaMagazzinoStoricoQueryKey(selectedId ?? 0),
      enabled: selectedId != null,
    },
  });
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
  const row = detail.data;

  const refresh = async (id?: number) => {
    await queryClient.invalidateQueries({
      queryKey: getListRichiesteMagazzinoQueryKey(),
    });
    if (id != null) await detail.refetch();
  };

  const execute = async (
    slot: string,
    semantic: Record<string, unknown>,
    payload: Record<string, unknown>,
    call: (body: any) => Promise<unknown>,
  ) => {
    setError("");
    setPending(true);
    const intent = intents.prepare(slot, semantic, payload);
    try {
      await call(intent);
      intents.complete(slot);
      await refresh(selectedId ?? undefined);
      return true;
    } catch (cause) {
      intents.fail(slot, cause);
      setError(message(cause, t("richiesteMagazzino.commandError")));
      if ((cause as { status?: number })?.status === 409)
        await refresh(selectedId ?? undefined);
      return false;
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
    const payload = { versione: row.versione, motivo: cancelReason.trim() };
    const ok = await execute(
      `richiesta:${row.id}:cancel`,
      payload,
      payload,
      (body) => cancelRichiestaMagazzino(row.id, body),
    );
    if (ok) setCancelReason("");
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
            {contextInterventionId && activeForIntervention.isLoading ? (
              <p>{t("common.loading")}</p>
            ) : contextInterventionId && activeForIntervention.isError ? (
              <p role="alert">{t("richiesteMagazzino.loadError")}</p>
            ) : activeForIntervention.data?.items[0] ? (
              <p>
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setSelectedId(activeForIntervention.data!.items[0].id);
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
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => setBeneficiaryId(null)}
                    >
                      {t("common.edit")}
                    </Button>
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
                          setSelectedId(request.id);
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
                setPage(1);
              }}
            >
              {t("richiesteMagazzino.open")}
            </Button>
            <Button
              variant={status === "annullata" ? "default" : "outline"}
              onClick={() => {
                setStatus("annullata");
                setPage(1);
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
                    setSelectedId(request.id);
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
                  <p className="line-clamp-2 text-sm">{request.bisogno}</p>
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
        <Card>
          <CardHeader>
            <CardTitle>{row?.codice ?? t("common.loading")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {detail.isError ? (
              <p role="alert">{t("richiesteMagazzino.loadError")}</p>
            ) : row ? (
              <>
                <p>
                  {row.destinatarioNomeSnapshot} · {row.areaNomeSnapshot} ·{" "}
                  {row.centroNomeSnapshot ?? "—"}
                </p>
                <p className="whitespace-pre-wrap">{row.bisogno}</p>
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
                  {canCancel &&
                    ((row.stato === "inviata" &&
                      row.tipoDestinatario === "beneficiario" &&
                      hasArea("sociale") &&
                      isModuloAttivo("CENTRO_ASCOLTO")) ||
                      (row.stato === "presa_in_carico" &&
                        hasArea("magazzino"))) && (
                      <div className="flex flex-wrap gap-2">
                        <Input
                          aria-label={t("richiesteMagazzino.cancelReason")}
                          maxLength={500}
                          value={cancelReason}
                          onChange={(event) =>
                            setCancelReason(event.target.value)
                          }
                          placeholder={t("richiesteMagazzino.cancelReason")}
                        />
                        <Button
                          variant="destructive"
                          disabled={pending || !cancelReason.trim()}
                          onClick={cancel}
                        >
                          {t("common.cancel")}
                        </Button>
                      </div>
                    )}
                </div>
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
                    </p>
                  ))}
                </section>
              </>
            ) : (
              <p>{t("common.loading")}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
