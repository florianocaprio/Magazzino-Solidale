import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCercaBeneficiariSimiliQueryKey,
  getListBeneficiariQueryKey,
  getListAreeOperativeQueryKey,
  getListUdsDirectoryQueryKey,
  type BeneficiarioSimile,
  type UdsDirectoryItem,
  useCercaBeneficiariSimili,
  useCreateBeneficiario,
  useListCentriAscolto,
  useListAreeOperative,
  useListZoneUds,
  useListUdsDirectory,
  useUpdateBeneficiario,
} from "@workspace/api-client-react";
import {
  FASCE_ETA_PRESUNTE,
  isFasciaEtaPresunta,
  risolviFasciaEta,
} from "@workspace/api-zod";
import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { isNotFutureDateOnly, todayDateOnly } from "@/lib/date-only";
import { fasciaEtaLabel, fasciaEtaOrigineLabel } from "@/lib/fascia-eta";
import { SESSO_OPTIONS } from "@/lib/sesso-options";

const NO_ZONE = "__none__";
const NO_CENTRO = "__nocentro__";
const NO_FASCIA_ETA = "__non_determinata__";

function makeSchema(t: (key: string) => string, isGlobal: boolean) {
  return z
    .object({
      nome: z.string().min(1, t("common.requiredField")),
      cognome: z.string().min(1, t("common.requiredField")),
      soprannome: z.string().optional(),
      codiceFiscale: z.string().optional(),
      dataNascita: z
        .string()
        .optional()
        .refine(
          isNotFutureDateOnly,
          "La data di nascita non può essere successiva alla data odierna.",
        ),
      fasciaEtaPresunta: z.string().optional(),
      sesso: z.string().min(1, t("beneficiari.sessoRequired")),
      cittadinanza: z.string().optional(),
      areaProvenienza: z.string().min(1, t("common.requiredField")),
      residenza: z.string().optional(),
      domicilio: z.string().optional(),
      telefono: z.string().optional(),
      email: z.string().optional(),
      comune: z.string().optional(),
      zonaMunicipio: z.string().optional(),
      numComponenti: z.string().optional(),
      priorita: z.string().optional(),
      consegnaDomicilio: z.boolean().optional(),
      motivoConsegnaDomicilio: z.string().optional(),
      restrizioniAlimentari: z.string().optional(),
      zonaUdsId: z.string().optional(),
      areaOperativaId: z.string().optional(),
      centroAscoltoId: z.string().optional(),
      uds: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      if (
        (data.uds ?? true) &&
        !data.dataNascita &&
        !isFasciaEtaPresunta(data.fasciaEtaPresunta)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["fasciaEtaPresunta"],
          message: t("udsAnagrafica.ageClassificationRequired"),
        });
      }
      if (isGlobal && (data.uds ?? true) && !data.areaOperativaId) {
        ctx.addIssue({
          code: "custom",
          path: ["areaOperativaId"],
          message: t("common.requiredField"),
        });
      }
    });
}
type FormValues = z.infer<ReturnType<typeof makeSchema>>;

export type UdsPersonaOutcome = "created" | "linked" | "existing";

export interface UdsPersonaSelection {
  id: number;
  nome: string;
  cognome: string;
  soprannome?: string | null;
  areaOperativaId?: number | null;
  zonaUdsId?: number | null;
}

interface UdsPersonaSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAreaOperativaId?: number | null;
  initialZonaUdsId?: number | null;
  onPersonReady?: (
    person: UdsPersonaSelection,
    outcome: UdsPersonaOutcome,
  ) => void;
}

function extractError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const compact = phone.trim();
  if (compact.length <= 4) return compact;
  return `•••• ${compact.slice(-4)}`;
}

