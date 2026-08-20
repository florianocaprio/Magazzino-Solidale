import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListMensaAbilitazioniQueryKey,
  getListMenseQueryKey,
  useCreateMensaAbilitazione,
  useListMensaAbilitazioni,
  useListMense,
  type BeneficiarioDettaglio,
  type MensaAbilitazione,
} from "@workspace/api-client-react";
import { Utensils } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { todayEuropeRome } from "@/lib/europe-rome";
import { useModuloFlags } from "@/lib/use-moduli";

type BeneficiarioMensa = Pick<
  BeneficiarioDettaglio,
  "id" | "attivo" | "statoAnagrafica" | "areaOperativaId"
>;

export type MensaDisplayState =
  | MensaAbilitazione["stato"]
  | "programmata"
  | "non_abilitato";

const statoLabel: Record<MensaDisplayState, string> = {
  attiva: "ATTIVA",
  programmata: "PROGRAMMATA",
  sospesa: "SOSPESA",
  revocata: "REVOCATA",
  scaduta: "SCADUTA",
  non_abilitato: "NON ABILITATO",
};

function dateLabel(value?: string | null): string {
  if (!value) return "senza scadenza";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function isCurrentEligibility(item: MensaAbilitazione, today: string): boolean {
  return (
    item.mensaPrincipale &&
    item.stato === "attiva" &&
    item.dataInizio <= today &&
    (item.dataFine == null || item.dataFine >= today)
  );
}

function displayedState(
  item: MensaAbilitazione | null,
  today: string,
): MensaDisplayState {
  if (!item) return "non_abilitato";
  if (item.stato === "attiva" && item.dataInizio > today) {
    return "programmata";
  }
  if (
    item.stato === "attiva" &&
    item.dataFine != null &&
    item.dataFine < today
  ) {
    return "scaduta";
  }
  return item.stato;
}

export function getMensaEligibilityDisplay(
  records: MensaAbilitazione[],
  today = todayEuropeRome(),
) {
  const current =
    records.find((item) => isCurrentEligibility(item, today)) ?? null;
  const latestPrincipal =
    records.find((item) => item.mensaPrincipale) ?? records[0] ?? null;
  const shown = current ?? latestPrincipal;
  const state = displayedState(shown, today);
  const hasBlockingPrincipal = records.some(
    (item) =>
      item.mensaPrincipale &&
      item.stato === "attiva" &&
      (item.dataFine == null || item.dataFine >= today),
  );

  return { current, shown, state, hasBlockingPrincipal };
}

export function MensaStatusBadge({ state }: { state: MensaDisplayState }) {
  return (
    <Badge variant={state === "attiva" ? "default" : "outline"}>
      {statoLabel[state]}
    </Badge>
  );
}

function errorMessage(error: unknown): string {
  const data = (error as { data?: { error?: unknown } })?.data;
  if (typeof data?.error === "string") return data.error;
  return error instanceof Error
    ? error.message
    : "Impossibile creare l'abilitazione Mensa";
}

export function BeneficiarioMensaSection({
  beneficiario,
  compact = false,
}: {
  beneficiario: BeneficiarioMensa;
  compact?: boolean;
}) {
  const { hasArea, hasPermission } = useAuth();
  const { mensaAbilitato } = useModuloFlags();

  const canViewMensa =
    mensaAbilitato && hasArea("mensa") && hasPermission("mensa.view");
  if (!canViewMensa) return null;

  return (
    <BeneficiarioMensaCard
      beneficiario={beneficiario}
      canManage={canViewMensa && hasPermission("mensa.eligibility.manage")}
      compact={compact}
    />
  );
}

export function BeneficiarioMensaCard({
  beneficiario,
  canManage,
  compact = false,
}: {
  beneficiario: BeneficiarioMensa;
  canManage: boolean;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const today = todayEuropeRome();
  const historyParams = { beneficiarioId: beneficiario.id };
  const history = useListMensaAbilitazioni(historyParams, {
    query: {
      queryKey: getListMensaAbilitazioniQueryKey(historyParams),
    },
  });
  const create = useCreateMensaAbilitazione();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mensaId, setMensaId] = useState("");
  const [dataInizio, setDataInizio] = useState(today);
  const [dataFine, setDataFine] = useState("");
  const menseParams = {
    attiva: true,
    areaOperativaId: beneficiario.areaOperativaId ?? undefined,
  };
  const mense = useListMense(menseParams, {
    query: {
      queryKey: getListMenseQueryKey(menseParams),
      enabled: dialogOpen && beneficiario.areaOperativaId != null,
    },
  });

  const records = history.data ?? [];
  const { current, shown, state, hasBlockingPrincipal } = useMemo(
    () => getMensaEligibilityDisplay(records, today),
    [records, today],
  );
  const canEnable =
    canManage &&
    beneficiario.attivo &&
    beneficiario.statoAnagrafica === "completa" &&
    !history.isLoading &&
    !history.isError &&
    !hasBlockingPrincipal;
  const invalidRange = dataFine !== "" && dataFine < dataInizio;

  const openDialog = () => {
    setMensaId("");
    setDataInizio(todayEuropeRome());
    setDataFine("");
    setDialogOpen(true);
  };

  const submit = () => {
    if (!mensaId || invalidRange) return;
    create.mutate(
      {
        data: {
          beneficiarioId: beneficiario.id,
          mensaId: Number(mensaId),
          dataInizio,
          dataFine: dataFine || null,
          mensaPrincipale: true,
        },
      },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({
            queryKey: getListMensaAbilitazioniQueryKey(historyParams),
          });
          setDialogOpen(false);
          toast({ title: "Beneficiario abilitato alla Mensa" });
        },
        onError: (error) =>
          toast({
            title: "Abilitazione Mensa non creata",
            description: errorMessage(error),
            variant: "destructive",
          }),
      },
    );
  };

  const content = (
    <div className="space-y-4">
      {history.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Caricamento stato Mensa…
        </p>
      ) : history.isError ? (
        <p className="text-sm text-destructive">Stato Mensa non disponibile.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {current
                  ? "Abilitazione Mensa attiva"
                  : state === "programmata"
                    ? "Abilitazione Mensa programmata"
                    : "Non abilitato alla Mensa"}
              </p>
              {!current && shown && (
                <p className="text-xs text-muted-foreground">
                  Ultima abilitazione disponibile
                </p>
              )}
            </div>
            <MensaStatusBadge state={state} />
          </div>

          {shown && (
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">
                  Mensa principale
                </div>
                <div className="font-medium">{shown.mensaNome ?? "-"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Dal</div>
                <div className="font-medium">{dateLabel(shown.dataInizio)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Al</div>
                <div className="font-medium">{dateLabel(shown.dataFine)}</div>
              </div>
            </div>
          )}

          {canEnable && (
            <div className="flex justify-end">
              <Button type="button" onClick={openDialog}>
                Abilita alla Mensa
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      {compact ? (
        <div
          className="rounded-md border p-3"
          data-testid="beneficiario-mensa-card"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Utensils className="h-4 w-4 text-muted-foreground" /> Mensa
          </div>
          {content}
        </div>
      ) : (
        <Card data-testid="beneficiario-mensa-card">
          <CardHeader className="py-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Utensils className="h-4 w-4 text-muted-foreground" /> Mensa
            </CardTitle>
          </CardHeader>
          <CardContent>{content}</CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abilita alla Mensa</DialogTitle>
            <DialogDescription>
              Crea un'abilitazione esplicita per la Mensa principale
              selezionata.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Mensa principale</label>
              <Select value={mensaId} onValueChange={setMensaId}>
                <SelectTrigger aria-label="Mensa principale">
                  <SelectValue placeholder="Seleziona una Mensa" />
                </SelectTrigger>
                <SelectContent>
                  {(mense.data ?? []).map((mensa) => (
                    <SelectItem key={mensa.id} value={String(mensa.id)}>
                      {mensa.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {beneficiario.areaOperativaId == null && (
                <p className="text-sm text-destructive">
                  Associa prima il beneficiario a un'Area per scegliere la
                  Mensa.
                </p>
              )}
              {beneficiario.areaOperativaId != null &&
                !mense.isLoading &&
                (mense.data ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nessuna Mensa attiva accessibile nell'Area del beneficiario.
                  </p>
                )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="mensa-data-inizio"
                >
                  Data inizio
                </label>
                <Input
                  id="mensa-data-inizio"
                  type="date"
                  value={dataInizio}
                  onChange={(event) => setDataInizio(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="mensa-data-fine"
                >
                  Data fine (facoltativa)
                </label>
                <Input
                  id="mensa-data-fine"
                  type="date"
                  min={dataInizio}
                  value={dataFine}
                  onChange={(event) => setDataFine(event.target.value)}
                />
              </div>
            </div>
            {invalidRange && (
              <p className="text-sm text-destructive">
                La data di fine non può precedere la data di inizio.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Annulla
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={
                !mensaId || !dataInizio || invalidRange || create.isPending
              }
            >
              Conferma abilitazione
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NuovaAbilitazioneMensaFields({
  enabled,
  onEnabledChange,
  areaOperativaId,
  mensaId,
  onMensaIdChange,
  dataInizio,
  onDataInizioChange,
  dataFine,
  onDataFineChange,
}: {
  enabled: boolean;
  onEnabledChange: (checked: boolean) => void;
  areaOperativaId?: number;
  mensaId: string;
  onMensaIdChange: (value: string) => void;
  dataInizio: string;
  onDataInizioChange: (value: string) => void;
  dataFine: string;
  onDataFineChange: (value: string) => void;
}) {
  const params = { attiva: true, areaOperativaId };
  const mense = useListMense(params, {
    query: {
      queryKey: getListMenseQueryKey(params),
      enabled: enabled && areaOperativaId != null,
    },
  });
  const invalidRange = dataFine !== "" && dataFine < dataInizio;

  return (
    <div
      className="rounded-md border p-3 space-y-3"
      data-testid="nuova-abilitazione-mensa"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">Mensa</h4>
          <p className="text-xs text-muted-foreground">
            Crea l'abilitazione dopo aver salvato il beneficiario.
          </p>
        </div>
        <Switch
          aria-label="Abilita alla Mensa"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
      {enabled && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Mensa principale</label>
            <Select value={mensaId} onValueChange={onMensaIdChange}>
              <SelectTrigger aria-label="Mensa principale nuova persona">
                <SelectValue placeholder="Seleziona una Mensa" />
              </SelectTrigger>
              <SelectContent>
                {(mense.data ?? []).map((mensa) => (
                  <SelectItem key={mensa.id} value={String(mensa.id)}>
                    {mensa.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {areaOperativaId == null && (
              <p className="text-sm text-destructive">
                Seleziona prima l'Area del beneficiario.
              </p>
            )}
            {areaOperativaId != null &&
              !mense.isLoading &&
              (mense.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nessuna Mensa attiva accessibile nell'Area Operativa selezionata.
                </p>
              )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="nuova-mensa-data-inizio"
              >
                Data inizio
              </label>
              <Input
                id="nuova-mensa-data-inizio"
                type="date"
                value={dataInizio}
                onChange={(event) => onDataInizioChange(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="nuova-mensa-data-fine"
              >
                Data fine (facoltativa)
              </label>
              <Input
                id="nuova-mensa-data-fine"
                type="date"
                min={dataInizio}
                value={dataFine}
                onChange={(event) => onDataFineChange(event.target.value)}
              />
            </div>
          </div>
          {invalidRange && (
            <p className="text-sm text-destructive">
              La data di fine non può precedere la data di inizio.
            </p>
          )}
        </>
      )}
    </div>
  );
}
