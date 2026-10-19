import { operationalCentroId } from "@/lib/service-scope";
import {
  getCurrentUser,
  listInterventiOperatori,
  getGetInterventiRiepilogoVisteQueryKey,
  getGetInterventoOperativitaQueryKey,
  getGetInterventoQueryKey,
  getListBeneficiariQueryKey,
  getListBisogniPianificatiQueryKey,
  getListInterventiOperatoriQueryKey,
  getListInterventoStoricoStatiQueryKey,
  getListAreeOperativeQueryKey,
  useCreateIntervento,
  useAnnullaIntervento,
  useAvviaIntervento,
  useConcludiIntervento,
  useGetIntervento,
  useGetInterventoOperativita,
  useGetInterventiRiepilogoViste,
  useListBeneficiari,
  useListBisogniPianificati,
  useListCentriAscolto,
  useListAreeOperative,
  useListInterventiPagina,
  listInterventiPagina,
  getListInterventiPaginaQueryKey,
  useListInterventiOperatori,
  useListInterventoStoricoStati,
  useListTipiIntervento,
  useRegistraMancataPresentazione,
  useSalvaInterventoOperativita,
  transitionIntervento,
  updateIntervento,
  type GetInterventiRiepilogoVisteParams,
  type Intervento,
  type InterventoConclusioneInput,
  type InterventoInput,
  type ListInterventiParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  interventiIdentity,
  isInterventoReadDenied,
  useInterventiAccess,
} from "@/hooks/use-interventi-access";
import { monthRange, todayEuropeRome } from "@/lib/europe-rome";
import { invalidateInterventiSociali } from "@/lib/interventi-sociali-cache";
import {
  clearInterventiSocialiFilters,
  focusInterventiSocialiFilters,
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
  const { user } = useAuth();
  const identity = interventiIdentity(user);
  return <InterventiSession key={identity} identity={identity} />;
}

