import { registerBlocco07 } from "@/lib/i18n/namespaces/blocco07";
import i18n from "@/lib/i18n";
registerBlocco07(i18n);
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  useExportBeneficiariFse,
  useImportBeneficiariFse,
  usePreflightBeneficiariFseExport,
  usePreviewBeneficiariFse,
  type BeneficiariFseImportResolution,
  type BeneficiariFseImportResult,
  type BeneficiariFsePreviewResult,
  type BeneficiariFseExportPreflight,
  type BeneficiariFseWorkbookUpload,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileDown, Upload } from "lucide-react";
import { todayEuropeRome } from "@/lib/europe-rome";
import { useTranslation } from "react-i18next";

type Centro = {
  id: number;
  nome: string;
  areaOperativaId?: number | null;
  areaOperativaNome?: string | null;
  attivo?: boolean;
};

type FilePayload = BeneficiariFseWorkbookUpload & { file: File };

export const FSE_BENEFICIARI_HEADERS_UI = [
  "Nome Referente fascicolo",
  "Cognome Referente fascicolo",
  "Codice fascicolo",
  "Data di presa in carico",
  "Numero componenti fascicolo",
  "Tipologia di Attività",
  "Stato attuale",
  "Donne",
  "Uomini",
  "Età<18",
  "Età 18-29",
  "Età 30-64",
  "Età>=65",
  "Origine straniera e minoranze",
  "Disabili",
  "Cittadini di Paesi Terzi",
  "Senzatetto o colpiti da esclusione abitativa",
] as const;

function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: string; errori?: string[] } })?.data;
  return [...new Set([data?.error ?? (error instanceof Error ? error.message : fallback), ...(data?.errori ?? [])])].join(" ");
}

