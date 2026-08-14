import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getDocumentoTrasferimento,
  getSearchMensaBeneficiariQueryKey,
  getListMensaAbilitazioniQueryKey,
  getListGiacenzeMensaQueryKey,
  useAutorizzaEccezioneMensa,
  useAvviaTrasferimento,
  useConfermaTrasferimento,
  useCreateMensa,
  useCreateAccessoTemporaneoMensa,
  useCreateMensaAbilitazione,
  useCreatePastoMensa,
  useCreateTesseraBeneficiario,
  useCreateTrasferimentoMensa,
  useGetMensaReport,
  useListEccezioniMensa,
  useListGiacenzeMensa,
  useListMagazziniMensa,
  useListMensaAbilitazioni,
  useListMense,
  useListPastiMensa,
  useListTrasferimentiMensa,
  useSearchMensaBeneficiari,
  useUpdateMensaAbilitazioneStato,
  useVerificaAccessoMensa,
  type MensaAccesso,
  type MensaBeneficiarioSummary,
  type BeneficiarioSimile,
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
import { generateTrasferimentoPdf } from "@/lib/trasferimento-pdf";

export type MensaView =
  | "postazione"
  | "pasti"
  | "mense"
  | "abilitazioni"
  | "trasferimenti"
  | "eccezioni"
  | "report";

function requestKey(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  const data = (error as { data?: unknown })?.data;
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string") return value;
  }
  return error instanceof Error ? error.message : "Operazione non riuscita";
}

function PageTitle({ view }: { view: MensaView }) {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t(`mensa.title.${view}`)}</h1>
      <p className="text-sm text-muted-foreground">
        {t("mensa.noSensitiveData")}
      </p>
    </div>
  );
}

function MensaSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) {
  const { data: mense = [] } = useListMense({ attiva: true });
  useEffect(() => {
    if (value == null && mense[0]) onChange(mense[0].id);
  }, [mense, onChange, value]);
  return (
    <Select
      value={value?.toString() ?? ""}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger aria-label="Mensa">
        <SelectValue placeholder="Seleziona Mensa" />
      </SelectTrigger>
      <SelectContent>
        {mense.map((mensa) => (
          <SelectItem key={mensa.id} value={String(mensa.id)}>
            {mensa.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const scanLockedRef = useRef(false);
  const [mensaId, setMensaId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [access, setAccess] = useState<MensaAccesso | null>(null);
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
  const search = useSearchMensaBeneficiari(
    { search: manualSearch },
    {
      query: {
        queryKey: getSearchMensaBeneficiariQueryKey({ search: manualSearch }),
        enabled:
          hasPermission("mensa.access.manual") &&
          manualSearch.trim().length >= 2,
      },
    },
  );

  useEffect(() => {
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

  const scan = (event: React.FormEvent) => {
    event.preventDefault();
    if (!mensaId || !code.trim() || verify.isPending || scanLockedRef.current)
      return;
    scanLockedRef.current = true;
    verify.mutate(
      {
        data: {
          mensaId,
          modalitaAccesso: "tessera",
          codiceTessera: code.trim(),
          idempotencyKey: requestKey("scan"),
        },
      },
      {
        onSuccess: (result) => {
          setAccess(result);
          setCode("");
        },
        onError: (error) =>
          toast({
            title: "Verifica non riuscita",
            description: errorMessage(error),
            variant: "destructive",
          }),
        onSettled: () => {
          scanLockedRef.current = false;
        },
      },
    );
  };

  const verifyManual = (beneficiary: MensaBeneficiarioSummary) => {
    if (!mensaId || verify.isPending) return;
    verify.mutate(
      {
        data: {
          mensaId,
          modalitaAccesso: "manuale",
          beneficiarioId: beneficiary.id,
          idempotencyKey: requestKey("manual"),
        },
      },
      {
        onSuccess: (result) => {
          setAccess(result);
          setManualSearch("");
        },
      },
    );
  };

  const authorize = () => {
    if (!access || !reason.trim()) return;
    exception.mutate(
      { id: access.id, data: { motivo: reason.trim() } },
      {
        onSuccess: (result) => {
          setAccess(result);
          setReason("");
        },
      },
    );
  };

  const registerMeal = () => {
    if (!access || meal.isPending) return;
    meal.mutate(
      {
        data: {
          accessoMensaId: access.id,
          tipoServizio: "pranzo",
          idempotencyKey: `meal-access-${access.id}`,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Pasto registrato" });
          readyForNextPerson();
        },
        onError: (error) =>
          toast({
            title: "Pasto non registrato",
            description: errorMessage(error),
            variant: "destructive",
          }),
      },
    );
  };

  const onTemporarySuccess = (result: MensaAccesso) => {
    setAccess(result);
    resetTemporaryForm();
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
          idempotencyKey: requestKey("temporary-existing"),
        },
      },
      {
        onSuccess: onTemporarySuccess,
        onError: (error) =>
          toast({
            title: "Accesso temporaneo non autorizzato",
            description: errorMessage(error),
            variant: "destructive",
          }),
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
      <PageTitle view="postazione" />
      <Card>
        <CardContent className="space-y-5 p-6">
          <MensaSelect value={mensaId} onChange={setMensaId} />
          <form onSubmit={scan} className="space-y-3 text-center">
            <Label htmlFor="mensa-scan" className="text-xl">
              {t("mensa.scanPrompt")}
            </Label>
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
                  <SelectTrigger>
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
                  <SelectTrigger>
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
                  Possibili persone già presenti nella stessa città
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
  const [mensaId, setMensaId] = useState<number | null>(null);
  const [date, setDate] = useState(todayEuropeRome());
  const { data = [], isLoading } = useListPastiMensa({
    mensaId: mensaId ?? undefined,
    data: date,
  });
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="pasti" />
      <div className="grid gap-3 md:grid-cols-2">
        <MensaSelect value={mensaId} onChange={setMensaId} />
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{data.length} pasti</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
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
        </CardContent>
      </Card>
    </div>
  );
}

function MenseView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: mense = [] } = useListMense();
  const { data: warehouses = [] } = useListMagazziniMensa();
  const create = useCreateMensa();
  const [form, setForm] = useState({
    codice: "",
    nome: "",
    cittaId: user?.cittaId?.toString() ?? "",
    magazzinoId: "",
    indirizzo: "",
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        data: {
          codice: form.codice,
          nome: form.nome,
          cittaId: Number(form.cittaId),
          magazzinoId: Number(form.magazzinoId),
          indirizzo: form.indirizzo || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/mensa/mense"] });
          setForm({
            ...form,
            codice: "",
            nome: "",
            magazzinoId: "",
            indirizzo: "",
          });
        },
        onError: (error) =>
          toast({
            title: "Mensa non creata",
            description: errorMessage(error),
            variant: "destructive",
          }),
      },
    );
  };
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="mense" />
      <Card>
        <CardHeader>
          <CardTitle>Nuova Mensa</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <Input
              required
              placeholder="Codice"
              value={form.codice}
              onChange={(e) => setForm({ ...form, codice: e.target.value })}
            />
            <Input
              required
              placeholder="Nome"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
            {user?.cittaId == null && (
              <Input
                required
                type="number"
                min="1"
                placeholder="ID città"
                value={form.cittaId}
                onChange={(e) => setForm({ ...form, cittaId: e.target.value })}
              />
            )}
            <Select
              value={form.magazzinoId}
              onValueChange={(value) =>
                setForm({ ...form, magazzinoId: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Ubicazione logistica" />
              </SelectTrigger>
              <SelectContent>
                {warehouses
                  .filter(
                    (warehouse) =>
                      warehouse.tipoMagazzino === "mensa" &&
                      !mense.some(
                        (mensa) => mensa.magazzinoId === warehouse.id,
                      ),
                  )
                  .map((warehouse) => (
                    <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                      {warehouse.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Indirizzo"
              value={form.indirizzo}
              onChange={(e) => setForm({ ...form, indirizzo: e.target.value })}
            />
            <Button disabled={create.isPending}>Crea Mensa</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {mense.map((mensa) => (
          <Card key={mensa.id}>
            <CardHeader>
              <CardTitle className="flex justify-between">
                {mensa.nome}
                <Badge variant={mensa.attiva ? "default" : "secondary"}>
                  {mensa.attiva ? "Attiva" : "Disattivata"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>{mensa.codice}</p>
              <p className="text-sm text-muted-foreground">
                {mensa.cittaNome} · {mensa.magazzinoNome}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AbilitazioniView() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<MensaBeneficiarioSummary | null>(
    null,
  );
  const [mensaId, setMensaId] = useState<number | null>(null);
  const [start, setStart] = useState(todayEuropeRome());
  const search = useSearchMensaBeneficiari(
    { search: searchText },
    {
      query: {
        queryKey: getSearchMensaBeneficiariQueryKey({ search: searchText }),
        enabled: searchText.trim().length >= 2,
      },
    },
  );
  const historyParams = { beneficiarioId: selected?.id };
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
    queryClient.invalidateQueries({ queryKey: ["/api/mensa/abilitazioni"] });
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="abilitazioni" />
      <Card>
        <CardContent className="space-y-3 p-4">
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Cerca beneficiario"
          />
          {search.data?.map((person) => (
            <Button
              key={person.id}
              variant={selected?.id === person.id ? "default" : "outline"}
              className="mr-2"
              onClick={() => setSelected(person)}
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
            <CardContent className="grid gap-3 md:grid-cols-3">
              <MensaSelect value={mensaId} onChange={setMensaId} />
              <Input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <Button
                disabled={!mensaId || create.isPending || !selected.attivo}
                onClick={() =>
                  create.mutate(
                    {
                      data: {
                        beneficiarioId: selected.id,
                        mensaId: mensaId!,
                        dataInizio: start,
                        mensaPrincipale: true,
                      },
                    },
                    { onSuccess: refresh },
                  )
                }
              >
                Abilita
              </Button>
              {hasPermission("mensa.cards.manage") && (
                <Button
                  variant="outline"
                  onClick={() =>
                    card.mutate({ data: { beneficiarioId: selected.id } })
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
                  {history.data?.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.mensaNome}</TableCell>
                      <TableCell>
                        {item.dataInizio} — {item.dataFine ?? "senza scadenza"}
                      </TableCell>
                      <TableCell>
                        <Badge>{item.stato}</Badge>
                      </TableCell>
                      <TableCell>
                        {item.stato === "attiva" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              status.mutate(
                                {
                                  id: item.id,
                                  data: {
                                    stato: "sospesa",
                                    motivo: "Sospensione operativa",
                                    versione: item.versione,
                                  },
                                },
                                { onSuccess: refresh },
                              )
                            }
                          >
                            Sospendi
                          </Button>
                        )}
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

type TransferRow = {
  id: number;
  codice: string;
  stato: string;
  mensaNome?: string;
  magazzinoOrigineNome?: string;
  dataRichiesta?: string;
};

function TrasferimentiView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: mense = [] } = useListMense({ attiva: true });
  const { data: warehouses = [] } = useListMagazziniMensa();
  const list = useListTrasferimentiMensa();
  const [mensaId, setMensaId] = useState("");
  const [originId, setOriginId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const stockParams = { magazzinoId: Number(originId) };
  const stock = useListGiacenzeMensa(stockParams, {
    query: {
      queryKey: getListGiacenzeMensaQueryKey(stockParams),
      enabled: Number(originId) > 0,
    },
  });
  const create = useCreateTrasferimentoMensa();
  const start = useAvviaTrasferimento();
  const confirm = useConfermaTrasferimento();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/mensa/trasferimenti"] });
  const submit = () => {
    const product = stock.data?.find(
      (item) => item.prodottoId === Number(productId),
    );
    if (!product) return;
    create.mutate(
      {
        data: {
          mensaId: Number(mensaId),
          magazzinoOrigineId: Number(originId),
          dataRichiesta: todayEuropeRome(),
          idempotencyKey: requestKey("transfer"),
          trasportatoreNome: "Operatore Mensa",
          righe: [
            {
              prodottoId: product.prodottoId,
              quantita: Number(quantity),
              unitaMisura: product.unitaMisura,
            },
          ],
        },
      },
      {
        onSuccess: refresh,
        onError: (error) =>
          toast({
            title: "Trasferimento non creato",
            description: errorMessage(error),
            variant: "destructive",
          }),
      },
    );
  };
  const rows = (list.data ?? []) as unknown as TransferRow[];
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="trasferimenti" />
      <Card>
        <CardHeader>
          <CardTitle>Nuovo rifornimento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Select value={mensaId} onValueChange={setMensaId}>
            <SelectTrigger>
              <SelectValue placeholder="Mensa destinazione" />
            </SelectTrigger>
            <SelectContent>
              {mense.map((mensa) => (
                <SelectItem key={mensa.id} value={String(mensa.id)}>
                  {mensa.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={originId}
            onValueChange={(value) => {
              setOriginId(value);
              setProductId("");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Magazzino origine" />
            </SelectTrigger>
            <SelectContent>
              {warehouses
                .filter(
                  (warehouse) =>
                    warehouse.id !==
                    mense.find((m) => m.id === Number(mensaId))?.magazzinoId,
                )
                .map((warehouse) => (
                  <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                    {warehouse.nome}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger>
              <SelectValue placeholder="Prodotto disponibile" />
            </SelectTrigger>
            <SelectContent>
              {stock.data?.map((item) => (
                <SelectItem
                  key={item.prodottoId}
                  value={String(item.prodottoId)}
                >
                  {item.nome} · {item.quantita} {item.unitaMisura}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <Button
            disabled={!mensaId || !originId || !productId || create.isPending}
            onClick={submit}
          >
            Crea trasferimento
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead>Mensa</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.codice}</TableCell>
                  <TableCell>{row.magazzinoOrigineNome}</TableCell>
                  <TableCell>{row.mensaNome}</TableCell>
                  <TableCell>
                    <Badge>{row.stato}</Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    {row.stato === "richiesto" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          start.mutate({ id: row.id }, { onSuccess: refresh })
                        }
                      >
                        Avvia
                      </Button>
                    )}
                    {row.stato === "in_transito" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          confirm.mutate(
                            { id: row.id, data: {} },
                            { onSuccess: refresh },
                          )
                        }
                      >
                        Conferma
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () =>
                        generateTrasferimentoPdf({
                          trasferimento: await getDocumentoTrasferimento(
                            row.id,
                          ),
                        })
                      }
                    >
                      Bolla PDF
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function EccezioniView() {
  const { data = [] } = useListEccezioniMensa();
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
        </CardContent>
      </Card>
    </div>
  );
}

function ReportView() {
  const [dal, setDal] = useState(todayEuropeRome());
  const [al, setAl] = useState(todayEuropeRome());
  const [mensaId, setMensaId] = useState<number | null>(null);
  const report = useGetMensaReport({ dal, al, mensaId: mensaId ?? undefined });
  const cards = report.data
    ? [
        ["Totale pasti", report.data.totalePasti],
        ["Beneficiari distinti", report.data.beneficiariDistinti],
        ["Accessi ordinari", report.data.accessiOrdinari],
        ["Accessi in eccezione", report.data.accessiEccezione],
        ["Accessi negati", report.data.accessiNegati],
        ["Media pasti/giorno", report.data.mediaPastiGiorno],
      ]
    : [];
  return (
    <div className="space-y-6 p-6">
      <PageTitle view="report" />
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          type="date"
          value={dal}
          onChange={(e) => setDal(e.target.value)}
        />
        <Input type="date" value={al} onChange={(e) => setAl(e.target.value)} />
        <MensaSelect value={mensaId} onChange={setMensaId} />
      </div>
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
      case "mense":
        return <MenseView />;
      case "abilitazioni":
        return <AbilitazioniView />;
      case "trasferimenti":
        return <TrasferimentiView />;
      case "eccezioni":
        return <EccezioniView />;
      case "report":
        return <ReportView />;
    }
  }, [view]);
  return content;
}
