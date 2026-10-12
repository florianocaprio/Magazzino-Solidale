import {
  FseExportInputFormatCode,
  FseResolutionInputAzione,
  getGetFseReconciliationQueryKey,
  getGetFseExportQueryKey,
  getGetFseReportingPreviewQueryKey,
  getListAgeaImportazioniQueryKey,
  getListFseExportsQueryKey,
  getListFseMonitoringQueryKey,
  getListFseReportingEventsQueryKey,
  getListFseReportingQualityQueryKey,
  getListFseReconciliationsQueryKey,
  getListFseReconciliationLinesQueryKey,
  useCreateFseExport,
  useCreateFseMonitoring,
  useCancelFseExport,
  useCreateFseReconciliation,
  useCloseFseReconciliation,
  useCancelFseReconciliation,
  useGetFseReconciliation,
  useGetFseExport,
  useGetFseReportingPreview,
  useListAgeaImportazioni,
  useListFseExports,
  useListFseMonitoring,
  useListFseReconciliations,
  useListFseReconciliationLines,
  useListFseReportingEvents,
  useListFseReportingQuality,
  useResolveFseReconciliationLine,
  useRecalculateFseReconciliation,
  useMarkFseExportManuallyEntered,
  useUpdateFseMonitoring,
  type FseRecord,
  type FseQueueStatoParameter,
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
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { errorMessage } from "@/lib/api-error";
import { useTranslation } from "react-i18next";
import {
  FseAdministrativeSourceForm,
  FseAdministrativeProvenance,
  FseOriginalDownload,
} from "./fse-administrative-source";

export const FSE_OPERATION_TABS = [
  "overview",
  "queue",
  "exports",
  "reconciliations",
  "indicators",
  "anomalies",
] as const;

export function fseReadableData<T>(query: { data?: T; isError?: boolean }) {
  return query.isError ? undefined : query.data;
}

function FseQueryFeedback({
  query,
}: {
  query?: { isError?: boolean; isLoading?: boolean; error?: unknown };
}) {
  const { t } = useTranslation();
  if (query?.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          {errorMessage(query.error, t("fseOperations.failed"))}
        </AlertDescription>
      </Alert>
    );
  if (query?.isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("common.loading")}
      </p>
    );
  return null;
}

function FseRequiredInput({
  valid,
  ...props
}: ComponentProps<typeof Input> & { valid: boolean }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <Input
        {...props}
        id={id}
        required
        aria-invalid={!valid}
        aria-describedby={!valid ? `${id}-error` : undefined}
        className={
          !valid
            ? "border-destructive focus-visible:ring-destructive"
            : undefined
        }
      />
      {!valid && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {t("fseOperations.requiredValue")}
        </p>
      )}
    </div>
  );
}

export function fseExportActionAvailability(
  record: FseRecord,
  actionText: string,
) {
  const state = String(record.stato ?? "");
  const hasAuditReference = actionText.trim().length >= 3;
  return {
    canMarkEntered:
      state === "PRONTA_PER_INSERIMENTO_MANUALE" &&
      Number(record.righeBloccanti ?? 0) === 0 &&
      hasAuditReference,
    canCancel:
      !["INSERITA_MANUALMENTE", "ANNULLATA"].includes(state) &&
      hasAuditReference,
  };
}

export function fseResolutionReady(input: {
  lineId: number | null;
  action: FseResolutionInputAzione;
  motivation: string;
  targetMovementId: string;
  targetAgeaRowId: string;
  hasHeader: boolean;
}) {
  return (
    input.lineId != null &&
    input.motivation.trim().length >= 3 &&
    input.hasHeader &&
    (input.action !== FseResolutionInputAzione.ABBINA ||
      (Number(input.targetMovementId) > 0 && Number(input.targetAgeaRowId) > 0))
  );
}

function text(record: FseRecord, key: string): string {
  const value = record[key];
  return value == null ? "—" : String(value);
}

