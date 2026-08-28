import { useEffect, useState } from "react";
import {
  customFetch,
  getVolontario,
  getListVolontariQueryKey,
  type Volontario,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  BookOpenCheck,
  CalendarPlus,
  Pencil,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { VolontarioOperation } from "./volontario-operation-dialog";

type OperationalState = {
  operativo: boolean;
  motivoNonOperativo: string | null;
  statoAssicurazione: string;
  scadenzaAssicurazione: string | null;
  sospesoManualmente: boolean;
  giornataTemporaneaValida: boolean | null;
};
type StateEvent = {
  id: number;
  tipoEvento: string;
  dataEffettiva: string;
  motivo?: string | null;
  note?: string | null;
  dataCreazione: string;
};
type Coverage = {
  id: number;
  dataInizio?: string | null;
  dataFine: string;
  tipoOperazione: string;
  riferimentoPolizza?: string | null;
  note?: string | null;
  annullata: boolean;
  dataCreazione: string;
};
type ServiceDay = {
  id: number;
  dataServizio: string;
  attivita?: string | null;
  stato: string;
  coperturaVerificata: boolean;
  note?: string | null;
  versione: number;
};
type CourseCatalog = {
  id: number;
  codice: string;
  titolo: string;
  ore: number;
  validitaMesi?: number | null;
  attivo: boolean;
};
type QualificationCatalog = {
  id: number;
  codice: string;
  nome: string;
  validitaMesi?: number | null;
  attivo: boolean;
};
type VolunteerCourse = {
  record: {
    id: number;
    dataCompletamento: string;
    esito: string;
    ore: number;
    dataScadenza?: string | null;
    numeroAttestato?: string | null;
  };
  catalogo: CourseCatalog;
};
type VolunteerQualification = {
  record: {
    id: number;
    dataOttenimento: string;
    dataScadenza?: string | null;
    stato: string;
  };
  catalogo: QualificationCatalog;
};
type Dossier = {
  statoOperativo: OperationalState;
  stati: StateEvent[];
  coperture: Coverage[];
  giornate: ServiceDay[];
  corsi: VolunteerCourse[];
  qualifiche: VolunteerQualification[];
};
type IdentifierHistory = {
  id: number;
  matricola: string;
  tipoIdentificativo: string;
  stato: string;
  origine: string;
  dataInizioValidita: string;
  dataFineValidita?: string | null;
};
type ConversionPreview = {
  volontarioId: number;
  versioneVolontario: number;
  matricolaAttuale: string | null;
  dataConversione: string;
  preview: {
    matricola: string;
    matricolaNormalizzata: string;
    configurazioneId: number;
    configurazioneVersione: number;
    scopeKey: string;
    versioneProgressivo: number;
    prossimoNumero: number;
  };
};
type AddKind = "giornata" | "corso" | "qualifica";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function reasonLabel(reason?: string | null): string {
  const labels: Record<string, string> = {
    IN_ATTESA_APPROVAZIONE: "In attesa di approvazione",
    APPROVAZIONE_RESPINTA: "Approvazione respinta",
    SOSPENSIONE_MANUALE: "Sospensione manuale",
    ASSICURAZIONE_SCADUTA: "Assicurazione scaduta",
    ASSICURAZIONE_MANCANTE: "Assicurazione mancante",
    ASSICURAZIONE_NON_ANCORA_VALIDA: "Assicurazione non ancora valida",
    GIORNATA_TEMPORANEA_MANCANTE: "Nessuna giornata valida per la data",
  };
  return reason
    ? (labels[reason] ?? reason.replaceAll("_", " ").toLowerCase())
    : "Nessun impedimento";
}

function Field({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-sm">{value || "—"}</div>
    </div>
  );
}

export function VolontarioDossierSheet({
  volontario,
  canManage,
  onOpenChange,
  onEdit,
  onOperation,
}: {
  volontario: Volontario | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (volontario: Volontario) => void;
  onOperation: (volontario: Volontario, operation: VolontarioOperation) => void;
}) {
  const open = volontario != null;
  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [catalogId, setCatalogId] = useState("");
  const [date, setDate] = useState(today());
  const [activity, setActivity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [conversionPreview, setConversionPreview] =
    useState<ConversionPreview | null>(null);
  const [conversionPending, setConversionPending] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const dossierQuery = useQuery({
    queryKey: ["volontario-dossier", volontario?.id],
    queryFn: () =>
      customFetch<Dossier>(`/api/volontari/${volontario!.id}/dossier`),
    enabled: volontario != null,
  });
  const detailQuery = useQuery({
    queryKey: ["volontario-detail", volontario?.id],
    queryFn: () => getVolontario(volontario!.id),
    enabled: volontario != null,
  });
  const coursesQuery = useQuery({
    queryKey: ["volontari-corsi-catalogo"],
    queryFn: () =>
      customFetch<CourseCatalog[]>("/api/volontari/formazione/corsi"),
    enabled: open && canManage,
  });
  const qualificationsQuery = useQuery({
    queryKey: ["volontari-qualifiche-catalogo"],
    queryFn: () =>
      customFetch<QualificationCatalog[]>(
        "/api/volontari/formazione/qualifiche",
      ),
    enabled: open && canManage,
  });
  const identifiersQuery = useQuery({
    queryKey: ["volontario-identificativi", volontario?.id],
    queryFn: () =>
      customFetch<IdentifierHistory[]>(
        `/api/volontari/${volontario!.id}/matricole`,
      ),
    enabled: volontario != null,
  });

  useEffect(() => {
    if (!addKind) return;
    setCatalogId("");
    setDate(today());
    setActivity("");
    setNotes("");
  }, [addKind]);

  const saveAddition = async () => {
    if (!volontario || !addKind) return;
    setSaving(true);
    try {
      if (addKind === "giornata") {
        await customFetch(`/api/volontari/${volontario.id}/giornate`, {
          method: "POST",
          body: JSON.stringify({
            dataServizio: date,
            stato: "PIANIFICATA",
            attivita: activity || undefined,
            note: notes || undefined,
          }),
        });
      } else if (addKind === "corso") {
        await customFetch(`/api/volontari/${volontario.id}/corsi`, {
          method: "POST",
          body: JSON.stringify({
            corsoId: Number(catalogId),
            dataCompletamento: date,
            note: notes || undefined,
          }),
        });
      } else {
        await customFetch(`/api/volontari/${volontario.id}/qualifiche`, {
          method: "POST",
          body: JSON.stringify({
            qualificaId: Number(catalogId),
            dataOttenimento: date,
            stato: "VALIDA",
            note: notes || undefined,
          }),
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["volontario-dossier", volontario.id],
        }),
        queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() }),
      ]);
      toast({
        title:
          addKind === "giornata"
            ? "Giornata registrata"
            : addKind === "corso"
              ? "Corso registrato"
              : "Qualifica registrata",
      });
      setAddKind(null);
    } catch (error) {
      toast({
        title: "Salvataggio non riuscito",
        description: error instanceof Error ? error.message : "Errore",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const openConversion = async () => {
    if (!volontario) return;
    setConversionPending(true);
    try {
      setConversionPreview(
        await customFetch<ConversionPreview>(
          `/api/volontari/${volontario.id}/conversione-permanente/preview`,
        ),
      );
    } catch (error) {
      toast({
        title: "Preview conversione non disponibile",
        description: error instanceof Error ? error.message : "Errore",
        variant: "destructive",
      });
    } finally {
      setConversionPending(false);
    }
  };

  const confirmConversion = async () => {
    if (!volontario || !conversionPreview) return;
    setConversionPending(true);
    try {
      await customFetch(
        `/api/volontari/${volontario.id}/conversione-permanente`,
        {
          method: "POST",
          body: JSON.stringify({
            versioneVolontario: conversionPreview.versioneVolontario,
            preview: conversionPreview.preview,
          }),
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["volontario-detail", volontario.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["volontario-dossier", volontario.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["volontario-identificativi", volontario.id],
        }),
        queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() }),
      ]);
      toast({
        title: "Conversione completata",
        description: `Nuova matricola permanente: ${conversionPreview.preview.matricola}`,
      });
      setConversionPreview(null);
    } catch (error) {
      toast({
        title: "Conversione non riuscita",
        description: error instanceof Error ? error.message : "Errore",
        variant: "destructive",
      });
    } finally {
      setConversionPending(false);
    }
  };

  const dossier = dossierQuery.data;
  const dettaglio = detailQuery.data ?? volontario;
  const state = dossier?.statoOperativo;
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader className="pr-8">
            <SheetTitle>
              {dettaglio
                ? `${dettaglio.cognome} ${dettaglio.nome}`
                : "Scheda volontario"}
            </SheetTitle>
            <SheetDescription>
              {dettaglio?.matricola ?? "Senza matricola"} ·{" "}
              {dettaglio?.tipoVolontario === "TEMPORANEO"
                ? "Temporaneo"
                : "Permanente"}
            </SheetDescription>
          </SheetHeader>

          {dettaglio && (
            <div className="mt-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                <div>
                  <Badge
                    className={
                      state?.operativo
                        ? "bg-emerald-600 hover:bg-emerald-600"
                        : "bg-destructive hover:bg-destructive"
                    }
                  >
                    {state?.operativo ? "Attivo" : "Non attivo"}
                  </Badge>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {reasonLabel(state?.motivoNonOperativo)}
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="min-h-11"
                      onClick={() => onEdit(dettaglio)}
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Modifica
                    </Button>
                    {dettaglio.sospesoManualmente ? (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => onOperation(dettaglio, "riattiva")}
                      >
                        Riattiva
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => onOperation(dettaglio, "sospendi")}
                      >
                        Sospendi
                      </Button>
                    )}
                    <Button
                      className="min-h-11"
                      onClick={() => onOperation(dettaglio, "assicurazione")}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" /> Registra /
                      Rinnova
                    </Button>
                    {dettaglio.tipoVolontario === "TEMPORANEO" && (
                      <Button
                        variant="secondary"
                        className="min-h-11"
                        onClick={openConversion}
                        disabled={conversionPending}
                      >
                        <ArrowRightLeft className="mr-2 h-4 w-4" /> Converti in
                        permanente
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <Tabs defaultValue="anagrafica">
                <div className="overflow-x-auto pb-1">
                  <TabsList className="h-11 min-w-max">
                    <TabsTrigger className="min-h-11" value="anagrafica">
                      Anagrafica
                    </TabsTrigger>
                    <TabsTrigger className="min-h-11" value="operativita">
                      Operatività
                    </TabsTrigger>
                    <TabsTrigger className="min-h-11" value="assicurazione">
                      Assicurazione
                    </TabsTrigger>
                    <TabsTrigger className="min-h-11" value="formazione">
                      Formazione
                    </TabsTrigger>
                    <TabsTrigger className="min-h-11" value="storico">
                      Storico
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="anagrafica" className="mt-4">
                  <div className="grid gap-5 rounded-xl border p-5 sm:grid-cols-2">
                    <Field label="Nome" value={dettaglio.nome} />
                    <Field label="Cognome" value={dettaglio.cognome} />
                    <Field label="Matricola" value={dettaglio.matricola} />
                    <Field
                      label="Codice fiscale"
                      value={dettaglio.codiceFiscale}
                    />
                    <Field
                      label="Data di nascita"
                      value={dettaglio.dataNascita}
                    />
                    <Field
                      label="Luogo di nascita"
                      value={dettaglio.luogoNascita}
                    />
                    <Field
                      label="Indirizzo di residenza"
                      value={dettaglio.indirizzoResidenza}
                    />
                    <Field
                      label="Indirizzo di domicilio"
                      value={
                        (dettaglio as Volontario & {
                          indirizzoDomicilio?: string | null;
                        }).indirizzoDomicilio
                      }
                    />
                    <Field label="Centro" value={dettaglio.centroAscoltoNome} />
                    <Field label="Cellulare" value={dettaglio.telefono} />
                    <Field
                      label="Telefono"
                      value={dettaglio.telefonoSecondario}
                    />
                    <Field label="Email" value={dettaglio.email} />
                    <Field label="Note" value={dettaglio.note} />
                  </div>
                </TabsContent>

                <TabsContent value="operativita" className="mt-4 space-y-4">
                  <div className="grid gap-5 rounded-xl border p-5 sm:grid-cols-2">
                    <Field
                      label="Stato operativo"
                      value={state?.operativo ? "Attivo" : "Non attivo"}
                    />
                    <Field
                      label="Motivo"
                      value={reasonLabel(state?.motivoNonOperativo)}
                    />
                    <Field
                      label="Approvazione"
                      value={dettaglio.statoApprovazione}
                    />
                    <Field
                      label="Abilitazione manuale"
                      value={
                        dettaglio.abilitatoAmministrativamente
                          ? "Abilitato"
                          : "Sospeso"
                      }
                    />
                    <Field
                      label="Tipo"
                      value={
                        dettaglio.tipoVolontario === "TEMPORANEO"
                          ? "Temporaneo"
                          : "Permanente"
                      }
                    />
                    <Field
                      label="Ruolo"
                      value={dettaglio.ruoloCatalogoNome ?? dettaglio.ruolo}
                    />
                    <Field
                      label="Patente"
                      value={dettaglio.patente ? "Sì" : "No"}
                    />
                    <Field
                      label="Mezzo personale"
                      value={dettaglio.mezzoPersonale ? "Sì" : "No"}
                    />
                    <Field
                      label="Massimo consegne/turno"
                      value={dettaglio.maxConsegneTurno}
                    />
                  </div>
                  {dettaglio.tipoVolontario === "TEMPORANEO" && canManage && (
                    <Button
                      variant="outline"
                      className="min-h-11"
                      onClick={() => setAddKind("giornata")}
                    >
                      <CalendarPlus className="mr-2 h-4 w-4" /> Registra
                      giornata di servizio
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="assicurazione" className="mt-4 space-y-3">
                  {dossierQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Caricamento storico…
                    </p>
                  ) : dossier?.coperture.length ? (
                    dossier.coperture.map((coverage) => (
                      <div key={coverage.id} className="rounded-xl border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">
                            {coverage.dataInizio ??
                              "Decorrenza storica non nota"}{" "}
                            → {coverage.dataFine}
                          </div>
                          <Badge variant="secondary">
                            {coverage.tipoOperazione.replaceAll("_", " ")}
                          </Badge>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          {coverage.riferimentoPolizza ||
                            "Nessun riferimento polizza"}
                          {coverage.note ? ` · ${coverage.note}` : ""}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Nessuna copertura registrata.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="formazione" className="mt-4 space-y-5">
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setAddKind("corso")}
                      >
                        <Plus className="mr-2 h-4 w-4" /> Registra corso
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setAddKind("qualifica")}
                      >
                        <BookOpenCheck className="mr-2 h-4 w-4" /> Registra
                        qualifica
                      </Button>
                    </div>
                  )}
                  <div>
                    <h3 className="mb-2 font-semibold">Corsi</h3>
                    {dossier?.corsi.length ? (
                      dossier.corsi.map((course) => (
                        <div
                          key={course.record.id}
                          className="mb-2 rounded-lg border p-3 text-sm"
                        >
                          <div className="font-medium">
                            {course.catalogo.codice} · {course.catalogo.titolo}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Completato {course.record.dataCompletamento} ·{" "}
                            {course.record.ore} ore
                            {course.record.dataScadenza
                              ? ` · scade ${course.record.dataScadenza}`
                              : ""}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nessun corso registrato.
                      </p>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 font-semibold">Qualifiche</h3>
                    {dossier?.qualifiche.length ? (
                      dossier.qualifiche.map((qualification) => (
                        <div
                          key={qualification.record.id}
                          className="mb-2 rounded-lg border p-3 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              {qualification.catalogo.codice} ·{" "}
                              {qualification.catalogo.nome}
                            </span>
                            <Badge variant="secondary">
                              {qualification.record.stato}
                            </Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Ottenuta {qualification.record.dataOttenimento}
                            {qualification.record.dataScadenza
                              ? ` · scade ${qualification.record.dataScadenza}`
                              : ""}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nessuna qualifica registrata.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="storico" className="mt-4 space-y-5">
                  <div>
                    <h3 className="mb-2 font-semibold">Storico matricole</h3>
                    {(identifiersQuery.data ?? []).length ? (
                      identifiersQuery.data!.map((identifier) => (
                        <div
                          key={`matricola-${identifier.id}`}
                          className="mb-2 rounded-lg border p-3 text-sm"
                        >
                          <div className="font-medium">
                            {identifier.matricola}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {identifier.tipoIdentificativo} · {identifier.origine} · dal{" "}
                            {identifier.dataInizioValidita}
                            {identifier.dataFineValidita
                              ? ` al ${identifier.dataFineValidita}`
                              : " · attiva"}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nessuno storico matricole disponibile.
                      </p>
                    )}
                  </div>
                  {dettaglio.tipoVolontario === "TEMPORANEO" && (
                    <div>
                      <h3 className="mb-2 font-semibold">
                        Giornate temporanee
                      </h3>
                      {dossier?.giornate.length ? (
                        dossier.giornate.map((day) => (
                          <div
                            key={day.id}
                            className="mb-2 rounded-lg border p-3 text-sm"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">
                                {day.dataServizio}
                                {day.attivita ? ` · ${day.attivita}` : ""}
                              </span>
                              <Badge variant="secondary">{day.stato}</Badge>
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              Copertura{" "}
                              {day.coperturaVerificata
                                ? "verificata"
                                : "da verificare"}
                              {day.note ? ` · ${day.note}` : ""}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Nessuna giornata registrata.
                        </p>
                      )}
                    </div>
                  )}
                  <div>
                    <h3 className="mb-2 font-semibold">Stati amministrativi</h3>
                    {dossier?.stati.length ? (
                      dossier.stati.map((event) => (
                        <div
                          key={event.id}
                          className="mb-2 rounded-lg border p-3 text-sm"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {event.dataEffettiva} · {event.tipoEvento}
                            </span>
                            <Badge variant="outline">#{event.id}</Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {event.motivo ?? "Senza motivo"}
                            {event.note ? ` · ${event.note}` : ""}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nessun evento di stato.
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={conversionPreview != null}
        onOpenChange={(next) => {
          if (!next) setConversionPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Converti in permanente</DialogTitle>
            <DialogDescription>
              La matricola temporanea resterà nello storico. La preview non
              consuma il progressivo e verrà ricontrollata alla conferma.
            </DialogDescription>
          </DialogHeader>
          {conversionPreview && (
            <div className="space-y-3 rounded-xl border p-4 text-sm">
              <Field
                label="Matricola attuale"
                value={conversionPreview.matricolaAttuale}
              />
              <Field
                label="Nuova matricola permanente"
                value={conversionPreview.preview.matricola}
              />
              <Field
                label="Data conversione"
                value={conversionPreview.dataConversione}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConversionPreview(null)}
            >
              Annulla
            </Button>
            <Button onClick={confirmConversion} disabled={conversionPending}>
              Conferma conversione
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addKind != null}
        onOpenChange={(next) => {
          if (!next) setAddKind(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addKind === "giornata"
                ? "Registra giornata di servizio"
                : addKind === "corso"
                  ? "Registra corso"
                  : "Registra qualifica"}
            </DialogTitle>
            <DialogDescription>
              I dati vengono aggiunti allo storico del volontario.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {addKind === "corso" && (
              <div className="space-y-2">
                <Label>Corso</Label>
                <Select value={catalogId} onValueChange={setCatalogId}>
                  <SelectTrigger className="min-h-11">
                    <SelectValue placeholder="Seleziona corso" />
                  </SelectTrigger>
                  <SelectContent>
                    {coursesQuery.data
                      ?.filter((item) => item.attivo)
                      .map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.codice} · {item.titolo}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {coursesQuery.data &&
                  coursesQuery.data.every((item) => !item.attivo) && (
                    <p className="text-sm text-muted-foreground">
                      Nessun corso configurato
                    </p>
                  )}
              </div>
            )}
            {addKind === "qualifica" && (
              <div className="space-y-2">
                <Label>Qualifica</Label>
                <Select value={catalogId} onValueChange={setCatalogId}>
                  <SelectTrigger className="min-h-11">
                    <SelectValue placeholder="Seleziona qualifica" />
                  </SelectTrigger>
                  <SelectContent>
                    {qualificationsQuery.data
                      ?.filter((item) => item.attivo)
                      .map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.codice} · {item.nome}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {qualificationsQuery.data &&
                  qualificationsQuery.data.every((item) => !item.attivo) && (
                    <p className="text-sm text-muted-foreground">
                      Nessuna qualifica configurata
                    </p>
                  )}
              </div>
            )}
            <div className="space-y-2">
              <Label>
                {addKind === "giornata"
                  ? "Data servizio"
                  : addKind === "corso"
                    ? "Data completamento"
                    : "Data ottenimento"}
              </Label>
              <Input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            {addKind === "giornata" && (
              <div className="space-y-2">
                <Label>Attività</Label>
                <Input
                  value={activity}
                  onChange={(event) => setActivity(event.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setAddKind(null)}
            >
              Annulla
            </Button>
            <Button
              className="min-h-11"
              onClick={saveAddition}
              disabled={
                saving || !date || (addKind !== "giornata" && !catalogId)
              }
            >
              {saving ? "Salvataggio…" : "Registra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
