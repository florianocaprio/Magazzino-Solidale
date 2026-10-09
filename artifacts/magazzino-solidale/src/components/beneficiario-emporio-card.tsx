import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEmporioAbilitazioneQueryKey,
  useGetEmporioAbilitazione,
  useUpdateEmporioAbilitazione,
  type EmporioAbilitazioneInputStato,
  type EmporioStatoEffettivo,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { useModuloFlags } from "@/lib/use-moduli";
import {
  emporioReadableData,
  useEmporioSecurity,
} from "@/hooks/use-emporio-security";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export function EmporioStatusBadge({
  state,
}: {
  state: EmporioStatoEffettivo;
}) {
  const { t } = useTranslation();
  return (
    <Badge variant={state === "attivo" ? "default" : "outline"}>
      {t(`emporioServizio.${state}`)}
    </Badge>
  );
}

export function useBeneficiarioEmporio(beneficiarioId: number) {
  const security = useEmporioSecurity();
  const { emporioAbilitato } = useModuloFlags();
  return useGetEmporioAbilitazione(beneficiarioId, {
    query: {
      ...security.readOptions(
        getGetEmporioAbilitazioneQueryKey(beneficiarioId),
      ),
      enabled: emporioAbilitato,
    },
  });
}

export function BeneficiarioEmporioSection({
  beneficiario,
}: {
  beneficiario: {
    id: number;
    attivo: boolean;
    areaOperativaId?: number | null;
    centroAscoltoId?: number | null;
  };
}) {
  const { t } = useTranslation();
  const { hasPermission, hasArea, user } = useAuth();
  const { emporioAbilitato } = useModuloFlags();
  const query = useBeneficiarioEmporio(beneficiario.id);
  const record = emporioReadableData(query);
  const update = useUpdateEmporioAbilitazione();
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  if (!emporioAbilitato) return null;
  const canManage =
    hasPermission("emporio.eligibility.manage") &&
    (user?.isAdmin ||
      (hasArea("sociale") &&
        (user?.centroAscoltoId == null ||
          user.centroAscoltoId === beneficiario.centroAscoltoId)));
  const change = async (stato: EmporioAbilitazioneInputStato) => {
    setError("");
    try {
      await update.mutateAsync({
        beneficiarioId: beneficiario.id,
        data: { stato, motivo: motivo.trim() },
      });
      setMotivo("");
      await queryClient.invalidateQueries({
        predicate: (q) =>
          /\/api\/(emporio|accessi-emporio|cassa-emporio|credito-solidale|beneficiari)(?:\/|$)/.test(
            String(q.queryKey[0]),
          ),
      });
    } catch (e) {
      setError(
        (e as { data?: { error?: string } })?.data?.error ??
          t("emporioServizio.errore"),
      );
    }
  };
  return (
    <Card role="region" aria-label={t("emporioServizio.titolo")}>
      <CardHeader>
        <CardTitle>{t("emporioServizio.titolo")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("emporioServizio.indipendente")}
        </p>
        {record && (
          <EmporioStatusBadge state={record.statoEffettivo ?? record.stato} />
        )}
        {query.isError && <p role="alert">{t("emporioServizio.errore")}</p>}
        {canManage &&
          record &&
          beneficiario.attivo &&
          beneficiario.areaOperativaId != null && (
            <>
              <Input
                aria-label={t("emporioServizio.motivo")}
                placeholder={t("emporioServizio.motivo")}
                value={motivo}
                maxLength={1000}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {record.stato !== "attivo" && (
                  <Button
                    type="button"
                    disabled={!motivo.trim() || update.isPending}
                    onClick={() => void change("attivo")}
                  >
                    {t(
                      record.stato === "non_abilitato"
                        ? "emporioServizio.abilita"
                        : "emporioServizio.riattiva",
                    )}
                  </Button>
                )}
                {record.stato === "attivo" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!motivo.trim() || update.isPending}
                    onClick={() => void change("sospeso")}
                  >
                    {t("emporioServizio.sospendi")}
                  </Button>
                )}
                {["attivo", "sospeso"].includes(record.stato) && (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!motivo.trim() || update.isPending}
                    onClick={() => void change("revocato")}
                  >
                    {t("emporioServizio.revoca")}
                  </Button>
                )}
              </div>
            </>
          )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {(record?.statoEffettivo ?? record?.stato) !== "attivo" && (
          <p className="text-sm text-muted-foreground">
            {t("emporioServizio.creditoBloccato")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