function emptyFormValues(
  initialAreaOperativaId?: number | null,
  initialZonaUdsId?: number | null,
): FormValues {
  return {
    nome: "",
    cognome: "",
    soprannome: "",
    codiceFiscale: "",
    dataNascita: "",
    fasciaEtaPresunta: NO_FASCIA_ETA,
    sesso: "",
    cittadinanza: "",
    areaProvenienza: "",
    residenza: "",
    domicilio: "",
    telefono: "",
    email: "",
    comune: "",
    zonaMunicipio: "",
    numComponenti: "1",
    priorita: "media",
    consegnaDomicilio: false,
    motivoConsegnaDomicilio: "",
    restrizioniAlimentari: "",
    zonaUdsId: initialZonaUdsId != null ? String(initialZonaUdsId) : NO_ZONE,
    areaOperativaId:
      initialAreaOperativaId != null ? String(initialAreaOperativaId) : "",
    centroAscoltoId: "",
    uds: true,
  };
}

export function UdsPersonaSheet({
  open,
  onOpenChange,
  initialAreaOperativaId,
  initialZonaUdsId,
  onPersonReady,
}: UdsPersonaSheetProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canViewSensitive = Boolean(
    user?.isAdmin || user?.permessi?.includes("beneficiari.sensitive.view"),
  );
  const canUseFullDuplicateSearch = Boolean(
    user?.isAdmin ||
      user?.isSuperAdmin ||
      (user?.aree?.includes("sociale") &&
        user?.permessi?.includes("beneficiari.duplicates.search")),
  );
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isGlobal = user?.areaOperativaId == null;
  const schema = useMemo(() => makeSchema(t, isGlobal), [t, isGlobal]);
  const [linkCandidate, setLinkCandidate] = useState<BeneficiarioSimile | null>(
    null,
  );
  const [dupDismissed, setDupDismissed] = useState(false);
  const [existingSearch, setExistingSearch] = useState("");
  const [debouncedExistingSearch, setDebouncedExistingSearch] = useState("");
  const [dupDebouncing, setDupDebouncing] = useState(false);
  const [dupParams, setDupParams] = useState<{
    nome?: string;
    cognome?: string;
    soprannome?: string;
    telefono?: string;
    dataNascita?: string;
  }>({});

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyFormValues(
      initialAreaOperativaId,
      initialZonaUdsId ?? user?.zonaUdsId,
    ),
  });
  const { reset } = form;
  const wasOpenRef = useRef(false);

  const { data: areaOperativaList } = useListAreeOperative({
    query: { queryKey: getListAreeOperativeQueryKey(), enabled: isGlobal },
  });
  const { data: centri } = useListCentriAscolto();
  const createBenef = useCreateBeneficiario();
  const updateBenef = useUpdateBeneficiario();

  const resetLookup = () => {
    setDupDismissed(false);
    setDupParams({});
    setExistingSearch("");
    setDebouncedExistingSearch("");
    setDupDebouncing(false);
    setLinkCandidate(null);
  };

  useEffect(() => {
    const hasJustOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!hasJustOpened) return;

    reset(
      emptyFormValues(
        initialAreaOperativaId,
        initialZonaUdsId ?? user?.zonaUdsId,
      ),
    );
    setDupDismissed(false);
    setDupParams({});
    setExistingSearch("");
    setDebouncedExistingSearch("");
    setDupDebouncing(false);
    setLinkCandidate(null);
  }, [initialAreaOperativaId, initialZonaUdsId, open, reset, user?.zonaUdsId]);

  const wNome = form.watch("nome");
  const wCognome = form.watch("cognome");
  const wSoprannome = form.watch("soprannome");
  const wTelefono = form.watch("telefono");
  const wDataNascita = form.watch("dataNascita");
  const wFasciaEtaPresunta = form.watch("fasciaEtaPresunta");
  const fasciaEtaCorrente = risolviFasciaEta(
    wDataNascita,
    isFasciaEtaPresunta(wFasciaEtaPresunta) ? wFasciaEtaPresunta : null,
  );
  const fasciaEtaPresuntaDirty = form.formState.dirtyFields.fasciaEtaPresunta;
  useEffect(() => {
    if (!open) return;
    const rawIdentityLength = [wNome, wCognome, wSoprannome, wTelefono]
      .map((value) => (value ?? "").trim())
      .join("").length;
    const hasRawLookup =
      existingSearch.trim().length >= 2 || rawIdentityLength >= 2;
    setDupDebouncing(hasRawLookup);
    const handle = setTimeout(() => {
      setDebouncedExistingSearch(existingSearch.trim());
      setDupParams({
        nome: (wNome ?? "").trim(),
        cognome: (wCognome ?? "").trim(),
        soprannome: (wSoprannome ?? "").trim(),
        telefono: (wTelefono ?? "").trim(),
        dataNascita: (wDataNascita ?? "").trim(),
      });
      setDupDismissed(false);
      setDupDebouncing(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [
    existingSearch,
    open,
    wCognome,
    wDataNascita,
    wNome,
    wSoprannome,
    wTelefono,
  ]);

  const dupHasInput =
    debouncedExistingSearch.length >= 2 ||
    (dupParams.nome ?? "").length + (dupParams.cognome ?? "").length >= 2 ||
    (dupParams.soprannome ?? "").length >= 2 ||
    (dupParams.telefono ?? "").length >= 2;
  const selectedAreaOperativa = form.watch("areaOperativaId");
  const dupAreaOperativa =
    isGlobal && selectedAreaOperativa
      ? parseInt(selectedAreaOperativa)
      : undefined;
  const dupScopeReady = !isGlobal || dupAreaOperativa != null;
  const dupQueryParams = {
    ...dupParams,
    ...(debouncedExistingSearch.length >= 2
      ? { search: debouncedExistingSearch }
      : {}),
    ...(dupAreaOperativa != null ? { areaOperativaId: dupAreaOperativa } : {}),
  };
  const { data: dupMatches, isFetching: isDupFetching } =
    useCercaBeneficiariSimili(dupQueryParams, {
      query: {
        queryKey: getCercaBeneficiariSimiliQueryKey(dupQueryParams),
        enabled:
          canUseFullDuplicateSearch &&
          open &&
          !dupDismissed &&
          dupHasInput &&
          dupScopeReady,
      },
    });
  const suggestions = canUseFullDuplicateSearch ? (dupMatches ?? []) : [];
  const directorySearch =
    debouncedExistingSearch.length >= 2
      ? debouncedExistingSearch
      : ([
          dupParams.cognome,
          dupParams.nome,
          dupParams.soprannome,
          dupParams.telefono,
        ]
          .map((value) => value?.trim() ?? "")
          .find((value) => value.length >= 2) ?? "");
  const directoryParams = {
    search: directorySearch,
    ...(dupAreaOperativa != null ? { areaOperativaId: dupAreaOperativa } : {}),
    page: 1,
    limit: 20,
  };
  const { data: directoryMatches, isFetching: isDirectoryFetching } =
    useListUdsDirectory(directoryParams, {
      query: {
        queryKey: getListUdsDirectoryQueryKey(directoryParams),
        enabled:
          open && !dupDismissed && directorySearch.length >= 2 && dupScopeReady,
      },
    });

  const formAreaOperativa = isGlobal
    ? selectedAreaOperativa
      ? parseInt(selectedAreaOperativa)
      : undefined
    : (user?.areaOperativaId ?? undefined);
  const { data: formZone } = useListZoneUds(
    formAreaOperativa ? { areaOperativaId: formAreaOperativa } : undefined,
    {
      query: {
        queryKey: ["zoneUds", "personaForm", formAreaOperativa],
        enabled: formAreaOperativa != null,
      },
    },
  );

  const finish = (person: UdsPersonaSelection, outcome: UdsPersonaOutcome) => {
    onPersonReady?.(person, outcome);
    onOpenChange(false);
    resetLookup();
  };

  const handleSuggestion = (suggestion: BeneficiarioSimile) => {
    if (suggestion.uds) {
      if (onPersonReady) finish(suggestion, "existing");
      return;
    }
    setLinkCandidate(suggestion);
  };

  const handleDirectorySuggestion = (suggestion: UdsDirectoryItem) => {
    if (!onPersonReady) return;
    finish(
      {
        id: suggestion.id,
        nome: suggestion.nome,
        cognome: suggestion.cognome,
        soprannome: suggestion.soprannome,
        zonaUdsId: suggestion.zonaUdsId,
      },
      "existing",
    );
  };

  const confirmLinkToUds = () => {
    const suggestion = linkCandidate;
    if (!suggestion) return;
    const zonaValue = form.getValues("zonaUdsId");
    const targetZona =
      zonaValue && zonaValue !== NO_ZONE
        ? parseInt(zonaValue)
        : (user?.zonaUdsId ?? null);
    updateBenef.mutate(
      {
        id: suggestion.id,
        data: {
          uds: true,
          versione: suggestion.versione,
          ...(targetZona != null ? { zonaUdsId: targetZona } : {}),
          ...(fasciaEtaPresuntaDirty
            ? {
                fasciaEtaPresunta: isFasciaEtaPresunta(wFasciaEtaPresunta)
                  ? wFasciaEtaPresunta
                  : null,
              }
            : {}),
        } as never,
      },
      {
        onSuccess: (linked) => {
          queryClient.invalidateQueries({
            queryKey: getListBeneficiariQueryKey(),
          });
          toast({ title: t("udsAnagrafica.dupLinked") });
          finish(linked, "linked");
        },
        onError: (err) => {
          toast({
            title: t("udsAnagrafica.newTitle"),
            description: extractError(err, t("common.requiredField")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const onSubmit = (data: FormValues) => {
    if (
      !dupDismissed &&
      (dupDebouncing ||
        isDupFetching ||
        isDirectoryFetching ||
        suggestions.length > 0 ||
        (directoryMatches?.length ?? 0) > 0)
    ) {
      toast({
        title: t("udsAnagrafica.dupCheckRequired"),
        description: t("udsAnagrafica.dupCheckRequiredHint"),
        variant: "destructive",
      });
      return;
    }
    const payload: Record<string, unknown> = {
      nome: data.nome,
      cognome: data.cognome,
      uds: isGlobal ? (data.uds ?? true) : true,
      centroAscoltoId:
        data.centroAscoltoId && data.centroAscoltoId !== NO_CENTRO
          ? parseInt(data.centroAscoltoId)
          : null,
    };
    if (data.soprannome) payload.soprannome = data.soprannome;
    if (data.codiceFiscale) payload.codiceFiscale = data.codiceFiscale;
    if (data.dataNascita) payload.dataNascita = data.dataNascita;
    payload.fasciaEtaPresunta = data.dataNascita
      ? null
      : isFasciaEtaPresunta(data.fasciaEtaPresunta)
      ? data.fasciaEtaPresunta
      : null;
    payload.sesso = data.sesso;
    if (data.cittadinanza) payload.cittadinanza = data.cittadinanza;
    if (data.areaProvenienza) payload.areaProvenienza = data.areaProvenienza;
    if (data.residenza) payload.residenza = data.residenza;
    if (data.domicilio) payload.domicilio = data.domicilio;
    if (data.telefono) payload.telefono = data.telefono;
    if (data.email) payload.email = data.email;
    if (data.comune) payload.comune = data.comune;
    if (data.zonaMunicipio) payload.zonaMunicipio = data.zonaMunicipio;
    if (data.numComponenti)
      payload.numComponenti = parseInt(data.numComponenti);
    if (data.priorita) payload.priorita = data.priorita;
    payload.consegnaDomicilio = data.consegnaDomicilio ?? false;
    if (data.motivoConsegnaDomicilio)
      payload.motivoConsegnaDomicilio = data.motivoConsegnaDomicilio;
    if (data.restrizioniAlimentari)
      payload.restrizioniAlimentari = data.restrizioniAlimentari;
    if (
      (isGlobal ? data.uds : true) &&
      data.zonaUdsId &&
      data.zonaUdsId !== NO_ZONE
    ) {
      payload.zonaUdsId = parseInt(data.zonaUdsId);
    }
    if (isGlobal && data.areaOperativaId)
      payload.areaOperativaId = parseInt(data.areaOperativaId);

    createBenef.mutate(
      { data: payload as never },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({
            queryKey: getListBeneficiariQueryKey(),
          });
          toast({ title: t("udsAnagrafica.toastCreated") });
          finish(created, "created");
        },
        onError: (err) => {
          toast({
            title: t("udsAnagrafica.newTitle"),
            description: extractError(err, t("common.requiredField")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const watchUds = form.watch("uds");
  const duplicateCheckPending =
    !dupDismissed && (dupDebouncing || isDupFetching || isDirectoryFetching);

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) resetLookup();
          onOpenChange(nextOpen);
        }}
      >
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("udsAnagrafica.newTitle")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("udsAnagrafica.existingSearchHint")}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                {isGlobal && (
                  <FormField
                    control={form.control}
                    name="areaOperativaId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("udsAnagrafica.fAreaOperativa")}
                        </FormLabel>
                        <Select
                          value={field.value || ""}
                          onValueChange={(value) => {
                            field.onChange(value);
                            form.setValue("zonaUdsId", NO_ZONE);
                            setExistingSearch("");
                            setDebouncedExistingSearch("");
                            setDupDismissed(false);
                          }}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "udsAnagrafica.selectAreaOperativaForSearch",
                                )}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {areaOperativaList?.map((areaOperativa) => (
                              <SelectItem
                                key={areaOperativa.id}
                                value={String(areaOperativa.id)}
                              >
                                {areaOperativa.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <Label htmlFor="uds-persona-existing-search">
                    {t("udsAnagrafica.existingSearchLabel")}
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="uds-persona-existing-search"
                      value={existingSearch}
                      onChange={(event) => {
                        setExistingSearch(event.target.value);
                        setDupDismissed(false);
                      }}
                      placeholder={t("udsAnagrafica.existingSearchPlaceholder")}
                      className="pl-9"
                      disabled={!dupScopeReady}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {!dupScopeReady
                      ? t("udsAnagrafica.selectAreaOperativaForSearch")
                      : t("udsAnagrafica.existingSearchHint")}
                  </p>
                  {duplicateCheckPending && (
                    <p
                      role="status"
                      className="text-sm font-medium text-amber-700"
                    >
                      {t("udsAnagrafica.duplicateCheckInProgress")}
                    </p>
                  )}
                </div>

                {!dupDismissed && (directoryMatches?.length ?? 0) > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                      <AlertTriangle className="h-4 w-4" />
                      {t("udsAnagrafica.dupTitle")}
                    </div>
                    <p className="text-xs text-amber-700">
                      {t("udsAnagrafica.dupHint")}
                    </p>
                    <div className="space-y-2">
                      {directoryMatches?.map((suggestion) => (
                        <div
                          key={`directory-${suggestion.id}`}
                          className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {suggestion.cognome} {suggestion.nome}
                              {suggestion.soprannome
                                ? ` (${suggestion.soprannome})`
                                : ""}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {[suggestion.codice, suggestion.zonaUdsNome]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          {onPersonReady && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleDirectorySuggestion(suggestion)
                              }
                            >
                              {t("udsAnagrafica.dupSelect")}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!dupDismissed && suggestions.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                      <AlertTriangle className="h-4 w-4" />
                      {t("udsAnagrafica.dupTitle")}
                    </div>
                    <p className="text-xs text-amber-700">
                      {t("udsAnagrafica.dupHint")}
                    </p>
                    <div className="space-y-2">
                      {suggestions.map((suggestion) => {
                        const isUds = suggestion.uds;
                        return (
                          <div
                            key={suggestion.id}
                            className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">
                                  {suggestion.cognome} {suggestion.nome}
                                  {suggestion.soprannome
                                    ? ` (${suggestion.soprannome})`
                                    : ""}
                                </span>
                                <Badge
                                  variant={isUds ? "secondary" : "outline"}
                                  className="shrink-0"
                                >
                                  {isUds
                                    ? t("udsAnagrafica.dupStatusUds")
                                    : t("udsAnagrafica.dupStatusShared")}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {[
                                  suggestion.codice,
                                  suggestion.dataNascita,
                                  maskPhone(suggestion.telefono),
                                  suggestion.areaOperativaNome,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </div>
                            </div>
                            {(!isUds || onPersonReady) && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleSuggestion(suggestion)}
                                disabled={updateBenef.isPending}
                              >
                                {isUds
                                  ? t("udsAnagrafica.dupSelect")
                                  : t("udsAnagrafica.dupAdd")}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!dupDismissed &&
                  ((directoryMatches?.length ?? 0) > 0 ||
                    suggestions.length > 0) && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full min-h-11 border-amber-300 text-amber-900"
                      onClick={() => setDupDismissed(true)}
                    >
                      {t("udsAnagrafica.dupContinueNew")}
                    </Button>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="nome"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("udsAnagrafica.fNome")} *</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cognome"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("udsAnagrafica.fCognome")} *</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="areaProvenienza"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("beneficiarioDettaglio.areaProvenienza")} *
                      </FormLabel>
                      <Select
                        value={field.value || ""}
                        onValueChange={field.onChange}
                      >
                      <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="-" />
                          </SelectTrigger>
                      </FormControl>
                        <SelectContent>
                          <SelectItem value="UE">UE</SelectItem>
                          <SelectItem value="Extra-UE">Extra-UE</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="dataNascita"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("udsAnagrafica.fDataNascita")}</FormLabel>
                        <FormControl>
                          <Input type="date" max={todayDateOnly()} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sesso"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("udsAnagrafica.fSesso")} *</FormLabel>
                        <Select
                          value={field.value || ""}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t("udsAnagrafica.sessoNd")}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SESSO_OPTIONS.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {t(`udsAnagrafica.${option.udsLabelKey}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {!wDataNascita && (
                <FormField
                  control={form.control}
                  name="fasciaEtaPresunta"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                          {t("udsAnagrafica.fasciaEtaLabel")} *
                      </FormLabel>
                      <Select
                        value={field.value || NO_FASCIA_ETA}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "udsAnagrafica.fasciaEtaPlaceholder",
                                )}
                              />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {FASCE_ETA_PRESUNTE.map((fascia) => (
                            <SelectItem key={fascia} value={fascia}>
                              {fasciaEtaLabel(t, fascia)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                          {t("udsAnagrafica.fasciaEtaRequiredHint")}
                      </p>
                        <FormMessage />
                    </FormItem>
                  )}
                />
                )}
                <div
                  className="rounded-md border bg-muted/30 p-3 text-sm"
                  data-testid="fascia-eta-corrente"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {t("udsAnagrafica.fasciaEtaCorrenteLabel")}
                    </span>
                    <Badge variant="outline">
                      {fasciaEtaOrigineLabel(t, fasciaEtaCorrente.origine)}
                    </Badge>
                  </div>
                  <div className="mt-1">
                    {fasciaEtaLabel(t, fasciaEtaCorrente.fascia)}
                  </div>
                  {fasciaEtaCorrente.origine === "calcolata" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("udsAnagrafica.fasciaEtaCalcolataHint")}
                    </p>
                  )}
                </div>
                <details className="rounded-lg border bg-muted/20 p-3">
                  <summary className="cursor-pointer font-medium min-h-11 flex items-center">
                    {t("udsAnagrafica.optionalDataTitle")}
                  </summary>
                  <p className="mb-4 text-sm text-muted-foreground">
                    {t("udsAnagrafica.optionalDataHint")}
                  </p>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="soprannome"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("udsAnagrafica.fSoprannome")}
                          </FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                <FormField
                  control={form.control}
                  name="telefono"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("udsAnagrafica.fTelefono")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.email")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="codiceFiscale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("beneficiarioDettaglio.codiceFiscale")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="font-mono uppercase"
                          maxLength={16}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                  <FormField
                    control={form.control}
                    name="cittadinanza"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("beneficiarioDettaglio.cittadinanza")}
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                <FormField
                  control={form.control}
                  name="residenza"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("beneficiarioDettaglio.residenza")}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="domicilio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("beneficiarioDettaglio.domicilio")}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="comune"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("beneficiari.comune")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="zonaMunicipio"
                    render={({ field }) => (
                      <FormItem>
                            <FormLabel>
                              {t("beneficiari.zonaMunicipio")}
                            </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="numComponenti"
                    render={({ field }) => (
                      <FormItem>
                            <FormLabel>
                              {t("beneficiari.numComponenti")}
                            </FormLabel>
                        <FormControl>
                          <Input type="number" min="1" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priorita"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("beneficiari.prioritaAssistenziale")}
                        </FormLabel>
                        <Select
                          value={field.value || "media"}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="bassa">
                              {t("beneficiari.prioBassa")}
                            </SelectItem>
                            <SelectItem value="media">
                              {t("beneficiari.prioMedia")}
                            </SelectItem>
                            <SelectItem value="alta">
                              {t("beneficiari.prioAlta")}
                            </SelectItem>
                            <SelectItem value="urgente">
                              {t("beneficiari.prioUrgente")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>
                {canViewSensitive && (
                  <FormField
                    control={form.control}
                    name="restrizioniAlimentari"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("beneficiarioDettaglio.restrizioniAlimentari")}
                        </FormLabel>
                        <FormControl>
                          <Textarea rows={2} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="centroAscoltoId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("beneficiari.centroRiferimento")}
                      </FormLabel>
                      <Select
                        value={field.value || NO_CENTRO}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("common.none")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NO_CENTRO}>
                            {t("common.none")}
                          </SelectItem>
                          {centri?.map((centro) => (
                            <SelectItem
                              key={centro.id}
                              value={String(centro.id)}
                            >
                              {centro.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                  </div>
                </details>

                <div className="rounded-md border p-3 space-y-3">
                  {isGlobal && (
                  <FormField
                    control={form.control}
                    name="uds"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <FormLabel className="!mt-0">
                            {t("beneficiari.udsToggle")}
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            {t("beneficiari.udsToggleHint")}
                          </p>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  )}
                  {(!isGlobal || watchUds) && (
                    <FormField
                      control={form.control}
                      name="zonaUdsId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("udsAnagrafica.fZona")}</FormLabel>
                          <Select
                            value={field.value || NO_ZONE}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t("udsAnagrafica.allZone")}
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={NO_ZONE}>
                                {t("udsAnagrafica.allZone")}
                              </SelectItem>
                              {formZone?.map((zona) => (
                                <SelectItem
                                  key={zona.id}
                                  value={String(zona.id)}
                                >
                                  {zona.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    className="min-h-11 min-w-28"
                    disabled={
                      createBenef.isPending ||
                      (!dupDismissed &&
                        (dupDebouncing ||
                          isDupFetching ||
                          isDirectoryFetching ||
                          suggestions.length > 0 ||
                          (directoryMatches?.length ?? 0) > 0))
                    }
                  >
                    {duplicateCheckPending
                      ? t("udsAnagrafica.duplicateCheckInProgress")
                      : createBenef.isPending
                        ? t("udsAnagrafica.savingPerson")
                        : t("common.save")}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={linkCandidate != null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) setLinkCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("udsAnagrafica.dupConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("udsAnagrafica.dupConfirmDescription", {
                nome: linkCandidate
                  ? `${linkCandidate.cognome} ${linkCandidate.nome}`
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLinkToUds}
              disabled={updateBenef.isPending}
            >
              {t("udsAnagrafica.dupConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
