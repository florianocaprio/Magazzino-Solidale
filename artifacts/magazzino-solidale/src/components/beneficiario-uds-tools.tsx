import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useGetBeneficiarioStatiServiziUds,
  getGetBeneficiarioStatiServiziUdsQueryKey,
  useGetOrCreateBeneficiarioTesseraDocumento,
  useUpdateBeneficiario,
  useListAreeOperative,
  useListCentriAscolto,
  useListZoneUds,
  useGetZonaUds,
  type BeneficiarioDettaglio,
  type TesseraBeneficiario,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { operationalCentroId } from "@/lib/service-scope";
import { documentAuthContext } from "@/hooks/use-documento-access";
import { todayEuropeRome } from "@/lib/europe-rome";
import { generateTesseraPdf, buildTesseraLabels } from "@/lib/tessera-pdf";
import { loadTesseraBrandingForPdf } from "@/lib/branding-ambiente";
import i18n from "@/lib/i18n";
import { registerBlocco04 } from "@/lib/i18n/namespaces/blocco04";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
registerBlocco04(i18n);

export const invalidateBeneficiarioTerritory = (
  client: ReturnType<typeof useQueryClient>,
) =>
  client.invalidateQueries({
    predicate: (query) =>
      /^\/api\/(beneficiari(?:\/|$)|uds\/(directory|link-candidates))/.test(
        String(query.queryKey[0]),
      ),
  });
const errorMessage = (error: unknown, fallback: string) =>
  (error as { data?: { error?: string } })?.data?.error ?? fallback;

export function UdsServiceStates({ id }: { id: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const query = useGetBeneficiarioStatiServiziUds(id, {
    query: {
      queryKey: [
        ...getGetBeneficiarioStatiServiziUdsQueryKey(id),
        documentAuthContext(user),
      ],
      retry: false,
    },
  });
  const data = query.isError ? undefined : query.data;
  const label = (state: string) => {
    const normal =
      (
        {
          attiva: "attivo",
          sospesa: "sospeso",
          revocata: "revocato",
          programmata: "programmato",
          scaduta: "scaduto",
        } as Record<string, string>
      )[state] ?? state;
    return normal === "scaduto"
      ? t("blocco04.expired")
      : t(`emporioServizio.${normal}`, {
          defaultValue: state.replaceAll("_", " "),
        });
  };
  return (
    <section
      aria-label={t("blocco04.services")}
      className="flex flex-wrap items-center gap-3 rounded-md border p-3"
    >
      {(["emporio", "mensa"] as const).map((key) => (
        <div key={key} className="flex items-center gap-2">
          <span>{key === "emporio" ? "Emporio" : "Mensa"}</span>
          <Badge
            variant={
              data?.[key].stato === "attivo" || data?.[key].stato === "attiva"
                ? "default"
                : "outline"
            }
          >
            {query.isLoading
              ? t("common.loading")
              : !data
                ? t("blocco04.unavailable")
                : !data[key].disponibile
                  ? t("blocco04.disabled")
                  : data[key].stato
                    ? label(data[key].stato!)
                    : t("blocco04.unavailable")}
          </Badge>
        </div>
      ))}
      {query.isError && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          {t("common.retry", { defaultValue: "Riprova" })}
        </Button>
      )}
    </section>
  );
}

