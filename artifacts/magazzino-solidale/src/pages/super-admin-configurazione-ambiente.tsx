import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetConfigurazioneAmbientePubblicaQueryKey,
  getGetSuperAdminConfigurazioneAmbienteQueryKey,
  useGetSuperAdminConfigurazioneAmbiente,
  useUpdateSuperAdminConfigurazioneAmbiente,
  type ConfigurazioneAmbiente,
  type ConfigurazioneAmbienteUpdate,
} from "@workspace/api-client-react";
import { Loader2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

  const query = useGetSuperAdminConfigurazioneAmbiente({
    query: {
      queryKey: getGetSuperAdminConfigurazioneAmbienteQueryKey(),
    },
  });

  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);

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