export function FseBeneficiariActions({
  centri,
  aree,
  lockedCentroId,
  lockedAreaId,
  canImport,
  canExport,
  onImported,
}: {
  centri: Centro[];
  aree?: { id: number; nome: string; attivo?: boolean }[];
  lockedCentroId: number | null;
  lockedAreaId?: number | null;
  canImport: boolean;
  canExport: boolean;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const previewMutation = usePreviewBeneficiariFse();
  const importMutation = useImportBeneficiariFse();
  const preflightMutation = usePreflightBeneficiariFseExport();
  const exportMutation = useExportBeneficiariFse();
  const [mode, setMode] = useState<"import" | "export" | null>(null);
  const [centroId, setCentroId] = useState(
    lockedCentroId ? String(lockedCentroId) : "",
  );
  const lockedArea =
    lockedAreaId ??
    centri.find((centro) => centro.id === lockedCentroId)?.areaOperativaId;
  const [areaId, setAreaId] = useState(lockedArea ? String(lockedArea) : "");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (lockedArea != null) setAreaId(String(lockedArea));
  }, [lockedArea]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inlineError, setInlineError] = useState("");
  const [reading, setReading] = useState(false);
  const generation = useRef(0);
  const availableAreas: { id: number; nome: string; attivo?: boolean }[] =
    aree ?? [
      ...new Map(
        centri
          .filter((c) => c.areaOperativaId != null)
          .map((c) => [
            c.areaOperativaId!,
            {
              id: c.areaOperativaId!,
              nome: c.areaOperativaNome ?? String(c.areaOperativaId),
            },
          ]),
      ).values(),
    ];
  const [filePayload, setFilePayload] = useState<FilePayload | null>(null);
  const [preview, setPreview] = useState<BeneficiariFsePreviewResult | null>(
    null,
  );
  const [importResult, setImportResult] =
    useState<BeneficiariFseImportResult | null>(null);
  const [exportPreflight, setExportPreflight] =
    useState<BeneficiariFseExportPreflight | null>(null);
  const [resolutions, setResolutions] = useState<
    Record<number, BeneficiariFseImportResolution>
  >({});
  const [date, setDate] = useState(todayEuropeRome());
  const busy =
    reading ||
    previewMutation.isPending ||
    importMutation.isPending ||
    preflightMutation.isPending ||
    exportMutation.isPending;

  const reset = () => {
    generation.current++;
    setReading(false);
    setMode(null);
    setSelectedFile(null);
    setInlineError("");
    if (!lockedArea) setAreaId("");
    setPreview(null);
    setImportResult(null);
    setExportPreflight(null);
    setFilePayload(null);
    setResolutions({});
    if (!lockedCentroId) setCentroId("");
  };

  const readFile = async (file?: File) => {
    if (!file || !centroId || !areaId) return;
    setInlineError("");
    const current = ++generation.current;
    setReading(true);
    try {
      if (!/\.xlsx$/i.test(file.name))
        throw new Error(t("reporting.fse.selectXlsx"));
      if (file.size === 0 || file.size > 10 * 1024 * 1024)
        throw new Error(t("blocco07.beneficiaryFormats"));
      const bytes = await file.arrayBuffer();
      if (generation.current !== current) return;
      const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
      if (
        workbook.SheetNames.length !== 1 ||
        workbook.SheetNames[0] !== "Table1"
      ) {
        throw new Error(t("reporting.fse.workbookSingleSheet"));
      }
      const worksheet = workbook.Sheets.Table1;
      if (!worksheet) throw new Error(t("reporting.fse.workbookMissingSheet"));
      XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: true,
        defval: null,
      });
      const payload: FilePayload = {
        centroAscoltoId: Number(centroId),
        areaOperativaId: Number(areaId),
        dataRiferimento: date,
        file,
      };
      setFilePayload(payload);
      setImportResult(null);
      setResolutions({});
      const result = await previewMutation.mutateAsync({ data: payload });
      if (generation.current === current) setPreview(result);
    } catch (error) {
      if (generation.current !== current) return;
      setFilePayload(null);
      setPreview(null);
      setInlineError(apiErrorMessage(error, t("reporting.fse.invalidFile")));
      toast({
        title: t("reporting.fse.import"),
        description: apiErrorMessage(error, t("reporting.fse.invalidFile")),
        variant: "destructive",
      });
    } finally {
      if (generation.current === current) setReading(false);
    }
  };

  const confirmImport = async () => {
    if (!filePayload) return;
    try {
      const result = await importMutation.mutateAsync({
        data: {
          ...filePayload,
          risoluzioni: JSON.stringify(Object.values(resolutions)),
        },
      });
      setImportResult(result);
      onImported();
      toast({
        title: t("reporting.fse.importCompleted"),
        description: t("reporting.fse.importSummary", {
          creati: result.creati,
          collegati: result.collegati,
          aggiornati: result.aggiornati,
          invariati: result.invariati,
          errori: result.errori,
        }),
      });
    } catch (error) {
      toast({
        title: t("reporting.fse.import"),
        description: apiErrorMessage(error, t("reporting.fse.importFailed")),
        variant: "destructive",
      });
    }
  };

  const preflight = async () => {
    try {
      setExportPreflight(
        await preflightMutation.mutateAsync({
          data: {
            centroAscoltoId: Number(centroId),
            areaOperativaId: Number(areaId),
            dataRiferimento: date,
            soloAttivi: true,
          },
        }),
      );
    } catch (error) {
      toast({
        title: t("reporting.fse.export"),
        description: apiErrorMessage(error, t("reporting.fse.preflightFailed")),
        variant: "destructive",
      });
    }
  };

  const download = async () => {
    try {
      const blob = await exportMutation.mutateAsync({
        data: {
          centroAscoltoId: Number(centroId),
          areaOperativaId: Number(areaId),
          dataRiferimento: date,
          soloAttivi: true,
        },
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `beneficiari-fse-${date}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      onImported();
      reset();
    } catch (error) {
      toast({
        title: t("reporting.fse.export"),
        description: apiErrorMessage(error, t("reporting.fse.exportFailed")),
        variant: "destructive",
      });
    }
  };

  const unresolvedDuplicates =
    preview?.righe.some(
      (row) =>
        row.classificazione === "possibile_duplicato" &&
        !resolutions[row.numeroRiga],
    ) ?? false;
  const importBlocked = Boolean(
    !preview || (preview.conteggi.conflitto ?? 0) > 0 || unresolvedDuplicates,
  );

  return (
    <>
      {canImport && (
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => setMode("import")}
        >
          <Upload className="h-4 w-4" />
          {t("reporting.fse.import")}
        </Button>
      )}
      {canExport && (
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => setMode("export")}
        >
          <FileDown className="h-4 w-4" />
          {t("reporting.fse.export")}
        </Button>
      )}
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === "import"
                ? t("reporting.fse.import")
                : t("reporting.fse.export")}
            </DialogTitle>
            <DialogDescription>
              {t("reporting.fse.scopeDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select
              value={areaId}
              disabled={lockedArea != null || busy}
              onValueChange={(value) => {
                setAreaId(value);
                setCentroId("");
                setPreview(null);
                setFilePayload(null);
                setImportResult(null);
                setExportPreflight(null);
                setInlineError("");
                setResolutions({});
              }}
            >
              <SelectTrigger aria-label={t("reporting.fse.operationalArea")}>
                <SelectValue
                  placeholder={t("reporting.filters.areaOperativa")}
                />
              </SelectTrigger>
              <SelectContent>
                {availableAreas
                  .filter(
                    (area) =>
                      area.attivo !== false &&
                      (lockedArea == null || area.id === lockedArea),
                  )
                  .map((area) => (
                    <SelectItem key={area.id} value={String(area.id)}>
                      {area.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={centroId}
              onValueChange={(value) => {
                setCentroId(value);
                setFilePayload(null);
                setInlineError("");
                setResolutions({});
                setPreview(null);
                setExportPreflight(null);
                setImportResult(null);
              }}
              disabled={!areaId || lockedCentroId != null || busy}
            >
              <SelectTrigger aria-label={t("reporting.fse.centre")}>
                <SelectValue placeholder={t("reporting.fse.centre")} />
              </SelectTrigger>
              <SelectContent>
                {centri
                  .filter(
                    (centro) =>
                      centro.attivo !== false &&
                      String(centro.areaOperativaId) === areaId,
                  )
                  .map((centro) => (
                    <SelectItem key={centro.id} value={String(centro.id)}>
                      {centro.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {mode === "import" && !importResult && (
              <>
                <Input
                  type="date"
                  aria-label={t("reporting.fse.referenceDate")}
                  value={date}
                  disabled={busy}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setFilePayload(null);
                    setPreview(null);
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  {t("reporting.fse.referenceDateHistory")}
                </p>
                <p className="text-sm text-muted-foreground">{t("blocco07.beneficiaryHelp")}</p>
                <div className="min-w-0 space-y-2 rounded-md border p-3">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    aria-label={t("reporting.fse.file")}
                    disabled={!centroId || !areaId || busy}
                    onChange={(event) => {
                      setSelectedFile(event.target.files?.[0] ?? null);
                      setPreview(null);
                      setFilePayload(null);
                      setInlineError("");
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={!centroId || !areaId || busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    {t("blocco07.beneficiaryPicker")}
                  </Button>
                  {selectedFile && (
                    <p className="break-all text-sm">{selectedFile.name}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {t("blocco07.beneficiaryFormats")}
                  </p>
                  <Button
                    disabled={!selectedFile || !centroId || !areaId || busy}
                    onClick={() => void readFile(selectedFile ?? undefined)}
                  >
                    {t("blocco07.analyze")}
                  </Button>
                </div>
                {inlineError && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive p-3 text-sm text-destructive"
                  >
                    {inlineError}
                  </p>
                )}
              </>
            )}
            {mode === "export" && (
              <>
                <Input
                  type="date"
                  aria-label={t("reporting.fse.referenceDate")}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setExportPreflight(null);
                  }}
                />
                <Badge variant="outline">{t("reporting.fse.activeOnly")}</Badge>
              </>
            )}

            {preview && (
              <>
                <div className="text-sm font-medium">
                  {t("reporting.fse.rowsRead", { count: preview.numeroRighe })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(preview.conteggi).map(([key, value]) => (
                    <Badge
                      key={key}
                      variant={
                        key === "errore" || key === "conflitto"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {t(`reporting.fse.classification.${key}`, {
                        defaultValue: key,
                      })}
                      : {value}
                    </Badge>
                  ))}
                </div>
                {(preview.conteggi.errore ?? 0) > 0 && (
                  <div className="rounded border border-amber-400/60 p-2 text-sm">
                    {t("reporting.fse.partialImport")}
                  </div>
                )}
                {preview.warningHeader.map((warning) => (
                  <div
                    key={warning}
                    className="rounded border border-amber-400/60 p-2 text-sm"
                  >
                    {warning}
                  </div>
                ))}
                {preview.righe
                  .filter(
                    (row) =>
                      row.errori.length ||
                      row.warning.length ||
                      row.classificazione === "conflitto",
                  )
                  .map((row) => (
                    <div
                      key={row.numeroRiga}
                      className="rounded border border-destructive/40 p-2 text-sm"
                    >
                      {t("reporting.fse.row", { number: row.numeroRiga })} ·{" "}
                      {row.codiceFascicolo ?? t("reporting.fse.missingCode")}:{" "}
                      {[...row.errori, ...row.warning].join(" ") ||
                        t("reporting.fse.territorialConflict")}
                    </div>
                  ))}
                {preview.righe
                  .filter(
                    (row) => row.classificazione === "possibile_duplicato",
                  )
                  .map((row) => (
                    <div
                      key={row.numeroRiga}
                      className="rounded border border-amber-400/60 p-3 text-sm"
                    >
                      <div className="mb-2 font-medium">
                        {t("reporting.fse.possibleExisting", {
                          number: row.numeroRiga,
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {row.duplicati?.map((candidate) => (
                          <Button
                            key={candidate.id}
                            type="button"
                            size="sm"
                            variant={
                              resolutions[row.numeroRiga]?.beneficiarioId ===
                              candidate.id
                                ? "default"
                                : "outline"
                            }
                            onClick={() =>
                              setResolutions((current) => ({
                                ...current,
                                [row.numeroRiga]: {
                                  numeroRiga: row.numeroRiga,
                                  azione: "collega",
                                  beneficiarioId: candidate.id,
                                },
                              }))
                            }
                          >
                            {t("reporting.fse.linkTo", {
                              code: candidate.codice,
                            })}
                          </Button>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            resolutions[row.numeroRiga]?.azione === "crea"
                              ? "default"
                              : "outline"
                          }
                          onClick={() =>
                            setResolutions((current) => ({
                              ...current,
                              [row.numeroRiga]: {
                                numeroRiga: row.numeroRiga,
                                azione: "crea",
                              },
                            }))
                          }
                        >
                          {t("reporting.fse.createNew")}
                        </Button>
                      </div>
                    </div>
                  ))}
              </>
            )}

            {importResult && (
              <div className="space-y-2 rounded border p-3 text-sm">
                <div className="font-medium">
                  {t("reporting.fse.importResult", {
                    batchId: importResult.batchId,
                  })}
                </div>
                <div>
                  {t("reporting.fse.resultSummary", {
                    creati: importResult.creati,
                    collegati: importResult.collegati,
                    aggiornati: importResult.aggiornati,
                    invariati: importResult.invariati,
                    conflitti: importResult.conflitti,
                    errori: importResult.errori,
                  })}
                </div>
                {importResult.dettagli
                  .filter((detail) => detail.errori.length)
                  .map((detail) => (
                    <div key={detail.numeroRiga} className="text-destructive">
                      {t("reporting.fse.row", { number: detail.numeroRiga })} ·{" "}
                      {detail.codiceFascicolo ?? t("reporting.fse.missingCode")}
                      : {detail.errori.join(", ")}
                    </div>
                  ))}
              </div>
            )}

            {exportPreflight && (
              <div className="space-y-2 rounded border p-3 text-sm">
                <div>
                  {t("reporting.fse.preflightSummary", {
                    candidates: exportPreflight.candidati,
                    exportable: exportPreflight.esportabili,
                    blocked: exportPreflight.bloccati.length,
                    warnings: exportPreflight.warning.length,
                  })}
                </div>
                {exportPreflight.bloccati.map((issue) => (
                  <div key={issue.beneficiarioId} className="text-destructive">
                    {issue.codice}: {issue.errori?.join(", ")}
                  </div>
                ))}
                {exportPreflight.warning.map((issue) => (
                  <div key={issue.beneficiarioId} className="text-amber-700">
                    {issue.codice}: {issue.warning?.join(", ")}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={reset}>
              {importResult
                ? t("reporting.fse.close")
                : t("reporting.fse.cancel")}
            </Button>
            {mode === "import" && !importResult && (
              <Button
                onClick={() => void confirmImport()}
                disabled={importBlocked || busy}
              >
                {t("reporting.fse.confirmImport")}
              </Button>
            )}
            {mode === "export" && !exportPreflight && (
              <Button
                onClick={() => void preflight()}
                disabled={!centroId || !date || busy}
              >
                {t("reporting.fse.runPreflight")}
              </Button>
            )}
            {mode === "export" && exportPreflight && (
              <Button
                onClick={() => void download()}
                disabled={
                  busy ||
                  exportPreflight.bloccati.length > 0 ||
                  exportPreflight.candidati === 0
                }
              >
                {t("reporting.fse.download")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
