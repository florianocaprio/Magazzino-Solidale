import {
  FseExportInputFormatCode,
  FseResolutionInputAzione,
  getGetFseReconciliationQueryKey,
  getGetFseReportingPreviewQueryKey,
  getListAgeaImportazioniQueryKey,
  getListFseExportsQueryKey,
  getListFseReportingEventsQueryKey,
  getListFseReportingQualityQueryKey,
  getListFseReconciliationsQueryKey,
  getListFseReconciliationLinesQueryKey,
  useCreateFseExport,
  useCreateFseReconciliation,
  useCloseFseReconciliation,
  useGetFseReconciliation,
  useGetFseReportingPreview,
  useListAgeaImportazioni,
  useListFseExports,
  useListFseMonitoring,
  useListFseReconciliations,
  useListFseReconciliationLines,
  useListFseReportingEvents,
  useListFseReportingQuality,
  useResolveFseReconciliationLine,
  type FseRecord,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { ReportingFilterState } from "@/components/reporting/report-filters";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const FSE_OPERATION_TABS = [
  "overview",
  "queue",
  "exports",
  "reconciliations",
  "indicators",
  "anomalies",
] as const;

function text(record: FseRecord, key: string): string {
  const value = record[key];
  return value == null ? "—" : String(value);
}

function RecordList({
  rows,
  downloadExports = false,
  onSelect,
  selectedId,
}: {
  rows: FseRecord[] | undefined;
  downloadExports?: boolean;
  onSelect?: (id: number) => void;
  selectedId?: number | null;
}) {
  const { t } = useTranslation();
  if (!rows?.length)
    return (
      <p className="text-sm text-muted-foreground">
        {t("fseOperations.empty")}
      </p>
    );
  return (
    <div className="space-y-2">
      {rows.slice(0, 20).map((row, index) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border p-3 text-sm"
          key={text(row, "id") === "—" ? index : text(row, "id")}
        >
          <div className="min-w-0">
            <p className="truncate font-medium">
              {text(row, "formatCode") !== "—"
                ? text(row, "formatCode")
                : text(row, "status")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              #{text(row, "id")} ·{" "}
              {text(row, "dataDa") !== "—"
                ? `${text(row, "dataDa")} – ${text(row, "dataA")}`
                : text(row, "businessKey")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {text(row, "stato")}
            </span>
            {downloadExports && Number(row.id) > 0 && (
              <Button asChild size="sm" variant="outline">
                <a href={`/api/fse/exportazioni/${Number(row.id)}/download`}>
                  {t("fseOperations.download")}
                </a>
              </Button>
            )}
            {onSelect && Number(row.id) > 0 && (
              <Button
                size="sm"
                variant={selectedId === Number(row.id) ? "default" : "outline"}
                onClick={() => onSelect(Number(row.id))}
              >
                {t("fseOperations.select")}
              </Button>
            )}
          </div>
        </div>
      ))}
      {rows.length > 20 && (
        <p className="text-xs text-muted-foreground">
          20 / {rows.length} {t("fseOperations.records")}
        </p>
      )}
    </div>
  );
}

export function FseOperations({ filters }: { filters: ReportingFilterState }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const warehouseId = filters.magazzinoId ?? 0;
  const enabled = warehouseId > 0;
  const params = useMemo(
    () => ({
      magazzinoId: warehouseId,
      dataDa: filters.da,
      dataA: filters.a,
    }),
    [warehouseId, filters.da, filters.a],
  );
  const previewParams = { ...params, dataAsOf: filters.a };
  const preview = useGetFseReportingPreview(previewParams, {
    query: {
      enabled,
      queryKey: getGetFseReportingPreviewQueryKey(previewParams),
    },
  });
  const events = useListFseReportingEvents(params, {
    query: { enabled, queryKey: getListFseReportingEventsQueryKey(params) },
  });
  const quality = useListFseReportingQuality(params, {
    query: { enabled, queryKey: getListFseReportingQualityQueryKey(params) },
  });
  const exportsQuery = useListFseExports();
  const reconciliations = useListFseReconciliations();
  const monitoring = useListFseMonitoring();
  const ageaImports = useListAgeaImportazioni({
    query: {
      enabled: hasPermission("magazzino.fse.reconcile"),
      queryKey: getListAgeaImportazioniQueryKey(),
    },
  });
  const [format, setFormat] = useState<FseExportInputFormatCode>(
    FseExportInputFormatCode.FSE_CANONICAL_AUDIT_XLSX_V1,
  );
  const [ageaId, setAgeaId] = useState("");
  const [previousAgeaId, setPreviousAgeaId] = useState("");
  const [selectedReconciliationId, setSelectedReconciliationId] = useState<
    number | null
  >(null);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [resolutionAction, setResolutionAction] =
    useState<FseResolutionInputAzione>(
      FseResolutionInputAzione.ACCETTA_SCOSTAMENTO,
    );
  const [resolutionMotivation, setResolutionMotivation] = useState("");
  const selectedReconciliation = useGetFseReconciliation(
    selectedReconciliationId ?? 0,
    {
      query: {
        enabled: selectedReconciliationId != null,
        queryKey: getGetFseReconciliationQueryKey(
          selectedReconciliationId ?? 0,
        ),
      },
    },
  );
  const reconciliationLines = useListFseReconciliationLines(
    selectedReconciliationId ?? 0,
    { pageSize: 200 },
    {
      query: {
        enabled: selectedReconciliationId != null,
        queryKey: getListFseReconciliationLinesQueryKey(
          selectedReconciliationId ?? 0,
          { pageSize: 200 },
        ),
      },
    },
  );

  useEffect(() => {
    const candidate = ageaImports.data?.find(
      (item) => item.magazzinoId === warehouseId && item.stato === "CONFERMATA",
    );
    if (candidate && !ageaId) setAgeaId(String(candidate.id));
  }, [ageaId, ageaImports.data, warehouseId]);

  const completed = () => toast({ title: t("fseOperations.done") });
  const failed = () =>
    toast({ title: t("fseOperations.failed"), variant: "destructive" });
  const createExport = useCreateFseExport({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: getListFseExportsQueryKey(),
        });
        completed();
      },
      onError: failed,
    },
  });
  const createReconciliation = useCreateFseReconciliation({
    mutation: {
      onSuccess: async (created) => {
        setSelectedReconciliationId(Number(created.id));
        await queryClient.invalidateQueries({
          queryKey: getListFseReconciliationsQueryKey(),
        });
        completed();
      },
      onError: failed,
    },
  });
  const refreshSelectedReconciliation = async () => {
    if (selectedReconciliationId == null) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getListFseReconciliationsQueryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetFseReconciliationQueryKey(selectedReconciliationId),
      }),
      queryClient.invalidateQueries({
        queryKey: getListFseReconciliationLinesQueryKey(
          selectedReconciliationId,
          { pageSize: 200 },
        ),
      }),
    ]);
    completed();
  };
  const resolveLine = useResolveFseReconciliationLine({
    mutation: {
      onSuccess: async () => {
        setSelectedLineId(null);
        setResolutionMotivation("");
        await refreshSelectedReconciliation();
      },
      onError: failed,
    },
  });
  const closeReconciliation = useCloseFseReconciliation({
    mutation: {
      onSuccess: refreshSelectedReconciliation,
      onError: failed,
    },
  });

  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      aria-label={t("fseOperations.title")}
    >
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>{t("fseOperations.title")}</AlertTitle>
        <AlertDescription>
          {t("fseOperations.noAutomaticTransmission")}
        </AlertDescription>
      </Alert>
      {!enabled && (
        <Alert variant="destructive">
          <AlertDescription>
            {t("fseOperations.chooseWarehouse")}
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap justify-start">
          {FSE_OPERATION_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`fseOperations.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="grid gap-4 md:grid-cols-3">
          {(["eventiTotali", "righeTotali", "bloccanti"] as const).map(
            (key) => (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{key}</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {preview.data ? text(preview.data, key) : "—"}
                </CardContent>
              </Card>
            ),
          )}
          <a
            className="inline-flex items-center gap-2 text-sm text-primary underline md:col-span-3"
            href="/lotti?tab=agea"
          >
            {t("fseOperations.ageaLink")} <ExternalLink className="h-4 w-4" />
          </a>
        </TabsContent>
        <TabsContent value="queue">
          <RecordList rows={events.data} />
        </TabsContent>
        <TabsContent value="exports" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("fseOperations.exportWizard")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("fseOperations.exportSteps")}
              </p>
              <div className="space-y-2">
                <Label htmlFor="fse-format">{t("fseOperations.format")}</Label>
                <select
                  id="fse-format"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={format}
                  onChange={(event) =>
                    setFormat(event.target.value as typeof format)
                  }
                >
                  <option
                    value={FseExportInputFormatCode.FSE_CANONICAL_AUDIT_XLSX_V1}
                  >
                    {t("fseOperations.canonicalFormat")}
                  </option>
                  <option
                    value={
                      FseExportInputFormatCode.SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1
                    }
                  >
                    {t("fseOperations.observedFormat")}
                  </option>
                </select>
              </div>
              {format ===
                FseExportInputFormatCode.SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t("fseOperations.observedFormatWarning")}
                  </AlertDescription>
                </Alert>
              )}
              {hasPermission("magazzino.fse.export") && (
                <Button
                  disabled={!enabled || createExport.isPending}
                  onClick={() =>
                    createExport.mutate({
                      data: {
                        magazzinoId: warehouseId,
                        dataDa: filters.da,
                        dataA: filters.a,
                        dataAsOf: filters.a,
                        formatCode: format,
                      },
                    })
                  }
                >
                  {t("fseOperations.generate")}
                </Button>
              )}
              {preview.data && (
                <p className="text-sm text-muted-foreground">
                  {t("fseOperations.preview")}:{" "}
                  {text(preview.data, "eventiTotali")} ·{" "}
                  {t("fseOperations.anomalies")}:{" "}
                  {text(preview.data, "bloccanti")}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("fseOperations.exports")}</CardTitle>
            </CardHeader>
            <CardContent>
              <RecordList rows={exportsQuery.data} downloadExports />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent
          value="reconciliations"
          className="grid gap-4 lg:grid-cols-2"
        >
          <Card>
            <CardHeader>
              <CardTitle>{t("fseOperations.reconciliationWizard")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("fseOperations.reconciliationSteps")}
              </p>
              <div className="space-y-2">
                <Label htmlFor="agea-id">{t("fseOperations.importId")}</Label>
                <Input
                  id="agea-id"
                  type="number"
                  min={1}
                  value={ageaId}
                  onChange={(event) => setAgeaId(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agea-previous-id">
                  {t("fseOperations.previousImportId")}
                </Label>
                <Input
                  id="agea-previous-id"
                  type="number"
                  min={1}
                  value={previousAgeaId}
                  onChange={(event) => setPreviousAgeaId(event.target.value)}
                />
              </div>
              {hasPermission("magazzino.fse.reconcile") && (
                <Button
                  disabled={
                    !enabled || !ageaId || createReconciliation.isPending
                  }
                  onClick={() =>
                    createReconciliation.mutate({
                      data: {
                        magazzinoId: warehouseId,
                        importazioneAgeaId: Number(ageaId),
                        importazioneAgeaPrecedenteId: previousAgeaId
                          ? Number(previousAgeaId)
                          : null,
                        dataRiferimento: filters.a,
                      },
                    })
                  }
                >
                  {t("fseOperations.calculate")}
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("fseOperations.reconciliations")}</CardTitle>
            </CardHeader>
            <CardContent>
              <RecordList
                rows={reconciliations.data}
                selectedId={selectedReconciliationId}
                onSelect={(id) => {
                  setSelectedReconciliationId(id);
                  setSelectedLineId(null);
                }}
              />
            </CardContent>
          </Card>
          {selectedReconciliationId != null && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>
                  {t("fseOperations.manageReconciliation")} #
                  {selectedReconciliationId}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("fseOperations.version")}:{" "}
                  {selectedReconciliation.data
                    ? text(selectedReconciliation.data, "versione")
                    : "—"}{" "}
                  · {t("fseOperations.status")}:{" "}
                  {selectedReconciliation.data
                    ? text(selectedReconciliation.data, "stato")
                    : "—"}
                </p>
                <RecordList
                  rows={reconciliationLines.data?.rows}
                  selectedId={selectedLineId}
                  onSelect={setSelectedLineId}
                />
                {hasPermission("magazzino.fse.reconcile.manage") && (
                  <div className="grid gap-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto]">
                    <select
                      aria-label={t("fseOperations.action")}
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={resolutionAction}
                      onChange={(event) =>
                        setResolutionAction(
                          event.target.value as FseResolutionInputAzione,
                        )
                      }
                    >
                      {Object.values(FseResolutionInputAzione).map((action) => (
                        <option key={action} value={action}>
                          {action}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={t("fseOperations.motivation")}
                      placeholder={t("fseOperations.motivation")}
                      value={resolutionMotivation}
                      onChange={(event) =>
                        setResolutionMotivation(event.target.value)
                      }
                    />
                    <Button
                      disabled={
                        selectedLineId == null ||
                        resolutionMotivation.trim().length < 3 ||
                        !selectedReconciliation.data ||
                        resolveLine.isPending
                      }
                      onClick={() =>
                        resolveLine.mutate({
                          id: selectedReconciliationId,
                          rigaId: selectedLineId!,
                          data: {
                            versione: Number(
                              selectedReconciliation.data?.versione,
                            ),
                            azione: resolutionAction,
                            motivazione: resolutionMotivation.trim(),
                          },
                        })
                      }
                    >
                      {t("fseOperations.resolve")}
                    </Button>
                  </div>
                )}
                {hasPermission("magazzino.fse.reconcile.manage") && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={
                        !selectedReconciliation.data ||
                        closeReconciliation.isPending
                      }
                      onClick={() =>
                        closeReconciliation.mutate({
                          id: selectedReconciliationId,
                          data: {
                            versione: Number(
                              selectedReconciliation.data?.versione,
                            ),
                            conScostamenti: false,
                          },
                        })
                      }
                    >
                      {t("fseOperations.closeExact")}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={
                        !selectedReconciliation.data ||
                        resolutionMotivation.trim().length < 3 ||
                        closeReconciliation.isPending
                      }
                      onClick={() =>
                        closeReconciliation.mutate({
                          id: selectedReconciliationId,
                          data: {
                            versione: Number(
                              selectedReconciliation.data?.versione,
                            ),
                            conScostamenti: true,
                            motivazione: resolutionMotivation.trim(),
                          },
                        })
                      }
                    >
                      {t("fseOperations.closeWithDifferences")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="indicators">
          <RecordList rows={monitoring.data} />
        </TabsContent>
        <TabsContent value="anomalies">
          <RecordList rows={quality.data} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