export function TesseraDocumentoSection({
  b,
  udsContext = false,
}: {
  b: BeneficiarioDettaglio;
  udsContext?: boolean;
}) {
  const { t } = useTranslation();
  const { user, hasArea, hasPermission } = useAuth();
  const mutation = useGetOrCreateBeneficiarioTesseraDocumento();
  const [card, setCard] = useState<TesseraBeneficiario | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const canDownload =
    hasPermission("beneficiari.cards.manage") ||
    (udsContext &&
      hasArea("uds") &&
      hasPermission("beneficiari.view") &&
      hasPermission("beneficiari.manage"));
  useEffect(() => {
    setCard(null);
    setError("");
  }, [b.id, user?.id]);
  const download = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const stored = await mutation.mutateAsync({ id: b.id });
      setCard(stored);
      const { branding, logoDataUrl } = await loadTesseraBrandingForPdf();
      await generateTesseraPdf({
        beneficiario: {
          codice: b.codice,
          codiceTessera: stored.codice,
          nome: b.nome,
          cognome: b.cognome,
          codiceFiscale: b.codiceFiscale,
        },
        dataEmissione: stored.dataEmissione,
        labels: buildTesseraLabels(t),
        branding,
        associationLogoDataUrl: logoDataUrl,
      });
    } catch (cause) {
      setError(errorMessage(cause, t("blocco04.cardFailed")));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const invalid =
    card &&
    (card.stato !== "attiva" ||
      card.dataRevoca != null ||
      (card.dataScadenza != null && card.dataScadenza < todayEuropeRome()));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("blocco04.card")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {card && (
          <p>
            {invalid ? (
              <Badge variant="destructive">
                {t("blocco04.cardInvalid", {
                  stato:
                    card.dataScadenza && card.dataScadenza < todayEuropeRome()
                      ? t("blocco04.expired")
                      : card.stato,
                })}
              </Badge>
            ) : (
              <Badge>{t("common.active")}</Badge>
            )}
          </p>
        )}
        <Button
          type="button"
          disabled={!canDownload || !b.attivo || busy}
          onClick={() => void download()}
        >
          {busy ? t("common.loading") : t("blocco04.cardDownload")}
        </Button>
        {!canDownload && <p>{t("blocco04.noPermission")}</p>}
        {error && <p role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function UdsTerritoryFields({ b }: { b: BeneficiarioDettaglio }) {
  const { t } = useTranslation(),
    { user, hasPermission } = useAuth(),
    { toast } = useToast();
  const queryClient = useQueryClient(),
    mutation = useUpdateBeneficiario();
  const { data: areas } = useListAreeOperative(),
    { data: centres } = useListCentriAscolto();
  const { data: zones } = useListZoneUds(
    b.areaOperativaId != null
      ? { areaOperativaId: b.areaOperativaId }
      : undefined,
    {
      query: {
        enabled: b.areaOperativaId != null,
        queryKey: ["zoneUds", "udsTerritory", b.areaOperativaId],
      },
    },
  );
  const currentZone = useGetZonaUds(b.zonaUdsId ?? 0, {
    query: {
      enabled:
        b.zonaUdsId != null &&
        zones != null &&
        !zones.some((item) => item.id === b.zonaUdsId),
      queryKey: [
        "zoneUds",
        "currentAssignment",
        b.zonaUdsId,
        documentAuthContext(user),
      ],
      retry: false,
    },
  });
  const [centre, setCentre] = useState(String(b.centroAscoltoId ?? "none")),
    [zone, setZone] = useState(String(b.zonaUdsId ?? "none")),
    [error, setError] = useState("");
  useEffect(() => {
    setCentre(String(b.centroAscoltoId ?? "none"));
    setZone(String(b.zonaUdsId ?? "none"));
  }, [b.versione, b.centroAscoltoId, b.zonaUdsId]);
  const centreLocked = operationalCentroId(user) != null,
    zoneLocked = user?.zonaUdsId != null,
    canManage = hasPermission("beneficiari.manage");
  const save = async (
    field: "centroAscoltoId" | "zonaUdsId",
    value: string,
  ) => {
    setError("");
    try {
      await mutation.mutateAsync({
        id: b.id,
        data: {
          [field]: value === "none" ? null : Number(value),
          versione: b.versione,
        },
      });
      await invalidateBeneficiarioTerritory(queryClient);
      toast({
        title: t("beneficiarioDettaglio.toastUpdated"),
        description: t("blocco04.changedFilter"),
      });
    } catch (cause) {
      await invalidateBeneficiarioTerritory(queryClient);
      setError(errorMessage(cause, t("common.error")));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("blocco04.territory")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          <strong>Area:</strong>{" "}
          {areas?.find((area) => area.id === b.areaOperativaId)?.nome ??
            b.areaOperativaId ??
            "—"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span>{t("beneficiari.centroRiferimento")}</span>
          <Select
            value={centre}
            disabled={!canManage || centreLocked || mutation.isPending}
            onValueChange={setCentre}
          >
            <SelectTrigger aria-label={t("beneficiari.centroRiferimento")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("common.none")}</SelectItem>
              {centres
                ?.filter(
                  (item) =>
                    item.areaOperativaId === b.areaOperativaId &&
                    (item.attivo || item.id === b.centroAscoltoId),
                )
                .map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.nome}
                    {!item.attivo ? ` · ${t("blocco04.historical")}` : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={
              !canManage ||
              centreLocked ||
              mutation.isPending ||
              centre === String(b.centroAscoltoId ?? "none")
            }
            onClick={() => void save("centroAscoltoId", centre)}
          >
            {t("common.save")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>{t("udsAnagrafica.fZona")}</span>
          <Select
            value={zone}
            disabled={!canManage || zoneLocked || mutation.isPending}
            onValueChange={setZone}
          >
            <SelectTrigger aria-label={t("udsAnagrafica.fZona")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("blocco04.noZone")}</SelectItem>
              {b.zonaUdsId != null &&
                !zones?.some((item) => item.id === b.zonaUdsId) && (
                  <SelectItem value={String(b.zonaUdsId)}>
                    {currentZone.data?.nome ?? b.zonaUdsNome ?? b.zonaUdsId} ·{" "}
                    {t(currentZone.data?.attivo === false ? "blocco04.historical" : "blocco04.currentAssignment")}
                  </SelectItem>
                )}
              {zones
                ?.filter(
                  (item) =>
                    item.areaOperativaId === b.areaOperativaId &&
                    (item.attivo || item.id === b.zonaUdsId),
                )
                .map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.nome}
                    {!item.attivo ? ` · ${t("blocco04.historical")}` : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={
              !canManage ||
              zoneLocked ||
              mutation.isPending ||
              zone === String(b.zonaUdsId ?? "none")
            }
            onClick={() => void save("zonaUdsId", zone)}
          >
            {t("common.save")}
          </Button>
        </div>
        {(centreLocked || zoneLocked) && (
          <p className="text-sm text-muted-foreground">
            {t("blocco04.scopeLocked")}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
