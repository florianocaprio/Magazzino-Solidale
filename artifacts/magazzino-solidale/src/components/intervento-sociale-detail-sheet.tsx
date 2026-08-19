import type {
  BisognoPianificato,
  Intervento,
  InterventoAttivitaInput,
  InterventoConclusioneInput,
  InterventoDocumentoInput,
  InterventoMaterialeInput,
  InterventoOperatore,
  InterventoOperativita,
  InterventoPriorita,
  InterventoStoricoStato,
  Magazzino,
  Prodotto,
} from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InterventoAvvisoBadge } from "@/components/intervento-avviso";
import { InterventoSocialeOperativitaEditor } from "@/components/intervento-sociale-operativita-editor";
import {
  InterventoStatoBadge,
  interventoDataLabel,
} from "@/components/intervento-workflow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  civilDateEuropeRome,
  dateTimeEuropeRomeToIso,
  timeEuropeRome,
  todayEuropeRome,
} from "@/lib/europe-rome";

interface TipoOption {
  id: number;
  nome: string;
  attivo: boolean;
}

export interface PianificazioneInterventoInput {
  dataOraPianificata: string;
  priorita: InterventoPriorita;
  sede: string | null;
  operatoreId: number;
}

interface Props {
  open: boolean;
  intervento?: Intervento;
  operativita?: InterventoOperativita;
  storico?: InterventoStoricoStato[];
  bisogni?: BisognoPianificato[];
  tipi?: TipoOption[];
  operatori?: InterventoOperatore[];
  prodotti?: Prodotto[];
  magazzini?: Magazzino[];
  isLoading?: boolean;
  isPending?: boolean;
  canUpdate?: boolean;
  canComplete?: boolean;
  canCancel?: boolean;
  canCreate?: boolean;
  onOpenChange: (open: boolean) => void;
  onPianifica: (input: PianificazioneInterventoInput) => void;
  onAvvia: (versione: string) => void;
  onSalva: (input: InterventoConclusioneInput) => void;
  onConcludi: (input: InterventoConclusioneInput) => void;
  onAnnulla: (versione: string, motivo: string) => void;
  onMancataPresentazione: (versione: string, nota: string) => void;
}

function timestampLabel(value: string | null | undefined): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[11rem_1fr]">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap text-sm">{value || "–"}</dd>
    </div>
  );
}

function payloadRows(operativita: InterventoOperativita) {
  return {
    attivita: operativita.attivita.map<InterventoAttivitaInput>((item) => ({
      tipologiaId: item.tipologiaId,
      tipologiaSnapshot: item.tipologiaSnapshot,
      descrizione: item.descrizione,
      risultato: item.risultato,
    })),
    materiali: operativita.materiali.map<InterventoMaterialeInput>((item) => ({
      prodottoId: item.prodottoId,
      descrizioneSnapshot: item.descrizioneSnapshot,
      unitaMisuraSnapshot: item.unitaMisuraSnapshot,
      quantitaPrevista: item.quantitaPrevista,
      quantitaConsegnata: item.quantitaConsegnata,
      statoPreparazione: item.statoPreparazione,
      magazzinoId: item.magazzinoId,
      note: item.note,
    })),
    documenti: operativita.documenti.map<InterventoDocumentoInput>((item) => ({
      tipoDescrizione: item.tipoDescrizione,
      stato: item.stato,
      dataScadenza: item.dataScadenza,
      note: item.note,
    })),
  };
}

