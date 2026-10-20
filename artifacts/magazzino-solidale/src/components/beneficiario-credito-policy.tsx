import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getListPoliticheCreditoSolidaleQueryKey,
  useListPoliticheCreditoSolidale,
  useUpdateCreditoSolidaleBeneficiarioConfigurazione,
  type BeneficiarioDettaglio,
} from "@workspace/api-client-react";
import { useEmporioSecurity } from "@/hooks/use-emporio-security";
import { Button } from "@/components/ui/button";
import { CreditoPolicySelect } from "./credito-policy-select";
import { errorMessage } from "@/lib/api-error";

export function BeneficiarioCreditoPolicy({ b, disabled = false }: { b: BeneficiarioDettaglio; disabled?: boolean }) {
  const { t } = useTranslation();
  const security = useEmporioSecurity();
  const policies = useListPoliticheCreditoSolidale({ query: security.readOptions(getListPoliticheCreditoSolidaleQueryKey()) });
  const mutation = useUpdateCreditoSolidaleBeneficiarioConfigurazione();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(String(b.politicaCreditoSolidaleId ?? ""));
  const [error, setError] = useState("");
  useEffect(() => { setSelected(String(b.politicaCreditoSolidaleId ?? "")); }, [b.id, b.politicaCreditoSolidaleId]);
  const available = (policies.isError ? [] : policies.data ?? []).filter((policy) =>
    policy.attiva && (policy.areaOperativaId == null || policy.areaOperativaId === b.areaOperativaId) &&
    (policy.centroAscoltoId == null || policy.centroAscoltoId === b.centroAscoltoId),
  );
  const save = async () => {
    setError("");
    if (!selected) return;
    try {
      await mutation.mutateAsync({ beneficiarioId: b.id, data: { politicaCreditoSolidaleId: Number(selected) } });
      await queryClient.invalidateQueries({ predicate: (query) => /\/api\/(beneficiari|credito-solidale)(?:\/|$)/.test(String(query.queryKey[0])) });
    } catch (cause) { setError(errorMessage(cause, t("creditoSolidale.calculateError"))); }
  };
  return <section className="space-y-2 rounded-md border p-3">
    <CreditoPolicySelect value={selected} onValueChange={setSelected} disabled={disabled || policies.isLoading || policies.isError || mutation.isPending}
      options={available.map(p=>({id:p.id,nome:p.nome,scope:p.centroAscoltoNome??p.areaOperativaNome??t("creditoSolidale.globalScope")}))}/>
    <p className="text-xs text-muted-foreground">{t("creditoSolidale.beneficiaryPolicyHelp")}</p>
    <Button type="button" variant="outline" onClick={() => void save()} disabled={disabled || !selected || policies.isLoading || policies.isError || mutation.isPending || (selected === String(b.politicaCreditoSolidaleId ?? "") && b.creditoSolidaleMensileAssegnato != null)}>{t("creditoSolidale.applyBeneficiaryPolicy")}</Button>
    {(error || policies.isError) && <p role="alert" className="text-sm text-destructive">{error || t("creditoSolidale.calculateError")}</p>}
  </section>;
}
