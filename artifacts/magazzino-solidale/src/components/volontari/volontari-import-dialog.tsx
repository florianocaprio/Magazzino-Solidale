import { useMemo, useRef, useState } from "react";
import {
  analyzeVolontariImport,
  confirmVolontariImport,
  getListVolontariQueryKey,
  type RuoloVolontario,
  type VolontariImportPreview,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Center = { id: number; nome: string };
type ImportData = {
  nome?: string | null;
  cognome?: string | null;
  matricola?: string | null;
  codiceFiscale?: string | null;
  tipoVolontario?: "PERMANENTE" | "TEMPORANEO" | null;
  dataServizio?: string | null;
  categoriaOriginale?: string | null;
  gruppoOriginale?: string | null;
};
type ImportRow = {
  numeroRiga: number;
  stato: string;
  datiNormalizzati?: ImportData;
  volontarioCandidatoId?: number | null;
  ruoloPropostoId?: number | null;
  centroPropostoId?: number | null;
  errori?: string[];
  avvisi?: string[];
};
type RowDraft = {
  inclusa: boolean;
  decisioneDuplicato: "unresolved" | "merge" | "new";
  ruolo: string;
  centro: string;
  data: ImportData;
};

const statusStyle: Record<string, string> = {
  NUOVO: "bg-sky-500/10 text-sky-700",
  AGGIORNAMENTO_CERTO: "bg-indigo-500/10 text-indigo-700",
  INVARIATO: "bg-emerald-500/10 text-emerald-700",
  POSSIBILE_DUPLICATO: "bg-amber-500/10 text-amber-800",
  ERRORE: "bg-destructive/10 text-destructive",
  DA_VERIFICARE: "bg-orange-500/10 text-orange-800",
};

function readableStatus(value: string): string {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function errorMessage(error: unknown): string {
  return (
    (error as { data?: { error?: string } })?.data?.error ??
    (error instanceof Error ? error.message : "Importazione non riuscita")
  );
}

export function VolontariImportDialog({
  open,
  onOpenChange,
  centroAscoltoId,
  ruoli,
  centri,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  centroAscoltoId?: number;
  ruoli: RuoloVolontario[];
  centri: Center[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<VolontariImportPreview | null>(null);
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const rows = (preview?.righe ?? []) as ImportRow[];

  const reset = () => {
    setFile(null);
    setPreview(null);
    setDrafts({});
    if (inputRef.current) inputRef.current.value = "";
  };

  const analyze = async () => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast({
        title: "Formato non valido",
        description: "Seleziona un file .xlsx.",
        variant: "destructive",
      });
      return;
    }
    setAnalyzing(true);
    try {
      const result = await analyzeVolontariImport(
        file,
        centroAscoltoId ? { centroAscoltoId } : undefined,
        { headers: { "x-file-name": file.name } },
      );
      setPreview(result);
      const next: Record<number, RowDraft> = {};
      for (const row of result.righe as ImportRow[]) {
        next[row.numeroRiga] = {
          inclusa: row.stato !== "ERRORE",
          decisioneDuplicato: "unresolved",
          ruolo: row.ruoloPropostoId
            ? String(row.ruoloPropostoId)
            : "unresolved",
          centro: row.centroPropostoId
            ? String(row.centroPropostoId)
            : "unresolved",
          data: { ...(row.datiNormalizzati ?? {}) },
        };
      }
      setDrafts(next);
      toast({
        title: result.replayIdempotente
          ? "File già importato"
          : "Analisi completata",
        description: `${result.numeroRighe} righe analizzate senza modificare le anagrafiche.`,
      });
    } catch (error) {
      toast({
        title: "Analisi non riuscita",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const unresolved = useMemo(
    () =>
      rows.filter((row) => {
        const draft = drafts[row.numeroRiga];
        if (!draft?.inclusa) return false;
        if (row.stato === "ERRORE") return true;
        if (
          row.stato === "POSSIBILE_DUPLICATO" &&
          draft.decisioneDuplicato === "unresolved"
        )
          return true;
        return draft.ruolo === "unresolved" || draft.centro === "unresolved";
      }).length,
    [drafts, rows],
  );

  const updateDraft = (rowNumber: number, update: Partial<RowDraft>) => {
    setDrafts((current) => ({
      ...current,
      [rowNumber]: { ...current[rowNumber], ...update },
    }));
  };

  const updateData = (
    rowNumber: number,
    key: keyof ImportData,
    value: string,
  ) => {
    setDrafts((current) => ({
      ...current,
      [rowNumber]: {
        ...current[rowNumber],
        data: { ...current[rowNumber].data, [key]: value || null },
      },
    }));
  };

  const confirm = async () => {
    if (!preview || unresolved > 0) return;
    setConfirming(true);
    try {
      const result = await confirmVolontariImport({
        importazioneId: preview.importazioneId,
        righe: rows.map((row) => {
          const draft = drafts[row.numeroRiga];
          return {
            numeroRiga: row.numeroRiga,
            inclusa: draft.inclusa,
            ...(row.stato === "POSSIBILE_DUPLICATO" &&
            draft.decisioneDuplicato === "merge"
              ? { volontarioId: row.volontarioCandidatoId }
              : {}),
            ...(row.stato === "POSSIBILE_DUPLICATO" &&
            draft.decisioneDuplicato === "new"
              ? { creaNuovo: true }
              : {}),
            ...(draft.ruolo === "create"
              ? { creaRuolo: true }
              : draft.ruolo !== "unresolved"
                ? { ruoloVolontarioId: Number(draft.ruolo) }
                : {}),
            ...(draft.centro !== "unresolved"
              ? { centroAscoltoId: Number(draft.centro) }
              : {}),
            correzioni: draft.data,
          };
        }),
      });
      const summary = result as Record<string, unknown>;
      await queryClient.invalidateQueries({
        queryKey: getListVolontariQueryKey(),
      });
      toast({
        title: summary.replayIdempotente
          ? "Importazione già applicata"
          : "Importazione completata",
        description: `Creati ${summary.creati ?? 0}, aggiornati ${summary.aggiornati ?? 0}, invariati ${summary.invariati ?? 0}, esclusi ${summary.esclusi ?? 0}, errori ${summary.errori ?? 0}.`,
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Conferma non riuscita",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[94vh] max-w-[min(96vw,1200px)] overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Importa volontari 2.0
          </DialogTitle>
          <DialogDescription>
            Analisi e anteprima precedono sempre il commit. Il file originale
            non viene conservato.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-5 px-6 py-8">
            <button
              type="button"
              className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-muted/20 p-6 text-center transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-9 w-9 text-muted-foreground" />
              <span className="font-medium">
                {file ? file.name : "Seleziona RegistroVolontariExcel.xlsx"}
              </span>
              <span className="text-sm text-muted-foreground">
                Un foglio, intestazioni ufficiali, massimo 2.000 righe.
              </span>
            </button>
            <Input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <ScrollArea className="h-[min(72vh,720px)]">
            <div className="space-y-4 px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                <div>
                  <div className="font-medium">{preview.nomeFile}</div>
                  <div className="text-sm text-muted-foreground">
                    {preview.numeroRighe} righe · hash{" "}
                    {preview.hashFile.slice(0, 12)}…
                  </div>
                </div>
                <Badge variant={unresolved ? "destructive" : "secondary"}>
                  {unresolved
                    ? `${unresolved} righe da risolvere`
                    : "Pronto per la conferma"}
                </Badge>
              </div>

              {rows.map((row) => {
                const draft = drafts[row.numeroRiga];
                if (!draft) return null;
                return (
                  <section
                    key={row.numeroRiga}
                    className={`rounded-xl border p-4 ${draft.inclusa ? "" : "opacity-60"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={draft.inclusa}
                          onCheckedChange={(checked) =>
                            updateDraft(row.numeroRiga, {
                              inclusa: checked === true,
                            })
                          }
                          aria-label={`Includi riga ${row.numeroRiga}`}
                        />
                        <div>
                          <div className="font-medium">
                            Riga {row.numeroRiga} · {draft.data.cognome}{" "}
                            {draft.data.nome}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Matricola {draft.data.matricola ?? "mancante"}
                          </div>
                        </div>
                      </div>
                      <Badge
                        className={statusStyle[row.stato] ?? ""}
                        variant="secondary"
                      >
                        {readableStatus(row.stato)}
                      </Badge>
                    </div>

                    {row.errori?.length || row.avvisi?.length ? (
                      <div className="mt-3 space-y-1 text-sm">
                        {row.errori?.map((message) => (
                          <div
                            key={message}
                            className="flex gap-2 text-destructive"
                          >
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            {message}
                          </div>
                        ))}
                        {row.avvisi?.map((message) => (
                          <div
                            key={message}
                            className="flex gap-2 text-amber-700"
                          >
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            {message}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2 text-sm text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> Nessuna anomalia
                      </div>
                    )}

                    {draft.inclusa && (
                      <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="space-y-1">
                          <Label>Matricola</Label>
                          <Input
                            value={draft.data.matricola ?? ""}
                            onChange={(event) =>
                              updateData(
                                row.numeroRiga,
                                "matricola",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Cognome</Label>
                          <Input
                            value={draft.data.cognome ?? ""}
                            onChange={(event) =>
                              updateData(
                                row.numeroRiga,
                                "cognome",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Nome</Label>
                          <Input
                            value={draft.data.nome ?? ""}
                            onChange={(event) =>
                              updateData(
                                row.numeroRiga,
                                "nome",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Codice fiscale</Label>
                          <Input
                            value={draft.data.codiceFiscale ?? ""}
                            onChange={(event) =>
                              updateData(
                                row.numeroRiga,
                                "codiceFiscale",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Ruolo / Categoria</Label>
                          <Select
                            value={draft.ruolo}
                            onValueChange={(value) =>
                              updateDraft(row.numeroRiga, { ruolo: value })
                            }
                          >
                            <SelectTrigger className="min-h-11">
                              <SelectValue placeholder="Da risolvere" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unresolved">
                                Da risolvere
                              </SelectItem>
                              {ruoli
                                .filter((role) => role.attivo)
                                .map((role) => (
                                  <SelectItem
                                    key={role.id}
                                    value={String(role.id)}
                                  >
                                    {role.nome}
                                  </SelectItem>
                                ))}
                              <SelectItem value="create">
                                Crea “
                                {draft.data.categoriaOriginale ?? "nuovo ruolo"}
                                ”
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Gruppo / Centro</Label>
                          <Select
                            value={draft.centro}
                            onValueChange={(value) =>
                              updateDraft(row.numeroRiga, { centro: value })
                            }
                          >
                            <SelectTrigger className="min-h-11">
                              <SelectValue placeholder="Da risolvere" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unresolved">
                                Da risolvere
                              </SelectItem>
                              {centri.map((center) => (
                                <SelectItem
                                  key={center.id}
                                  value={String(center.id)}
                                >
                                  {center.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Tipo volontario</Label>
                          <Select
                            value={draft.data.tipoVolontario ?? "PERMANENTE"}
                            onValueChange={(value) =>
                              updateData(
                                row.numeroRiga,
                                "tipoVolontario",
                                value,
                              )
                            }
                          >
                            <SelectTrigger className="min-h-11">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PERMANENTE">
                                Permanente
                              </SelectItem>
                              <SelectItem value="TEMPORANEO">
                                Temporaneo
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {draft.data.tipoVolontario === "TEMPORANEO" && (
                          <div className="space-y-1">
                            <Label>Data servizio</Label>
                            <Input
                              type="date"
                              value={draft.data.dataServizio ?? ""}
                              onChange={(event) =>
                                updateData(
                                  row.numeroRiga,
                                  "dataServizio",
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                        )}
                        {row.stato === "POSSIBILE_DUPLICATO" && (
                          <div className="space-y-1 md:col-span-2">
                            <Label>Decisione duplicato</Label>
                            <Select
                              value={draft.decisioneDuplicato}
                              onValueChange={(value) =>
                                updateDraft(row.numeroRiga, {
                                  decisioneDuplicato:
                                    value as RowDraft["decisioneDuplicato"],
                                })
                              }
                            >
                              <SelectTrigger className="min-h-11">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unresolved">
                                  Scegli manualmente
                                </SelectItem>
                                {row.volontarioCandidatoId && (
                                  <SelectItem value="merge">
                                    Aggiorna candidato #
                                    {row.volontarioCandidatoId}
                                  </SelectItem>
                                )}
                                <SelectItem value="new">
                                  Crea nuovo record separato
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 border-t px-6 py-4">
          {preview && (
            <Button variant="outline" className="min-h-11" onClick={reset}>
              Cambia file
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            Annulla
          </Button>
          {!preview ? (
            <Button
              className="min-h-11"
              onClick={analyze}
              disabled={!file || analyzing}
            >
              {analyzing ? "Analisi…" : "Analizza file"}
            </Button>
          ) : (
            <Button
              className="min-h-11"
              onClick={confirm}
              disabled={
                unresolved > 0 || confirming || preview.replayIdempotente
              }
            >
              {confirming
                ? "Conferma…"
                : preview.replayIdempotente
                  ? "Già importato"
                  : "Conferma importazione"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
