import { useState } from "react";
import {
  getListCarichiQueryKey,
  useListLotti,
  useListCarichi,
  useListMagazzini,
  useListProdotti,
  useListFornitori,
  useCreateCarico,
  useRettificaLotto,
  type Lotto,
  type FondoOrigine,
  type OrigineCarico,
  type OrigineCaricoManuale,
  getListGiacenzeQueryKey,
  getListLottiQueryKey,
  getListMovimentiQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ExportButtons } from "@/components/export-buttons";
import {
  Calendar,
  Filter,
  Plus,
  Info,
  ClipboardPen,
  Trash2,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { todayEuropeRome } from "@/lib/europe-rome";
import { AgeaImportWizard } from "@/components/agea-import-wizard";
import { UnsavedChangesDialog, useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";

type DraftRiga = {
  key: number;
  prodottoId: string;
  quantitaOperativa: string;
  fondoOrigine: FondoOrigine;
  codiceLotto: string;
  dataScadenza: string;
  quantitaPezzi: string;
  quantitaKgLt: string;
  fattoreKgLtPezzo: string;
};

let draftRigaKey = 0;
const nuovaRiga = (): DraftRiga => ({
  key: ++draftRigaKey,
  prodottoId: "",
  quantitaOperativa: "",
  fondoOrigine: "NESSUN_FONDO",
  codiceLotto: "",
  dataScadenza: "",
  quantitaPezzi: "",
  quantitaKgLt: "",
  fattoreKgLtPezzo: "",
});

const originiCarico: Array<{ value: OrigineCaricoManuale; label: string }> = [
  { value: "RACCOLTA_ALIMENTARE", label: "Raccolta alimentare" },
  { value: "DONAZIONE", label: "Donazione" },
  { value: "ACQUISTO", label: "Acquisto" },
  { value: "FORNITORE", label: "Fornitore" },
  { value: "ALTRO", label: "Altro" },
];

const fondiOrigine: Array<{ value: FondoOrigine; label: string }> = [
  { value: "NESSUN_FONDO", label: "Nessun fondo" },
  { value: "FSE_PLUS", label: "FSE+" },
  { value: "FONDO_NAZIONALE", label: "Fondo nazionale" },
  {
    value: "FONDO_NAZIONALE_COFINANZIATO",
    label: "Fondo nazionale cofinanziato",
  },
];

const quantitaValida = (value: string) =>
  /^\d+(?:[.,]\d{1,6})?$/.test(value.trim()) &&
  !/^0+(?:[.,]0+)?$/.test(value.trim());

const fattoreValido = (value: string) =>
  /^\d+(?:[.,]\d{1,9})?$/.test(value.trim()) &&
  !/^0+(?:[.,]0+)?$/.test(value.trim());

function NuovoCaricoDialog({ onClose }: { onClose: () => void }) {
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  const { data: fornitori } = useListFornitori();
  const createCarico = useCreateCarico();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [magazzinoId, setMagazzinoId] = useState("");
  const [origineCarico, setOrigineCarico] = useState<OrigineCaricoManuale>(
    "RACCOLTA_ALIMENTARE",
  );
  const [dataCarico, setDataCarico] = useState(
    todayEuropeRome(),
  );
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [dataDocumento, setDataDocumento] = useState("");
  const [fornitoreId, setFornitoreId] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState<DraftRiga[]>([nuovaRiga()]);
  const [errori, setErrori] = useState<string[]>([]);
  const [idempotencyKey] = useState(
    () => `ui-carico-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const isDirty = !!magazzinoId || origineCarico !== "RACCOLTA_ALIMENTARE" || dataCarico !== todayEuropeRome() || !!numeroDocumento || !!dataDocumento || !!fornitoreId || !!descrizione || !!note || righe.length !== 1 || righe.some((riga) => !!riga.prodottoId || !!riga.quantitaOperativa || riga.fondoOrigine !== "NESSUN_FONDO" || !!riga.codiceLotto || !!riga.dataScadenza || !!riga.quantitaPezzi || !!riga.quantitaKgLt || !!riga.fattoreKgLtPezzo);
  const unsavedGuard = useUnsavedChangesGuard(isDirty);
  const requestClose = () => unsavedGuard.requestClose(onClose);

  const aggiornaRiga = (key: number, patch: Partial<DraftRiga>) => {
    setRighe((current) =>
      current.map((riga) => (riga.key === key ? { ...riga, ...patch } : riga)),
    );
  };

  const validazione = () => {
    const next: string[] = [];
    if (!magazzinoId) next.push("Seleziona il magazzino.");
    if (!dataCarico) next.push("Indica la data di carico.");
    if (origineCarico === "FORNITORE" && !fornitoreId)
      next.push("Seleziona il fornitore.");
    righe.forEach((riga, index) => {
      const prodotto = prodotti?.find(
        (item) => item.id === Number(riga.prodottoId),
      );
      if (!prodotto) next.push(`Riga ${index + 1}: seleziona il prodotto.`);
      if (!quantitaValida(riga.quantitaOperativa))
        next.push(
          `Riga ${index + 1}: quantità positiva con massimo 6 decimali richiesta.`,
        );
      if (riga.quantitaPezzi && !quantitaValida(riga.quantitaPezzi))
        next.push(`Riga ${index + 1}: pezzi non validi.`);
      if (riga.quantitaKgLt && !quantitaValida(riga.quantitaKgLt))
        next.push(`Riga ${index + 1}: Kg/Lt non validi.`);
      if (riga.fattoreKgLtPezzo && !fattoreValido(riga.fattoreKgLtPezzo))
        next.push(
          `Riga ${index + 1}: fattore non valido (massimo 9 decimali).`,
        );
      if (prodotto?.gestioneLotto && !riga.codiceLotto.trim())
        next.push(`Riga ${index + 1}: codice lotto obbligatorio.`);
      if (prodotto?.gestioneScadenza && !riga.dataScadenza)
        next.push(`Riga ${index + 1}: scadenza obbligatoria.`);
    });
    setErrori(next);
    return next.length === 0;
  };

  const submit = () => {
    if (!validazione()) return;
    createCarico.mutate(
      {
        data: {
          magazzinoId: Number(magazzinoId),
          origineCarico,
          dataCarico,
          numeroDocumento: numeroDocumento.trim() || null,
          dataDocumento: dataDocumento || null,
          fornitoreId: fornitoreId ? Number(fornitoreId) : null,
          descrizione: descrizione.trim() || null,
          note: note.trim() || null,
          idempotencyKey,
          righe: righe.map((riga) => {
            const prodotto = prodotti!.find(
              (item) => item.id === Number(riga.prodottoId),
            )!;
            return {
              prodottoId: prodotto.id,
              fondoOrigine: riga.fondoOrigine,
              quantitaOperativa: riga.quantitaOperativa.replace(",", "."),
              unitaMisuraOperativa: prodotto.unitaMisura,
              codiceLotto: prodotto.gestioneLotto
                ? riga.codiceLotto.trim()
                : null,
              dataScadenza: prodotto.gestioneScadenza
                ? riga.dataScadenza
                : null,
              quantitaPezzi: riga.quantitaPezzi
                ? riga.quantitaPezzi.replace(",", ".")
                : null,
              quantitaKgLt: riga.quantitaKgLt
                ? riga.quantitaKgLt.replace(",", ".")
                : null,
              fattoreKgLtPezzo: riga.fattoreKgLtPezzo
                ? riga.fattoreKgLtPezzo.replace(",", ".")
                : null,
            };
          }),
        },
      },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListCarichiQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getListGiacenzeQueryKey(),
          });
          queryClient.invalidateQueries({ queryKey: getListLottiQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getListMovimentiQueryKey(),
          });
          toast({
            title: result.replay
              ? "Carico già registrato"
              : "Carico contabilizzato",
            description: `${result.righe.length} righe confermate senza salvataggi parziali.`,
          });
          onClose();
        },
        onError: (error) => {
          const message =
            (error as { data?: { error?: string } })?.data?.error ??
            "Correggi i dati e riprova.";
          setErrori([message]);
          toast({
            title: "Carico non registrato",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) requestClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-5xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Nuovo carico multi-riga</SheetTitle>
          <SheetDescription>
            Testata e righe vengono validate e contabilizzate in un’unica
            transazione.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Il volontario registra il documento; le Partite vengono create o
            incrementate automaticamente.
          </span>
        </div>
        <div className="mt-5 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Magazzino *</Label>
              <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                <SelectTrigger aria-label="Magazzino carico">
                  <SelectValue placeholder="Seleziona" />
                </SelectTrigger>
                <SelectContent>
                  {magazzini
                    ?.filter((m) => m.stato === "attivo")
                    .map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Provenienza *</Label>
              <Select
                value={origineCarico}
                onValueChange={(value) => {
                  setOrigineCarico(value as OrigineCaricoManuale);
                  if (value === "RACCOLTA_ALIMENTARE") setFornitoreId("");
                }}
              >
                <SelectTrigger aria-label="Provenienza carico">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {originiCarico.map((origine) => (
                    <SelectItem key={origine.value} value={origine.value}>
                      {origine.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data carico *</Label>
              <Input
                type="date"
                aria-label="Data carico"
                value={dataCarico}
                onChange={(event) => setDataCarico(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Numero documento</Label>
              <Input
                value={numeroDocumento}
                aria-label="Numero documento carico"
                onChange={(event) => setNumeroDocumento(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Data documento</Label>
              <Input
                type="date"
                aria-label="Data documento carico"
                value={dataDocumento}
                onChange={(event) => setDataDocumento(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>
                Fornitore {origineCarico === "FORNITORE" ? "*" : ""}
              </Label>
              <Select
                value={fornitoreId || "none"}
                onValueChange={(value) =>
                  setFornitoreId(value === "none" ? "" : value)
                }
                disabled={origineCarico === "RACCOLTA_ALIMENTARE"}
              >
                <SelectTrigger aria-label="Fornitore carico">
                  <SelectValue placeholder="Non applicabile" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Non applicabile</SelectItem>
                  {fornitori
                    ?.filter((f) => f.attivo)
                    .map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Descrizione / evento</Label>
              <Input
                placeholder={
                  origineCarico === "RACCOLTA_ALIMENTARE"
                    ? "Es. Raccolta PAM 29/08/2026"
                    : undefined
                }
                value={descrizione}
                aria-label="Descrizione carico"
                onChange={(event) => setDescrizione(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                rows={1}
                aria-label="Note carico"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Righe del carico</h3>
                <p className="text-sm text-muted-foreground">
                  Quantità conservate con precisione fino a 6 decimali.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRighe((current) => [...current, nuovaRiga()])}
              >
                <Plus className="mr-1 h-4 w-4" /> Aggiungi riga
              </Button>
            </div>
            {righe.map((riga, index) => {
              const prodotto = prodotti?.find(
                (item) => item.id === Number(riga.prodottoId),
              );
              return (
                <div key={riga.key} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Riga {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Rimuovi riga ${index + 1}`}
                      disabled={righe.length === 1}
                      onClick={() =>
                        setRighe((current) =>
                          current.filter((item) => item.key !== riga.key),
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label>Prodotto *</Label>
                      <Select
                        value={riga.prodottoId}
                        onValueChange={(value) =>
                          aggiornaRiga(riga.key, {
                            prodottoId: value,
                            codiceLotto: "",
                            dataScadenza: "",
                          })
                        }
                      >
                        <SelectTrigger aria-label={`Prodotto riga ${index + 1}`}>
                          <SelectValue placeholder="Seleziona prodotto" />
                        </SelectTrigger>
                        <SelectContent>
                          {prodotti
                            ?.filter((p) => p.attivo)
                            .map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.nome}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Quantità operativa *</Label>
                      <Input
                        inputMode="decimal"
                        aria-label={`Quantità operativa riga ${index + 1}`}
                        placeholder="0,000000"
                        value={riga.quantitaOperativa}
                        onChange={(event) =>
                          aggiornaRiga(riga.key, {
                            quantitaOperativa: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unità</Label>
                      <Input value={prodotto?.unitaMisura ?? ""} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label>Fondo *</Label>
                      <Select
                        value={riga.fondoOrigine}
                        onValueChange={(value) =>
                          aggiornaRiga(riga.key, {
                            fondoOrigine: value as FondoOrigine,
                          })
                        }
                      >
                        <SelectTrigger aria-label={`Fondo riga ${index + 1}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {fondiOrigine.map((fondo) => (
                            <SelectItem key={fondo.value} value={fondo.value}>
                              {fondo.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {prodotto?.gestioneLotto && (
                      <div className="space-y-2">
                        <Label>Codice lotto *</Label>
                        <Input
                          value={riga.codiceLotto}
                          aria-label={`Codice lotto riga ${index + 1}`}
                          onChange={(event) =>
                            aggiornaRiga(riga.key, {
                              codiceLotto: event.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                    {prodotto?.gestioneScadenza && (
                      <div className="space-y-2">
                        <Label>Scadenza *</Label>
                        <Input
                          type="date"
                          aria-label={`Scadenza riga ${index + 1}`}
                          value={riga.dataScadenza}
                          onChange={(event) =>
                            aggiornaRiga(riga.key, {
                              dataScadenza: event.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Pezzi</Label>
                      <Input
                        inputMode="decimal"
                        aria-label={`Pezzi riga ${index + 1}`}
                        value={riga.quantitaPezzi}
                        onChange={(event) =>
                          aggiornaRiga(riga.key, {
                            quantitaPezzi: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Kg/Lt</Label>
                      <Input
                        inputMode="decimal"
                        aria-label={`Kg/Lt riga ${index + 1}`}
                        value={riga.quantitaKgLt}
                        onChange={(event) =>
                          aggiornaRiga(riga.key, {
                            quantitaKgLt: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Fattore Kg/Lt per pezzo</Label>
                      <Input
                        inputMode="decimal"
                        aria-label={`Fattore Kg/Lt riga ${index + 1}`}
                        placeholder="0,000000000"
                        value={riga.fattoreKgLtPezzo}
                        onChange={(event) =>
                          aggiornaRiga(riga.key, {
                            fattoreKgLtPezzo: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <h3 className="font-semibold">Riepilogo prima della conferma</h3>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                {righe.length} righe ·{" "}
                {magazzini?.find((m) => m.id === Number(magazzinoId))?.nome ??
                  "magazzino non selezionato"}{" "}
                · {originiCarico.find((o) => o.value === origineCarico)?.label}
              </div>
            </CardContent>
          </Card>
          {errori.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <ul className="list-disc pl-5">
                {errori.map((errore) => (
                  <li key={errore}>{errore}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={requestClose}>
              Annulla
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={createCarico.isPending}
            >
              {createCarico.isPending
                ? "Contabilizzazione…"
                : "Conferma carico"}
            </Button>
          </div>
        </div>
        <UnsavedChangesDialog guard={unsavedGuard} />
      </SheetContent>
    </Sheet>
  );
}

function RettificaDialog({
  lotto,
  onClose,
}: {
  lotto: Lotto;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [causale, setCausale] = useState<
    "inventario_fisico" | "errore_registrazione" | "deterioramento" | "altro"
  >("inventario_fisico");
  const [motivazione, setMotivazione] = useState("");
  const [note, setNote] = useState("");
  const mutation = useRettificaLotto();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const valid =
    /^-?\d+(?:[.,]\d{1,6})?$/.test(delta.trim()) &&
    !/^-?0+(?:[.,]0+)?$/.test(delta.trim()) &&
    (causale !== "altro" || motivazione.trim().length > 0);

  const submit = () => {
    if (!valid) return;
    mutation.mutate(
      {
        id: lotto.id,
        data: {
          delta: delta.replace(",", "."),
          causale,
          motivazione: motivazione || undefined,
          note: note || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLottiQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getListGiacenzeQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getListMovimentiQueryKey(),
          });
          toast({ title: "Rettifica inventariale registrata" });
          onClose();
        },
        onError: (error) =>
          toast({
            title: "Rettifica non registrata",
            description:
              (error as { data?: { error?: string } })?.data?.error ??
              "Verifica quantità e causale.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rettifica inventariale</DialogTitle>
          <DialogDescription>
            Lotto {lotto.codiceLotto ?? `#${lotto.id}`} · residuo attuale{" "}
            {lotto.quantitaResidua}. Usa un valore positivo per aumentare e
            negativo per diminuire.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rettifica-delta">Variazione quantità</Label>
            <Input
              id="rettifica-delta"
              inputMode="decimal"
              placeholder="0,000001"
              value={delta}
              onChange={(event) => setDelta(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Causale</Label>
            <Select
              value={causale}
              onValueChange={(value) => setCausale(value as typeof causale)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inventario_fisico">
                  Inventario fisico
                </SelectItem>
                <SelectItem value="errore_registrazione">
                  Errore di registrazione
                </SelectItem>
                <SelectItem value="deterioramento">
                  Deterioramento / rettifica
                </SelectItem>
                <SelectItem value="altro">Altro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {causale === "altro" && (
            <div className="space-y-2">
              <Label htmlFor="rettifica-motivazione">
                Motivazione obbligatoria
              </Label>
              <Input
                id="rettifica-motivazione"
                value={motivazione}
                onChange={(event) => setMotivazione(event.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="rettifica-note">Note</Label>
            <Input
              id="rettifica-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={submit} disabled={!valid || mutation.isPending}>
            Registra rettifica
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Lotti() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [magazzinoId, setMagazzinoId] = useState<string>("all");
  const [prodottoId, setProdottoId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<
    "carichi" | "partite" | "scadenza" | "agea"
  >("carichi");
  const [nuovoOpen, setNuovoOpen] = useState(false);
  const [rettificaLotto, setRettificaLotto] = useState<Lotto | null>(null);

  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  const { data: carichi, isLoading: carichiLoading } = useListCarichi({
    magazzinoId: magazzinoId !== "all" ? Number(magazzinoId) : undefined,
  });

  const { data: lotti, isLoading } = useListLotti({
    magazzinoId: magazzinoId !== "all" ? Number(magazzinoId) : undefined,
    prodottoId: prodottoId !== "all" ? Number(prodottoId) : undefined,
    inScadenza: activeTab === "scadenza" || undefined,
  });

  const getExpiryStatus = (dateStr: string | null | undefined) => {
    if (!dateStr)
      return {
        key: "noExpiry",
        label: t("lotti.statusNoExpiry"),
        color: "text-muted-foreground",
        badge: "bg-gray-100 text-gray-800",
      };

    const expiryDate = new Date(dateStr);
    const daysLeft = differenceInDays(expiryDate, new Date());

    if (daysLeft < 0)
      return {
        key: "expired",
        label: t("lotti.statusExpired"),
        color: "text-destructive font-bold",
        badge: "bg-destructive text-destructive-foreground",
      };
    if (daysLeft <= 7)
      return {
        key: "critical",
        label: t("lotti.statusCritical"),
        color: "text-destructive font-semibold",
        badge: "bg-destructive/90 text-destructive-foreground",
      };
    if (daysLeft <= 30)
      return {
        key: "warning",
        label: t("lotti.statusWarning"),
        color: "text-amber-600 font-medium",
        badge: "bg-amber-500 text-white",
      };
    return {
      key: "regular",
      label: t("lotti.statusRegular"),
      color: "text-green-600",
      badge: "bg-green-500/20 text-green-700",
    };
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Carichi e Lotti</h1>
          <p className="text-muted-foreground">
            Documenti di carico, Partite contabili e scadenze del magazzino.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={lotti ?? []}
            columns={[
              {
                header: t("lotti.colCodLotto"),
                accessor: (l) => l.codiceLotto,
              },
              {
                header: t("lotti.colProdotto"),
                accessor: (l) => l.prodottoNome,
              },
              {
                header: t("lotti.colMagazzino"),
                accessor: (l) => l.magazzinoNome,
              },
              {
                header: t("lotti.colProvenienza"),
                accessor: (l) => (l.fsePlus ? "FSE+" : (l.fornitoreNome ?? "")),
              },
              {
                header: t("lotti.colDataScadenza"),
                accessor: (l) =>
                  l.dataScadenza
                    ? new Date(l.dataScadenza).toLocaleDateString("it-IT")
                    : "",
              },
              {
                header: t("lotti.colQtaIniziale"),
                accessor: (l) =>
                  l.quantitaCaricata != null
                    ? parseFloat(String(l.quantitaCaricata))
                    : "",
              },
              {
                header: t("lotti.colQtaResidua"),
                accessor: (l) =>
                  l.quantitaResidua != null
                    ? parseFloat(String(l.quantitaResidua))
                    : "",
              },
            ]}
            filename="lotti"
            title={t("lotti.exportTitle")}
            orientation="landscape"
          />
          {hasPermission("magazzino.stock.receive") && (
            <Button onClick={() => setNuovoOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nuovo carico
            </Button>
          )}
        </div>
      </div>

      {nuovoOpen && <NuovoCaricoDialog onClose={() => setNuovoOpen(false)} />}
      {rettificaLotto && (
        <RettificaDialog
          lotto={rettificaLotto}
          onClose={() => setRettificaLotto(null)}
        />
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as typeof activeTab)}
      >
        <TabsList>
          <TabsTrigger value="carichi">Carichi</TabsTrigger>
          <TabsTrigger value="partite">Partite/Lotti</TabsTrigger>
          <TabsTrigger value="scadenza">In scadenza</TabsTrigger>
          {hasPermission("magazzino.agea.view") && (
            <TabsTrigger value="agea">Import AGEA/SIFEAD</TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {activeTab === "agea" ? (
        <AgeaImportWizard />
      ) : activeTab === "carichi" ? (
        <Card>
          <CardHeader className="py-4 border-b bg-muted/20">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Tutti i magazzini" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i magazzini</SelectItem>
                  {magazzini?.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Provenienza</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Magazzino</TableHead>
                  <TableHead>Descrizione / evento</TableHead>
                  <TableHead>Fornitore</TableHead>
                  <TableHead className="text-right">Righe</TableHead>
                  <TableHead>Stato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carichiLoading ? (
                  Array(4)
                    .fill(0)
                    .map((_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={8}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                ) : carichi?.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-32 text-center text-muted-foreground"
                    >
                      Nessun carico trovato.
                    </TableCell>
                  </TableRow>
                ) : (
                  carichi?.map((carico) => (
                    <TableRow key={carico.id}>
                      <TableCell>
                        {format(new Date(carico.dataCarico), "dd MMM yyyy", {
                          locale: it,
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {originiCarico.find(
                            (o) => o.value === carico.origineCarico,
                          )?.label ?? carico.origineCarico}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {carico.numeroDocumento ?? "—"}
                      </TableCell>
                      <TableCell>{carico.magazzinoNome}</TableCell>
                      <TableCell>{carico.descrizione ?? "—"}</TableCell>
                      <TableCell>{carico.fornitoreNome ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {carico.numeroRighe ?? 0}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            carico.stato === "confermato"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {carico.stato}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="py-4 border-b bg-muted/20">
            <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end sm:items-center">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t("lotti.allWarehouses")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("lotti.allWarehouses")}
                    </SelectItem>
                    {magazzini?.map((m) => (
                      <SelectItem key={m.id} value={m.id.toString()}>
                        {m.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Select value={prodottoId} onValueChange={setProdottoId}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder={t("lotti.allProducts")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("lotti.allProducts")}
                    </SelectItem>
                    {prodotti
                      ?.filter((p) => p.attivo)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>
                          {p.nome}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {activeTab === "scadenza" && (
                <Badge
                  variant="outline"
                  className="ml-auto border-amber-500/30 bg-amber-500/10 text-amber-700"
                >
                  Scadenza entro 30 giorni
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("lotti.colCodLotto")}</TableHead>
                  <TableHead>{t("lotti.colProdotto")}</TableHead>
                  <TableHead>{t("lotti.colMagazzino")}</TableHead>
                  <TableHead>{t("lotti.colProvenienza")}</TableHead>
                  <TableHead>{t("lotti.colDataScadenza")}</TableHead>
                  <TableHead className="text-right">
                    {t("lotti.colQtaIniziale")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("lotti.colQtaResidua")}
                  </TableHead>
                  <TableHead className="w-[100px] text-center">
                    {t("lotti.colStato")}
                  </TableHead>
                  {hasPermission("magazzino.stock.adjust") && (
                    <TableHead className="w-[120px]" />
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5)
                    .fill(0)
                    .map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-5 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-40" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-12 ml-auto" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-12 ml-auto" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-6 w-20 mx-auto rounded-full" />
                        </TableCell>
                      </TableRow>
                    ))
                ) : lotti?.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={hasPermission("magazzino.stock.adjust") ? 9 : 8}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {t("lotti.noResults")}
                    </TableCell>
                  </TableRow>
                ) : (
                  lotti?.map((lotto) => {
                    const status = getExpiryStatus(lotto.dataScadenza);
                    // Highlight row if critical
                    const isCritical =
                      status.key === "critical" || status.key === "expired";
                    const isWarning = status.key === "warning";

                    return (
                      <TableRow
                        key={lotto.id}
                        className={
                          isCritical
                            ? "bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20"
                            : isWarning
                              ? "bg-amber-50/30 hover:bg-amber-50 dark:bg-amber-950/20"
                              : ""
                        }
                      >
                        <TableCell className="font-mono text-xs font-medium">
                          {lotto.codiceLotto || (
                            <span className="text-muted-foreground italic">
                              {t("lotti.na")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {lotto.prodottoNome}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {lotto.magazzinoNome}
                        </TableCell>
                        <TableCell>
                          {lotto.fondoOrigine === "FSE_PLUS" ? (
                            <Badge
                              variant="outline"
                              className="border-none bg-blue-500/15 text-blue-700"
                            >
                              FSE+
                            </Badge>
                          ) : lotto.fondoOrigine ? (
                            <Badge variant="outline">
                              {fondiOrigine.find(
                                (fondo) => fondo.value === lotto.fondoOrigine,
                              )?.label ?? lotto.fondoOrigine}
                            </Badge>
                          ) : lotto.fornitoreNome ? (
                            <span className="text-sm">
                              {lotto.fornitoreNome}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm italic">
                              {t("lotti.na")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {lotto.dataScadenza ? (
                            <div
                              className={`flex items-center gap-2 text-sm ${status.color}`}
                            >
                              <Calendar className="h-3.5 w-3.5" />
                              {format(
                                new Date(lotto.dataScadenza),
                                "dd MMM yyyy",
                                { locale: it },
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm italic">
                              {t("lotti.notProvided")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {lotto.quantitaCaricata}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {lotto.quantitaResidua}
                        </TableCell>
                        <TableCell className="text-center">
                          {lotto.dataScadenza && (
                            <Badge
                              variant="outline"
                              className={`border-none ${status.badge}`}
                            >
                              {status.label}
                            </Badge>
                          )}
                        </TableCell>
                        {hasPermission("magazzino.stock.adjust") && (
                          <TableCell>
                            {magazzini?.find((m) => m.id === lotto.magazzinoId)
                              ?.stato === "attivo" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                onClick={() => setRettificaLotto(lotto)}
                              >
                                <ClipboardPen className="h-3.5 w-3.5" />{" "}
                                Rettifica
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
