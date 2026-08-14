import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export type BisognoTipo = "richiesta" | "azione";
export type BisognoStato =
  | "da_pianificare"
  | "pianificato"
  | "completato"
  | "annullato";
export type BisognoPriorita = "bassa" | "normale" | "alta" | "urgente";

export interface BisognoPianificatoDraft {
  clientKey: string;
  id?: number;
  tipo: BisognoTipo;
  descrizione: string;
  stato: BisognoStato;
  dataPrevista: string;
  priorita: BisognoPriorita;
  note: string;
  dataCompletamento?: string | null;
}

let draftSequence = 0;

export function nuovoBisognoPianificato(): BisognoPianificatoDraft {
  draftSequence += 1;
  return {
    clientKey: `bisogno-new-${draftSequence}`,
    tipo: "richiesta",
    descrizione: "",
    stato: "da_pianificare",
    dataPrevista: "",
    priorita: "normale",
    note: "",
  };
}

function dataCivileEuropeRome(referenceDate = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(referenceDate)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isBisognoScaduto(
  bisogno: Pick<BisognoPianificatoDraft, "stato" | "dataPrevista">,
  today = dataCivileEuropeRome(),
): boolean {
  return (
    (bisogno.stato === "da_pianificare" || bisogno.stato === "pianificato") &&
    bisogno.dataPrevista !== "" &&
    bisogno.dataPrevista < today
  );
}

interface Props {
  value: BisognoPianificatoDraft[];
  onChange: (value: BisognoPianificatoDraft[]) => void;
  disabled?: boolean;
}

export function BisogniPianificatiEditor({
  value,
  onChange,
  disabled = false,
}: Props) {
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<BisognoPianificatoDraft>) => {
    onChange(
      value.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  return (
    <section className="space-y-4" aria-labelledby="bisogni-pianificati-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-5">
        <div>
          <h3 id="bisogni-pianificati-title" className="font-semibold">
            {t("udsInterventi.bisogniPianificatiTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("udsInterventi.bisogniPianificatiDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
          onClick={() => onChange([...value, nuovoBisognoPianificato()])}
        >
          <Plus className="h-4 w-4" />
          {t("udsInterventi.addBisognoPianificato")}
        </Button>
      </div>

      {value.length === 0 ? (
        <div
          data-testid="bisogni-pianificati-empty"
          className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground"
        >
          {t("udsInterventi.noBisogniPianificatiForm")}
        </div>
      ) : (
        <div className="space-y-3" data-testid="bisogni-pianificati-list">
          {value.map((bisogno, index) => {
            const scaduto = isBisognoScaduto(bisogno);
            return (
              <div
                key={bisogno.clientKey}
                data-testid="bisogno-pianificato-card"
                className={`rounded-lg border p-4 space-y-4 ${scaduto ? "border-red-300 bg-red-50/60" : "bg-muted/20"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {t("udsInterventi.bisognoNumber", { number: index + 1 })}
                    </span>
                    <Badge variant="outline">
                      {t(`udsInterventi.bisognoPriorita.${bisogno.priorita}`)}
                    </Badge>
                    {scaduto && (
                      <Badge
                        variant="destructive"
                        className="gap-1"
                        data-testid="bisogno-scaduto"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {t("udsInterventi.bisognoScaduto")}
                      </Badge>
                    )}
                    {bisogno.stato === "completato" && (
                      <Badge className="gap-1 bg-emerald-600">
                        <CheckCircle2 className="h-3 w-3" />
                        {t("udsInterventi.bisognoStato.completato")}
                      </Badge>
                    )}
                  </div>
                  {bisogno.id == null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={t("udsInterventi.removeBisognoPianificato")}
                      onClick={() =>
                        onChange(
                          value.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("udsInterventi.bisognoTipoLabel")}</Label>
                    <Select
                      value={bisogno.tipo}
                      disabled={disabled}
                      onValueChange={(tipo: BisognoTipo) =>
                        update(index, { tipo })
                      }
                    >
                      <SelectTrigger
                        aria-label={t("udsInterventi.bisognoTipoLabel")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="richiesta">
                          {t("udsInterventi.bisognoTipo.richiesta")}
                        </SelectItem>
                        <SelectItem value="azione">
                          {t("udsInterventi.bisognoTipo.azione")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("udsInterventi.bisognoPrioritaLabel")}</Label>
                    <Select
                      value={bisogno.priorita}
                      disabled={disabled}
                      onValueChange={(priorita: BisognoPriorita) =>
                        update(index, { priorita })
                      }
                    >
                      <SelectTrigger
                        aria-label={t("udsInterventi.bisognoPrioritaLabel")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["bassa", "normale", "alta", "urgente"] as const).map(
                          (priorita) => (
                            <SelectItem key={priorita} value={priorita}>
                              {t(`udsInterventi.bisognoPriorita.${priorita}`)}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("udsInterventi.bisognoStatoLabel")}</Label>
                    <Select
                      value={bisogno.stato}
                      disabled={disabled}
                      onValueChange={(stato: BisognoStato) =>
                        update(index, { stato })
                      }
                    >
                      <SelectTrigger
                        aria-label={t("udsInterventi.bisognoStatoLabel")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          [
                            "da_pianificare",
                            "pianificato",
                            "completato",
                            "annullato",
                          ] as const
                        ).map((stato) => (
                          <SelectItem key={stato} value={stato}>
                            {t(`udsInterventi.bisognoStato.${stato}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`bisogno-data-${bisogno.clientKey}`}>
                      {t("udsInterventi.bisognoDataPrevistaLabel")}
                    </Label>
                    <div className="relative">
                      <CalendarClock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id={`bisogno-data-${bisogno.clientKey}`}
                        type="date"
                        className="pl-9"
                        value={bisogno.dataPrevista}
                        disabled={disabled}
                        onChange={(event) =>
                          update(index, { dataPrevista: event.target.value })
                        }
                      />
                    </div>
                    {bisogno.stato === "pianificato" &&
                      !bisogno.dataPrevista && (
                        <p className="text-sm font-medium text-destructive">
                          {t("udsInterventi.bisognoDataRequired")}
                        </p>
                      )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`bisogno-descrizione-${bisogno.clientKey}`}>
                    {t("udsInterventi.bisognoDescrizioneLabel")}
                  </Label>
                  <Textarea
                    id={`bisogno-descrizione-${bisogno.clientKey}`}
                    rows={2}
                    maxLength={500}
                    value={bisogno.descrizione}
                    disabled={disabled}
                    placeholder={t(
                      "udsInterventi.bisognoDescrizionePlaceholder",
                    )}
                    onChange={(event) =>
                      update(index, { descrizione: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`bisogno-note-${bisogno.clientKey}`}>
                    {t("udsInterventi.bisognoNoteLabel")}
                  </Label>
                  <Textarea
                    id={`bisogno-note-${bisogno.clientKey}`}
                    rows={2}
                    maxLength={2000}
                    value={bisogno.note}
                    disabled={disabled}
                    placeholder={t("udsInterventi.bisognoNotePlaceholder")}
                    onChange={(event) =>
                      update(index, { note: event.target.value })
                    }
                  />
                  {bisogno.dataCompletamento && (
                    <p className="text-xs text-muted-foreground">
                      {t("udsInterventi.bisognoCompletatoIl", {
                        date: new Date(
                          bisogno.dataCompletamento,
                        ).toLocaleString("it-IT"),
                      })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
