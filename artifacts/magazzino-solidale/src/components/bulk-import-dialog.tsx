import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";

export type BulkColumn = {
  /** Stable key handed to mapRow (independent of the translated header). */
  key: string;
  /** Translated header written to the template and matched on upload. */
  header: string;
  /** Example value shown in the template's first data row. */
  example?: string | number;
};

export type BulkServerResult = {
  creati: number;
  errori: { riga: number; messaggio: string }[];
};

export type MapRowResult<T> = { data: T } | { error: string };

type BulkImportDialogProps<T> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Localized entity name, used for title and template filename. */
  entityLabel: string;
  templateFilename: string;
  columns: BulkColumn[];
  /** Resolve a raw (header-keyed) row into a payload or a per-row error. */
  mapRow: (raw: Record<string, string>) => MapRowResult<T>;
  /** Send the valid payloads to the bulk endpoint. */
  onImport: (righe: T[]) => Promise<BulkServerResult>;
  /** Invalidate queries / refresh after a successful import. */
  onDone: () => void;
};

type ParsedRow<T> = { rowNumber: number; result: MapRowResult<T> };

function normalize(s: string): string {
  return String(s).trim().toLowerCase();
}

/** Interpret a spreadsheet cell as a boolean (multi-language truthy tokens). */
export function parseBoolCell(v: string): boolean {
  return ["sì", "si", "yes", "true", "1", "x", "oui", "ja", "y", "نعم", "vero", "wahr", "verdadero", "vrai"].includes(
    normalize(v),
  );
}

/** Find an entry in a reference list by a (case-insensitive, trimmed) display name. */
export function matchByName<T>(
  list: T[] | undefined,
  value: string,
  getName: (item: T) => string,
): T | undefined {
  const target = normalize(value);
  if (!target) return undefined;
  return list?.find((item) => normalize(getName(item)) === target);
}

export function BulkImportDialog<T>({
  open,
  onOpenChange,
  entityLabel,
  templateFilename,
  columns,
  mapRow,
  onImport,
  onDone,
}: BulkImportDialogProps<T>) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRow<T>[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ creati: number; errori: { riga: number; messaggio: string }[] } | null>(null);

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setImporting(false);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const downloadTemplate = () => {
    const header = columns.map((c) => c.header);
    const example = columns.map((c) => c.example ?? "");
    const ws = XLSX.utils.aoa_to_sheet([header, example]);
    ws["!cols"] = columns.map((c) => ({
      wch: Math.min(Math.max(String(c.header).length + 2, 12), 40),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, entityLabel.slice(0, 31) || "Template");
    XLSX.writeFile(wb, `${templateFilename}.xlsx`);
  };

  const handleFile = async (file: File) => {
    setResult(null);
    setParsed(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
      if (aoa.length < 2) {
        toast({ title: t("bulkImport.emptyFile"), variant: "destructive" });
        return;
      }
      const fileHeaders = (aoa[0] as unknown[]).map((h) => normalize(String(h)));
      const idxToKey: { idx: number; key: string }[] = [];
      for (const col of columns) {
        const idx = fileHeaders.indexOf(normalize(col.header));
        if (idx >= 0) idxToKey.push({ idx, key: col.key });
      }
      const rows: ParsedRow<T>[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const arr = aoa[i] as unknown[];
        const raw: Record<string, string> = {};
        let hasValue = false;
        for (const { idx, key } of idxToKey) {
          const v = String(arr[idx] ?? "").trim();
          raw[key] = v;
          if (v !== "") hasValue = true;
        }
        if (!hasValue) continue;
        rows.push({ rowNumber: i + 1, result: mapRow(raw) });
      }
      if (rows.length === 0) {
        toast({ title: t("bulkImport.emptyFile"), variant: "destructive" });
        return;
      }
      setParsed(rows);
    } catch {
      toast({ title: t("bulkImport.parseError"), variant: "destructive" });
    }
  };

  const handleImport = async () => {
    if (!parsed) return;
    const clientErrors = parsed
      .filter((r): r is ParsedRow<T> & { result: { error: string } } => "error" in r.result)
      .map((r) => ({ riga: r.rowNumber, messaggio: (r.result as { error: string }).error }));
    const valid = parsed.filter((r): r is ParsedRow<T> & { result: { data: T } } => "data" in r.result);

    if (valid.length === 0) {
      if (clientErrors.length > 0) {
        setResult({ creati: 0, errori: clientErrors.sort((a, b) => a.riga - b.riga) });
      } else {
        toast({ title: t("bulkImport.noValidRows"), variant: "destructive" });
      }
      return;
    }

    setImporting(true);
    try {
      const server = await onImport(valid.map((r) => r.result.data));
      // Server `riga` is the 1-based index within the submitted (valid) array;
      // remap it to the original spreadsheet row.
      const serverErrors = server.errori.map((e) => ({
        riga: valid[e.riga - 1]?.rowNumber ?? e.riga,
        messaggio: e.messaggio,
      }));
      const errori = [...clientErrors, ...serverErrors].sort((a, b) => a.riga - b.riga);
      setResult({ creati: server.creati, errori });
      onDone();
      if (server.creati > 0) toast({ title: t("bulkImport.toastDone") });
    } catch {
      toast({ title: t("bulkImport.parseError"), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const rowCount = parsed?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bulkImport.title")} — {entityLabel}</DialogTitle>
          <DialogDescription>{t("bulkImport.description")}</DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("bulkImport.step1")}</p>
              <Button variant="outline" onClick={downloadTemplate} className="gap-2">
                <Download className="h-4 w-4" /> {t("bulkImport.downloadTemplate")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("bulkImport.templateHint")}</p>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <p className="text-sm font-medium">{t("bulkImport.step2")}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="h-4 w-4" /> {fileName ? t("bulkImport.changeFile") : t("bulkImport.selectFile")}
              </Button>
              {fileName && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  <span className="truncate">{fileName}</span>
                </div>
              )}
              {parsed && (
                <p className="text-sm text-muted-foreground">
                  {t("bulkImport.rowsFound", { count: rowCount })}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span>{t("bulkImport.createdCount", { count: result.creati })}</span>
            </div>
            {result.errori.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                  <span>{t("bulkImport.errorCount", { count: result.errori.length })}</span>
                </div>
                <div className="max-h-60 overflow-y-auto rounded-md border divide-y text-sm">
                  {result.errori.map((e, i) => (
                    <div key={i} className="flex gap-2 px-3 py-2">
                      <span className="font-medium whitespace-nowrap">{t("bulkImport.rowLabel")} {e.riga}</span>
                      <span className="text-muted-foreground">{e.messaggio}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-green-600">{t("bulkImport.allOk")}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t("bulkImport.cancel")}
              </Button>
              <Button onClick={handleImport} disabled={!parsed || importing}>
                {importing ? t("bulkImport.importing") : t("bulkImport.importBtn")}
              </Button>
            </>
          ) : (
            <Button onClick={() => handleOpenChange(false)}>{t("bulkImport.close")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
