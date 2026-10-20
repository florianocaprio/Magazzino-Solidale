import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

export function VolunteerApprovalBadge({ state, suspended = false }: { state: string; suspended?: boolean }) {
  const { hasPermission, hasArea } = useAuth();
  const { t } = useTranslation();
  if (state === "in_attesa" && suspended) return null;
  if (state !== "in_attesa" && state !== "respinto") return null;
  const badge = <Badge variant="secondary" className={state === "in_attesa" ? "bg-amber-500/10 text-amber-800" : "bg-red-500/10 text-red-700"}>
    {t(state === "in_attesa" ? "logisticaCampaign.pending" : "logisticaCampaign.rejected")}
  </Badge>;
  return state === "in_attesa" && hasArea("logistica") && hasPermission("logistica.approvazioni.view")
    ? <Link href="/approvazioni-logistica" className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{badge}</Link>
    : badge;
}
