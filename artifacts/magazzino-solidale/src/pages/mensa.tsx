import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getSearchMensaBeneficiariQueryKey,
  getListMensaAbilitazioniQueryKey,
  getListGiacenzeMensaQueryKey,
  getListLottiMensaQueryKey,
  getListConsumiMensaQueryKey,
  useAutorizzaEccezioneMensa,
  useOpenGiornataMensa,
  useCreateAccessoTemporaneoMensa,
  useCreateMensaAbilitazione,
  useCreatePastoMensa,
  useCreateConsumoMensa,
  useCreateTesseraBeneficiario,
  useGetMensaReport,
  useListEccezioniMensa,
  useListConsumiMensa,
  useListGiornateMensa,
  useListGiacenzeMensa,
  useListLottiMensa,
  useListMensaAbilitazioni,
  useListMense,
  useListPastiMensa,
  useSearchMensaBeneficiari,
  useStornaConsumoMensa,
  useChiudiGiornataMensa,
  useRiapriGiornataMensa,
  useUpdateMensaAbilitazioneStato,
  useVerificaAccessoMensa,
  type MensaAccesso,
  type MensaBeneficiarioSummary,
  type BeneficiarioSimile,
  type MensaConsumo,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  UserPlus,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { todayEuropeRome } from "@/lib/europe-rome";
import { useCommandIntentRegistry } from "@/lib/command-intent";
import { mensaErrorMessage } from "@/lib/mensa-ui";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { MensaRifornimenti } from "@/components/mensa-rifornimenti";
import {
  MensaSelect,
  MensaOperationalContext,
  useMensaContext,
} from "@/components/mensa-operational-context";

export type MensaView =
  | "postazione"
  | "pasti"
  | "abilitazioni"
  | "trasferimenti"
  | "consumi"
  | "eccezioni"
  | "report";

function requestKey(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pageItems<T>(data: T[] | { items: T[] } | undefined): T[] {
  if (Array.isArray(data)) return data;
  return data?.items ?? [];
}

function pageTotal<T>(data: T[] | { items: T[]; total: number } | undefined) {
  return Array.isArray(data) ? data.length : (data?.total ?? 0);
}

function errorMessage(error: unknown): string {
  return mensaErrorMessage(
    error,
    i18next.t("mensa.actionFailed") || "Operazione non riuscita",
  );
}

function PageTitle({ view }: { view: MensaView }) {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t(`mensa.title.${view}`)}</h1>
      <p className="text-sm text-muted-foreground">
        {view === "postazione"
          ? t("mensa.noSensitiveData")
          : t(`mensa.description.${view}`)}
      </p>
    </div>
  );
}

function MensaQueryFeedback({
  isLoading,
  isError,
  empty,
}: {
  isLoading?: boolean;
  isError?: boolean;
  empty?: boolean;
}) {
  const { t } = useTranslation();
  if (isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("mensa.loadError")}
      </p>
    );
  if (isLoading) return <p role="status">{t("common.loading")}</p>;
  if (empty)
    return <p className="text-sm text-muted-foreground">{t("mensa.empty")}</p>;
  return null;
}

