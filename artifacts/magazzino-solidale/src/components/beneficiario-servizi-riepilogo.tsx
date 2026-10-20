import { useTranslation } from "react-i18next";
import { getGetBeneficiarioStatiServiziQueryKey, useGetBeneficiarioStatiServizi } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { documentAuthContext } from "@/hooks/use-documento-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function BeneficiarioServiziRiepilogo({ id }: { id: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const query = useGetBeneficiarioStatiServizi(id, { query: {
    queryKey: [...getGetBeneficiarioStatiServiziQueryKey(id), documentAuthContext(user)], retry: false,
  } });
  const data = query.isError ? undefined : query.data;
  const label = (state: string | null) => {
    const normalized = ({ attiva: "attivo", sospesa: "sospeso", revocata: "revocato", programmata: "programmato" } as Record<string, string>)[state ?? ""] ?? state;
    return state === "scaduta" ? t("blocco04.expired") : t(`emporioServizio.${normalized}`, { defaultValue: state ?? t("blocco04.unavailable") });
  };
  return <section aria-label={t("blocco04.services")} className="grid gap-3 sm:grid-cols-3">
    {(["emporio", "mensa", "tessera"] as const).map((key) => <div key={key} className="space-y-2 rounded-md border bg-card p-4">
      <h2 className="font-medium">{key === "emporio" ? "Emporio" : key === "mensa" ? "Mensa" : t("blocco04.card")}</h2>
      <Badge variant={data?.[key].stato === "attivo" || data?.[key].stato === "attiva" ? "default" : "outline"}>
        {query.isLoading ? t("common.loading") : !data ? t("blocco04.unavailable") : !data[key].disponibile ? t("blocco04.disabled") : label(data[key].stato)}
      </Badge>
    </div>)}
    {query.isError && <Button type="button" variant="outline" onClick={() => void query.refetch()}>{t("common.retry", { defaultValue: "Riprova" })}</Button>}
  </section>;
}
