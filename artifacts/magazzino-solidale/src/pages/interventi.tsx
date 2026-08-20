import {
  getGetInterventiRiepilogoVisteQueryKey,
  getGetMaterialeDaPreparareQueryKey,
  getGetInterventoOperativitaQueryKey,
  getGetInterventoQueryKey,
  getListBeneficiariQueryKey,
  getListBisogniPianificatiQueryKey,
  getListInterventiOperatoriQueryKey,
  getListInterventiQueryKey,
  getListInterventoStoricoStatiQueryKey,
  getListAreeOperativeQueryKey,
  useCreateIntervento,
  useAggiornaStatoPreparazioneMateriale,
  useAnnullaIntervento,
  useAvviaIntervento,
  useConcludiIntervento,
  useGetIntervento,
  useGetInterventoOperativita,
  useGetInterventiRiepilogoViste,
  useGetMaterialeDaPreparare,
  useListBeneficiari,
  useListBisogniPianificati,
  useListCentriAscolto,
  useListAreeOperative,
  useListInterventi,
  useListInterventiOperatori,
  useListInterventoStoricoStati,
  useListMagazzini,
  useListProdotti,
  useListTipiIntervento,
  useRegistraMancataPresentazione,
  useSalvaInterventoOperativita,
  transitionIntervento,
  updateIntervento,
  type GetInterventiRiepilogoVisteParams,
  type GetMaterialeDaPreparareParams,
  type GetMaterialeDaPrepararePeriodo,
  type Intervento,
  type InterventoConclusioneInput,
  type InterventoInput,
  type ListInterventiParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, PackageOpen, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExportButtons } from "@/components/export-buttons";
import {
  InterventoSocialeDetailSheet,
  type PianificazioneInterventoInput,
} from "@/components/intervento-sociale-detail-sheet";
import {
  InterventoSocialeFormSheet,
  type InterventoSocialeCreateMode,
} from "@/components/intervento-sociale-form-sheet";
import { InterventiSocialiWorkspace } from "@/components/interventi-sociali-workspace";
import { MaterialeDaPreparareView } from "@/components/materiale-da-preparare";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { monthRange, todayEuropeRome } from "@/lib/europe-rome";
import { invalidateInterventiSociali } from "@/lib/interventi-sociali-cache";
import {
  clearInterventiSocialiFilters,
  parseInterventiSocialiFilters,
  serializeInterventiSocialiFilters,
  type InterventiSocialiFilters,
} from "@/lib/interventi-sociali-filters";

function optionalId(value: string): number | undefined {
  return value ? Number(value) : undefined;
}

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return debounced;
}

function calendarInterval(filters: InterventiSocialiFilters): {
  da?: string;
  a?: string;
  valid: boolean;
} {
  if (filters.modo !== "calendario") {
    return filters.da && filters.a
      ? { da: filters.da, a: filters.a, valid: filters.da <= filters.a }
      : { valid: true };
  }
  const month = monthRange(filters.mese);
  const da = filters.da
    ? filters.da > month.da
      ? filters.da
      : month.da
    : month.da;
  const a = filters.a ? (filters.a < month.a ? filters.a : month.a) : month.a;
  return { da, a, valid: da <= a };
}