function AccessFeedback({ access }: { access: MensaAccesso }) {
  const { t } = useTranslation();
  const allowed = access.esito !== "negato";
  const possible = access.eccezionePossibile;
  return (
    <div
      role="status"
      className={`rounded-xl border-2 p-6 ${
        allowed
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20"
          : possible
            ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20"
            : "border-red-500 bg-red-50 dark:bg-red-950/20"
      }`}
    >
      <div className="flex items-center gap-3">
        {allowed ? (
          <CheckCircle2 className="h-9 w-9 text-emerald-600" />
        ) : possible ? (
          <AlertTriangle className="h-9 w-9 text-amber-600" />
        ) : (
          <XCircle className="h-9 w-9 text-red-600" />
        )}
        <div>
          <p className="text-xl font-bold">
            {allowed
              ? t("mensa.accessGranted")
              : possible
                ? t("mensa.exceptionPossible")
                : t("mensa.accessDenied")}
          </p>
          <p className="text-sm">{access.motivoEsito.replaceAll("_", " ")}</p>
        </div>
      </div>
      {access.beneficiarioNome && (
        <div className="mt-4 space-y-1">
          <p className="text-lg font-semibold">{access.beneficiarioNome}</p>
          <p>Codice: {access.beneficiarioCodice}</p>
          {access.mensaPrincipaleNome && (
            <p>Mensa principale: {access.mensaPrincipaleNome}</p>
          )}
          {access.allergie && (
            <p className="font-medium text-red-700">
              Allergie: {access.allergie}
            </p>
          )}
          {access.restrizioniAlimentari && (
            <p className="font-medium">
              Restrizioni: {access.restrizioniAlimentari}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function MensaPostazione() {
  const operationalContext = useMensaContext();
  const areaId = operationalContext?.areaId;
  const accessIntents = useCommandIntentRegistry();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const scanLockedRef = useRef(false);
  const [mensaId, setMensaId] = useState<number | null>(null);
  const [tipoServizio, setTipoServizio] = useState<"pranzo" | "cena">("pranzo");
  const [code, setCode] = useState("");
  const [access, setAccess] = useState<MensaAccesso | null>(null);
  const contextRef = useRef("");
  const generation = useRef({ identity: "", value: 0 });
  const identity = `${areaId}:${mensaId}:${tipoServizio}`;
  if (generation.current.identity !== identity)
    generation.current = { identity, value: generation.current.value + 1 };
  const context = `${identity}:${generation.current.value}`;
  contextRef.current = context;
  useEffect(
    () => () => {
      contextRef.current = "unmounted";
    },
    [],
  );
  useEffect(() => {
    setAccess(null);
    setCode("");
    setReason("");
    setManualSearch("");
    resetTemporaryForm();
  }, [mensaId, tipoServizio]);
  const [reason, setReason] = useState("");
  const [manualSearch, setManualSearch] = useState("");
  const [temporaryOpen, setTemporaryOpen] = useState(false);
  const [temporaryReason, setTemporaryReason] = useState(
    "Accesso temporaneo autorizzato dalla Postazione Mensa",
  );
  const [temporaryPerson, setTemporaryPerson] = useState({
    nome: "",
    cognome: "",
    sesso: "",
    dataNascita: "",
    fasciaEtaPresunta: "",
    telefono: "",
    cittadinanza: "",
    allergie: "",
    restrizioniAlimentari: "",
  });
  const [temporaryDuplicates, setTemporaryDuplicates] = useState<
    BeneficiarioSimile[]
  >([]);
  const verify = useVerificaAccessoMensa();
  const exception = useAutorizzaEccezioneMensa();
  const meal = useCreatePastoMensa();
  const temporaryAccess = useCreateAccessoTemporaneoMensa();
  const setContextDirty = operationalContext?.setDirty;
  const hasDraft = Boolean(
    code ||
    reason ||
    manualSearch ||
    temporaryOpen ||
    verify.isPending ||
    meal.isPending ||
    temporaryAccess.isPending,
  );
  useEffect(() => {
    setContextDirty?.(hasDraft);
    return () => setContextDirty?.(false);
  }, [setContextDirty, hasDraft]);
  const search = useSearchMensaBeneficiari(
    {
      search: manualSearch,
      areaOperativaId: areaId,
      mensaId: mensaId ?? undefined,
    },
    {
      query: {
        queryKey: getSearchMensaBeneficiariQueryKey({
          search: manualSearch,
          areaOperativaId: areaId,
          mensaId: mensaId ?? undefined,
        }),
        enabled:
          hasPermission("mensa.access.manual") &&
          manualSearch.trim().length >= 2,
      },
    },
  );

  useEffect(() => {
    if (
      document.activeElement === document.body ||
      document.activeElement === inputRef.current
    )
      inputRef.current?.focus();
  }, [verify.isPending, access]);

  const focusScanner = () => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const resetTemporaryForm = () => {
    setTemporaryOpen(false);
    setTemporaryDuplicates([]);
    setTemporaryReason("Accesso temporaneo autorizzato dalla Postazione Mensa");
    setTemporaryPerson({
      nome: "",
      cognome: "",
      sesso: "",
      dataNascita: "",
      fasciaEtaPresunta: "",
      telefono: "",
      cittadinanza: "",
      allergie: "",
      restrizioniAlimentari: "",
    });
  };

  const readyForNextPerson = () => {
    setAccess(null);
    setReason("");
    setCode("");
    setManualSearch("");
    resetTemporaryForm();
    focusScanner();
  };

  const verifyCode = (scannedCode: string) => {
    if (
      !mensaId ||
      !scannedCode.trim() ||
      verify.isPending ||
      scanLockedRef.current
    )
      return;
    scanLockedRef.current = true;
    setAccess(null);
    const slot = `access:${context}`;
    const payload = {
      mensaId,
      modalitaAccesso: "tessera" as const,
      codiceTessera: scannedCode.trim(),
      tipoServizio,
    };
    verify.mutate(
      {
        data: accessIntents.prepare(slot, payload, payload),
      },
      {
        onSuccess: (result) => {
          accessIntents.complete(slot);
          if (contextRef.current === context) {
            setAccess(result);
            setCode("");
          }
        },
        onError: (error) => {
          accessIntents.fail(slot, error);
          if (contextRef.current !== context) return;
          toast({
            title: "Verifica non riuscita",
            description: errorMessage(error),
            variant: "destructive",
          });
        },
        onSettled: () => {
          scanLockedRef.current = false;
        },
      },
    );
  };
  const scan = (event: React.FormEvent) => {
    event.preventDefault();
    verifyCode(code);
  };

  const verifyManual = (beneficiary: MensaBeneficiarioSummary) => {
    if (!mensaId || verify.isPending || scanLockedRef.current) return;
    scanLockedRef.current = true;
    setAccess(null);
    const slot = `access:${context}`;
    const payload = {
      mensaId,
      modalitaAccesso: "manuale" as const,
      beneficiarioId: beneficiary.id,
      tipoServizio,
    };
    verify.mutate(
      {
        data: accessIntents.prepare(slot, payload, payload),
      },
      {
        onSuccess: (result) => {
          accessIntents.complete(slot);
          if (contextRef.current === context) {
            setAccess(result);
            setManualSearch("");
          }
        },
        onError: (error) => {
          accessIntents.fail(slot, error);
          if (contextRef.current !== context) return;
          toast({
            title: t("mensa.loadError"),
            description: errorMessage(error),
            variant: "destructive",
          });
        },
        onSettled: () => {
          scanLockedRef.current = false;
        },
      },
    );
  };

  const authorize = () => {
    if (!access || !reason.trim() || exception.isPending) return;
    exception.mutate(
      { id: access.id, data: { motivo: reason.trim() } },
      {
        onSuccess: (result) => {
          if (contextRef.current === context) {
            setAccess(result);
            setReason("");
          }
        },
        onError: (error) => {
          if (contextRef.current !== context) return;
          toast({
            title: t("mensa.actionFailed"),
            description: errorMessage(error),
            variant: "destructive",
          });
        },
      },
    );
  };

  const registerMeal = () => {
    if (!access || meal.isPending) return;
    const submit = (override = false, motivoOverride?: string) =>
      meal.mutate(
        {
          data: {
            accessoMensaId: access.id,
            tipoServizio,
            idempotencyKey: override
              ? requestKey(`meal-override-access-${access.id}`)
              : `meal-access-${access.id}`,
            override,
            motivoOverride,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Pasto registrato" });
            if (contextRef.current === context) readyForNextPerson();
          },
          onError: (error) => {
            if (contextRef.current !== context) return;
            const message = errorMessage(error);
            if (
              !override &&
              hasPermission("mensa.meals.override") &&
              message.includes("override autorizzato") &&
              window.confirm(
                "Il pasto risulta già registrato. Vuoi autorizzare un secondo pasto?",
              )
            ) {
              const reason = window.prompt(
                "Motivo obbligatorio del secondo pasto",
              );
              if (reason?.trim()) submit(true, reason.trim());
              return;
            }
            toast({
              title: "Pasto non registrato",
              description: message,
              variant: "destructive",
            });
          },
        },
      );
    submit();
  };

  const onTemporarySuccess = (result: MensaAccesso) => {
    if (contextRef.current === context) {
      setAccess(result);
      resetTemporaryForm();
    }
  };

  const authorizeTemporaryBeneficiary = (
    beneficiary: MensaBeneficiarioSummary | BeneficiarioSimile,
  ) => {
    if (!mensaId || temporaryAccess.isPending) return;
    temporaryAccess.mutate(
      {
        data: {
          mensaId,
          beneficiarioId: beneficiary.id,
          motivo: temporaryReason.trim() || null,
          tipoServizio,
          idempotencyKey: requestKey("temporary-existing"),
        },
      },
      {
        onSuccess: onTemporarySuccess,
        onError: (error) => {
          if (contextRef.current !== context) return;
          toast({
            title: "Accesso temporaneo non autorizzato",
            description: errorMessage(error),
            variant: "destructive",
          });
        },
      },
    );
  };

  const createTemporaryPerson = (confirmDuplicate = false) => {
    if (!mensaId || temporaryAccess.isPending) return;
    temporaryAccess.mutate(
      {
        data: {
          mensaId,
          motivo: temporaryReason.trim() || null,
          tipoServizio,
          confermaDuplicato: confirmDuplicate,
          idempotencyKey: requestKey("temporary-new"),
          nuovaPersona: {
            nome: temporaryPerson.nome.trim(),
            cognome: temporaryPerson.cognome.trim(),
            sesso: temporaryPerson.sesso as "M" | "F" | "ALTRO",
            dataNascita: temporaryPerson.dataNascita || null,
            fasciaEtaPresunta:
              (temporaryPerson.fasciaEtaPresunta as
                | "0_17"
                | "18_29"
                | "30_64"
                | "65_plus") || null,
            telefono: temporaryPerson.telefono.trim() || null,
            cittadinanza: temporaryPerson.cittadinanza.trim() || null,
            allergie: temporaryPerson.allergie.trim() || null,
            restrizioniAlimentari:
              temporaryPerson.restrizioniAlimentari.trim() || null,
          },
        },
      },
      {
        onSuccess: onTemporarySuccess,
        onError: (error) => {
          if (contextRef.current !== context) return;
          const data = (
            error as {
              data?: { possibiliDuplicati?: BeneficiarioSimile[] };
            }
          ).data;
          if (data?.possibiliDuplicati?.length) {
            setTemporaryDuplicates(data.possibiliDuplicati);
            return;
          }
          toast({
            title: "Persona non registrata",
            description: errorMessage(error),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Card>
        <CardContent className="space-y-5 p-6">
          <MensaSelect value={mensaId} onChange={setMensaId} />
          <Select
            value={tipoServizio}
            onValueChange={(value) => {
              const change = () => setTipoServizio(value as "pranzo" | "cena");
              if (operationalContext) operationalContext.change(change);
              else change();
            }}
          >
            <SelectTrigger aria-label="Tipo servizio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pranzo">Pranzo</SelectItem>
              <SelectItem value="cena">Cena</SelectItem>
            </SelectContent>
          </Select>
          <form onSubmit={scan} className="space-y-3 text-center">
            <Label htmlFor="mensa-scan" className="text-xl">
              {t("mensa.scanPrompt")}
            </Label>
            <BarcodeScannerButton
              key={context}
              withLabel
              label={t("mensa.scanCard")}
              disabled={!mensaId || verify.isPending}
              onScan={verifyCode}
            />
            <Input
              ref={inputRef}
              id="mensa-scan"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="h-16 text-center text-2xl tracking-wider"
              autoComplete="off"
              disabled={verify.isPending}
            />
            <Button
              className="w-full"
              size="lg"
              disabled={!mensaId || !code.trim() || verify.isPending}
            >
              {verify.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Verifica accesso
            </Button>
          </form>
        </CardContent>
      </Card>
      {access && (
        <div className="space-y-4">
          <AccessFeedback access={access} />
          {access.eccezionePossibile &&
            hasPermission("mensa.exceptions.manage") && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <Label htmlFor="exception-reason">Motivo eccezione</Label>
                  <Textarea
                    id="exception-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <Button
                    onClick={authorize}
                    disabled={!reason.trim() || exception.isPending}
                  >
                    {t("mensa.authorizeException")}
                  </Button>
                </CardContent>
              </Card>
            )}
          {access.esito !== "negato" && hasPermission("mensa.meals.create") && (
            <Button
              size="lg"
              className="w-full"
              onClick={registerMeal}
              disabled={meal.isPending}
            >
              {t("mensa.registerMeal")}
            </Button>
          )}
        </div>
      )}
      {hasPermission("mensa.access.manual") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("mensa.manualSearch")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={manualSearch}
                onChange={(event) => setManualSearch(event.target.value)}
                placeholder="Nome, cognome o codice"
              />
            </div>
            {search.data?.map((beneficiary) => (
              <div
                key={beneficiary.id}
                className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row"
              >
                <Button
                  variant="ghost"
                  className="flex-1 justify-between"
                  onClick={() => verifyManual(beneficiary)}
                >
                  <span>
                    {beneficiary.nome} {beneficiary.cognome}
                  </span>
                  <span>{beneficiary.codice}</span>
                </Button>
                {hasPermission("mensa.access.temporary") && (
                  <Button
                    variant="outline"
                    onClick={() => authorizeTemporaryBeneficiary(beneficiary)}
                    disabled={!mensaId || temporaryAccess.isPending}
                  >
                    Accesso temporaneo
                  </Button>
                )}
              </div>
            ))}
            {hasPermission("mensa.access.temporary") && (
              <Button
                variant="secondary"
                className="w-full gap-2"
                onClick={() => setTemporaryOpen(true)}
                disabled={!mensaId}
              >
                <UserPlus className="h-4 w-4" />
                NUOVA PERSONA – ACCESSO TEMPORANEO
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {!hasPermission("mensa.access.manual") &&
        hasPermission("mensa.access.temporary") && (
          <Button
            variant="secondary"
            className="w-full gap-2"
            onClick={() => setTemporaryOpen(true)}
            disabled={!mensaId}
          >
            <UserPlus className="h-4 w-4" />
            NUOVA PERSONA – ACCESSO TEMPORANEO
          </Button>
        )}
      {temporaryOpen && hasPermission("mensa.access.temporary") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Nuova persona – accesso temporaneo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              L'anagrafica sarà registrata come provvisoria, senza tessera né
              abilitazione permanente. L'accesso vale solo per oggi.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="temporary-name">Nome</Label>
                <Input
                  id="temporary-name"
                  value={temporaryPerson.nome}
                  onChange={(event) =>
                    setTemporaryPerson((value) => ({
                      ...value,
                      nome: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="temporary-surname">Cognome</Label>
                <Input
                  id="temporary-surname"
                  value={temporaryPerson.cognome}
                  onChange={(event) =>
                    setTemporaryPerson((value) => ({
                      ...value,
                      cognome: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Sesso</Label>
                <Select
                  value={temporaryPerson.sesso}
                  onValueChange={(sesso) =>
                    setTemporaryPerson((value) => ({ ...value, sesso }))
                  }
                >
                  <SelectTrigger aria-label="Sesso">
                    <SelectValue placeholder="Seleziona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Maschio</SelectItem>
                    <SelectItem value="F">Femmina</SelectItem>
                    <SelectItem value="ALTRO">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="temporary-birth-date">Data di nascita</Label>
                <Input
                  id="temporary-birth-date"
                  type="date"
                  value={temporaryPerson.dataNascita}
                  disabled={!!temporaryPerson.fasciaEtaPresunta}
                  onChange={(event) =>
                    setTemporaryPerson((value) => ({
                      ...value,
                      dataNascita: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Fascia d'età presunta</Label>
                <Select
                  value={temporaryPerson.fasciaEtaPresunta}
                  disabled={!!temporaryPerson.dataNascita}
                  onValueChange={(fasciaEtaPresunta) =>
                    setTemporaryPerson((value) => ({
                      ...value,
                      fasciaEtaPresunta,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Fascia d'età presunta">
                    <SelectValue placeholder="In alternativa alla data" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0_17">0–17</SelectItem>
                    <SelectItem value="18_29">18–29</SelectItem>
                    <SelectItem value="30_64">30–64</SelectItem>
                    <SelectItem value="65_plus">65+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {[
                ["telefono", "Telefono"],
                ["cittadinanza", "Cittadinanza"],
                ["allergie", "Allergie"],
                ["restrizioniAlimentari", "Restrizioni alimentari"],
              ].map(([field, label]) => (
                <div key={field} className="space-y-1">
                  <Label htmlFor={`temporary-${field}`}>{label}</Label>
                  <Input
                    id={`temporary-${field}`}
                    value={
                      temporaryPerson[field as keyof typeof temporaryPerson]
                    }
                    onChange={(event) =>
                      setTemporaryPerson((value) => ({
                        ...value,
                        [field]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="temporary-reason">Motivazione</Label>
              <Textarea
                id="temporary-reason"
                value={temporaryReason}
                onChange={(event) => setTemporaryReason(event.target.value)}
              />
            </div>
            {temporaryDuplicates.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-500 p-3">
                <p className="font-medium">
                  Possibili persone già presenti nella stessa area
                </p>
                {temporaryDuplicates.map((duplicate) => (
                  <Button
                    key={duplicate.id}
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => authorizeTemporaryBeneficiary(duplicate)}
                  >
                    <span>
                      Usa {duplicate.nome} {duplicate.cognome}
                    </span>
                    <span>{duplicate.codice}</span>
                  </Button>
                ))}
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => createTemporaryPerson(true)}
                  disabled={temporaryAccess.isPending}
                >
                  Conferma che è una persona diversa e crea comunque
                </Button>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetTemporaryForm}>
                Annulla
              </Button>
              <Button
                onClick={() => createTemporaryPerson(false)}
                disabled={
                  temporaryAccess.isPending ||
                  !temporaryPerson.nome.trim() ||
                  !temporaryPerson.cognome.trim() ||
                  !temporaryPerson.sesso ||
                  (!temporaryPerson.dataNascita &&
                    !temporaryPerson.fasciaEtaPresunta)
                }
              >
                Verifica e autorizza per oggi
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PastiView() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [mensaId, setMensaId] = useState<number | null>(null);
  const [date, setDate] = useState(todayEuropeRome());
  const [tipoServizio, setTipoServizio] = useState<"pranzo" | "cena">("pranzo");
  const [page, setPage] = useState(1);
  const mealsQuery = useListPastiMensa({
    mensaId: mensaId ?? undefined,
    data: date,
    tipoServizio,
    page,
    pageSize: 50,
  });
  const days = useListGiornateMensa({
    mensaId: mensaId ?? undefined,
    data: date,
  });
  const close = useChiudiGiornataMensa();
  const openDay = useOpenGiornataMensa();
  const reopen = useRiapriGiornataMensa();
  const data = pageItems(mealsQuery.data);
  const total = pageTotal(mealsQuery.data);
  const serviceDay = days.data?.find(
    (day) => day.mensaId === mensaId && day.tipoServizio === tipoServizio,
  );
  const refreshDays = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/mensa/giornate"] });
  const onError = (error: unknown) =>
    toast({
      title: t("mensa.actionFailed"),
      description: errorMessage(error),
      variant: "destructive",
    });
  useEffect(() => setPage(1), [mensaId, date, tipoServizio]);
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="pasti" />
      <MensaQueryFeedback isError={mealsQuery.isError || days.isError} />
      <div className="grid gap-3 md:grid-cols-3">
        <MensaSelect value={mensaId} onChange={setMensaId} historical />
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Select
          value={tipoServizio}
          onValueChange={(value) => setTipoServizio(value as "pranzo" | "cena")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pranzo">Pranzo</SelectItem>
            <SelectItem value="cena">Cena</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!serviceDay &&
        mensaId &&
        date === todayEuropeRome() &&
        hasPermission("mensa.service.close") && (
          <Button
            disabled={openDay.isPending || close.isPending}
            onClick={() =>
              openDay.mutate(
                { data: { mensaId, dataServizio: date, tipoServizio } },
                {
                  onError,
                  onSuccess: (day) =>
                    close.mutate(
                      { id: day.id, data: {} },
                      { onError, onSuccess: refreshDays },
                    ),
                },
              )
            }
          >
            {t("mensa.closeZeroDay")}
          </Button>
        )}
      {serviceDay && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <Badge
                variant={
                  serviceDay.stato === "chiusa" ? "secondary" : "default"
                }
              >
                Giornata {serviceDay.stato}
              </Badge>
              {serviceDay.stato === "chiusa" && serviceDay.snapshot && (
                <span className="ml-3 text-sm text-muted-foreground">
                  Snapshot preservato alla chiusura
                </span>
              )}
            </div>
            {serviceDay.stato === "aperta" &&
              hasPermission("mensa.service.close") && (
                <Button
                  variant="outline"
                  disabled={close.isPending}
                  onClick={() =>
                    close.mutate(
                      { id: serviceDay.id, data: {} },
                      { onSuccess: refreshDays, onError },
                    )
                  }
                >
                  Chiudi giornata
                </Button>
              )}
            {serviceDay.stato === "chiusa" &&
              hasPermission("mensa.service.reopen") && (
                <Button
                  variant="outline"
                  disabled={reopen.isPending}
                  onClick={() => {
                    const motivo = window.prompt(
                      "Motivo obbligatorio della riapertura",
                    );
                    if (motivo?.trim())
                      reopen.mutate(
                        { id: serviceDay.id, data: { motivo: motivo.trim() } },
                        { onSuccess: refreshDays, onError },
                      );
                  }}
                >
                  Riapri giornata
                </Button>
              )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{total} pasti</CardTitle>
        </CardHeader>
        <CardContent>
          {mealsQuery.isLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ora</TableHead>
                  <TableHead>Beneficiario</TableHead>
                  <TableHead>Servizio</TableHead>
                  <TableHead>Accesso</TableHead>
                  <TableHead>Operatore</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((meal) => (
                  <TableRow key={meal.id}>
                    <TableCell>
                      {new Date(meal.dataOra).toLocaleTimeString("it-IT", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/Rome",
                      })}
                    </TableCell>
                    <TableCell>
                      {meal.beneficiarioNome}{" "}
                      <span className="text-muted-foreground">
                        {meal.beneficiarioCodice}
                      </span>
                    </TableCell>
                    <TableCell>{meal.tipoServizio}</TableCell>
                    <TableCell>
                      {meal.eccezione ? (
                        <Badge variant="secondary">Eccezione</Badge>
                      ) : (
                        "Ordinario"
                      )}
                    </TableCell>
                    <TableCell>{meal.operatore}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Precedente
            </Button>
            <Button
              variant="outline"
              disabled={page * 50 >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              Successiva
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AbilitazioniView() {
  const operationalContext = useMensaContext();
  const areaId = operationalContext?.areaId;
  const { t } = useTranslation();
  const { toast } = useToast();
  const onError = (error: unknown) =>
    toast({
      title: t("mensa.actionFailed"),
      description: errorMessage(error),
      variant: "destructive",
    });
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<MensaBeneficiarioSummary | null>(
    null,
  );
  const [mensaId, setMensaId] = useState<number | null>(null);
  const [start, setStart] = useState(todayEuropeRome());
  const [end, setEnd] = useState("");
  const [eligibilityReason, setEligibilityReason] = useState("");
  const setContextDirty = operationalContext?.setDirty;
  const hasDraft =
    selected != null && (start !== todayEuropeRome() || end !== "" || eligibilityReason !== "");
  useEffect(() => {
    setContextDirty?.(hasDraft);
    return () => setContextDirty?.(false);
  }, [setContextDirty, hasDraft]);
  const search = useSearchMensaBeneficiari(
    { search: searchText, areaOperativaId: areaId },
    {
      query: {
        queryKey: getSearchMensaBeneficiariQueryKey({
          search: searchText,
          areaOperativaId: areaId,
        }),
        enabled: searchText.trim().length >= 2,
      },
    },
  );
  const historyParams = {
    beneficiarioId: selected?.id,
    areaOperativaId: areaId,
  };
  const history = useListMensaAbilitazioni(historyParams, {
    query: {
      queryKey: getListMensaAbilitazioniQueryKey(historyParams),
      enabled: selected != null,
    },
  });
  const create = useCreateMensaAbilitazione();
  const status = useUpdateMensaAbilitazioneStato();
  const card = useCreateTesseraBeneficiario();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/mensa/abilitazioni"] }),
      queryClient.invalidateQueries({
        queryKey: ["/api/mensa/beneficiari/ricerca"],
      }),
      queryClient.invalidateQueries({ queryKey: ["/api/mensa/tessere"] }),
    ]);
  return (
    <div className="space-y-6 p-6">
      <MensaQueryFeedback
        isLoading={search.isLoading}
        isError={search.isError || history.isError}
      />
      <Card>
        <CardContent className="space-y-3 p-4">
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Cerca beneficiario"
          />
          {searchText.trim().length < 2 && <p>{t("mensa.searchHint")}</p>}
          {search.isSuccess &&
            searchText.trim().length >= 2 &&
            !search.data?.length && <p>{t("mensa.noBeneficiariesInArea")}</p>}
          {!search.isError &&
            search.data?.map((person) => (
              <Button
                key={person.id}
                variant={selected?.id === person.id ? "default" : "outline"}
                className="mr-2"
                onClick={() => {
                  const change = () => {
                    setSelected(person);
                    setStart(todayEuropeRome());
                    setEnd("");
                    setEligibilityReason("");
                  };
                  if (operationalContext) operationalContext.change(change);
                  else change();
                }}
              >
                {person.nome} {person.cognome} · {person.codice}
              </Button>
            ))}
        </CardContent>
      </Card>
      {selected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Abilita {selected.nome} {selected.cognome}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <MensaSelect value={mensaId} onChange={setMensaId} />
              <Input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <Input
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
                aria-label="Data fine abilitazione"
              />
              <Input aria-label={t("ciclo2Mensa.reason")} placeholder={t("ciclo2Mensa.reason")} value={eligibilityReason} onChange={(e)=>setEligibilityReason(e.target.value)} maxLength={2000}/>
              <p className="text-sm text-muted-foreground md:col-span-4">{mensaId != null && t("ciclo2Mensa.areaValidity", {area:operationalContext?.mense.find((m)=>m.id===mensaId)?.areaOperativaNome ?? String(areaId)})} {t("ciclo2Mensa.referenceHelp")}</p>
              <Button
                disabled={!mensaId || !eligibilityReason.trim() || create.isPending || !selected.attivo}
                onClick={() =>
                  create.mutate(
                    {
                      data: {
                        beneficiarioId: selected.id,
                        mensaId: mensaId!,
                        dataInizio: start,
                        dataFine: end || null,
                        mensaPrincipale: true,
                        motivo: eligibilityReason.trim(),
                      },
                    },
                    { onSuccess: () => { setEligibilityReason(""); void refresh(); }, onError },
                  )
                }
              >
                Abilita
              </Button>
              {hasPermission("mensa.cards.manage") && (
                <Button
                  variant="outline"
                  disabled={card.isPending}
                  onClick={() =>
                    card.mutate(
                      { data: { beneficiarioId: selected.id } },
                      { onSuccess: refresh, onError },
                    )
                  }
                >
                  Emetti tessera
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Storico</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mensa</TableHead>
                    <TableHead>Validità</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!history.isError &&
                    history.data?.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.mensaNome}</TableCell>
                        <TableCell>
                          {item.dataInizio} —{" "}
                          {item.dataFine ?? "senza scadenza"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Badge>
                              {item.stato === "attiva" &&
                              item.dataInizio > todayEuropeRome()
                                ? "programmata"
                                : item.stato}
                            </Badge>
                            {item.mensaPrincipale && (
                              <Badge variant="secondary">
                                Mensa principale
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {item.stato === "attiva" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={status.isPending}
                                onClick={() => {
                                  const motivo = window.prompt(
                                    "Motivo obbligatorio della sospensione",
                                  );
                                  if (motivo?.trim())
                                    status.mutate(
                                      {
                                        id: item.id,
                                        data: {
                                          stato: "sospesa",
                                          motivo: motivo.trim(),
                                          versione: item.versione,
                                        },
                                      },
                                      { onSuccess: refresh, onError },
                                    );
                                }}
                              >
                                Sospendi
                              </Button>
                            )}
                            {item.stato === "sospesa" && (
                              <Button
                                size="sm"
                                disabled={status.isPending}
                                onClick={() => {
                                  const motivo = window.prompt(t("ciclo2Mensa.reason"));
                                  if (motivo?.trim()) status.mutate(
                                    {id:item.id,data:{stato:"attiva",versione:item.versione,motivo:motivo.trim()}},
                                    {onSuccess:refresh,onError},
                                  );
                                }}
                              >
                                Riattiva
                              </Button>
                            )}
                            {(item.stato === "attiva" ||
                              item.stato === "sospesa") && (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={status.isPending}
                                onClick={() => {
                                  const motivo = window.prompt(
                                    "Motivo obbligatorio della revoca",
                                  );
                                  if (motivo?.trim())
                                    status.mutate(
                                      {
                                        id: item.id,
                                        data: {
                                          stato: "revocata",
                                          motivo: motivo.trim(),
                                          versione: item.versione,
                                        },
                                      },
                                      { onSuccess: refresh, onError },
                                    );
                                }}
                              >
                                Revoca
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ConsumiView() {
  const { t } = useTranslation();
  const commandIntents = useCommandIntentRegistry();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: mense = [] } = useListMense({ attiva: true });
  const [mensaId, setMensaId] = useState<number | null>(null);
  const [date, setDate] = useState(todayEuropeRome());
  const [historyMensaId, setHistoryMensaId] = useState<number | null>(null);
  const [tipoServizio, setTipoServizio] = useState<"pranzo" | "cena">("pranzo");
  const [causale, setCausale] = useState<"consumo" | "scarto">("consumo");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [lotId, setLotId] = useState("");
  const [reason, setReason] = useState("");
  const [lotPage, setLotPage] = useState(1);
  const [lotSearch, setLotSearch] = useState("");
  const [page, setPage] = useState(1);
  const warehouseId = mense.find((mensa) => mensa.id === mensaId)?.magazzinoId;
  const stock = useListGiacenzeMensa(
    { magazzinoId: warehouseId ?? 0 },
    {
      query: {
        queryKey: getListGiacenzeMensaQueryKey({
          magazzinoId: warehouseId ?? 0,
        }),
        enabled: warehouseId != null,
      },
    },
  );
  const listParams = {
    mensaId: historyMensaId ?? undefined,
    data: date,
    page,
    pageSize: 50,
  };
  const list = useListConsumiMensa(listParams);
  const create = useCreateConsumoMensa();
  const reverse = useStornaConsumoMensa();
  const rows = pageItems(list.data);
  const total = pageTotal(list.data);
  const selectedProduct = stock.data?.find(
    (item) => item.prodottoId === Number(productId),
  );
  const lotParams = {
    mensaId: mensaId ?? 0,
    magazzinoId: warehouseId ?? 0,
    prodottoId: Number(productId),
    includeExpired: causale === "scarto",
    page: lotPage,
    pageSize: 50,
    search: lotSearch || undefined,
  };
  const lots = useListLottiMensa(lotParams, {
    query: {
      queryKey: getListLottiMensaQueryKey(lotParams),
      enabled: !!mensaId && !!warehouseId && !!selectedProduct,
    },
  });
  const availableLots = pageItems(lots.data);
  const selectedLot = availableLots.find((item) => item.id === Number(lotId));
  const available =
    selectedLot?.disponibileReale ??
    (causale === "scarto"
      ? Math.max(
          0,
          (selectedProduct?.giacenzaFisica ?? 0) -
            (selectedProduct?.impegnato ?? 0),
        )
      : (selectedProduct?.disponibileReale ?? 0));
  useEffect(() => {
    setLotId("");
    setLotPage(1);
  }, [mensaId, productId, causale, lotSearch]);
  useEffect(() => setPage(1), [historyMensaId, date]);
  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getListConsumiMensaQueryKey(listParams),
    });
    if (warehouseId)
      queryClient.invalidateQueries({
        queryKey: getListGiacenzeMensaQueryKey({ magazzinoId: warehouseId }),
      });
  };
  const submit = () => {
    if (!mensaId || !selectedProduct) return;
    const slot = "consumo-mensa:create";
    const payload = {
      mensaId,
      dataServizio: todayEuropeRome(),
      tipoServizio,
      prodottoId: selectedProduct.prodottoId,
      quantita: quantity,
      causale,
      note: notes.trim() || null,
      lottoId: selectedLot?.id ?? null,
      motivo: causale === "scarto" ? reason.trim() : null,
    };
    create.mutate(
      {
        data: commandIntents.prepare(slot, payload, payload),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          setQuantity("1");
          setNotes("");
          setReason("");
          refresh();
          toast({
            title:
              causale === "consumo"
                ? "Consumo registrato"
                : "Scarto registrato",
          });
        },
        onError: (error) => {
          commandIntents.fail(slot, error);
          toast({
            title: "Registrazione non riuscita",
            description: errorMessage(error),
            variant: "destructive",
          });
        },
      },
    );
  };
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="consumi" />
      <MensaQueryFeedback
        isLoading={stock.isLoading}
        isError={stock.isError || lots.isError}
      />
      <Card>
        <CardHeader>
          <CardTitle>Nuova registrazione</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <MensaSelect
            value={mensaId}
            onChange={(value) => {
              setMensaId(value);
              setProductId("");
            }}
          />
          <Input
            type="date"
            value={todayEuropeRome()}
            readOnly
            aria-label={t("mensa.currentDate")}
          />
          <Select
            value={tipoServizio}
            onValueChange={(value) =>
              setTipoServizio(value as "pranzo" | "cena")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pranzo">Pranzo</SelectItem>
              <SelectItem value="cena">Cena</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={causale}
            onValueChange={(value) => setCausale(value as "consumo" | "scarto")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consumo">Consumo</SelectItem>
              <SelectItem value="scarto">Scarto</SelectItem>
            </SelectContent>
          </Select>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger aria-label="Prodotto">
              <SelectValue placeholder="Prodotto" />
            </SelectTrigger>
            <SelectContent>
              {stock.data?.map((item) => (
                <SelectItem
                  key={item.prodottoId}
                  value={String(item.prodottoId)}
                >
                  {item.nome} · {item.disponibileReale} {item.unitaMisura}{" "}
                  disponibili
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={selectedProduct?.quantitaFrazionabile ? "0.000001" : "1"}
            step={selectedProduct?.quantitaFrazionabile ? "0.000001" : "1"}
            max={available}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          {selectedProduct && (
            <div className="space-y-2">
              <Input
                aria-label={t("mensa.searchLot")}
                value={lotSearch}
                onChange={(event) => setLotSearch(event.target.value)}
              />
              <Select
                value={lotId || "fefo"}
                onValueChange={(value) =>
                  setLotId(value === "fefo" ? "" : value)
                }
              >
                <SelectTrigger aria-label={t("mensa.physicalLot")}>
                  <SelectValue placeholder={t("mensa.physicalLot")} />
                </SelectTrigger>
                <SelectContent>
                  {!selectedProduct.lottoFisicoObbligatorio && (
                    <SelectItem value="fefo">
                      {t("mensa.automaticFefo")}
                    </SelectItem>
                  )}
                  {availableLots.map((lot) => (
                    <SelectItem key={lot.id} value={String(lot.id)}>
                      {lot.codiceLotto ?? `#${lot.id}`} ·{" "}
                      {lot.dataScadenza ?? "—"} · {lot.disponibileRealePrecisa}{" "}
                      {selectedProduct.unitaMisura}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={lotPage === 1}
                onClick={() => setLotPage((page) => page - 1)}
              >
                {t("common.previous")}
              </Button>
              <Button
                variant="outline"
                disabled={lotPage * 50 >= pageTotal(lots.data)}
                onClick={() => setLotPage((page) => page + 1)}
              >
                {t("common.next")}
              </Button>
            </div>
          )}
          {causale === "scarto" && (
            <>
              <p>{t("mensa.physicalWasteHint")}</p>
              <Input
                required
                aria-label={t("mensa.wasteReason")}
                placeholder={t("mensa.wasteReason")}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </>
          )}
          <Textarea
            className="md:col-span-2"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Note operative"
          />
          <Button
            disabled={
              !mensaId ||
              !selectedProduct ||
              Number(quantity) <= 0 ||
              Number(quantity) > available ||
              (selectedProduct?.lottoFisicoObbligatorio && !selectedLot) ||
              (causale === "scarto" && !reason.trim()) ||
              create.isPending
            }
            onClick={submit}
          >
            Registra {causale}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex gap-3">
            <MensaSelect
              value={historyMensaId}
              onChange={setHistoryMensaId}
              historical
            />
            <Input
              type="date"
              aria-label={t("mensa.historyDate")}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <MensaQueryFeedback
            isLoading={list.isLoading}
            isError={list.isError}
            empty={list.data != null && !rows.length}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servizio</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Quantità</TableHead>
                <TableHead>Causale</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row: MensaConsumo) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.dataServizio} · {row.tipoServizio}
                  </TableCell>
                  <TableCell>
                    {row.prodottoNome ?? `#${row.prodottoId}`}
                  </TableCell>
                  <TableCell>
                    {row.quantita} {row.unitaMisura}
                  </TableCell>
                  <TableCell>{row.causale}</TableCell>
                  <TableCell>
                    <Badge variant={row.stornato ? "secondary" : "default"}>
                      {row.stornato ? "Stornato" : "Registrato"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {!row.stornato && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reverse.isPending}
                        onClick={() => {
                          const motivo = window.prompt(
                            "Motivo obbligatorio dello storno",
                          );
                          if (motivo?.trim())
                            reverse.mutate(
                              { id: row.id, data: { motivo: motivo.trim() } },
                              {
                                onSuccess: refresh,
                                onError: (error) =>
                                  toast({
                                    title: t("mensa.actionFailed"),
                                    description: errorMessage(error),
                                    variant: "destructive",
                                  }),
                              },
                            );
                        }}
                      >
                        Storna
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Precedente
            </Button>
            <Button
              variant="outline"
              disabled={page * 50 >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              Successiva
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EccezioniView() {
  const [page, setPage] = useState(1);
  const query = useListEccezioniMensa({ page, pageSize: 50 });
  const data = pageItems(query.data);
  const total = pageTotal(query.data);
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="eccezioni" />
      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Beneficiario</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Mensa origine → destinazione</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {new Date(item.dataOra).toLocaleString("it-IT", {
                      timeZone: "Europe/Rome",
                    })}
                  </TableCell>
                  <TableCell>{item.beneficiarioNome}</TableCell>
                  <TableCell>{item.motivo}</TableCell>
                  <TableCell>
                    {item.mensaPrincipaleId} → {item.mensaDestinazioneId}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Precedente
            </Button>
            <Button
              variant="outline"
              disabled={page * 50 >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              Successiva
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReportView() {
  const { t } = useTranslation();
  const [dal, setDal] = useState(todayEuropeRome());
  const [al, setAl] = useState(todayEuropeRome());
  const [mensaId, setMensaId] = useState<number | null>(null);
  const report = useGetMensaReport({ dal, al, mensaId: mensaId ?? undefined });
  const cards = report.data
    ? [
        ["Totale pasti", report.data.totalePasti],
        ["Beneficiari distinti", report.data.beneficiariDistinti],
        ["Accessi ordinari", report.data.accessiOrdinari],
        ["Accessi temporanei", report.data.accessiTemporanei],
        ["Accessi in eccezione", report.data.accessiEccezione],
        ["Accessi negati", report.data.accessiNegati],
        ["Pasti ordinari", report.data.pastiOrdinari ?? 0],
        ["Pasti temporanei", report.data.pastiTemporanei ?? 0],
        ["Pasti in eccezione", report.data.pastiEccezione ?? 0],
        ["Pasti con override", report.data.pastiOverride ?? 0],
        ["Media pasti/giorno civile", report.data.mediaPastiGiorno],
      ]
    : [];
  const breakdowns: Array<{
    title: string;
    rows: Array<{ chiave: string; totale: number }>;
    distinct?: Array<{ chiave: string; totale: number }>;
  }> = report.data
    ? [
        {
          title: "Pasti per sesso",
          rows: report.data.distribuzioneSesso ?? [],
          distinct: report.data.beneficiariDistintiPerSesso ?? [],
        },
        {
          title: "Pasti per fascia d'età",
          rows: report.data.distribuzioneFasciaEta ?? [],
          distinct: report.data.beneficiariDistintiPerFasciaEta ?? [],
        },
        {
          title: "Pasti per tipo servizio",
          rows: report.data.distribuzioneTipoServizio ?? [],
        },
      ]
    : [];
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="report" />
      <MensaQueryFeedback
        isLoading={report.isLoading}
        isError={report.isError}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          type="date"
          value={dal}
          onChange={(e) => setDal(e.target.value)}
        />
        <Input type="date" value={al} onChange={(e) => setAl(e.target.value)} />
        <MensaSelect value={mensaId} onChange={setMensaId} historical />
      </div>
      <p className="text-sm text-muted-foreground">
        {t("mensa.averageDenominator")} ·{" "}
        {report.data?.denominatoreMedia ?? "—"}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{value}</CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {breakdowns.map((breakdown) => (
          <Card key={breakdown.title}>
            <CardHeader>
              <CardTitle className="text-base">{breakdown.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {breakdown.rows.map((row) => {
                const distinct = breakdown.distinct?.find(
                  (item) => item.chiave === row.chiave,
                );
                return (
                  <div
                    key={row.chiave}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{row.chiave.replaceAll("_", " ")}</span>
                    <span className="font-medium">
                      {row.totale} pasti
                      {distinct ? ` · ${distinct.totale} persone` : ""}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
      {report.data?.giornate?.map((day) => (
        <Card key={day.id}>
          <CardContent className="p-4">
            <Badge>
              {day.dataServizio} · {day.tipoServizio} ·{" "}
              {day.stato === "aperta" && day.riapertaAt
                ? t("mensa.reopened")
                : day.stato}
            </Badge>
            {day.snapshot && (
              <p>
                {t("mensa.previousSnapshot")}: {String(day.snapshot.pasti ?? 0)}{" "}
                {t("mensa.title.pasti")}
              </p>
            )}
            <p>
              {t("mensa.closureHistory")}:{" "}
              {report.data?.chiusurePrecedenti?.filter(
                (closure) => closure.giornataId === day.id,
              ).length ?? 0}
            </p>
          </CardContent>
        </Card>
      ))}
      <div className="grid gap-4 md:grid-cols-2">
        {report.data &&
          [
            {
              title: "Consumi per prodotto",
              rows: report.data.consumiPerProdotto,
            },
            {
              title: "Scarti per prodotto",
              rows: report.data.scartiPerProdotto,
            },
          ].map((breakdown) => (
            <Card key={breakdown.title}>
              <CardHeader>
                <CardTitle className="text-base">{breakdown.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {breakdown.rows.length === 0 ? (
                  <span className="text-muted-foreground">Nessun dato</span>
                ) : (
                  breakdown.rows.map((row) => (
                    <div
                      key={`${row.prodottoId}:${row.unitaMisura}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>{row.prodottoNome}</span>
                      <span className="font-medium">
                        {row.quantita} {row.unitaMisura}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {report.data &&
          [
            {
              title: "Consumi per unità di misura",
              rows: report.data.consumiPerUnitaMisura,
            },
            {
              title: "Scarti per unità di misura",
              rows: report.data.scartiPerUnitaMisura,
            },
          ].map((breakdown) => (
            <Card key={breakdown.title}>
              <CardHeader>
                <CardTitle className="text-base">{breakdown.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {breakdown.rows.length === 0 ? (
                  <span className="text-muted-foreground">Nessun dato</span>
                ) : (
                  breakdown.rows.map((row) => (
                    <div
                      key={row.unitaMisura}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>{row.unitaMisura}</span>
                      <span className="font-medium">{row.quantita}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
      </div>
      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mensa</TableHead>
                <TableHead>Pasti</TableHead>
                <TableHead>Beneficiari</TableHead>
                <TableHead>Eccezioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data?.distribuzione.map((row) => (
                <TableRow key={row.mensaId}>
                  <TableCell>{row.mensaNome}</TableCell>
                  <TableCell>{row.totalePasti}</TableCell>
                  <TableCell>{row.beneficiariDistinti}</TableCell>
                  <TableCell>{row.pastiEccezione}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MensaPage({ view }: { view: MensaView }) {
  const content = useMemo(() => {
    switch (view) {
      case "postazione":
        return <MensaPostazione />;
      case "pasti":
        return <PastiView />;
      case "abilitazioni":
        return <AbilitazioniView />;
      case "trasferimenti":
        return <MensaRifornimenti />;
      case "consumi":
        return <ConsumiView />;
      case "eccezioni":
        return <EccezioniView />;
      case "report":
        return <ReportView />;
    }
  }, [view]);
  return ["postazione", "abilitazioni", "trasferimenti"].includes(view) ? (
    <MensaOperationalContext key={view} heading={<PageTitle view={view} />}>
      {content}
    </MensaOperationalContext>
  ) : (
    content
  );
}
