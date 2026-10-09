import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getListAccessiEmporioQueryKey,
  getSearchBeneficiariAccessiEmporioQueryKey,
  useCreateAccessoEmporio,
  useListAccessiEmporio,
  useListCentriAscolto,
  useListAreeOperative,
  useListEmporiOperativi,
  useSearchBeneficiariAccessiEmporio,
  useUpdateAccessoEmporio,
  useUpdateAccessoEmporioStato,
  type AccessoEmporio,
  type AccessoEmporioStato,
  type BeneficiarioAccessoEmporioSearchResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  emporioReadableData,
  emporioReadDenied,
  useEmporioSecurity,
  withEmporioSecurity,
} from "@/hooks/use-emporio-security";
import { useTranslation } from "react-i18next";
import { Edit, Play, Search, UserCheck, UserX, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { EmporioBeneficiaryResults } from "@/components/emporio-beneficiary-results";
import { EMPORIO_DISABLED_MESSAGE, useModuloFlags } from "@/lib/use-moduli";
import { useAuth } from "@/lib/auth";
import {
  civilDateEuropeRome,
  dateTimeEuropeRomeToIso,
  timeEuropeRome,
  todayEuropeRome,
} from "@/lib/europe-rome";

const ALL = "__all__";
const STATI_ACCESSO: AccessoEmporioStato[] = [
  "pianificato",
  "confermato",
  "effettuato",
  "annullato",
  "non_presentato",
];
type FormState = {
  beneficiarioId: string;
  magazzinoEmporioId: string;
  data: string;
  oraInizio: string;
  oraFine: string;
  noteAccessoEmporio: string;
};

type EditingState =
  | { mode: "create"; accesso?: undefined }
  | { mode: "edit"; accesso: AccessoEmporio };

const nowTime = () => timeEuropeRome(new Date());

function formatCredito(value: number | null | undefined): string {
  return value == null
    ? "-"
    : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(
        value,
      );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  });
}

function combineDateTime(date: string, time: string): string {
  return dateTimeEuropeRomeToIso(date, time || "00:00");
}

