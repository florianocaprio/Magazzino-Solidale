import { useEffect, useMemo, useState } from "react";
import {
  getListVolontariQueryKey,
  useReactivateVolontario,
  useRegisterVolontarioInsurance,
  useSuspendVolontario,
  type Volontario,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";

export type VolontarioOperation = "sospendi" | "riattiva" | "assicurazione";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function errorMessage(error: unknown): string {
  const data = (error as { data?: { error?: string } })?.data;
  return (
    data?.error ??
    (error instanceof Error ? error.message : "Operazione non riuscita")
  );
}

export function VolontarioOperationDialog({
  volontario,
  operation,
  onOpenChange,
}: {
  volontario: Volontario | null;
  operation: VolontarioOperation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = volontario != null && operation != null;
  const [dataEffettiva, setDataEffettiva] = useState(today());
  const [motivo, setMotivo] = useState("indisponibilita_temporanea");
  const [note, setNote] = useState("");
  const [modalita, setModalita] = useState<
    "CONTINUA_SCADENZA" | "NUOVA_DA_DATA"
  >("NUOVA_DA_DATA");
  const [dataDecorrenza, setDataDecorrenza] = useState(today());
  const [durataMesi, setDurataMesi] = useState("12");
  const [riferimentoPolizza, setRiferimentoPolizza] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const suspend = useSuspendVolontario();
  const reactivate = useReactivateVolontario();
  const insurance = useRegisterVolontarioInsurance();

  useEffect(() => {
    if (!open || !volontario) return;
    setDataEffettiva(today());
    setDataDecorrenza(today());
    setMotivo("indisponibilita_temporanea");
    setNote("");
    setModalita(
      volontario.scadenzaAssicurazione ? "CONTINUA_SCADENZA" : "NUOVA_DA_DATA",
    );
    setDurataMesi("12");
    setRiferimentoPolizza("");
  }, [open, volontario]);

  const metadata = useMemo(() => {
    if (operation === "sospendi") {
      return {
        title: "Sospendi volontario",
        description:
          "Registra una sospensione con data effettiva e motivazione. Lo storico non verrà sovrascritto.",
        icon: PauseCircle,
        submit: "Conferma sospensione",
      };
    }
    if (operation === "riattiva") {
      return {
        title: "Riattiva volontario",
        description:
          "Rimuove la sospensione manuale. Approvazione e assicurazione restano requisiti separati.",
        icon: PlayCircle,
        submit: "Conferma riattivazione",
      };
    }
    return {
      title: "Registra / Rinnova assicurazione",
      description:
        "La copertura viene aggiunta allo storico. Un'eventuale sospensione manuale resta invariata.",
      icon: ShieldCheck,
      submit: "Registra copertura",
    };
  }, [operation]);

  const pending =
    suspend.isPending || reactivate.isPending || insurance.isPending;
  const close = () => onOpenChange(false);

  const submit = async () => {
    if (!volontario || !operation) return;
    try {
      if (operation === "sospendi") {
        await suspend.mutateAsync({
          id: volontario.id,
          data: {
            versione: volontario.versione,
            dataEffettiva,
            motivo: motivo as
              | "indisponibilita_temporanea"
              | "dimissioni_cessazione"
              | "sospensione_organizzativa"
              | "altro",
            note: note || undefined,
          },
        });
        toast({ title: "Sospensione registrata" });
      } else if (operation === "riattiva") {
        const result = await reactivate.mutateAsync({
          id: volontario.id,
          data: {
            versione: volontario.versione,
            dataEffettiva,
            note: note || undefined,
          },
        });
        toast({
          title: "Riattivazione registrata",
          description: result.messaggio,
        });
      } else {
        const months = Number(durataMesi);
        if (!Number.isSafeInteger(months) || months < 1 || months > 120) {
          toast({
            title: "Durata non valida",
            description: "Inserisci da 1 a 120 mesi.",
            variant: "destructive",
          });
          return;
        }
        await insurance.mutateAsync({
          id: volontario.id,
          data: {
            versione: volontario.versione,
            modalita,
            ...(modalita === "NUOVA_DA_DATA" ? { dataDecorrenza } : {}),
            durataMesi: months,
            riferimentoPolizza: riferimentoPolizza || undefined,
            note: note || undefined,
          },
        });
        toast({ title: "Copertura assicurativa registrata" });
      }
      await queryClient.invalidateQueries({
        queryKey: getListVolontariQueryKey(),
      });
      await queryClient.invalidateQueries({
        queryKey: ["volontario-dossier", volontario.id],
      });
      close();
    } catch (error) {
      toast({
        title: "Operazione non riuscita",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  };

  const Icon = metadata.icon;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" /> {metadata.title}
          </DialogTitle>
          <DialogDescription>
            {volontario
              ? `${volontario.cognome} ${volontario.nome} · ${volontario.matricola ?? "senza matricola"}. `
              : ""}
            {metadata.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {operation !== "assicurazione" && (
            <div className="space-y-2">
              <Label htmlFor="volontario-data-effettiva">Data effettiva</Label>
              <Input
                id="volontario-data-effettiva"
                type="date"
                value={dataEffettiva}
                onChange={(event) => setDataEffettiva(event.target.value)}
              />
            </div>
          )}

          {operation === "sospendi" && (
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="indisponibilita_temporanea">
                    Indisponibilità temporanea
                  </SelectItem>
                  <SelectItem value="dimissioni_cessazione">
                    Dimissioni / cessazione
                  </SelectItem>
                  <SelectItem value="sospensione_organizzativa">
                    Sospensione organizzativa
                  </SelectItem>
                  <SelectItem value="altro">Altro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {operation === "assicurazione" && (
            <>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <CalendarClock className="h-4 w-4" /> Copertura attuale
                </div>
                <div className="mt-1 text-muted-foreground">
                  {volontario?.scadenzaAssicurazione
                    ? `Scadenza ${volontario.scadenzaAssicurazione}`
                    : "Nessuna copertura registrata"}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Modalità</Label>
                <Select
                  value={modalita}
                  onValueChange={(value) =>
                    setModalita(value as typeof modalita)
                  }
                >
                  <SelectTrigger className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="CONTINUA_SCADENZA"
                      disabled={!volontario?.scadenzaAssicurazione}
                    >
                      Continua dalla scadenza attuale
                    </SelectItem>
                    <SelectItem value="NUOVA_DA_DATA">
                      Nuova copertura da una data
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {modalita === "NUOVA_DA_DATA" && (
                <div className="space-y-2">
                  <Label htmlFor="volontario-decorrenza">Decorrenza</Label>
                  <Input
                    id="volontario-decorrenza"
                    type="date"
                    value={dataDecorrenza}
                    onChange={(event) => setDataDecorrenza(event.target.value)}
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="volontario-durata">Durata in mesi</Label>
                  <Input
                    id="volontario-durata"
                    type="number"
                    min="1"
                    max="120"
                    value={durataMesi}
                    onChange={(event) => setDurataMesi(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="volontario-polizza">
                    Riferimento polizza
                  </Label>
                  <Input
                    id="volontario-polizza"
                    value={riferimentoPolizza}
                    onChange={(event) =>
                      setRiferimentoPolizza(event.target.value)
                    }
                  />
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="volontario-operazione-note">Note</Label>
            <Textarea
              id="volontario-operazione-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={close}
          >
            Annulla
          </Button>
          <Button
            type="button"
            className="min-h-11"
            onClick={submit}
            disabled={pending || !dataEffettiva}
          >
            {pending ? "Salvataggio…" : metadata.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
