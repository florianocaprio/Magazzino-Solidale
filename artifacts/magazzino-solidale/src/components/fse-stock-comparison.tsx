import { useRef, useState } from "react";
import {
  compareFseWarehouseStock,
  getListFseImportSourcesQueryKey,
  useListFseImportSources,
  type FseStockComparison as Comparison,
} from "@workspace/api-client-react";
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
import { errorMessage } from "@/lib/api-error";

export function FseStockComparison({
  warehouseId,
  areaId,
}: {
  warehouseId: number | null;
  areaId: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const sources = useListFseImportSources({
    query: { queryKey: getListFseImportSourcesQueryKey(), enabled: open },
  });
  const available =
    sources.data?.filter(
      (source) => source.areaOperativaId === areaId && source.attiva === 1,
    ) ?? [];
  const selectedSource =
    sourceId || (available.length === 1 ? String(available[0].id) : "");
  const clearResult = () => {
    setResult(null);
    setError(null);
  };

  async function compare() {
    if (!file || !warehouseId || !selectedSource) return;
    clearResult();
    if (file.size > 10 * 1024 * 1024) {
      setError("Il file supera il limite di 10 MB.");
      return;
    }
    setBusy(true);
    try {
      setResult(
        await compareFseWarehouseStock(file, {
          magazzinoId: warehouseId,
          sourceRegistryId: Number(selectedSource),
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause, "Impossibile confrontare le giacenze."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={!warehouseId}
        title={
          !warehouseId
            ? "Seleziona prima un singolo magazzino nei filtri."
            : undefined
        }
        onClick={() => {
          clearResult();
          setOpen(true);
        }}
      >
        Verifica giacenze FSE+
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Verifica giacenze FSE+</DialogTitle>
            <DialogDescription>
              Confronta il file aggiornato con la giacenza fisica attuale di
              questo magazzino, per prodotto, fondo e lotto. Sono inclusi FSE+,
              Fondo Nazionale e Fondo Nazionale Cofinanziato. Non vengono creati
              carichi né modificate quantità.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {available.length > 1 && (
              <Select
                value={selectedSource}
                disabled={busy}
                onValueChange={(value) => {
                  setSourceId(value);
                  clearResult();
                }}
              >
                <SelectTrigger aria-label="Registro FSE+">
                  <SelectValue placeholder="Seleziona il registro FSE+" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((source) => (
                    <SelectItem key={source.id} value={String(source.id)}>
                      {source.descrizione}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {sources.isError && (
              <p role="alert">
                {errorMessage(
                  sources.error,
                  "Impossibile caricare i registri FSE+.",
                )}
              </p>
            )}
            {!sources.isLoading &&
              !sources.isError &&
              available.length === 0 && (
                <p>
                  Completa prima la prima importazione FSE+ nell’Area, per
                  creare le associazioni dei prodotti.
                </p>
              )}
            <div className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
              <Label htmlFor="fse-comparison-registry">File Registro</Label>
              <Input
                id="fse-comparison-registry"
                type="file"
                disabled
                aria-describedby="fse-comparison-registry-help"
              />
              <p id="fse-comparison-registry-help" className="mt-2 text-sm">
                Non serve per questa verifica. Per registrare nuovi carichi con
                i relativi documenti usa «Importa FSE+» e il Registro.
              </p>
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <input
                ref={picker}
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv"
                aria-label="File Giacenze FSE+"
                disabled={busy}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  clearResult();
                }}
              />
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                Seleziona file Giacenze FSE+
              </Button>
              <p className="break-words text-sm">
                {file?.name ?? "XLSX, XLS o CSV · massimo 10 MB"}
              </p>
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive p-3 text-destructive"
              >
                {error}
              </p>
            )}
            {result && (
              <section
                role="status"
                className={`space-y-3 rounded-md border p-4 ${result.allineato ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-300 bg-amber-50 dark:bg-amber-950/30"}`}
              >
                <h3 className="font-semibold">
                  {result.allineato
                    ? "Magazzino allineato"
                    : "Giacenze da verificare"}
                </h3>
                <p className="text-sm">
                  {result.righeCoincidenti} righe coincidenti su{" "}
                  {result.righeFile}. Nessuna quantità modificata.
                </p>
                <p className="text-sm">
                  Verifica del{" "}
                  {new Date(result.verificatoAt).toLocaleString("it-IT")}. Il
                  risultato si riferisce a questo momento; puoi ripetere il
                  confronto dopo altri movimenti.
                </p>
                {result.differenze.map((difference, index) => (
                  <div
                    key={index}
                    className="rounded-md border bg-background p-3 text-foreground"
                  >
                    <strong>{difference.prodotto}</strong>
                    <p className="text-sm">
                      Lotto: {difference.lotto ?? "—"} · Fondo:{" "}
                      {difference.fondo ?? "—"}
                    </p>
                    <p>
                      Nel file: {difference.quantitaFile ?? "—"}{" "}
                      {difference.unita} · In magazzino:{" "}
                      {difference.quantitaLocale ?? "—"} {difference.unita}
                    </p>
                    <p className="text-sm">{difference.motivo}</p>
                  </div>
                ))}
              </section>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Chiudi
            </Button>
            <Button
              disabled={busy || !file || !selectedSource || sources.isError}
              onClick={() => void compare()}
            >
              {busy ? "Confronto in corso…" : "Confronta giacenze"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