function extractError(err: unknown, fallback: string): string {
  const data =
    (err as { data?: unknown })?.data ??
    (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

function isEligible(
  b: BeneficiarioAccessoEmporioSearchResult | null,
): string | null {
  if (!b) return null;
  if (b.pianificabile === false) return "accessiEmporio.nonPianificabile";
  if (!b.attivo) return "accessiEmporio.beneficiarioNonAttivo";
  if (b.emporioStato !== "attivo") return "emporioServizio.non_abilitato";
  if (b.centroAscoltoId == null) return "accessiEmporio.centroAscoltoRichiesto";
  if (!b.creditoSolidaleAbilitato)
    return "accessiEmporio.creditoSolidaleRichiesto";
  if (b.creditoSolidaleStato !== "attivo")
    return "accessiEmporio.creditoSolidaleNonAttivo";
  return null;
}

function statusClass(stato: AccessoEmporioStato | null): string {
  if (stato === "confermato")
    return "bg-sky-500/10 text-sky-700 border-sky-200";
  if (stato === "effettuato")
    return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
  if (stato === "annullato") return "bg-red-500/10 text-red-700 border-red-200";
  if (stato === "non_presentato")
    return "bg-amber-500/10 text-amber-700 border-amber-200";
  return "bg-muted text-muted-foreground";
}

export default withEmporioSecurity(EmporioAccessi);

function EmporioAccessi() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const security = useEmporioSecurity();
  const { emporioAbilitato } = useModuloFlags();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("emporio.access.manage");
  const canOperateCassa = hasPermission("emporio.cassa.operate");
  const canViewBeneficiario = hasPermission("beneficiari.view");
  const initialBeneficiarioId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get(
      "beneficiarioId",
    );
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? String(id) : "";
  }, []);

  const [dataDa, setDataDa] = useState(todayEuropeRome());
  const [dataA, setDataA] = useState(todayEuropeRome());
  const [centroFilter, setCentroFilter] = useState(ALL);
  const [areaOperativaFilter, setAreaOperativaFilter] = useState(ALL);
  const [emporioFilter, setEmporioFilter] = useState(ALL);
  const [statoFilter, setStatoFilter] = useState(ALL);
  const [beneficiarioSearch, setBeneficiarioSearch] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [cardSearch, setCardSearch] = useState(false);
  const [submittedSearch, setSubmittedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setSearchTerm(beneficiarioSearch.trim()),
      250,
    );
    return () => clearTimeout(timer);
  }, [beneficiarioSearch]);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [annullando, setAnnullando] = useState<AccessoEmporio | null>(null);
  const [motivoAnnullamento, setMotivoAnnullamento] = useState("");
  const [form, setForm] = useState<FormState>({
    beneficiarioId: initialBeneficiarioId,
    magazzinoEmporioId: "",
    data: todayEuropeRome(),
    oraInizio: nowTime(),
    oraFine: "",
    noteAccessoEmporio: "",
  });

  const params = {
    dataDa: dataDa || undefined,
    dataA: dataA || undefined,
    centroAscoltoId: centroFilter === ALL ? undefined : Number(centroFilter),
    areaOperativaId:
      areaOperativaFilter === ALL ? undefined : Number(areaOperativaFilter),
    magazzinoEmporioId:
      emporioFilter === ALL ? undefined : Number(emporioFilter),
    statoAccessoEmporio:
      statoFilter === ALL ? undefined : (statoFilter as AccessoEmporioStato),
    beneficiarioSearch: listSearch.trim() || undefined,
    beneficiarioId: initialBeneficiarioId
      ? Number(initialBeneficiarioId)
      : undefined,
    page,
    limit: 50,
  };
  const accessiQuery = useListAccessiEmporio(params, {
    query: security.readOptions(getListAccessiEmporioQueryKey(params)),
  });
  const accessi = emporioReadableData(accessiQuery),
    isLoading = accessiQuery.isLoading;
  const { data: centri } = useListCentriAscolto();
  const { data: areaOperativa } = useListAreeOperative();
  const emporiQuery = useListEmporiOperativi({
    query: security.readOptions(["/api/emporio/magazzini"]),
  });
  const empori = emporioReadableData(emporiQuery) ?? [];
  const beneficiarioSearchParams = {
    magazzinoEmporioId: Number(form.magazzinoEmporioId),
    includiNonPianificabili: true,
    ...(searchTerm
      ? cardSearch
        ? { codiceTessera: searchTerm }
        : { search: searchTerm }
      : { beneficiarioId: Number(form.beneficiarioId) || undefined }),
  };
  const beneficiariQuery = useSearchBeneficiariAccessiEmporio(
    beneficiarioSearchParams,
    {
      query: {
        ...security.readOptions(
          getSearchBeneficiariAccessiEmporioQueryKey(beneficiarioSearchParams),
        ),
        enabled:
          editing != null &&
          !!form.magazzinoEmporioId &&
          !!(searchTerm || form.beneficiarioId) &&
          beneficiarioSearch.trim() === searchTerm,
      },
    },
  );
  const beneficiari = emporioReadableData(beneficiariQuery);
  useEffect(() => {
    if (
      (!cardSearch && submittedSearch !== searchTerm) ||
      !searchTerm ||
      beneficiarioSearch.trim() !== searchTerm ||
      !beneficiari ||
      beneficiariQuery.isFetching
    )
      return;
    const matches = beneficiari.filter(
      (b) =>
        b.pianificabile !== false &&
        (cardSearch ||
          b.tesseraCorrispondente ||
          b.beneficiarioCodice === searchTerm),
    );
    if (matches.length === 1)
      setForm((current) => ({
        ...current,
        beneficiarioId: String(matches[0].beneficiarioId),
      }));
    else if (cardSearch)
      setForm((current) => ({ ...current, beneficiarioId: "" }));
  }, [
    beneficiari,
    beneficiariQuery.isFetching,
    cardSearch,
    submittedSearch,
    searchTerm,
    beneficiarioSearch,
  ]);
  useEffect(() => {
    if (
      editing?.mode === "create" &&
      empori.length === 1 &&
      !form.magazzinoEmporioId
    )
      setForm((current) => ({
        ...current,
        magazzinoEmporioId: String(empori[0].id),
      }));
  }, [empori, editing, form.magazzinoEmporioId]);
  useEffect(() => {
    if (
      !emporioReadDenied(accessiQuery.error) &&
      !emporioReadDenied(beneficiariQuery.error)
    )
      return;
    setEditing(null);
    setAnnullando(null);
    setBeneficiarioSearch("");
    setForm((previous) => ({
      ...previous,
      beneficiarioId: "",
      noteAccessoEmporio: "",
    }));
  }, [accessiQuery.error, beneficiariQuery.error]);
  const beneficiarioSelezionato = useMemo(
    () =>
      (!beneficiariQuery.isFetching &&
      !beneficiariQuery.isError &&
      beneficiarioSearch.trim() === searchTerm
        ? (beneficiari ?? [])
        : []
      ).find((b) => String(b.beneficiarioId) === form.beneficiarioId) ?? null,
    [
      beneficiari,
      form.beneficiarioId,
      beneficiariQuery.isFetching,
      beneficiariQuery.isError,
      beneficiarioSearch,
      searchTerm,
    ],
  );
  const eligibilityError = isEligible(beneficiarioSelezionato);

  const createAccesso = useCreateAccessoEmporio();
  const updateAccesso = useUpdateAccessoEmporio();
  const updateStato = useUpdateAccessoEmporioStato();
  const pending =
    createAccesso.isPending || updateAccesso.isPending || updateStato.isPending;

  const riepilogo = useMemo(() => {
    const rows = accessi ?? [];
    return {
      totale: rows.filter((a) => a.statoAccessoEmporio !== "annullato").length,
      confermati: rows.filter((a) => a.statoAccessoEmporio === "confermato")
        .length,
      effettuati: rows.filter((a) => a.statoAccessoEmporio === "effettuato")
        .length,
      nonPresentati: rows.filter(
        (a) => a.statoAccessoEmporio === "non_presentato",
      ).length,
      annullati: rows.filter((a) => a.statoAccessoEmporio === "annullato")
        .length,
    };
  }, [accessi]);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: getListAccessiEmporioQueryKey(),
    });
  };

  const openCreate = () => {
    setEditing({ mode: "create" });
    setBeneficiarioSearch("");
    setSearchTerm("");
    setCardSearch(false);
    setForm({
      beneficiarioId: initialBeneficiarioId,
      magazzinoEmporioId: empori.length === 1 ? String(empori[0].id) : "",
      data: todayEuropeRome(),
      oraInizio: nowTime(),
      oraFine: "",
      noteAccessoEmporio: "",
    });
  };

  const openEdit = (accesso: AccessoEmporio) => {
    const start = accesso.dataOraInizio
      ? new Date(accesso.dataOraInizio)
      : new Date();
    const end = accesso.dataOraFine ? new Date(accesso.dataOraFine) : null;
    setEditing({ mode: "edit", accesso });
    setBeneficiarioSearch("");
    setSearchTerm("");
    setCardSearch(false);
    setForm({
      beneficiarioId: String(accesso.beneficiarioId),
      magazzinoEmporioId:
        accesso.magazzinoEmporioId != null
          ? String(accesso.magazzinoEmporioId)
          : "",
      data: civilDateEuropeRome(start),
      oraInizio: timeEuropeRome(start),
      oraFine: end ? timeEuropeRome(end) : "",
      noteAccessoEmporio: accesso.noteAccessoEmporio ?? "",
    });
  };

  const submit = () => {
    if (!canManage) return;
    if (!emporioAbilitato) {
      toast({
        title: t("accessiEmporio.titolo"),
        description: t("accessiEmporio.emporioDisabilitato"),
        variant: "destructive",
      });
      return;
    }
    if (
      !form.beneficiarioId ||
      !form.magazzinoEmporioId ||
      !form.data ||
      !form.oraInizio
    ) {
      toast({
        title: t("accessiEmporio.titolo"),
        description: t("common.requiredField"),
        variant: "destructive",
      });
      return;
    }
    if (eligibilityError || !beneficiarioSelezionato) {
      toast({
        title: t("accessiEmporio.beneficiario"),
        description: t(eligibilityError ?? "emporioServizio.non_abilitato"),
        variant: "destructive",
      });
      return;
    }
    const data = {
      beneficiarioId: Number(form.beneficiarioId),
      magazzinoEmporioId: Number(form.magazzinoEmporioId),
      dataOraInizio: combineDateTime(form.data, form.oraInizio),
      dataOraFine: form.oraFine
        ? combineDateTime(form.data, form.oraFine)
        : null,
      noteAccessoEmporio: form.noteAccessoEmporio.trim() || null,
    };
    const onSuccess = () => {
      invalidate();
      setEditing(null);
      toast({
        title: t(
          editing?.mode === "edit"
            ? "accessiEmporio.modificaAccesso"
            : "accessiEmporio.nuovoAccesso",
        ),
      });
    };
    const onError = (err: unknown) => {
      toast({
        title: t("accessiEmporio.titolo"),
        description: extractError(err, t("consegne.toastErrore")),
        variant: "destructive",
      });
    };
    if (editing?.mode === "edit") {
      updateAccesso.mutate(
        { id: editing.accesso.id, data },
        { onSuccess, onError },
      );
    } else {
      createAccesso.mutate({ data }, { onSuccess, onError });
    }
  };

  const changeStatus = (
    accesso: AccessoEmporio,
    statoAccessoEmporio: AccessoEmporioStato,
    motivo?: string,
  ) => {
    if (!canManage) return;
    updateStato.mutate(
      {
        id: accesso.id,
        data: { statoAccessoEmporio, motivoAnnullamento: motivo ?? null },
      },
      {
        onSuccess: () => {
          invalidate();
          setAnnullando(null);
          setMotivoAnnullamento("");
          toast({ title: t("accessiEmporio.stato") });
        },
        onError: (err) =>
          toast({
            title: t("accessiEmporio.stato"),
            description: extractError(err, t("consegne.toastErrore")),
            variant: "destructive",
          }),
      },
    );
  };

  if (
    emporioReadDenied(accessiQuery.error) ||
    emporioReadDenied(beneficiariQuery.error)
  )
    return <p role="alert">{t("accessiEmporio.accessoNegato")}</p>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {t("accessiEmporio.titolo")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("accessiEmporio.sottotitolo")}
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate} disabled={!emporioAbilitato}>
            {t("accessiEmporio.nuovoAccesso")}
          </Button>
        )}
      </div>

      {!emporioAbilitato && (
        <Alert variant="destructive">
          <AlertDescription>{EMPORIO_DISABLED_MESSAGE}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {t("accessiEmporio.totalePianificati")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">
            {riepilogo.totale}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {t("accessiEmporio.totaleConfermati")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">
            {riepilogo.confermati}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {t("accessiEmporio.totaleEffettuati")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">
            {riepilogo.effettuati}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {t("accessiEmporio.totaleNonPresentati")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">
            {riepilogo.nonPresentati}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {t("accessiEmporio.totaleAnnullati")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">
            {riepilogo.annullati}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            {t("accessiEmporio.filtri")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-7">
          <Input
            type="date"
            value={dataDa}
            onChange={(event) => {
              setDataDa(event.target.value);
              setPage(1);
            }}
          />
          <Input
            type="date"
            value={dataA}
            onChange={(event) => {
              setDataA(event.target.value);
              setPage(1);
            }}
          />
          <Select
            value={centroFilter}
            onValueChange={(value) => {
              setCentroFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("creditoSolidale.tuttiCentri")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("creditoSolidale.tuttiCentri")}
              </SelectItem>
              {centri?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={areaOperativaFilter}
            onValueChange={(value) => {
              setAreaOperativaFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("accessiEmporio.tutteLeAree")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("accessiEmporio.tutteLeAree")}
              </SelectItem>
              {areaOperativa?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={emporioFilter}
            onValueChange={(value) => {
              setEmporioFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("accessiEmporio.tuttiGliEmpori")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("accessiEmporio.tuttiGliEmpori")}
              </SelectItem>
              {empori.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statoFilter}
            onValueChange={(value) => {
              setStatoFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("accessiEmporio.tuttiGliStati")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("accessiEmporio.tuttiGliStati")}
              </SelectItem>
              {STATI_ACCESSO.map((stato) => (
                <SelectItem key={stato} value={stato}>
                  {t(`accessiEmporio.${stato}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder={t("accessiEmporio.cercaBeneficiarioPlaceholder")}
            value={listSearch}
            onChange={(event) => {
              setListSearch(event.target.value);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("accessiEmporio.dataOraInizio")}</TableHead>
                <TableHead>{t("accessiEmporio.beneficiario")}</TableHead>
                <TableHead>{t("beneficiari.centroRiferimento")}</TableHead>
                <TableHead>{t("accessiEmporio.emporio")}</TableHead>
                <TableHead>{t("accessiEmporio.stato")}</TableHead>
                <TableHead>
                  {t("creditoSolidale.saldoCreditoSolidale")}
                </TableHead>
                <TableHead>
                  {t("creditoSolidale.quotaMensileAssegnata")}
                </TableHead>
                <TableHead>{t("accessiEmporio.note")}</TableHead>
                <TableHead className="text-right">
                  {t("creditoSolidale.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (accessi ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {t("accessiEmporio.nessunAccesso")}
                  </TableCell>
                </TableRow>
              ) : (
                (accessi ?? []).map((accesso) => (
                  <TableRow key={accesso.id}>
                    <TableCell>
                      <div className="font-medium">
                        {formatDateTime(accesso.dataOraInizio)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {accesso.dataOraFine
                          ? formatDateTime(accesso.dataOraFine)
                          : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {accesso.beneficiarioNome ?? "-"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {accesso.beneficiarioCodice ?? "-"}
                      </div>
                      {accesso.accessoForzato && (
                        <Badge variant="secondary" className="mt-1">
                          {t("accessiEmporio.accessoForzatoDaCassa")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{accesso.centroAscoltoNome ?? "-"}</TableCell>
                    <TableCell>{accesso.magazzinoEmporioNome ?? "-"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={statusClass(accesso.statoAccessoEmporio)}
                      >
                        {t(
                          `accessiEmporio.${accesso.statoAccessoEmporio ?? "pianificato"}`,
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatCredito(accesso.saldoCreditoSolidale)}
                    </TableCell>
                    <TableCell>
                      {formatCredito(accesso.quotaMensileAssegnata)}
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {accesso.noteAccessoEmporio ?? "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canManage && (
                          <>
                            {(accesso.statoAccessoEmporio === "pianificato" ||
                              accesso.statoAccessoEmporio === "confermato") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(accesso)}
                                disabled={!emporioAbilitato || pending}
                                title={t("accessiEmporio.modificaAccesso")}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            {accesso.statoAccessoEmporio === "pianificato" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  changeStatus(accesso, "confermato")
                                }
                                disabled={!emporioAbilitato || pending}
                                title={t("accessiEmporio.confermaAccesso")}
                              >
                                <UserCheck className="h-4 w-4" />
                              </Button>
                            )}
                            {(accesso.statoAccessoEmporio === "pianificato" ||
                              accesso.statoAccessoEmporio === "confermato") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  changeStatus(accesso, "non_presentato")
                                }
                                disabled={!emporioAbilitato || pending}
                                title={t("accessiEmporio.segnoNonPresentato")}
                              >
                                <UserX className="h-4 w-4" />
                              </Button>
                            )}
                            {(accesso.statoAccessoEmporio === "pianificato" ||
                              accesso.statoAccessoEmporio === "confermato") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setAnnullando(accesso)}
                                disabled={!emporioAbilitato || pending}
                                title={t("accessiEmporio.annullaAccesso")}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                        {canOperateCassa &&
                          (accesso.statoAccessoEmporio === "pianificato" ||
                            accesso.statoAccessoEmporio === "confermato" ||
                            accesso.statoAccessoEmporio === "effettuato") && (
                            <Button
                              variant="outline"
                              size="icon"
                              asChild
                              title={t("accessiEmporio.apriCassa")}
                            >
                              <Link
                                href={`/emporio/cassa?accessoEmporioId=${accesso.id}`}
                              >
                                <Play className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          disabled={page === 1 || isLoading}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          {t("common.previous", { defaultValue: "Precedente" })}
        </Button>
        <span className="text-sm text-muted-foreground">Pagina {page}</span>
        <Button
          variant="outline"
          disabled={isLoading || (accessi?.length ?? 0) < 50}
          onClick={() => setPage((current) => current + 1)}
        >
          {t("common.next", { defaultValue: "Successiva" })}
        </Button>
      </div>

      <Dialog
        open={editing != null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(
                editing?.mode === "edit"
                  ? "accessiEmporio.modificaAccesso"
                  : "accessiEmporio.nuovoAccesso",
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Select
              value={form.magazzinoEmporioId || ""}
              onValueChange={(value) => {
                setBeneficiarioSearch("");
                setSearchTerm("");
                setCardSearch(false);
                setSubmittedSearch("");
                setForm((current) => ({
                  ...current,
                  magazzinoEmporioId: value,
                  beneficiarioId: current.magazzinoEmporioId
                    ? ""
                    : initialBeneficiarioId,
                }));
              }}
              disabled={!emporioAbilitato || empori.length === 0}
            >
              <SelectTrigger aria-label={t("accessiEmporio.emporio")}>
                <SelectValue placeholder={t("accessiEmporio.emporio")} />
              </SelectTrigger>
              <SelectContent>
                {empori.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t(
                empori.length === 0 && !emporiQuery.isLoading
                  ? "emporioServizio.nessunEmporio"
                  : "emporioServizio.scegliEmporio",
              )}
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("accessiEmporio.cercaBeneficiario")}
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder={t("accessiEmporio.cercaBeneficiarioPlaceholder")}
                  value={beneficiarioSearch}
                  onChange={(event) => {
                    setCardSearch(false);
                    setSubmittedSearch("");
                    setBeneficiarioSearch(event.target.value);
                    setForm((current) => ({ ...current, beneficiarioId: "" }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && beneficiarioSearch.trim()) {
                      event.preventDefault();
                      setCardSearch(false);
                      setSubmittedSearch(beneficiarioSearch.trim());
                      setSearchTerm(beneficiarioSearch.trim());
                    }
                  }}
                  disabled={!emporioAbilitato || !form.magazzinoEmporioId}
                />
                <BarcodeScannerButton
                  disabled={!emporioAbilitato || !form.magazzinoEmporioId}
                  onScan={(value) => {
                    setForm((current) => ({ ...current, beneficiarioId: "" }));
                    setCardSearch(true);
                    setBeneficiarioSearch(value);
                    setSearchTerm(value.trim());
                  }}
                />
              </div>
              {cardSearch &&
                beneficiari &&
                !beneficiariQuery.isFetching &&
                !beneficiari.some((b) => b.tesseraCorrispondente) && (
                  <p role="alert" className="text-sm text-destructive">
                    {t("emporioServizio.tesseraNonValida")}
                  </p>
                )}
            </div>
            <EmporioBeneficiaryResults
              results={beneficiari ?? []}
              selectedId={form.beneficiarioId}
              requested={
                !!form.magazzinoEmporioId &&
                !!(beneficiarioSearch.trim() || form.beneficiarioId)
              }
              searching={
                beneficiariQuery.isFetching ||
                beneficiarioSearch.trim() !== searchTerm
              }
              error={beneficiariQuery.isError}
              canConfigureCredit={
                canViewBeneficiario &&
                hasPermission("beneficiari.manage") &&
                hasPermission("credito.quota.manage")
              }
              onSelect={(id) =>
                setForm((current) => ({
                  ...current,
                  beneficiarioId: String(id),
                }))
              }
            />
            {beneficiarioSelezionato && (
              <div
                role="region"
                aria-label={t("accessiEmporio.beneficiarioSelezionato")}
                className="rounded-md border p-3 text-xs text-muted-foreground"
              >
                <div className="font-medium text-foreground">
                  {beneficiarioSelezionato.beneficiarioNome}
                </div>
                <div>{beneficiarioSelezionato.beneficiarioCodice}</div>
                <div>{beneficiarioSelezionato.centroAscoltoNome ?? "-"}</div>
                <div>
                  {t(
                    `emporioServizio.${beneficiarioSelezionato.emporioStato ?? "non_abilitato"}`,
                  )}
                </div>
                {hasPermission("credito.view") && (
                  <div>
                    {t(
                      `creditoSolidale.stato.${beneficiarioSelezionato.creditoSolidaleStato}`,
                    )}
                  </div>
                )}
              </div>
            )}
            {eligibilityError && (
              <p className="text-sm font-medium text-destructive">
                {t(eligibilityError)}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Input
                type="date"
                value={form.data}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    data: event.target.value,
                  }))
                }
                disabled={!emporioAbilitato}
              />
              <Input
                type="time"
                value={form.oraInizio}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    oraInizio: event.target.value,
                  }))
                }
                disabled={!emporioAbilitato}
              />
              <Input
                type="time"
                value={form.oraFine}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    oraFine: event.target.value,
                  }))
                }
                disabled={!emporioAbilitato}
              />
            </div>
            {editing?.mode === "edit" && (
              <Badge
                variant="outline"
                className={statusClass(editing.accesso.statoAccessoEmporio)}
              >
                {t(
                  `accessiEmporio.${editing.accesso.statoAccessoEmporio ?? "pianificato"}`,
                )}
              </Badge>
            )}
            <Textarea
              rows={3}
              placeholder={t("accessiEmporio.note")}
              value={form.noteAccessoEmporio}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  noteAccessoEmporio: event.target.value,
                }))
              }
              disabled={!emporioAbilitato}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={submit}
              disabled={
                !emporioAbilitato ||
                pending ||
                !beneficiarioSelezionato ||
                !!eligibilityError ||
                beneficiariQuery.isFetching ||
                !form.magazzinoEmporioId
              }
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={annullando != null}
        onOpenChange={(open) => !open && setAnnullando(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("accessiEmporio.annullaAccesso")}</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder={t("accessiEmporio.motivoAnnullamento")}
            value={motivoAnnullamento}
            onChange={(event) => setMotivoAnnullamento(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnullando(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!motivoAnnullamento.trim() || pending || !annullando}
              onClick={() =>
                annullando &&
                changeStatus(annullando, "annullato", motivoAnnullamento)
              }
            >
              {t("accessiEmporio.annullaAccesso")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {initialBeneficiarioId && canViewBeneficiario && (
        <Button variant="link" asChild className="px-0">
          <Link href={`/beneficiari/${initialBeneficiarioId}`}>
            {t("accessiEmporio.tornaBeneficiario")}
          </Link>
        </Button>
      )}
    </div>
  );
}