export function RecordList({
  rows,
  downloadExports = false,
  onSelect,
  selectedId,
  pagination,
  query,
}: {
  rows: FseRecord[] | undefined;
  downloadExports?: boolean;
  onSelect?: (id: number) => void;
  selectedId?: number | null;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
  };
  query?: { isError?: boolean; isLoading?: boolean; error?: unknown };
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const currentPage = pagination ? pagination.page - 1 : page;
  const pageSize = pagination?.pageSize ?? 20;
  const total = pagination?.total ?? rows?.length ?? 0;
  const changePage = (next: number) =>
    pagination ? pagination.onChange(next + 1) : setPage(next);
  const visibleRows = pagination
    ? (rows ?? [])
    : (rows?.slice(page * 20, page * 20 + 20) ?? []);
  if (query?.isError || query?.isLoading)
    return <FseQueryFeedback query={query} />;
  return (
    <div className="space-y-2">
      {!visibleRows.length && (
        <p className="text-sm text-muted-foreground">
          {t("fseOperations.empty")}
        </p>
      )}
      {visibleRows.map((row, index) => (
        <div
          className="grid min-w-0 gap-3 rounded-md border p-3 text-sm"
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {text(row, "stato")}
            </span>
            {downloadExports && Number(row.id) > 0 && (
              <>
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`/api/fse/exportazioni/${Number(row.id)}/download?representation=FSE_CANONICAL_AUDIT_XLSX_V1`}
                  >
                    {t("fseOperations.download")} audit
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`/api/fse/exportazioni/${Number(row.id)}/download?representation=SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1`}
                  >
                    {t("fseOperations.download")} controllo
                  </a>
                </Button>
              </>
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
      {(total > pageSize || currentPage > 0) && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {Math.min(currentPage * pageSize + 1, total)}–
            {Math.min((currentPage + 1) * pageSize, total)} / {total}{" "}
            {t("fseOperations.records")}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={t("fseOperations.previousPage")}
              disabled={currentPage === 0}
              onClick={() => changePage(Math.max(0, currentPage - 1))}
            >
              ‹
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={t("fseOperations.nextPage")}
              disabled={(currentPage + 1) * pageSize >= total}
              onClick={() => changePage(currentPage + 1)}
            >
              ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FseOperations({ filters }: { filters: ReportingFilterState }) {
  const { user } = useAuth();
  const scopeKey = JSON.stringify([
    user?.id,
    user?.areaOperativaId,
    user?.centroAscoltoId,
    user?.isAdmin,
    user?.aree,
    user?.permessi,
    filters,
  ]);
  // A new territory/session owns new selections and drafts; late responses cannot populate it.
  return (
    <FseOperationsContext
      key={scopeKey}
      filters={filters}
      scopeKey={scopeKey}
    />
  );
}

function FseOperationsContext({
  filters,
  scopeKey,
}: {
  filters: ReportingFilterState;
  scopeKey: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission, user } = useAuth();
  const queryClient = useQueryClient();
  const warehouseId = filters.magazzinoId ?? 0;
  const enabled = warehouseId > 0 && hasPermission("magazzino.fse.view");
  const active = useRef(true);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [pages, setPages] = useState({
    events: 1,
    quality: 1,
    exports: 1,
    reconciliations: 1,
    monitoring: 1,
    lines: 1,
  });
  const paging = (name: keyof typeof pages, total = 0) => ({
    page: pages[name],
    pageSize: 20,
    total,
    onChange: (page: number) =>
      setPages((current) => ({ ...current, [name]: page })),
  });
  const scopedKey = (key: readonly unknown[]) => [
    ...key,
    { fseScope: scopeKey },
  ];
  const [reportingStateFilter, setReportingStateFilter] = useState<
    "" | FseQueueStatoParameter
  >("");
  const params = useMemo(
    () => ({
      magazzinoId: warehouseId,
      dataCompetenzaDa: filters.da,
      dataCompetenzaA: filters.a,
      includeArretrati: true,
      ...(reportingStateFilter
        ? { statoRendicontazione: reportingStateFilter }
        : {}),
    }),
    [warehouseId, filters.da, filters.a, reportingStateFilter],
  );
  const previewParams = { ...params, dataAsOf: filters.a };
  const listParams = {
    magazzinoId: warehouseId,
    dataCompetenzaDa: filters.da,
    dataCompetenzaA: filters.a,
    pageSize: 20,
  };
  const preview = useGetFseReportingPreview(previewParams, {
    query: {
      enabled,
      queryKey: scopedKey(getGetFseReportingPreviewQueryKey(previewParams)),
    },
  });
  const eventParams = { ...params, page: pages.events, pageSize: 20 };
  const qualityParams = { ...params, page: pages.quality, pageSize: 20 };
  const exportsParams = { ...listParams, page: pages.exports };
  const reconciliationParams = { ...listParams, page: pages.reconciliations };
  const monitoringParams = { ...listParams, page: pages.monitoring };
  const events = useListFseReportingEvents(eventParams, {
    query: {
      enabled,
      queryKey: scopedKey(getListFseReportingEventsQueryKey(eventParams)),
    },
  });
  const quality = useListFseReportingQuality(qualityParams, {
    query: {
      enabled,
      queryKey: scopedKey(getListFseReportingQualityQueryKey(qualityParams)),
    },
  });
  const exportsQuery = useListFseExports(exportsParams, {
    query: {
      enabled,
      queryKey: scopedKey(getListFseExportsQueryKey(exportsParams)),
    },
  });
  const reconciliations = useListFseReconciliations(reconciliationParams, {
    query: {
      enabled,
      queryKey: scopedKey(
        getListFseReconciliationsQueryKey(reconciliationParams),
      ),
    },
  });
  const monitoring = useListFseMonitoring(monitoringParams, {
    query: {
      enabled,
      queryKey: scopedKey(getListFseMonitoringQueryKey(monitoringParams)),
    },
  });
  const ageaImports = useListAgeaImportazioni({
    query: {
      enabled: hasPermission("magazzino.fse.reconcile"),
      queryKey: scopedKey(getListAgeaImportazioniQueryKey()),
    },
  });
  const [format, setFormat] = useState<FseExportInputFormatCode>(
    FseExportInputFormatCode.FSE_CANONICAL_AUDIT_XLSX_V1,
  );
  const [selectedExportId, setSelectedExportId] = useState<number | null>(null);
  const [exportActionText, setExportActionText] = useState("");
  const selectedExport = useGetFseExport(selectedExportId ?? 0, {
    query: {
      enabled: enabled && selectedExportId != null,
      queryKey: scopedKey(getGetFseExportQueryKey(selectedExportId ?? 0)),
    },
  });
  const [ageaId, setAgeaId] = useState("");
  const [sourceType, setSourceType] = useState<"AGEA_LEGACY" | "FSE_M3B">(
    "AGEA_LEGACY",
  );
  const [recalculationSourceVersion, setRecalculationSourceVersion] =
    useState("");
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
  const [targetMovementId, setTargetMovementId] = useState("");
  const [targetAgeaRowId, setTargetAgeaRowId] = useState("");
  const [selectedMonitoringId, setSelectedMonitoringId] = useState<
    number | null
  >(null);
  const [monitoringMonth, setMonitoringMonth] = useState(filters.a.slice(0, 7));
  const [monitoringChannel, setMonitoringChannel] = useState("PACCHI");
  const [monitoringTotal, setMonitoringTotal] = useState("");
  const selectedReconciliation = useGetFseReconciliation(
    selectedReconciliationId ?? 0,
    {
      query: {
        enabled: enabled && selectedReconciliationId != null,
        queryKey: scopedKey(
          getGetFseReconciliationQueryKey(selectedReconciliationId ?? 0),
        ),
      },
    },
  );
  const reconciliationLines = useListFseReconciliationLines(
    selectedReconciliationId ?? 0,
    { page: pages.lines, pageSize: 20 },
    {
      query: {
        enabled: enabled && selectedReconciliationId != null,
        queryKey: scopedKey(
          getListFseReconciliationLinesQueryKey(selectedReconciliationId ?? 0, {
            page: pages.lines,
            pageSize: 20,
          }),
        ),
      },
    },
  );

  useEffect(() => {
    const candidate = fseReadableData(ageaImports)?.find(
      (item) => item.magazzinoId === warehouseId && item.stato === "CONFERMATA",
    );
    if (candidate && !ageaId) setAgeaId(String(candidate.id));
  }, [ageaId, ageaImports.data, ageaImports.isError, warehouseId]);

  const [actionError, setActionError] = useState<string | null>(null);
  const completed = () => {
    if (active.current) {
      setActionError(null);
      toast({ title: t("fseOperations.done") });
    }
  };
  const failed = (error: unknown) => {
    if (active.current) {
      setActionError(errorMessage(error, t("fseOperations.failed")));
      section.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }
  };
  const refreshCanonical = () =>
    Promise.all(
      [
        getGetFseReportingPreviewQueryKey(),
        getListFseReportingEventsQueryKey(),
        getListFseReportingQualityQueryKey(),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  const createExport = useCreateFseExport({
    mutation: {
      onSuccess: async () => {
        await refreshCanonical();
        await queryClient.invalidateQueries({
          queryKey: getListFseExportsQueryKey(),
        });
        completed();
      },
      onError: failed,
    },
  });
  const refreshSelectedExport = async () => {
    await refreshCanonical();
    await queryClient.invalidateQueries({
      queryKey: getListFseExportsQueryKey(),
    });
    if (selectedExportId != null)
      await queryClient.invalidateQueries({
        queryKey: getGetFseExportQueryKey(selectedExportId),
      });
    completed();
  };
  const markExport = useMarkFseExportManuallyEntered({
    mutation: { onSuccess: refreshSelectedExport, onError: failed },
  });
  const cancelExport = useCancelFseExport({
    mutation: { onSuccess: refreshSelectedExport, onError: failed },
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
  const recalculateReconciliation = useRecalculateFseReconciliation({
    mutation: { onSuccess: refreshSelectedReconciliation, onError: failed },
  });
  const cancelReconciliation = useCancelFseReconciliation({
    mutation: { onSuccess: refreshSelectedReconciliation, onError: failed },
  });
  const refreshMonitoring = async () => {
    await refreshCanonical();
    await queryClient.invalidateQueries({
      queryKey: getListFseMonitoringQueryKey(),
    });
    completed();
  };
  const createMonitoring = useCreateFseMonitoring({
    mutation: { onSuccess: refreshMonitoring, onError: failed },
  });
  const updateMonitoring = useUpdateFseMonitoring({
    mutation: { onSuccess: refreshMonitoring, onError: failed },
  });
  const selectedMonitoring = fseReadableData(monitoring)?.rows.find(
    (row) => Number(row.id) === selectedMonitoringId,
  );

  return (
    <section
      ref={section}
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
        <FseQueryFeedback query={preview} />
        {selectedExportId != null && (
          <FseQueryFeedback query={selectedExport} />
        )}
        {selectedReconciliationId != null && (
          <FseQueryFeedback query={selectedReconciliation} />
        )}
        {actionError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}
        <TabsList className="h-auto flex-wrap justify-start">
          {FSE_OPERATION_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} className="min-h-11 min-w-11">
              {t(`fseOperations.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="grid gap-4 md:grid-cols-3">
          {(["eventiTotali", "righeTotali", "bloccanti"] as const).map(
            (key) => (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    {t(`fseOperations.${key}`)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {fseReadableData(preview)
                    ? text(fseReadableData(preview)!, key)
                    : "—"}
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
          {hasPermission("magazzino.fse.return") && (
            <a
              className="inline-flex items-center gap-2 text-sm text-primary underline md:col-span-3"
              href="/scarichi"
            >
              {t("fseOperations.returnLink")}
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </TabsContent>
        <TabsContent value="queue" className="space-y-3">
          <select
            aria-label={t("fseOperations.queueFilter")}
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={reportingStateFilter}
            onChange={(event) => {
              setPages((current) => ({ ...current, events: 1, quality: 1 }));
              setReportingStateFilter(
                event.target.value as "" | FseQueueStatoParameter,
              );
            }}
          >
            <option value="">{t("fseOperations.allStatuses")}</option>
            <option value="DA_RENDICONTARE">DA_RENDICONTARE</option>
            <option value="ARRETRATO_NON_RENDICONTATO">
              ARRETRATO_NON_RENDICONTATO
            </option>
            <option value="BLOCCATO">BLOCCATO</option>
            <option value="CORREZIONE_DA_GESTIRE_MANUALMENTE">
              CORREZIONE_DA_GESTIRE_MANUALMENTE
            </option>
          </select>
          <RecordList
            query={events}
            rows={fseReadableData(events)?.rows}
            pagination={paging("events", fseReadableData(events)?.total)}
          />
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
                        dataCompetenzaDa: filters.da,
                        dataCompetenzaA: filters.a,
                        dataAsOf: filters.a,
                        formatCode: format,
                        includeArretrati: true,
                      },
                    })
                  }
                >
                  {t("fseOperations.generate")}
                </Button>
              )}
              {!preview.isError && preview.data && (
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
              <RecordList
                query={exportsQuery}
                rows={fseReadableData(exportsQuery)?.rows?.filter(
                  (row) =>
                    !selectedExport.isError ||
                    Number(row.id) !== selectedExportId,
                )}
                pagination={paging(
                  "exports",
                  fseReadableData(exportsQuery)?.total,
                )}
                downloadExports
                selectedId={selectedExportId}
                onSelect={setSelectedExportId}
              />
              {!selectedExport.isError && selectedExport.data && (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    {t("fseOperations.status")}:{" "}
                    {text(selectedExport.data, "stato")}
                    {selectedExport.data.legacyReviewRequired === true
                      ? ` · ${t("fseOperations.legacyReviewRequired")}`
                      : ""}
                  </p>
                  {user?.permessi?.includes(
                    "magazzino.fse.export.original.view",
                  ) && (
                    <FseOriginalDownload
                      key={selectedExportId}
                      id={selectedExportId!}
                    />
                  )}
                  <FseRequiredInput
                    valid={exportActionText.trim().length >= 3}
                    placeholder={t("fseOperations.motivation")}
                    value={exportActionText}
                    onChange={(event) =>
                      setExportActionText(event.target.value)
                    }
                  />
                  {hasPermission("magazzino.fse.export") && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={
                          !fseExportActionAvailability(
                            selectedExport.data,
                            exportActionText,
                          ).canMarkEntered || markExport.isPending
                        }
                        onClick={() =>
                          markExport.mutate({
                            id: selectedExportId!,
                            data: {
                              versione: Number(selectedExport.data?.versione),
                              data: filters.a,
                              riferimentoEsterno: exportActionText.trim(),
                            },
                          })
                        }
                      >
                        {t("fseOperations.markEntered")}
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={
                          !fseExportActionAvailability(
                            selectedExport.data,
                            exportActionText,
                          ).canCancel || cancelExport.isPending
                        }
                        onClick={() =>
                          cancelExport.mutate({
                            id: selectedExportId!,
                            data: {
                              versione: Number(selectedExport.data?.versione),
                              motivazione: exportActionText.trim(),
                            },
                          })
                        }
                      >
                        {t("fseOperations.cancelExport")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
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
              <Label htmlFor="fse-source-type">
                {t("fseOperations.sourceType")}
              </Label>
              <select
                id="fse-source-type"
                className="h-10 rounded-md border bg-background px-3"
                value={sourceType}
                onChange={(e) => {
                  setSourceType(e.target.value as typeof sourceType);
                  setAgeaId("");
                  setPreviousAgeaId("");
                  setActionError(null);
                }}
              >
                <option value="AGEA_LEGACY">AGEA legacy</option>
                <option value="FSE_M3B">FSE+ M3B</option>
              </select>
              {sourceType === "FSE_M3B" ? (
                <FseAdministrativeSourceForm
                  key={scopeKey}
                  warehouseId={warehouseId}
                  referenceDate={filters.a}
                  scopeKey={scopeKey}
                  pending={createReconciliation.isPending}
                  onCalculate={(data) => createReconciliation.mutate({ data })}
                />
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="agea-id">
                      {t("fseOperations.importId")}
                    </Label>
                    <FseRequiredInput
                      valid={
                        Number.isSafeInteger(Number(ageaId)) &&
                        Number(ageaId) > 0
                      }
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
                      onChange={(event) =>
                        setPreviousAgeaId(event.target.value)
                      }
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
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("fseOperations.reconciliations")}</CardTitle>
            </CardHeader>
            <CardContent>
              <RecordList
                query={reconciliations}
                rows={fseReadableData(reconciliations)?.rows}
                pagination={paging(
                  "reconciliations",
                  fseReadableData(reconciliations)?.total,
                )}
                selectedId={selectedReconciliationId}
                onSelect={(id) => {
                  setSelectedReconciliationId(id);
                  setSelectedLineId(null);
                  setRecalculationSourceVersion("");
                  setPages((current) => ({ ...current, lines: 1 }));
                }}
              />
            </CardContent>
          </Card>
          {selectedReconciliationId != null &&
            fseReadableData(selectedReconciliation) && (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>
                    {t("fseOperations.manageReconciliation")} #
                    {selectedReconciliationId}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedReconciliation.data?.sourceType === "FSE_M3B" && (
                    <FseAdministrativeProvenance
                      key={selectedReconciliationId}
                      id={selectedReconciliationId}
                      scopeKey={scopeKey}
                    />
                  )}
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
                    query={reconciliationLines}
                    rows={fseReadableData(reconciliationLines)?.rows}
                    pagination={paging(
                      "lines",
                      fseReadableData(reconciliationLines)?.total,
                    )}
                    selectedId={selectedLineId}
                    onSelect={setSelectedLineId}
                  />
                  {hasPermission("magazzino.fse.reconcile.manage") && (
                    <div className="grid gap-3 md:grid-cols-2">
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
                        {Object.values(FseResolutionInputAzione).map(
                          (action) => (
                            <option key={action} value={action}>
                              {action}
                            </option>
                          ),
                        )}
                      </select>
                      {resolutionAction === FseResolutionInputAzione.ABBINA && (
                        <>
                          <FseRequiredInput
                            valid={
                              Number.isSafeInteger(Number(targetMovementId)) &&
                              Number(targetMovementId) > 0
                            }
                            type="number"
                            min={1}
                            placeholder={t("fseOperations.targetMovement")}
                            value={targetMovementId}
                            onChange={(event) =>
                              setTargetMovementId(event.target.value)
                            }
                          />
                          <FseRequiredInput
                            valid={
                              Number.isSafeInteger(Number(targetAgeaRowId)) &&
                              Number(targetAgeaRowId) > 0
                            }
                            type="number"
                            min={1}
                            placeholder={t("fseOperations.targetAgeaRow")}
                            value={targetAgeaRowId}
                            onChange={(event) =>
                              setTargetAgeaRowId(event.target.value)
                            }
                          />
                        </>
                      )}
                      <FseRequiredInput
                        valid={resolutionMotivation.trim().length >= 3}
                        aria-label={t("fseOperations.motivation")}
                        placeholder={t("fseOperations.motivation")}
                        value={resolutionMotivation}
                        onChange={(event) =>
                          setResolutionMotivation(event.target.value)
                        }
                      />
                      <Button
                        disabled={
                          !fseResolutionReady({
                            lineId: selectedLineId,
                            action: resolutionAction,
                            motivation: resolutionMotivation,
                            targetMovementId,
                            targetAgeaRowId,
                            hasHeader: selectedReconciliation.data != null,
                          }) || resolveLine.isPending
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
                              movimentoId: targetMovementId
                                ? Number(targetMovementId)
                                : undefined,
                              ...(selectedReconciliation.data?.sourceType ===
                              "FSE_M3B"
                                ? {
                                    observationId: targetAgeaRowId
                                      ? Number(targetAgeaRowId)
                                      : undefined,
                                  }
                                : {
                                    importazioneAgeaRigaId: targetAgeaRowId
                                      ? Number(targetAgeaRowId)
                                      : undefined,
                                  }),
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
                      {selectedReconciliation.data?.sourceType ===
                        "FSE_M3B" && (
                        <div>
                          <Label htmlFor="fse-recalculate-version">
                            {t("fseOperations.sourceVersionRequired")}
                          </Label>
                          <FseRequiredInput
                            id="fse-recalculate-version"
                            type="number"
                            min={1}
                            valid={Number(recalculationSourceVersion) > 0}
                            value={recalculationSourceVersion}
                            onChange={(e) =>
                              setRecalculationSourceVersion(e.target.value)
                            }
                          />
                        </div>
                      )}
                      <Button
                        variant="outline"
                        disabled={
                          !selectedReconciliation.data ||
                          (selectedReconciliation.data?.sourceType ===
                            "FSE_M3B" &&
                            !(Number(recalculationSourceVersion) > 0)) ||
                          recalculateReconciliation.isPending
                        }
                        onClick={() =>
                          recalculateReconciliation.mutate({
                            id: selectedReconciliationId,
                            data: {
                              versione: Number(
                                selectedReconciliation.data?.versione,
                              ),
                              sessionVersion:
                                selectedReconciliation.data?.sourceType ===
                                "FSE_M3B"
                                  ? Number(recalculationSourceVersion)
                                  : undefined,
                            },
                          })
                        }
                      >
                        {t("fseOperations.recalculate")}
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={
                          !selectedReconciliation.data ||
                          [
                            "RICONCILIATA",
                            "CHIUSA_CON_SCOSTAMENTI",
                            "ANNULLATA",
                          ].includes(
                            String(selectedReconciliation.data.stato),
                          ) ||
                          cancelReconciliation.isPending
                        }
                        onClick={() =>
                          cancelReconciliation.mutate({
                            id: selectedReconciliationId,
                            data: {
                              versione: Number(
                                selectedReconciliation.data?.versione,
                              ),
                            },
                          })
                        }
                      >
                        {t("fseOperations.cancelReconciliation")}
                      </Button>
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
        <TabsContent value="indicators" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("fseOperations.monitoringTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FseRequiredInput
                valid={/^\d{4}-(0[1-9]|1[0-2])$/.test(monitoringMonth)}
                type="month"
                value={monitoringMonth}
                onChange={(event) => setMonitoringMonth(event.target.value)}
              />
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={monitoringChannel}
                onChange={(event) => setMonitoringChannel(event.target.value)}
              >
                <option value="PACCHI">PACCHI</option>
                <option value="MENSA">MENSA</option>
                <option value="STRADA">STRADA</option>
              </select>
              <Input
                type="number"
                min={0}
                placeholder={t("fseOperations.monitoringTotalPlaceholder")}
                value={monitoringTotal}
                onChange={(event) => setMonitoringTotal(event.target.value)}
              />
              {hasPermission("magazzino.fse.monitoring.manage") && (
                <Button
                  disabled={!enabled || !monitoringMonth}
                  onClick={() => {
                    if (selectedMonitoring) {
                      updateMonitoring.mutate({
                        id: Number(selectedMonitoring.id),
                        data: {
                          versione: Number(selectedMonitoring.versione),
                          totaleSaltuari:
                            monitoringTotal === ""
                              ? null
                              : Number(monitoringTotal),
                        },
                      });
                    } else {
                      createMonitoring.mutate({
                        data: {
                          magazzinoId: warehouseId,
                          annoMese: monitoringMonth,
                          canaleUfficiale: monitoringChannel as
                            | "PACCHI"
                            | "MENSA"
                            | "STRADA",
                          dataRiferimento: `${monitoringMonth}-01`,
                          fonte: "RILEVAZIONE_MANUALE_VERIFICATA",
                          completezza: "PARZIALE",
                          totaleSaltuari:
                            monitoringTotal === ""
                              ? null
                              : Number(monitoringTotal),
                        },
                      });
                    }
                  }}
                >
                  {selectedMonitoring
                    ? t("fseOperations.updateMonitoring")
                    : t("fseOperations.createMonitoring")}
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("fseOperations.indicators")}</CardTitle>
            </CardHeader>
            <CardContent>
              <RecordList
                query={monitoring}
                rows={fseReadableData(monitoring)?.rows}
                pagination={paging(
                  "monitoring",
                  fseReadableData(monitoring)?.total,
                )}
                selectedId={selectedMonitoringId}
                onSelect={setSelectedMonitoringId}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="anomalies">
          <RecordList
            query={quality}
            rows={fseReadableData(quality)?.rows}
            pagination={paging("quality", fseReadableData(quality)?.total)}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