function InterventiSession({ identity }: { identity: string }) {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const access = useInterventiAccess(identity);
  const [filters, setFiltersState] = useState(() =>
    parseInterventiSocialiFilters(window.location.search),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] =
    useState<InterventoSocialeCreateMode>("da_pianificare");
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
  const [selectedInterventoId, setSelectedInterventoId] = useState<
    number | null
  >(() => {
    const value = Number(
      new URLSearchParams(window.location.search).get("interventoId"),
    );
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const [planningPending, setPlanningPending] = useState(false);
  const canCreate = hasPermission("sociale.interventi.create");
  const canUpdate = hasPermission("sociale.interventi.update");
  const canComplete = hasPermission("sociale.interventi.complete");
  const canCancel = hasPermission("sociale.interventi.cancel");
  const debouncedSearch = useDebouncedValue(filters.ricerca, 300);
  const debouncedBeneficiarySearch = useDebouncedValue(beneficiarySearch, 250);

  const isGlobal = Boolean(
    user?.isAdmin &&
    user.areaOperativaId == null &&
    user.centroAscoltoId == null &&
    user.zonaUdsId == null,
  );
  const canRead =
    Boolean(
      user &&
      (user.isAdmin || user.aree?.includes("sociale")) &&
      hasPermission("sociale.interventi.view") &&
      (isGlobal || user.areaOperativaId != null),
    ) && !access.blocked;
  const lockedCentroId = operationalCentroId(user);
  const isCentroLocked = lockedCentroId != null;
  const areaOperativaRequired = isGlobal && !filters.areaOperativaId;
  const effectiveAreaOperativaId = isGlobal
    ? optionalId(filters.areaOperativaId)
    : (user?.areaOperativaId ?? undefined);
  const effectiveCentroId = isCentroLocked
    ? lockedCentroId
    : optionalId(filters.centroAscoltoId);

  useEffect(() => {
    const onPopState = () => {
      setFiltersState(parseInterventiSocialiFilters(window.location.search));
      const value = Number(
        new URLSearchParams(window.location.search).get("interventoId"),
      );
      setSelectedInterventoId(
        Number.isInteger(value) && value > 0 ? value : null,
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const setFilters = (next: InterventiSocialiFilters) => {
    if (
      Object.keys(next).some(
        (key) =>
          key !== "pagina" &&
          next[key as keyof typeof next] !==
            filters[key as keyof typeof filters],
      )
    )
      next = { ...next, pagina: 1 };
    setFiltersState(next);
    const params = new URLSearchParams(serializeInterventiSocialiFilters(next));
    if (selectedInterventoId != null) {
      params.set("interventoId", String(selectedInterventoId));
    }
    window.history.pushState(null, "", `${window.location.pathname}?${params}`);
  };

  const openIntervento = (id: number, nextFilters = filters) => {
    setFiltersState(nextFilters);
    setSelectedInterventoId(id);
    const params = new URLSearchParams(
      serializeInterventiSocialiFilters(nextFilters),
    );
    params.set("interventoId", String(id));
    window.history.pushState(null, "", `${window.location.pathname}?${params}`);
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
    pagina: filters.pagina,
    limite: 50,
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
  const queryEnabled = canRead && !areaOperativaRequired && interval.valid;

  const interventiQuery = useListInterventiPagina(listParams, {
    query: {
      queryKey: access.key(getListInterventiPaginaQueryKey(listParams)),
      enabled: queryEnabled,
      retry: false,
    },
  });
  const summaryQuery = useGetInterventiRiepilogoViste(summaryParams, {
    query: {
      queryKey: access.key(
        getGetInterventiRiepilogoVisteQueryKey(summaryParams),
      ),
      enabled:
        canRead &&
        !areaOperativaRequired &&
        (!filters.da || !filters.a || filters.da <= filters.a),
    },
  });
  const operatorParams = {
    areaOperativaId: effectiveAreaOperativaId,
    centroAscoltoId: effectiveCentroId,
  };
  const operatorsQuery = useListInterventiOperatori(operatorParams, {
    query: {
      queryKey: access.key(getListInterventiOperatoriQueryKey(operatorParams)),
      enabled: canRead && !areaOperativaRequired,
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
      queryKey: access.key(getListBeneficiariQueryKey(beneficiaryParams)),
      enabled: canRead && !areaOperativaRequired,
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
      queryKey: access.key(getGetInterventoQueryKey(detailId)),
      enabled: canRead && selectedInterventoId != null,
      retry: false,
    },
  });
  const operationalQuery = useGetInterventoOperativita(detailId, {
    query: {
      queryKey: access.key(getGetInterventoOperativitaQueryKey(detailId)),
      enabled: canRead && selectedInterventoId != null,
      retry: false,
    },
  });
  const historyQuery = useListInterventoStoricoStati(detailId, {
    query: {
      queryKey: access.key(getListInterventoStoricoStatiQueryKey(detailId)),
      enabled: canRead && selectedInterventoId != null,
      retry: false,
    },
  });
  const needsQuery = useListBisogniPianificati(detailId, {
    query: {
      queryKey: access.key(getListBisogniPianificatiQueryKey(detailId)),
      enabled: canRead && selectedInterventoId != null,
      retry: false,
    },
  });
  const createIntervento = useCreateIntervento();
  const avviaIntervento = useAvviaIntervento();
  const salvaOperativita = useSalvaInterventoOperativita();
  const concludiIntervento = useConcludiIntervento();
  const annullaIntervento = useAnnullaIntervento();
  const mancataPresentazione = useRegistraMancataPresentazione();
  const protectedReads = [
    interventiQuery,
    summaryQuery,
    operatorsQuery,
    beneficiariesQuery,
    detailQuery,
    operationalQuery,
    historyQuery,
    needsQuery,
  ];
  const readDenied = protectedReads.some((query) =>
    isInterventoReadDenied(query.error),
  );
  const readUnavailable = protectedReads.some(
    (query) => query.error && !isInterventoReadDenied(query.error),
  );
  useEffect(() => {
    if (readDenied && !access.blocked) access.revoke();
  }, [readDenied, access.blocked]);

  const openForm = (mode: InterventoSocialeCreateMode) => {
    setFormMode(mode);
    setBeneficiarySearch("");
    setFormOpen(true);
  };

  const create = (data: InterventoInput) => {
    createIntervento.mutate(
      { data },
      {
        onSuccess: async (created) => {
          setFormOpen(false);
          if (
            created.stato === "da_pianificare" ||
            created.stato === "pianificato"
          ) {
            openIntervento(
              created.id,
              focusInterventiSocialiFilters(
                filters,
                created.stato === "da_pianificare"
                  ? "da_pianificare"
                  : "pianificati",
              ),
            );
          }
          await invalidateInterventiSociali(queryClient);
          toast({ title: t("interventi.toastRegistered") });
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
      description: candidate.data?.error ?? candidate.message,
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
        openIntervento(
          selectedInterventoId,
          focusInterventiSocialiFilters(filters, "pianificati"),
        );
      }
      await refreshOperational(t("interventi.operational.appointmentSaved"));
    } catch (error) {
      mutationError(error);
    } finally {
      setPlanningPending(false);
    }
  };

  const interventi = interventiQuery.data?.items ?? [];
  const allCenters = centersQuery.data ?? [];
  const centers = allCenters.filter((center) => {
    if (isCentroLocked) return center.id === lockedCentroId;
    if (!effectiveAreaOperativaId) return true;
    return (
      center.areaOperativaId == null ||
      center.areaOperativaId === effectiveAreaOperativaId
    );
  });

  if (!canRead || readDenied)
    return (
      <p role="alert" className="p-6 text-destructive">
        {t("interventi.accessDenied")}
      </p>
    );

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
          {canCreate && (
            <ExportButtons
              rows={interventi}
              disabled={!queryEnabled || interventiQuery.isError}
              loadRows={async () => {
                const rows: Intervento[] = [];
                const seen = new Set<number>();
                for (let pagina = 1; ; pagina++) {
                  access.assertCurrent();
                  const page = await listInterventiPagina({
                    ...listParams,
                    pagina,
                    limite: 200,
                  });
                  access.assertCurrent();
                  for (const row of page.items) {
                    if (!seen.has(row.id)) {
                      rows.push(row);
                      seen.add(row.id);
                    }
                  }
                  if (page.items.length < page.limite) break;
                }
                return rows;
              }}
              beforeExport={async () => {
                access.assertCurrent();
                const current = await getCurrentUser();
                if (interventiIdentity(current) !== identity)
                  throw Object.assign(new Error(t("interventi.accessDenied")), {
                    status: 403,
                  });
                // This scoped read denies inactive/incoherent assignments; an
                // empty legacy list alone is not evidence of continuing access.
                await listInterventiOperatori(operatorParams);
                access.assertCurrent();
              }}
              onError={(error) => {
                if (isInterventoReadDenied(error)) access.revoke();
                toast({
                  title: t("common.error"),
                  description: isInterventoReadDenied(error)
                    ? t("interventi.accessDenied")
                    : t("interventi.readUnavailable"),
                  variant: "destructive",
                });
              }}
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
              title={t("interventi.exportAllFiltered")}
              subtitle={t("interventi.liveResults")}
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
                <span>
                  <span className="block">
                    {t("interventi.form.actions.da_pianificare")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("interventi.form.descriptions.da_pianificare")}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openForm("pianificato")}>
                <span>
                  <span className="block">
                    {t("interventi.form.actions.pianificato")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("interventi.form.descriptions.pianificato")}
                  </span>
                </span>
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
        onOpenIntervento={(intervento) => openIntervento(intervento.id)}
      />
      <nav
        aria-label={t("interventi.pagination")}
        className="flex flex-wrap items-center gap-3"
      >
        <Button
          variant="outline"
          disabled={filters.pagina <= 1 || interventiQuery.isFetching}
          onClick={() => setFilters({ ...filters, pagina: filters.pagina - 1 })}
        >
          {t("interventi.previousPage")}
        </Button>
        <span>
          {t("interventi.pageTotal", {
            page: filters.pagina,
            total: interventiQuery.data?.total ?? 0,
          })}
        </span>
        <Button
          variant="outline"
          disabled={
            filters.pagina * 50 >= (interventiQuery.data?.total ?? 0) ||
            interventiQuery.isFetching
          }
          onClick={() => setFilters({ ...filters, pagina: filters.pagina + 1 })}
        >
          {t("interventi.nextPage")}
        </Button>
        {filters.modo === "calendario" &&
          (interventiQuery.data?.total ?? 0) > 50 && (
            <p role="status">{t("interventi.calendarPartial")}</p>
          )}
      </nav>
      <p className="text-xs text-muted-foreground">
        {t("interventi.liveResults")}
      </p>

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
        readUnavailable={readUnavailable}
        key={`${identity}:${detailId}`}
        open={selectedInterventoId != null}
        intervento={detailQuery.data}
        operativita={operationalQuery.data}
        storico={historyQuery.data}
        bisogni={needsQuery.data}
        tipi={typesQuery.data ?? []}
        operatori={operatorsQuery.data ?? []}
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
          if (!open) {
            setSelectedInterventoId(null);
            const params = new URLSearchParams(window.location.search);
            params.delete("interventoId");
            window.history.pushState(
              null,
              "",
              `${window.location.pathname}${params.size ? `?${params}` : ""}`,
            );
          }
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