export default function Interventi() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFiltersState] = useState(() =>
    parseInterventiSocialiFilters(window.location.search),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] =
    useState<InterventoSocialeCreateMode>("da_pianificare");
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
  const [selectedInterventoId, setSelectedInterventoId] = useState<
    number | null
  >(null);
  const [planningPending, setPlanningPending] = useState(false);
  const [preparationMode, setPreparationMode] = useState(false);
  const [preparationPeriod, setPreparationPeriod] =
    useState<GetMaterialeDaPrepararePeriodo>("7");
  const [preparationFrom, setPreparationFrom] = useState(todayEuropeRome());
  const [preparationTo, setPreparationTo] = useState(todayEuropeRome());
  const [pendingMaterialId, setPendingMaterialId] = useState<number | null>(
    null,
  );
  const canCreate = hasPermission("sociale.interventi.create");
  const canUpdate = hasPermission("sociale.interventi.update");
  const canComplete = hasPermission("sociale.interventi.complete");
  const canCancel = hasPermission("sociale.interventi.cancel");
  const debouncedSearch = useDebouncedValue(filters.ricerca, 300);
  const debouncedBeneficiarySearch = useDebouncedValue(beneficiarySearch, 250);

  const isGlobal = user?.areaOperativaId == null;
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const areaOperativaRequired = isGlobal && !filters.areaOperativaId;
  const effectiveAreaOperativaId = isGlobal
    ? optionalId(filters.areaOperativaId)
    : (user?.areaOperativaId ?? undefined);
  const effectiveCentroId = isCentroLocked
    ? lockedCentroId
    : optionalId(filters.centroAscoltoId);

  useEffect(() => {
    const onPopState = () =>
      setFiltersState(parseInterventiSocialiFilters(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const setFilters = (next: InterventiSocialiFilters) => {
    setFiltersState(next);
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${serializeInterventiSocialiFilters(next)}`,
    );
  };

  const interval = useMemo(() => calendarInterval(filters), [filters]);
  const baseFilterParams = useMemo(
    () => ({
      ricerca: debouncedSearch || undefined,
      tipo: filters.tipo || undefined,
      priorita: (filters.priorita ||
        undefined) as ListInterventiParams["priorita"],
      operatoreId: optionalId(filters.operatoreId),
      centroAscoltoId: effectiveCentroId,
      areaOperativaId: effectiveAreaOperativaId,
      stato: (filters.stato || undefined) as ListInterventiParams["stato"],
      ambitoLegacy: filters.ambitoLegacy,
      da: interval.da,
      a: interval.a,
    }),
    [
      debouncedSearch,
      effectiveCentroId,
      effectiveAreaOperativaId,
      filters.ambitoLegacy,
      filters.operatoreId,
      filters.priorita,
      filters.stato,
      filters.tipo,
      interval.a,
      interval.da,
    ],
  );
  const listParams: ListInterventiParams = {
    ...baseFilterParams,
    ambito: "sociale",
    includiStorici: true,
    vista: filters.vista,
    ordina: filters.ordina === "default" ? undefined : filters.ordina,
    direzione: filters.ordina === "default" ? undefined : filters.direzione,
  };
  const summaryParams: GetInterventiRiepilogoVisteParams = {
    ricerca: debouncedSearch || undefined,
    tipo: filters.tipo || undefined,
    priorita: (filters.priorita ||
      undefined) as GetInterventiRiepilogoVisteParams["priorita"],
    operatoreId: optionalId(filters.operatoreId),
    centroAscoltoId: effectiveCentroId,
    areaOperativaId: effectiveAreaOperativaId,
    stato: (filters.stato ||
      undefined) as GetInterventiRiepilogoVisteParams["stato"],
    ambitoLegacy: filters.ambitoLegacy,
    ...(filters.da && filters.a ? { da: filters.da, a: filters.a } : {}),
  };
  const queryEnabled = !areaOperativaRequired && interval.valid;

  const interventiQuery = useListInterventi(listParams, {
    query: {
      queryKey: getListInterventiQueryKey(listParams),
      enabled: queryEnabled,
    },
  });
  const summaryQuery = useGetInterventiRiepilogoViste(summaryParams, {
    query: {
      queryKey: getGetInterventiRiepilogoVisteQueryKey(summaryParams),
      enabled:
        !areaOperativaRequired && (!filters.da || !filters.a || filters.da <= filters.a),
    },
  });
  const operatorParams = {
    areaOperativaId: effectiveAreaOperativaId,
    centroAscoltoId: effectiveCentroId,
  };
  const operatorsQuery = useListInterventiOperatori(operatorParams, {
    query: {
      queryKey: getListInterventiOperatoriQueryKey(operatorParams),
      enabled: !areaOperativaRequired,
    },
  });
  const beneficiaryParams = {
    attivo: true,
    search: debouncedBeneficiarySearch || undefined,
    areaOperativaId: effectiveAreaOperativaId,
    centroAscoltoId: effectiveCentroId,
  };
  const beneficiariesQuery = useListBeneficiari(beneficiaryParams, {
    query: {
      queryKey: getListBeneficiariQueryKey(beneficiaryParams),
      enabled: !areaOperativaRequired,
    },
  });
  const areaOperativaQuery = useListAreeOperative({
    query: { queryKey: getListAreeOperativeQueryKey(), enabled: isGlobal },
  });
  const centersQuery = useListCentriAscolto();
  const typesQuery = useListTipiIntervento();

  const detailId = selectedInterventoId ?? 0;
  const detailQuery = useGetIntervento(detailId, {
    query: {
      queryKey: getGetInterventoQueryKey(detailId),
      enabled: selectedInterventoId != null,
    },
  });
  const operationalQuery = useGetInterventoOperativita(detailId, {
    query: {
      queryKey: getGetInterventoOperativitaQueryKey(detailId),
      enabled: selectedInterventoId != null,
    },
  });
  const historyQuery = useListInterventoStoricoStati(detailId, {
    query: {
      queryKey: getListInterventoStoricoStatiQueryKey(detailId),
      enabled: selectedInterventoId != null,
    },
  });
  const needsQuery = useListBisogniPianificati(detailId, {
    query: {
      queryKey: getListBisogniPianificatiQueryKey(detailId),
      enabled: selectedInterventoId != null,
    },
  });
  const createIntervento = useCreateIntervento();
  const avviaIntervento = useAvviaIntervento();
  const salvaOperativita = useSalvaInterventoOperativita();
  const concludiIntervento = useConcludiIntervento();
  const annullaIntervento = useAnnullaIntervento();
  const mancataPresentazione = useRegistraMancataPresentazione();
  const prodottiQuery = useListProdotti();
  const magazziniQuery = useListMagazzini();
  const aggiornaPreparazione = useAggiornaStatoPreparazioneMateriale();
  const preparationIntervalValid =
    preparationPeriod !== "personalizzato" ||
    (!!preparationFrom && !!preparationTo && preparationFrom <= preparationTo);
  const preparationParams: GetMaterialeDaPreparareParams = {
    periodo: preparationPeriod,
    ...(preparationPeriod === "personalizzato"
      ? { da: preparationFrom, a: preparationTo }
      : {}),
    areaOperativaId: effectiveAreaOperativaId,
    centroAscoltoId: effectiveCentroId,
  };
  const preparationQuery = useGetMaterialeDaPreparare(preparationParams, {
    query: {
      queryKey: getGetMaterialeDaPreparareQueryKey(preparationParams),
      enabled: preparationMode && !areaOperativaRequired && preparationIntervalValid,
    },
  });

  const openForm = (mode: InterventoSocialeCreateMode) => {
    setFormMode(mode);
    setBeneficiarySearch("");
    setFormOpen(true);
  };

  const create = (data: InterventoInput) => {
    createIntervento.mutate(
      { data },
      {
        onSuccess: async () => {
          await invalidateInterventiSociali(queryClient);
          toast({ title: t("interventi.toastRegistered") });
          setFormOpen(false);
        },
        onError: (error) => {
          const candidate = error as {
            data?: { error?: string };
            message?: string;
          };
          toast({
            title: t("interventi.form.saveError"),
            description: candidate.data?.error ?? candidate.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const mutationError = (error: unknown) => {
    const candidate = error as {
      data?: { error?: string };
      message?: string;
      status?: number;
    };
    toast({
      title: t("interventi.operational.operationError"),
      description:
        candidate.status === 409
          ? "L’intervento è stato modificato da un altro operatore. Aggiorna i dati prima di riprovare."
          : (candidate.data?.error ?? candidate.message),
      variant: "destructive",
    });
  };

  const refreshOperational = async (title: string) => {
    if (selectedInterventoId != null) {
      await invalidateInterventiSociali(queryClient, selectedInterventoId);
    } else {
      await invalidateInterventiSociali(queryClient);
    }
    toast({ title });
  };

  const pianifica = async (input: PianificazioneInterventoInput) => {
    if (!detailQuery.data || selectedInterventoId == null) return;
    setPlanningPending(true);
    try {
      const updated = await updateIntervento(selectedInterventoId, {
        versione: detailQuery.data.dataAggiornamento!,
        dataOraPianificata: input.dataOraPianificata,
        priorita: input.priorita,
        sede: input.sede,
        operatoreId: input.operatoreId,
      });
      if (detailQuery.data.stato === "da_pianificare") {
        await transitionIntervento(selectedInterventoId, {
          versione: updated.dataAggiornamento!,
          stato: "pianificato",
          dataOraPianificata: input.dataOraPianificata,
        });
      }
      await refreshOperational(t("interventi.operational.appointmentSaved"));
    } catch (error) {
      mutationError(error);
    } finally {
      setPlanningPending(false);
    }
  };

  const interventi = interventiQuery.data ?? [];
  const allCenters = centersQuery.data ?? [];
  const centers = allCenters.filter((center) => {
    if (isCentroLocked) return center.id === lockedCentroId;
    if (!effectiveAreaOperativaId) return true;
    return center.areaOperativaId == null || center.areaOperativaId === effectiveAreaOperativaId;
  });

  return (
    <div className="mx-auto max-w-[96rem] space-y-6 p-4 sm:p-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("interventi.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("interventi.unifiedSubtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpdate && (
            <Button
              type="button"
              variant={preparationMode ? "default" : "outline"}
              disabled={areaOperativaRequired}
              onClick={() => setPreparationMode((current) => !current)}
            >
              <PackageOpen className="mr-2 h-4 w-4" />
              {preparationMode
                ? t("interventi.preparation.back")
                : t("interventi.preparation.title")}
            </Button>
          )}
          {!preparationMode && canCreate && (
            <ExportButtons
              rows={interventi}
              columns={[
                {
                  header: t("interventi.beneficiario"),
                  accessor: (row: Intervento) => row.beneficiarioNome,
                },
                {
                  header: t("interventi.tipoIntervento"),
                  accessor: (row: Intervento) => row.tipoIntervento,
                },
                {
                  header: t("interventi.detail.state"),
                  accessor: (row: Intervento) => row.stato,
                },
                {
                  header: t("interventi.detail.priority"),
                  accessor: (row: Intervento) => row.priorita,
                },
                {
                  header: t("interventi.operatore"),
                  accessor: (row: Intervento) =>
                    row.operatoreNome ?? row.operatoreCodice,
                },
              ]}
              filename="interventi-sociali"
              title={t("interventi.exportTitle")}
              orientation="landscape"
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={areaOperativaRequired} className="gap-2">
                <Plus className="h-4 w-4" /> {t("interventi.newAction")}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openForm("da_pianificare")}>
                {t("interventi.form.actions.da_pianificare")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openForm("pianificato")}>
                {t("interventi.form.actions.pianificato")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openForm("gia_effettuato")}>
                {t("interventi.form.actions.gia_effettuato")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {preparationMode ? (
        <MaterialeDaPreparareView
          data={preparationQuery.data}
          periodo={preparationPeriod}
          da={preparationFrom}
          a={preparationTo}
          isLoading={preparationQuery.isLoading}
          isError={preparationQuery.isError || !preparationIntervalValid}
          pendingMaterialId={pendingMaterialId}
          onPeriodoChange={setPreparationPeriod}
          onDaChange={setPreparationFrom}
          onAChange={setPreparationTo}
          onOpenIntervento={setSelectedInterventoId}
          onChangeState={(detail, state) => {
            setPendingMaterialId(detail.materialeId);
            aggiornaPreparazione.mutate(
              {
                id: detail.interventoId,
                materialeId: detail.materialeId,
                data: {
                  statoPreparazione: state,
                  versione: detail.versione,
                },
              },
              {
                onSuccess: async () => {
                  await Promise.all([
                    queryClient.invalidateQueries({
                      queryKey:
                        getGetMaterialeDaPreparareQueryKey(preparationParams),
                    }),
                    invalidateInterventiSociali(
                      queryClient,
                      detail.interventoId,
                    ),
                  ]);
                  toast({
                    title: t("interventi.preparation.stateUpdated"),
                  });
                },
                onError: mutationError,
                onSettled: () => setPendingMaterialId(null),
              },
            );
          }}
        />
      ) : (
        <InterventiSocialiWorkspace
          filters={filters}
          interventi={interventi}
          counts={summaryQuery.data}
          areaOperativa={areaOperativaQuery.data ?? []}
          centri={centers}
          tipi={typesQuery.data ?? []}
          operatori={operatorsQuery.data ?? []}
          isGlobal={isGlobal}
          isCentroLocked={isCentroLocked}
          areaOperativaRequired={areaOperativaRequired}
          isLoading={interventiQuery.isLoading}
          isError={interventiQuery.isError || !interval.valid}
          onFiltersChange={setFilters}
          onReset={() => setFilters(clearInterventiSocialiFilters(filters))}
          onOpenIntervento={(intervento) =>
            setSelectedInterventoId(intervento.id)
          }
        />
      )}

      <InterventoSocialeFormSheet
        open={formOpen && canCreate}
        mode={formMode}
        beneficiari={beneficiariesQuery.data ?? []}
        tipi={typesQuery.data ?? []}
        operatori={operatorsQuery.data ?? []}
        currentOperatorId={user?.id}
        beneficiarySearch={beneficiarySearch}
        isPending={createIntervento.isPending}
        onBeneficiarySearch={setBeneficiarySearch}
        onOpenChange={setFormOpen}
        onSubmit={create}
      />

      <InterventoSocialeDetailSheet
        open={selectedInterventoId != null}
        intervento={detailQuery.data}
        operativita={operationalQuery.data}
        storico={historyQuery.data}
        bisogni={needsQuery.data}
        tipi={typesQuery.data ?? []}
        operatori={operatorsQuery.data ?? []}
        prodotti={prodottiQuery.data ?? []}
        magazzini={magazziniQuery.data ?? []}
        isLoading={
          detailQuery.isLoading ||
          operationalQuery.isLoading ||
          historyQuery.isLoading ||
          needsQuery.isLoading
        }
        isPending={
          planningPending ||
          avviaIntervento.isPending ||
          salvaOperativita.isPending ||
          concludiIntervento.isPending ||
          annullaIntervento.isPending ||
          mancataPresentazione.isPending
        }
        canUpdate={canUpdate}
        canComplete={canComplete}
        canCancel={canCancel}
        canCreate={canCreate}
        onOpenChange={(open) => {
          if (!open) setSelectedInterventoId(null);
        }}
        onPianifica={pianifica}
        onAvvia={(versione) => {
          if (selectedInterventoId == null) return;
          avviaIntervento.mutate(
            { id: selectedInterventoId, data: { versione } },
            {
              onSuccess: () =>
                refreshOperational(t("interventi.operational.started")),
              onError: mutationError,
            },
          );
        }}
        onSalva={(data: InterventoConclusioneInput) => {
          if (selectedInterventoId == null) return;
          salvaOperativita.mutate(
            { id: selectedInterventoId, data },
            {
              onSuccess: () =>
                refreshOperational(t("interventi.operational.saved")),
              onError: mutationError,
            },
          );
        }}
        onConcludi={(data) => {
          if (selectedInterventoId == null) return;
          concludiIntervento.mutate(
            { id: selectedInterventoId, data },
            {
              onSuccess: () =>
                refreshOperational(t("interventi.operational.concluded")),
              onError: mutationError,
            },
          );
        }}
        onAnnulla={(versione, motivo) => {
          if (selectedInterventoId == null) return;
          annullaIntervento.mutate(
            { id: selectedInterventoId, data: { versione, motivo } },
            {
              onSuccess: () =>
                refreshOperational(t("interventi.operational.cancelled")),
              onError: mutationError,
            },
          );
        }}
        onMancataPresentazione={(versione, nota) => {
          if (selectedInterventoId == null) return;
          mancataPresentazione.mutate(
            { id: selectedInterventoId, data: { versione, nota } },
            {
              onSuccess: () =>
                refreshOperational(t("interventi.operational.noShowSaved")),
              onError: mutationError,
            },
          );
        }}
      />
    </div>
  );
}
