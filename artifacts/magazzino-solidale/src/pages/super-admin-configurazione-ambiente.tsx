import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetConfigurazioneAmbientePubblicaQueryKey,
  getGetSuperAdminConfigurazioneAmbienteQueryKey,
  getGetSuperAdminConfigurazioneMatricoleVolontariQueryKey,
  useGetSuperAdminConfigurazioneAmbiente,
  useGetSuperAdminConfigurazioneMatricoleVolontari,
  useUpdateSuperAdminConfigurazioneAmbiente,
  useUpdateSuperAdminConfigurazioneMatricoleVolontari,
  type ConfigurazioneAmbiente,
  type ConfigurazioneAmbienteUpdate,
  type ConfigurazioneMatricoleVolontariInput,
} from "@workspace/api-client-react";
import { Loader2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";

const TEXT_FIELDS = [
  "codiceAmbiente",
  "nomeAmbiente",
  "nomeAssociazione",
  "descrizione",
  "indirizzo",
  "comune",
  "provincia",
  "codiceFiscale",
  "partitaIva",
  "email",
  "telefono",
  "sitoWeb",
  "logoDocumentiUrl",
  "logoTessereUrl",
  "footerDocumenti",
  "noteLegali",
  "privacyTestoBreve",
] as const;

const MULTILINE_FIELDS = new Set([
  "descrizione",
  "footerDocumenti",
  "noteLegali",
  "privacyTestoBreve",
]);

const REQUIRED_FIELDS = new Set([
  "codiceAmbiente",
  "nomeAmbiente",
  "nomeAssociazione",
]);

type TextField = (typeof TEXT_FIELDS)[number];
type FormState = Record<TextField, string> & { attivo: boolean };
type MatricolaForm = {
  prefissoAssociazione: string;
  includiCodiceArea: boolean;
  segmentoFisso: string;
  separatore: "" | "-" | "/";
  cifreProgressivo: number;
  numeroIniziale: number;
  ambitoProgressivo: "GLOBALE" | "PER_AREA";
};

const EMPTY_FORM: FormState = {
  codiceAmbiente: "",
  nomeAmbiente: "",
  nomeAssociazione: "",
  descrizione: "",
  indirizzo: "",
  comune: "",
  provincia: "",
  codiceFiscale: "",
  partitaIva: "",
  email: "",
  telefono: "",
  sitoWeb: "",
  logoDocumentiUrl: "",
  logoTessereUrl: "",
  footerDocumenti: "",
  noteLegali: "",
  privacyTestoBreve: "",
  attivo: true,
};
const EMPTY_MATRICOLA_FORM: MatricolaForm = {
  prefissoAssociazione: "",
  includiCodiceArea: true,
  segmentoFisso: "V",
  separatore: "-",
  cifreProgressivo: 3,
  numeroIniziale: 1,
  ambitoProgressivo: "PER_AREA",
};

function toForm(data: ConfigurazioneAmbiente): FormState {
  return {
    ...EMPTY_FORM,
    ...Object.fromEntries(
      TEXT_FIELDS.map((field) => [field, data[field] ?? ""]),
    ),
    attivo: data.attivo,
  };
}

function toPayload(form: FormState): ConfigurazioneAmbienteUpdate {
  const nullable = (field: TextField) => form[field].trim() || null;
  return {
    codiceAmbiente: form.codiceAmbiente.trim(),
    nomeAmbiente: form.nomeAmbiente.trim(),
    nomeAssociazione: form.nomeAssociazione.trim(),
    descrizione: nullable("descrizione"),
    indirizzo: nullable("indirizzo"),
    comune: nullable("comune"),
    provincia: nullable("provincia"),
    codiceFiscale: nullable("codiceFiscale"),
    partitaIva: nullable("partitaIva"),
    email: nullable("email"),
    telefono: nullable("telefono"),
    sitoWeb: nullable("sitoWeb"),
    logoDocumentiUrl: nullable("logoDocumentiUrl"),
    logoTessereUrl: nullable("logoTessereUrl"),
    footerDocumenti: nullable("footerDocumenti"),
    noteLegali: nullable("noteLegali"),
    privacyTestoBreve: nullable("privacyTestoBreve"),
    attivo: form.attivo,
  };
}

function LogoPreview({ value }: { value: string }) {
  const { t } = useTranslation();
  if (!value.trim()) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        {t("superAdmin.environment.fallbackLogoAim")}
      </p>
    );
  }
  return (
    <div className="rounded-md border p-3">
      <img
        src={value}
        alt={t("superAdmin.environment.logoPreview")}
        className="max-h-20 w-auto object-contain"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

export default function SuperAdminConfigurazioneAmbiente() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [matricolaForm, setMatricolaForm] = useState<MatricolaForm>(
    EMPTY_MATRICOLA_FORM,
  );

  const query = useGetSuperAdminConfigurazioneAmbiente({
    query: {
      queryKey: getGetSuperAdminConfigurazioneAmbienteQueryKey(),
    },
  });
  const matricolaQuery = useGetSuperAdminConfigurazioneMatricoleVolontari({
    query: {
      queryKey: getGetSuperAdminConfigurazioneMatricoleVolontariQueryKey(),
    },
  });

  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);
  useEffect(() => {
    const config = matricolaQuery.data?.configurazione;
    if (!config) return;
    setMatricolaForm({
      prefissoAssociazione: config.prefissoAssociazione ?? "",
      includiCodiceArea: config.includiCodiceArea,
      segmentoFisso: config.segmentoFisso ?? "",
      separatore: config.separatore,
      cifreProgressivo: config.cifreProgressivo,
      numeroIniziale: config.numeroIniziale,
      ambitoProgressivo: config.ambitoProgressivo,
    });
  }, [matricolaQuery.data]);

  const update = useUpdateSuperAdminConfigurazioneAmbiente({
    mutation: {
      onSuccess: (data) => {
        setForm(toForm(data));
        queryClient.invalidateQueries({ queryKey: getGetSuperAdminConfigurazioneAmbienteQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetConfigurazioneAmbientePubblicaQueryKey() });
        toast({ title: t("superAdmin.environment.saved") });
      },
      onError: (err) => {
        toast({
          title: t("superAdmin.environment.error"),
          description: errorMessage(err, t("superAdmin.environment.errorDescription")),
          variant: "destructive",
        });
      },
    },
  });
  const updateMatricole = useUpdateSuperAdminConfigurazioneMatricoleVolontari({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: getGetSuperAdminConfigurazioneMatricoleVolontariQueryKey(),
        });
        toast({
          title: "Configurazione matricole salvata",
          description: data.esempio ? `Esempio: ${data.esempio}` : undefined,
        });
      },
      onError: (err) => {
        toast({
          title: "Configurazione matricole non salvata",
          description: errorMessage(err, "Controlla i valori inseriti"),
          variant: "destructive",
        });
      },
    },
  });

  const setField = (field: TextField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = () => {
    const missing = TEXT_FIELDS.find(
      (field) => REQUIRED_FIELDS.has(field) && !form[field].trim(),
    );
    if (missing) {
      toast({
        title: t("common.requiredField"),
        description: t(`superAdmin.environment.fields.${missing}`),
        variant: "destructive",
      });
      return;
    }
    update.mutate({ data: toPayload(form) });
  };

  const saveMatricole = () => {
    updateMatricole.mutate({
      data: {
        prefissoAssociazione: matricolaForm.prefissoAssociazione || null,
        includiCodiceArea: matricolaForm.includiCodiceArea,
        segmentoFisso: matricolaForm.segmentoFisso || null,
        separatore: matricolaForm.separatore,
        cifreProgressivo: matricolaForm.cifreProgressivo,
        numeroIniziale: matricolaForm.numeroIniziale,
        ambitoProgressivo: matricolaForm.ambitoProgressivo,
      } satisfies ConfigurazioneMatricoleVolontariInput,
    });
  };

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>{t("superAdmin.environment.error")}</AlertTitle>
          <AlertDescription>{t("superAdmin.environment.loadError")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("superAdmin.environment.title")}</h1>
          <p className="text-muted-foreground">{t("superAdmin.environment.subtitle")}</p>
        </div>
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {update.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>

      <Alert>
        <AlertTitle>{t("superAdmin.environment.logoNoteTitle")}</AlertTitle>
        <AlertDescription>{t("superAdmin.environment.logoNote")}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{t("superAdmin.environment.identity")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {TEXT_FIELDS.slice(0, 12).map((field) => (
            <div key={field} className={field === "descrizione" ? "space-y-2 md:col-span-3" : "space-y-2"}>
              <Label htmlFor={field}>{t(`superAdmin.environment.fields.${field}`)}</Label>
              {MULTILINE_FIELDS.has(field) ? (
                <Textarea id={field} value={form[field]} onChange={(e) => setField(field, e.target.value)} />
              ) : (
                <Input id={field} value={form[field]} onChange={(e) => setField(field, e.target.value)} />
              )}
            </div>
          ))}
          <div className="flex items-center justify-between rounded-md border p-3 md:col-span-3">
            <div>
              <Label>{t("superAdmin.environment.fields.attivo")}</Label>
              <p className="text-sm text-muted-foreground">{t("superAdmin.environment.activeHelp")}</p>
            </div>
            <Switch
              checked={form.attivo}
              onCheckedChange={(attivo) => setForm((current) => ({ ...current, attivo }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Matricole volontari permanenti</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Ogni salvataggio crea una nuova versione auditata. I progressivi già
            assegnati e lo storico delle matricole non vengono modificati.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Prefisso associazione</Label>
              <Input
                maxLength={12}
                value={matricolaForm.prefissoAssociazione}
                onChange={(event) =>
                  setMatricolaForm((current) => ({
                    ...current,
                    prefissoAssociazione: event.target.value.toUpperCase(),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Segmento fisso</Label>
              <Input
                maxLength={8}
                value={matricolaForm.segmentoFisso}
                onChange={(event) =>
                  setMatricolaForm((current) => ({
                    ...current,
                    segmentoFisso: event.target.value.toUpperCase(),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Separatore</Label>
              <Select
                value={matricolaForm.separatore || "NESSUNO"}
                onValueChange={(value) =>
                  setMatricolaForm((current) => ({
                    ...current,
                    separatore: value === "NESSUNO" ? "" : (value as "-" | "/"),
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NESSUNO">Nessuno</SelectItem>
                  <SelectItem value="-">Trattino (-)</SelectItem>
                  <SelectItem value="/">Barra (/)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cifre progressivo</Label>
              <Input
                type="number"
                min={2}
                max={8}
                value={matricolaForm.cifreProgressivo}
                onChange={(event) =>
                  setMatricolaForm((current) => ({
                    ...current,
                    cifreProgressivo: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Numero iniziale</Label>
              <Input
                type="number"
                min={1}
                value={matricolaForm.numeroIniziale}
                onChange={(event) =>
                  setMatricolaForm((current) => ({
                    ...current,
                    numeroIniziale: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Ambito progressivo</Label>
              <Select
                value={matricolaForm.ambitoProgressivo}
                onValueChange={(value) =>
                  setMatricolaForm((current) => ({
                    ...current,
                    ambitoProgressivo: value as "GLOBALE" | "PER_AREA",
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PER_AREA">Separato per Area</SelectItem>
                  <SelectItem value="GLOBALE">Globale</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Includi codice Area</Label>
              <p className="text-sm text-muted-foreground">
                Codice configurato sull’Area; in assenza viene usata la sigla.
              </p>
            </div>
            <Switch
              checked={matricolaForm.includiCodiceArea}
              onCheckedChange={(checked) =>
                setMatricolaForm((current) => ({
                  ...current,
                  includiCodiceArea: checked,
                }))
              }
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted p-3">
            <div className="text-sm">
              Esempio corrente:{" "}
              <strong>{matricolaQuery.data?.esempio ?? "non disponibile"}</strong>
            </div>
            <Button onClick={saveMatricole} disabled={updateMatricole.isPending}>
              {updateMatricole.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salva nuova versione
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("superAdmin.environment.documents")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {TEXT_FIELDS.slice(12).map((field) => (
            <div key={field} className={MULTILINE_FIELDS.has(field) ? "space-y-2 md:col-span-2" : "space-y-2"}>
              <Label htmlFor={field}>{t(`superAdmin.environment.fields.${field}`)}</Label>
              {MULTILINE_FIELDS.has(field) ? (
                <Textarea id={field} value={form[field]} onChange={(e) => setField(field, e.target.value)} />
              ) : (
                <Input id={field} value={form[field]} onChange={(e) => setField(field, e.target.value)} />
              )}
              {(field === "logoDocumentiUrl" || field === "logoTessereUrl") && (
                <LogoPreview value={form[field]} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
