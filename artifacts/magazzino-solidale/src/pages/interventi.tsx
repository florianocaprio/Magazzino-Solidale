import {
  getGetInterventiRiepilogoVisteQueryKey,
  getGetInterventoQueryKey,
  getListBeneficiariQueryKey,
  getListBisogniPianificatiQueryKey,
  getListInterventiOperatoriQueryKey,
  getListInterventiQueryKey,
  getListInterventoStoricoStatiQueryKey,
  getListCittaQueryKey,
  useCreateIntervento,
  useGetIntervento,
  useGetInterventiRiepilogoViste,
  useListBeneficiari,
  useListBisogniPianificati,
  useListCentriAscolto,
  useListCitta,
  useListInterventi,
  useListInterventiOperatori,
  useListInterventoStoricoStati,
  useListTipiIntervento,
  type GetInterventiRiepilogoVisteParams,
  type Intervento,
  type InterventoInput,
  type ListInterventiParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExportButtons } from "@/components/export-buttons";
import { InterventoSocialeDetailSheet } from "@/components/intervento-sociale-detail-sheet";
import {
  InterventoSocialeFormSheet,
  type InterventoSocialeCreateMode,
} from "@/components/intervento-sociale-form-sheet";
import { InterventiSocialiWorkspace } from "@/components/interventi-sociali-workspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { monthRange } from "@/lib/europe-rome";
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
  const { user } = useAuth();
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
  const debouncedSearch = useDebouncedValue(filters.ricerca, 300);
  const debouncedBeneficiarySearch = useDebouncedValue(beneficiarySearch, 250);

  const isGlobal = user?.cittaId == null;
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const cityRequired = isGlobal && !filters.cittaId;
  const effectiveCittaId = isGlobal
    ? optionalId(filters.cittaId)
    : (user?.cittaId ?? undefined);
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
      cittaId: effectiveCittaId,
      stato: (filters.stato || undefined) as ListInterventiParams["stato"],
      ambitoLegacy: filters.ambitoLegacy,
      da: interval.da,
      a: interval.a,
    }),
    [
      debouncedSearch,
      effectiveCentroId,
      effectiveCittaId,
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
    cittaId: effectiveCittaId,
    stato: (filters.stato ||
      undefined) as GetInterventiRiepilogoVisteParams["stato"],
    ambitoLegacy: filters.ambitoLegacy,
    ...(filters.da && filters.a ? { da: filters.da, a: filters.a } : {}),
  };
  const queryEnabled = !cityRequired && interval.valid;

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
        !cityRequired && (!filters.da || !filters.a || filters.da <= filters.a),
    },
  });
  const operatorParams = {
    cittaId: effectiveCittaId,
    centroAscoltoId: effectiveCentroId,
  };
  const operatorsQuery = useListInterventiOperatori(operatorParams, {
    query: {
      queryKey: getListInterventiOperatoriQueryKey(operatorParams),
      enabled: !cityRequired,
    },
  });
  const beneficiaryParams = {
    attivo: true,
    search: debouncedBeneficiarySearch || undefined,
    cittaId: effectiveCittaId,
    centroAscoltoId: effectiveCentroId,
  };
  const beneficiariesQuery = useListBeneficiari(beneficiaryParams, {
    query: {
      queryKey: getListBeneficiariQueryKey(beneficiaryParams),
      enabled: !cityRequired,
    },
  });
  const cittaQuery = useListCitta({
    query: { queryKey: getListCittaQueryKey(), enabled: isGlobal },
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

  const interventi = interventiQuery.data ?? [];
  const allCenters = centersQuery.data ?? [];
  const centers = allCenters.filter((center) => {
    if (isCentroLocked) return center.id === lockedCentroId;
    if (!effectiveCittaId) return true;
    return center.cittaId == null || center.cittaId === effectiveCittaId;
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={cityRequired} className="gap-2">
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

      <InterventiSocialiWorkspace
        filters={filters}
        interventi={interventi}
        counts={summaryQuery.data}
        citta={cittaQuery.data ?? []}
        centri={centers}
        tipi={typesQuery.data ?? []}
        operatori={operatorsQuery.data ?? []}
        isGlobal={isGlobal}
        isCentroLocked={isCentroLocked}
        cityRequired={cityRequired}
        isLoading={interventiQuery.isLoading}
        isError={interventiQuery.isError || !interval.valid}
        onFiltersChange={setFilters}
        onReset={() => setFilters(clearInterventiSocialiFilters(filters))}
        onOpenIntervento={(intervento) =>
          setSelectedInterventoId(intervento.id)
        }
      />

      <InterventoSocialeFormSheet
        open={formOpen}
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
        storico={historyQuery.data}
        bisogni={needsQuery.data}
        isLoading={
          detailQuery.isLoading ||
          historyQuery.isLoading ||
          needsQuery.isLoading
        }
        onOpenChange={(open) => {
          if (!open) setSelectedInterventoId(null);
        }}
      />
    </div>
  );
}