export function InterventoSocialeDetailSheet({
  open,
  intervento,
  operativita,
  storico = [],
  bisogni = [],
  tipi = [],
  operatori = [],
  prodotti = [],
  magazzini = [],
  isLoading = false,
  isPending = false,
  canUpdate = true,
  canComplete = true,
  canCancel = true,
  canCreate = true,
  onOpenChange,
  onPianifica,
  onAvvia,
  onSalva,
  onConcludi,
  onAnnulla,
  onMancataPresentazione,
}: Props) {
  const { t } = useTranslation();
  const [attivita, setAttivita] = useState<InterventoAttivitaInput[]>([]);
  const [materiali, setMateriali] = useState<InterventoMaterialeInput[]>([]);
  const [documenti, setDocumenti] = useState<InterventoDocumentoInput[]>([]);
  const [risultato, setRisultato] = useState("");
  const [esito, setEsito] = useState("");
  const [note, setNote] = useState("");
  const [motivoAnnullamento, setMotivoAnnullamento] = useState("");
  const [notaMancataPresentazione, setNotaMancataPresentazione] = useState("");
  const [confermaConclusione, setConfermaConclusione] = useState(false);
  const [creaSuccessivo, setCreaSuccessivo] = useState(false);
  const [successivoStato, setSuccessivoStato] = useState<
    "da_pianificare" | "pianificato"
  >("da_pianificare");
  const [successivoTipo, setSuccessivoTipo] = useState("");
  const [successivoData, setSuccessivoData] = useState(todayEuropeRome());
  const [successivoOra, setSuccessivoOra] = useState("09:00");
  const [successivoPriorita, setSuccessivoPriorita] =
    useState<InterventoPriorita>("normale");
  const [successivoSede, setSuccessivoSede] = useState("");
  const [successivoOperatoreId, setSuccessivoOperatoreId] = useState("");
  const [successivoMateriali, setSuccessivoMateriali] = useState<
    InterventoMaterialeInput[]
  >([]);
  const [successivoDocumenti, setSuccessivoDocumenti] = useState<
    InterventoDocumentoInput[]
  >([]);
  const [pianificazioneData, setPianificazioneData] =
    useState(todayEuropeRome());
  const [pianificazioneOra, setPianificazioneOra] = useState("09:00");
  const [pianificazionePriorita, setPianificazionePriorita] =
    useState<InterventoPriorita>("normale");
  const [pianificazioneSede, setPianificazioneSede] = useState("");
  const [pianificazioneOperatoreId, setPianificazioneOperatoreId] =
    useState("");
  const loadedKey = useRef<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!open) {
      loadedKey.current = null;
      return;
    }
    if (!intervento || !operativita) return;
    const key = `${intervento.id}:${operativita.versione ?? "none"}`;
    if (!opening && loadedKey.current === key) return;
    const rows = payloadRows(operativita);
    setAttivita(rows.attivita);
    setMateriali(rows.materiali);
    setDocumenti(rows.documenti);
    setRisultato(operativita.risultato ?? "");
    setEsito(operativita.esito ?? "");
    setNote(operativita.note ?? "");
    setMotivoAnnullamento("");
    setNotaMancataPresentazione("");
    setConfermaConclusione(false);
    setCreaSuccessivo(false);
    setSuccessivoStato("da_pianificare");
    setSuccessivoTipo(intervento.tipoIntervento);
    setSuccessivoData(todayEuropeRome());
    setSuccessivoOra("09:00");
    setSuccessivoPriorita("normale");
    setSuccessivoSede(intervento.sede ?? "");
    setSuccessivoOperatoreId(
      intervento.operatoreId ? String(intervento.operatoreId) : "",
    );
    setSuccessivoMateriali([]);
    setSuccessivoDocumenti([]);
    const planned = intervento.dataOraPianificata;
    setPianificazioneData(
      planned ? civilDateEuropeRome(planned) : todayEuropeRome(),
    );
    setPianificazioneOra(planned ? timeEuropeRome(planned) : "09:00");
    setPianificazionePriorita(intervento.priorita);
    setPianificazioneSede(intervento.sede ?? "");
    setPianificazioneOperatoreId(
      intervento.operatoreId ? String(intervento.operatoreId) : "",
    );
    loadedKey.current = key;
  }, [intervento, open, operativita]);

  const terminal =
    intervento?.stato === "concluso" ||
    intervento?.stato === "annullato" ||
    intervento?.stato === "mancata_presentazione";
  const operationalPayload = (): InterventoConclusioneInput | null => {
    if (!operativita?.versione) return null;
    return {
      versione: operativita.versione,
      risultato: risultato || null,
      esito: esito || null,
      note: note || null,
      attivita,
      materiali,
      documenti,
      conferma: true,
    };
  };

  const conclude = () => {
    const payload = operationalPayload();
    if (!payload) return;
    if (creaSuccessivo) {
      payload.successivo = {
        tipoIntervento: successivoTipo,
        stato: successivoStato,
        ambito: "sociale",
        priorita: successivoPriorita,
        dataOraPianificata:
          successivoStato === "pianificato"
            ? dateTimeEuropeRomeToIso(successivoData, successivoOra)
            : null,
        sede: successivoSede || null,
        operatoreId: Number(successivoOperatoreId),
        materiali: successivoMateriali,
        documenti: successivoDocumenti,
      };
    }
    onConcludi(payload);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{t("interventi.detail.title")}</SheetTitle>
          <SheetDescription>
            {intervento?.stato === "in_corso"
              ? t("interventi.operational.inProgressDescription")
              : terminal
                ? t("interventi.operational.readOnlyDescription")
                : t("interventi.operational.planningDescription")}
          </SheetDescription>
        </SheetHeader>
        {isLoading || !intervento || !operativita ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <div
            className="mt-6 space-y-6"
            data-testid="intervento-operational-workspace"
          >
            <section className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{intervento.beneficiarioNome}</p>
                  <p className="text-sm text-muted-foreground">
                    {[
                      intervento.beneficiarioCodice,
                      intervento.nucleoFamiliareSintesi,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button asChild type="button" size="sm" variant="outline">
                  <a href={`/beneficiari/${intervento.beneficiarioId}`}>
                    {t("interventi.operational.openRegistry")}
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </div>
            </section>

            <dl className="divide-y">
              <DetailRow
                label={t("interventi.detail.state")}
                value={
                  <span className="flex flex-wrap gap-2">
                    <InterventoStatoBadge stato={intervento.stato} />
                    <InterventoAvvisoBadge avviso={intervento.avviso} />
                  </span>
                }
              />
              <DetailRow
                label={t("interventi.detail.scope")}
                value={
                  intervento.ambitoLegacy ? (
                    <Badge variant="outline">
                      {t("interventi.legacy.label")}
                    </Badge>
                  ) : (
                    t("interventi.scopeSociale")
                  )
                }
              />
              <DetailRow
                label={t("interventi.detail.plannedAt")}
                value={timestampLabel(intervento.dataOraPianificata)}
              />
              <DetailRow
                label={t("interventi.detail.startedAt")}
                value={timestampLabel(intervento.dataOraAvvio)}
              />
              <DetailRow
                label={t("interventi.detail.concludedAt")}
                value={
                  intervento.dataOraConclusione
                    ? timestampLabel(intervento.dataOraConclusione)
                    : intervento.stato === "concluso" &&
                        intervento.dataIntervento
                      ? interventoDataLabel(intervento)
                      : "–"
                }
              />
              <DetailRow
                label={t("interventi.detail.site")}
                value={intervento.sede}
              />
              <DetailRow
                label={t("interventi.operatore")}
                value={intervento.operatoreNome ?? intervento.operatoreCodice}
              />
              <DetailRow
                label={t("interventi.tipoIntervento")}
                value={intervento.tipoIntervento}
              />
            </dl>

            {canUpdate &&
              (intervento.stato === "da_pianificare" ||
                intervento.stato === "pianificato") && (
                <section className="space-y-3 rounded-lg border p-4">
                  <h3 className="font-semibold">
                    {t("interventi.operational.appointment")}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      type="date"
                      value={pianificazioneData}
                      onChange={(event) =>
                        setPianificazioneData(event.target.value)
                      }
                      aria-label={t("interventi.form.date")}
                    />
                    <Input
                      type="time"
                      value={pianificazioneOra}
                      onChange={(event) =>
                        setPianificazioneOra(event.target.value)
                      }
                      aria-label={t("interventi.form.time")}
                    />
                    <Select
                      value={pianificazionePriorita}
                      onValueChange={(value) =>
                        setPianificazionePriorita(value as InterventoPriorita)
                      }
                    >
                      <SelectTrigger
                        aria-label={t("interventi.detail.priority")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["bassa", "normale", "alta", "urgente"] as const).map(
                          (value) => (
                            <SelectItem key={value} value={value}>
                              {t(`interventi.priorita.${value}`)}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <Input
                      value={pianificazioneSede}
                      onChange={(event) =>
                        setPianificazioneSede(event.target.value)
                      }
                      placeholder={t("interventi.detail.site")}
                    />
                    <Select
                      value={pianificazioneOperatoreId}
                      onValueChange={setPianificazioneOperatoreId}
                    >
                      <SelectTrigger
                        aria-label={t("interventi.form.assignedOperator")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {operatori.map((operatore) => (
                          <SelectItem
                            key={operatore.id}
                            value={String(operatore.id)}
                          >
                            {operatore.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPending || !pianificazioneOperatoreId}
                    onClick={() =>
                      onPianifica({
                        dataOraPianificata: dateTimeEuropeRomeToIso(
                          pianificazioneData,
                          pianificazioneOra,
                        ),
                        priorita: pianificazionePriorita,
                        sede: pianificazioneSede || null,
                        operatoreId: Number(pianificazioneOperatoreId),
                      })
                    }
                  >
                    {intervento.stato === "da_pianificare"
                      ? t("interventi.operational.plan")
                      : t("interventi.operational.updateAppointment")}
                  </Button>
                </section>
              )}

            <InterventoSocialeOperativitaEditor
              attivita={attivita}
              materiali={materiali}
              documenti={documenti}
              tipi={tipi}
              prodotti={prodotti}
              magazzini={magazzini}
              readOnly={terminal || !canUpdate}
              showActivities={intervento.stato === "in_corso" || terminal}
              onAttivitaChange={setAttivita}
              onMaterialiChange={setMateriali}
              onDocumentiChange={setDocumenti}
            />

            <section className="space-y-3">
              <h3 className="font-semibold">
                {t("interventi.operational.outcome")}
              </h3>
              <Textarea
                value={risultato}
                readOnly={terminal || !canUpdate}
                onChange={(event) => setRisultato(event.target.value)}
                placeholder={t("interventi.operational.result")}
              />
              <Textarea
                value={esito}
                readOnly={terminal || !canUpdate}
                onChange={(event) => setEsito(event.target.value)}
                placeholder={t("interventi.esito")}
              />
              <Textarea
                value={note}
                readOnly={terminal || !canUpdate}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("interventi.note")}
              />
            </section>

            <section className="space-y-3">
              <h3 className="font-semibold">{t("interventi.detail.needs")}</h3>
              {bisogni.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("interventi.detail.noNeeds")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {bisogni.map((bisogno) => (
                    <li
                      key={bisogno.id}
                      className="rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{bisogno.tipo}</Badge>
                        <Badge variant="outline">{bisogno.stato}</Badge>
                      </div>
                      <p className="mt-2">{bisogno.descrizione}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canComplete && intervento.stato === "in_corso" && (
              <section className="space-y-4 rounded-lg border p-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={creaSuccessivo}
                    disabled={!canCreate}
                    onCheckedChange={(checked) =>
                      setCreaSuccessivo(checked === true)
                    }
                  />
                  {t("interventi.operational.createFollowing")}
                </label>
                {creaSuccessivo && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Select
                        value={successivoStato}
                        onValueChange={(value) =>
                          setSuccessivoStato(
                            value as "da_pianificare" | "pianificato",
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="da_pianificare">
                            {t("interventi.views.da_pianificare")}
                          </SelectItem>
                          <SelectItem value="pianificato">
                            {t("interventi.views.pianificati")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={successivoTipo}
                        onValueChange={setSuccessivoTipo}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {tipi
                            .filter((tipo) => tipo.attivo)
                            .map((tipo) => (
                              <SelectItem key={tipo.id} value={tipo.nome}>
                                {tipo.nome}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {successivoStato === "pianificato" && (
                        <>
                          <Input
                            type="date"
                            value={successivoData}
                            onChange={(event) =>
                              setSuccessivoData(event.target.value)
                            }
                          />
                          <Input
                            type="time"
                            value={successivoOra}
                            onChange={(event) =>
                              setSuccessivoOra(event.target.value)
                            }
                          />
                        </>
                      )}
                      <Select
                        value={successivoPriorita}
                        onValueChange={(value) =>
                          setSuccessivoPriorita(value as InterventoPriorita)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            ["bassa", "normale", "alta", "urgente"] as const
                          ).map((value) => (
                            <SelectItem key={value} value={value}>
                              {t(`interventi.priorita.${value}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={successivoSede}
                        onChange={(event) =>
                          setSuccessivoSede(event.target.value)
                        }
                        placeholder={t("interventi.detail.site")}
                      />
                      <Select
                        value={successivoOperatoreId}
                        onValueChange={setSuccessivoOperatoreId}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {operatori.map((operatore) => (
                            <SelectItem
                              key={operatore.id}
                              value={String(operatore.id)}
                            >
                              {operatore.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <InterventoSocialeOperativitaEditor
                      attivita={[]}
                      materiali={successivoMateriali}
                      documenti={successivoDocumenti}
                      tipi={tipi}
                      prodotti={prodotti}
                      magazzini={magazzini}
                      showActivities={false}
                      onAttivitaChange={() => undefined}
                      onMaterialiChange={setSuccessivoMateriali}
                      onDocumentiChange={setSuccessivoDocumenti}
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={confermaConclusione}
                    onCheckedChange={(checked) =>
                      setConfermaConclusione(checked === true)
                    }
                  />
                  {t("interventi.operational.confirmConclusion")}
                </label>
              </section>
            )}

            {!terminal && (canUpdate || canComplete || canCancel) && (
              <section className="space-y-3 rounded-lg border p-4">
                <h3 className="font-semibold">
                  {t("interventi.operational.actions")}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {canComplete &&
                    (intervento.stato === "da_pianificare" ||
                      intervento.stato === "pianificato") && (
                      <Button
                        type="button"
                        disabled={isPending || !operativita.versione}
                        onClick={() => {
                          if (operativita.versione)
                            onAvvia(operativita.versione);
                        }}
                      >
                        {t("interventi.operational.start")}
                      </Button>
                    )}
                  {canUpdate && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPending || !operativita.versione}
                      onClick={() => {
                        const payload = operationalPayload();
                        if (payload) onSalva(payload);
                      }}
                    >
                      {t("interventi.operational.saveWithoutClosing")}
                    </Button>
                  )}
                  {canComplete && intervento.stato === "in_corso" && (
                    <Button
                      type="button"
                      disabled={
                        isPending ||
                        !operativita.versione ||
                        !confermaConclusione ||
                        (!risultato.trim() && !esito.trim()) ||
                        (creaSuccessivo &&
                          (!successivoTipo || !successivoOperatoreId))
                      }
                      onClick={conclude}
                    >
                      {t("interventi.operational.conclude")}
                    </Button>
                  )}
                </div>
                {canCancel && <Separator />}
                {canCancel && (
                  <>
                    <Textarea
                      value={motivoAnnullamento}
                      onChange={(event) =>
                        setMotivoAnnullamento(event.target.value)
                      }
                      placeholder={t(
                        "interventi.operational.cancellationReason",
                      )}
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={
                        isPending ||
                        !operativita.versione ||
                        !motivoAnnullamento.trim()
                      }
                      onClick={() => {
                        if (
                          operativita.versione &&
                          window.confirm(
                            t("interventi.operational.confirmCancellation"),
                          )
                        ) {
                          onAnnulla(operativita.versione, motivoAnnullamento);
                        }
                      }}
                    >
                      {t("interventi.operational.cancel")}
                    </Button>
                  </>
                )}
                {canCancel && intervento.stato === "pianificato" && (
                  <div className="space-y-2 border-t pt-3">
                    <Textarea
                      value={notaMancataPresentazione}
                      onChange={(event) =>
                        setNotaMancataPresentazione(event.target.value)
                      }
                      placeholder={t("interventi.operational.noShowNote")}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isPending || !operativita.versione}
                      onClick={() => {
                        if (operativita.versione)
                          onMancataPresentazione(
                            operativita.versione,
                            notaMancataPresentazione,
                          );
                      }}
                    >
                      {t("interventi.operational.noShow")}
                    </Button>
                  </div>
                )}
              </section>
            )}

            <section className="space-y-3">
              <h3 className="font-semibold">
                {t("interventi.detail.history")}
              </h3>
              {storico.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("interventi.detail.noHistory")}
                </p>
              ) : (
                <ol className="space-y-3 border-l pl-4">
                  {storico.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <InterventoStatoBadge stato={entry.statoNuovo} />
                      <span className="ml-2 text-muted-foreground">
                        {timestampLabel(entry.dataTransizione)}
                      </span>
                      {entry.motivo && <p className="mt-1">{entry.motivo}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <DetailRow
              label={t("interventi.detail.previous")}
              value={intervento.interventoPrecedenteId?.toString()}
            />
            <DetailRow
              label={t("interventi.detail.following")}
              value={
                (intervento.successoriIds?.length ?? 0) > 0
                  ? intervento.successoriIds?.join(", ")
                  : undefined
              }
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
