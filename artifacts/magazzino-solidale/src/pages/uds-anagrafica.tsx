import { useEffect, useMemo, useState } from "react";
import {
  useListBeneficiari,
  useCreateBeneficiario,
  useUpdateBeneficiario,
  useCercaBeneficiariSimili,
  useListCitta,
  useListZoneUds,
  useListCentriAscolto,
  getListBeneficiariQueryKey,
  getListCittaQueryKey,
  getGetBeneficiarioQueryKey,
  getCercaBeneficiariSimiliQueryKey,
  type Beneficiario,
  type BeneficiarioSimile,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, Footprints, AlertTriangle, Search } from "lucide-react";
import { SESSO_OPTIONS } from "@/lib/sesso-options";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { isNotFutureDateOnly, todayDateOnly } from "@/lib/date-only";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";

const ALL_ZONE = "__all__";
const NO_ZONE = "__none__";
const NO_CENTRO = "__nocentro__";

function makeSchema(t: (k: string) => string, isGlobal: boolean) {
  return z
    .object({
      nome: z.string().min(1, t("common.requiredField")),
      cognome: z.string().min(1, t("common.requiredField")),
      soprannome: z.string().optional(),
      codiceFiscale: z.string().optional(),
      dataNascita: z.string().optional().refine(isNotFutureDateOnly, "La data di nascita non può essere successiva alla data odierna."),
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
      cittaId: z.string().optional(),
      centroAscoltoId: z.string().optional(),
      uds: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      // A città-global operator must supply a città whenever the person is UDS:
      // a uds=true row without a città would leak across every city.
      if (isGlobal && (data.uds ?? true) && !data.cittaId) {
        ctx.addIssue({ code: "custom", path: ["cittaId"], message: t("common.requiredField") });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

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

export default function UdsAnagrafica() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isGlobal = user?.cittaId == null;
  const schema = useMemo(() => makeSchema(t, isGlobal), [t, isGlobal]);

  // città filter (global super-admin only); a scoped operator is locked to theirs.
  const [filterCitta, setFilterCitta] = useState<string>("");
  // zona filter: default to operator's own zone; ALL_ZONE shows the whole città.
  const [filterZona, setFilterZona] = useState<string>(
    user?.zonaUdsId != null ? String(user.zonaUdsId) : ALL_ZONE,
  );
  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [linkCandidate, setLinkCandidate] = useState<BeneficiarioSimile | null>(null);

  const { data: cittaList } = useListCitta({ query: { queryKey: getListCittaQueryKey(), enabled: isGlobal } });

  const effectiveCitta = isGlobal
    ? filterCitta
      ? parseInt(filterCitta)
      : undefined
    : (user?.cittaId ?? undefined);

  const { data: zoneList } = useListZoneUds(
    effectiveCitta ? { cittaId: effectiveCitta } : undefined,
    { query: { queryKey: ["zoneUds", effectiveCitta], enabled: effectiveCitta != null } },
  );

  const listParams = {
    uds: true,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(isGlobal && effectiveCitta ? { cittaId: effectiveCitta } : {}),
    ...(filterZona !== ALL_ZONE ? { zonaUdsId: parseInt(filterZona) } : {}),
  };
  const { data: beneficiari, isLoading } = useListBeneficiari(listParams);

  const createBenef = useCreateBeneficiario();
  const updateBenef = useUpdateBeneficiario();
  const { data: centri } = useListCentriAscolto();

  const toggleStatus = (b: { id: number; attivo: boolean }) => {
    updateBenef.mutate(
      { id: b.id, data: { attivo: !b.attivo } as never },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(b.id) });
          toast({ title: b.attivo ? t("beneficiari.toastDisattivato") : t("beneficiari.toastAttivato") });
        },
      },
    );
  };

  // Anti-duplicate fuzzy suggestions: debounce the identity fields and query the
  // città-scoped cerca-simili endpoint while the create form is open.
  const [dupDismissed, setDupDismissed] = useState(false);
  const [existingSearch, setExistingSearch] = useState("");
  const [debouncedExistingSearch, setDebouncedExistingSearch] = useState("");
  const [dupDebouncing, setDupDebouncing] = useState(false);
  const [dupParams, setDupParams] = useState<{
    nome?: string; cognome?: string; soprannome?: string; telefono?: string; dataNascita?: string;
  }>({});

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: "",
      cognome: "",
      soprannome: "",
      codiceFiscale: "",
      dataNascita: "",
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
      zonaUdsId: user?.zonaUdsId != null ? String(user.zonaUdsId) : NO_ZONE,
      cittaId: "",
      centroAscoltoId: "",
      uds: true,
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });

  const handleCreate = () => {
    form.reset({
      nome: "",
      cognome: "",
      soprannome: "",
      codiceFiscale: "",
      dataNascita: "",
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
      zonaUdsId:
        filterZona !== ALL_ZONE
          ? filterZona
          : user?.zonaUdsId != null
            ? String(user.zonaUdsId)
            : NO_ZONE,
      cittaId: isGlobal && filterCitta ? filterCitta : "",
      centroAscoltoId: "",
      uds: true,
    });
    setDupDismissed(false);
    setDupParams({});
    setExistingSearch("");
    setDebouncedExistingSearch("");
    setDupDebouncing(false);
    setLinkCandidate(null);
    setIsFormOpen(true);
  };

  // Debounce the watched identity fields into the query params (300ms).
  const wNome = form.watch("nome");
  const wCognome = form.watch("cognome");
  const wSoprannome = form.watch("soprannome");
  const wTelefono = form.watch("telefono");
  const wDataNascita = form.watch("dataNascita");
  useEffect(() => {
    if (!isFormOpen) return;
    const rawIdentityLength = [wNome, wCognome, wSoprannome, wTelefono]
      .map((value) => (value ?? "").trim())
      .join("")
      .length;
    const hasRawLookup = existingSearch.trim().length >= 2 || rawIdentityLength >= 2;
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
  }, [isFormOpen, existingSearch, wNome, wCognome, wSoprannome, wTelefono, wDataNascita]);

  // Two characters are enough for the assisted shared-directory lookup.
  const dupHasInput =
    debouncedExistingSearch.length >= 2 ||
    ((dupParams.nome ?? "").length + (dupParams.cognome ?? "").length >= 2) ||
    (dupParams.soprannome ?? "").length >= 2 ||
    (dupParams.telefono ?? "").length >= 2;
  const dupCitta = isGlobal && form.watch("cittaId") ? parseInt(form.watch("cittaId")!) : undefined;
  const dupScopeReady = !isGlobal || dupCitta != null;
  const dupQueryParams = {
    ...dupParams,
    ...(debouncedExistingSearch.length >= 2 ? { search: debouncedExistingSearch } : {}),
    ...(dupCitta != null ? { cittaId: dupCitta } : {}),
  };
  const { data: dupMatches, isFetching: isDupFetching } = useCercaBeneficiariSimili(
    dupQueryParams,
    {
      query: {
        queryKey: getCercaBeneficiariSimiliQueryKey(dupQueryParams),
        enabled: isFormOpen && !dupDismissed && dupHasInput && dupScopeReady,
      },
    },
  );
  const suggestions = dupMatches ?? [];

  const requestLinkToUds = (s: BeneficiarioSimile) => {
    if (s.uds) {
      toast({
        title: t("udsAnagrafica.dupAlreadyUds"),
        description: `${s.cognome} ${s.nome} · ${s.codice}`,
      });
      return;
    }
    setLinkCandidate(s);
  };

  // "Aggiungi a UDS": after explicit confirmation, attach the operator's chosen
  // zona to an existing same-città person instead of creating a duplicate.
  const confirmLinkToUds = () => {
    const s = linkCandidate;
    if (!s) return;
    const zonaVal = form.getValues("zonaUdsId");
    const targetZona =
      zonaVal && zonaVal !== NO_ZONE ? parseInt(zonaVal) : user?.zonaUdsId ?? null;
    updateBenef.mutate(
      { id: s.id, data: { uds: true, ...(targetZona != null ? { zonaUdsId: targetZona } : {}) } as never },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: t("udsAnagrafica.dupLinked") });
          setLinkCandidate(null);
          setIsFormOpen(false);
          setDupDismissed(false);
          setDupParams({});
          setExistingSearch("");
          setDebouncedExistingSearch("");
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
    if (!dupDismissed && (dupDebouncing || isDupFetching || suggestions.length > 0)) {
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
      uds: data.uds ?? true,
      centroAscoltoId:
        data.centroAscoltoId && data.centroAscoltoId !== NO_CENTRO
          ? parseInt(data.centroAscoltoId)
          : null,
    };
    if (data.soprannome) payload.soprannome = data.soprannome;
    if (data.codiceFiscale) payload.codiceFiscale = data.codiceFiscale;
    if (data.dataNascita) payload.dataNascita = data.dataNascita;
    payload.sesso = data.sesso;
    if (data.cittadinanza) payload.cittadinanza = data.cittadinanza;
    if (data.areaProvenienza) payload.areaProvenienza = data.areaProvenienza;
    if (data.residenza) payload.residenza = data.residenza;
    if (data.domicilio) payload.domicilio = data.domicilio;
    if (data.telefono) payload.telefono = data.telefono;
    if (data.email) payload.email = data.email;
    if (data.comune) payload.comune = data.comune;
    if (data.zonaMunicipio) payload.zonaMunicipio = data.zonaMunicipio;
    if (data.numComponenti) payload.numComponenti = parseInt(data.numComponenti);
    if (data.priorita) payload.priorita = data.priorita;
    payload.consegnaDomicilio = data.consegnaDomicilio ?? false;
    if (data.motivoConsegnaDomicilio) payload.motivoConsegnaDomicilio = data.motivoConsegnaDomicilio;
    if (data.restrizioniAlimentari) payload.restrizioniAlimentari = data.restrizioniAlimentari;
    if (data.uds && data.zonaUdsId && data.zonaUdsId !== NO_ZONE) {
      payload.zonaUdsId = parseInt(data.zonaUdsId);
    }
    if (isGlobal && data.cittaId) payload.cittaId = parseInt(data.cittaId);

    createBenef.mutate(
      { data: payload as never },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: t("udsAnagrafica.toastCreated") });
          setIsFormOpen(false);
          setDupDismissed(false);
          setDupParams({});
          setExistingSearch("");
          setDebouncedExistingSearch("");
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

  const canale = (b: Beneficiario) => {
    const uds = b.uds;
    const centro = b.centroAscoltoId != null;
    if (uds && centro)
      return { label: t("udsAnagrafica.canaleEntrambi"), cls: "bg-purple-500/10 text-purple-700" };
    if (centro)
      return { label: t("udsAnagrafica.canaleCentro"), cls: "bg-blue-500/10 text-blue-700" };
    if (uds)
      return { label: t("udsAnagrafica.canaleUds"), cls: "bg-amber-500/10 text-amber-700" };
    return { label: t("udsAnagrafica.canaleNd"), cls: "bg-muted text-muted-foreground" };
  };

  const watchUds = form.watch("uds");
  const formCitta = isGlobal && form.watch("cittaId") ? parseInt(form.watch("cittaId")!) : effectiveCitta;
  const { data: formZone } = useListZoneUds(
    formCitta ? { cittaId: formCitta } : undefined,
    { query: { queryKey: ["zoneUds", "form", formCitta], enabled: formCitta != null } },
  );

  const rows = beneficiari ?? [];

  const exportColumns = useMemo(
    () => [
      { header: t("common.surname"), accessor: (b: Beneficiario) => b.cognome },
      { header: t("common.name"), accessor: (b: Beneficiario) => b.nome },
      { header: t("udsAnagrafica.colSoprannome"), accessor: (b: Beneficiario) => b.soprannome ?? "" },
      { header: t("udsAnagrafica.colTelefono"), accessor: (b: Beneficiario) => b.telefono ?? "" },
      { header: t("udsAnagrafica.colZona"), accessor: (b: Beneficiario) => b.zonaUdsNome ?? "" },
      { header: t("udsAnagrafica.colCanale"), accessor: (b: Beneficiario) => canale(b).label },
    ],
    [t],
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("udsAnagrafica.title")}</h1>
          <p className="text-muted-foreground">{t("udsAnagrafica.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={rows}
            columns={exportColumns}
            filename="uds-anagrafica"
            title={t("udsAnagrafica.exportTitle")}
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("udsAnagrafica.newPerson")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1 min-w-[240px] flex-1">
            <span className="text-sm font-medium">{t("udsAnagrafica.searchLabel")}</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("udsAnagrafica.searchPlaceholder")}
                className="pl-9"
              />
            </div>
          </div>
          {isGlobal && (
            <div className="space-y-1">
              <span className="text-sm font-medium">{t("udsAnagrafica.filterCitta")}</span>
              <Select value={filterCitta || ALL_ZONE} onValueChange={(v) => { setFilterCitta(v === ALL_ZONE ? "" : v); setFilterZona(ALL_ZONE); }}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder={t("udsAnagrafica.allCitta")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONE}>{t("udsAnagrafica.allCitta")}</SelectItem>
                  {cittaList?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-sm font-medium">{t("udsAnagrafica.filterZona")}</span>
            <Select value={filterZona} onValueChange={setFilterZona}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={t("udsAnagrafica.allZone")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ZONE}>{t("udsAnagrafica.allZone")}</SelectItem>
                {zoneList?.map((z) => (
                  <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.surname")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("udsAnagrafica.colSoprannome")}</TableHead>
                <TableHead>{t("udsAnagrafica.colTelefono")}</TableHead>
                <TableHead>{t("udsAnagrafica.colZona")}</TableHead>
                <TableHead className="text-center">{t("udsAnagrafica.colCanale")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.colStato")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(4).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {Array(7).fill(0).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-24" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    {t("udsAnagrafica.noPersone")}
                  </TableCell>
                </TableRow>
              ) : rows.map((b) => {
                const c = canale(b);
                return (
                  <TableRow key={b.id} className={!b.attivo ? "opacity-60" : ""}>
                    <TableCell>
                      <Link href={`/beneficiari/${b.id}`} className="flex items-center gap-2 font-medium text-primary hover:underline">
                        <Footprints className="h-4 w-4 text-muted-foreground" /> {b.cognome}
                      </Link>
                    </TableCell>
                    <TableCell>{b.nome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.soprannome || "-"}</TableCell>
                    <TableCell className="text-sm">{b.telefono || "-"}</TableCell>
                    <TableCell className="text-sm">{b.zonaUdsNome || "-"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`border-none ${c.cls}`}>{c.label}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center">
                        <Switch
                          checked={b.attivo}
                          onCheckedChange={() => toggleStatus(b)}
                          aria-label={b.attivo ? t("beneficiari.disattiva") : t("beneficiari.attiva")}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={(open) => {
        setIsFormOpen(open);
        if (!open) {
          setDupDismissed(false);
          setDupParams({});
          setExistingSearch("");
          setDebouncedExistingSearch("");
          setDupDebouncing(false);
          setLinkCandidate(null);
        }
      }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("udsAnagrafica.newTitle")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {isGlobal && (
                  <FormField control={form.control} name="cittaId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("udsAnagrafica.fCitta")}</FormLabel>
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
                          <SelectTrigger><SelectValue placeholder={t("udsAnagrafica.selectCittaForSearch")} /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {cittaList?.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}

                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <FormLabel>{t("udsAnagrafica.existingSearchLabel")}</FormLabel>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
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
                      ? t("udsAnagrafica.selectCittaForSearch")
                      : t("udsAnagrafica.existingSearchHint")}
                  </p>
                </div>

                {!dupDismissed && suggestions.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                      <AlertTriangle className="h-4 w-4" />
                      {t("udsAnagrafica.dupTitle")}
                    </div>
                    <p className="text-xs text-amber-700">{t("udsAnagrafica.dupHint")}</p>
                    <div className="space-y-2">
                      {suggestions.map((s) => {
                        const isUds = s.uds;
                        return (
                          <div key={s.id} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">
                                  {s.cognome} {s.nome}
                                  {s.soprannome ? ` (${s.soprannome})` : ""}
                                </span>
                                <Badge variant={isUds ? "secondary" : "outline"} className="shrink-0">
                                  {isUds ? t("udsAnagrafica.dupStatusUds") : t("udsAnagrafica.dupStatusShared")}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {[s.codice, s.dataNascita, maskPhone(s.telefono), s.cittaNome].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </div>
                            <Button type="button" size="sm" variant="outline" onClick={() => requestLinkToUds(s)} disabled={updateBenef.isPending}>
                              {isUds ? t("udsAnagrafica.dupOpen") : t("udsAnagrafica.dupAdd")}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    <Button type="button" size="sm" variant="ghost" className="text-amber-800" onClick={() => setDupDismissed(true)}>
                      {t("udsAnagrafica.dupContinueNew")}
                    </Button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem><FormLabel>{t("udsAnagrafica.fNome")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="cognome" render={({ field }) => (
                    <FormItem><FormLabel>{t("udsAnagrafica.fCognome")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="soprannome" render={({ field }) => (
                  <FormItem><FormLabel>{t("udsAnagrafica.fSoprannome")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="dataNascita" render={({ field }) => (
                    <FormItem><FormLabel>{t("udsAnagrafica.fDataNascita")}</FormLabel><FormControl><Input type="date" max={todayDateOnly()} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="sesso" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("udsAnagrafica.fSesso")}</FormLabel>
                      <Select value={field.value || ""} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder={t("udsAnagrafica.sessoNd")} /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SESSO_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(`udsAnagrafica.${option.udsLabelKey}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="telefono" render={({ field }) => (
                  <FormItem><FormLabel>{t("udsAnagrafica.fTelefono")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.email")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="codiceFiscale" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.codiceFiscale")}</FormLabel><FormControl><Input {...field} className="font-mono uppercase" maxLength={16} /></FormControl></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="cittadinanza" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiarioDettaglio.cittadinanza")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="areaProvenienza" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiarioDettaglio.areaProvenienza")} *</FormLabel>
                      <Select value={field.value || ""} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="UE">UE</SelectItem>
                          <SelectItem value="Extra-UE">Extra-UE</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="residenza" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.residenza")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="domicilio" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.domicilio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="comune" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.comune")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="zonaMunicipio" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.zonaMunicipio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="numComponenti" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.numComponenti")}</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="priorita" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiari.prioritaAssistenziale")}</FormLabel>
                      <Select value={field.value || "media"} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="bassa">{t("beneficiari.prioBassa")}</SelectItem>
                          <SelectItem value="media">{t("beneficiari.prioMedia")}</SelectItem>
                          <SelectItem value="alta">{t("beneficiari.prioAlta")}</SelectItem>
                          <SelectItem value="urgente">{t("beneficiari.prioUrgente")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="restrizioniAlimentari" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.restrizioniAlimentari")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                )} />

                <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiari.centroRiferimento")}</FormLabel>
                    <Select value={field.value || NO_CENTRO} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CENTRO}>{t("common.none")}</SelectItem>
                        {centri?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="rounded-md border p-3 space-y-3">
                  <FormField control={form.control} name="uds" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <FormLabel className="!mt-0">{t("beneficiari.udsToggle")}</FormLabel>
                        <p className="text-xs text-muted-foreground">{t("beneficiari.udsToggleHint")}</p>
                      </div>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  {watchUds && (
                    <>
                      <FormField control={form.control} name="zonaUdsId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("udsAnagrafica.fZona")}</FormLabel>
                          <Select value={field.value || NO_ZONE} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder={t("udsAnagrafica.allZone")} /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={NO_ZONE}>{t("udsAnagrafica.allZone")}</SelectItem>
                              {formZone?.map((z) => (
                                <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </>
                  )}
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => { setIsFormOpen(false); setDupDismissed(false); setDupParams({}); }}>{t("common.cancel")}</Button>
                  <Button
                    type="submit"
                    disabled={createBenef.isPending || (!dupDismissed && (dupDebouncing || isDupFetching || suggestions.length > 0))}
                  >
                    {t("common.save")}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={linkCandidate != null} onOpenChange={(open) => { if (!open) setLinkCandidate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("udsAnagrafica.dupConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("udsAnagrafica.dupConfirmDescription", {
                nome: linkCandidate ? `${linkCandidate.cognome} ${linkCandidate.nome}` : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLinkToUds} disabled={updateBenef.isPending}>
              {t("udsAnagrafica.dupConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
