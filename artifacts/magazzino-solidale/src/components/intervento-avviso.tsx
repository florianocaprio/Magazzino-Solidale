import type { InterventoAvviso } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function InterventoAvvisoBadge({
  avviso,
  className,
}: {
  avviso?: InterventoAvviso | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!avviso) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        avviso === "scaduto" &&
          "border-destructive bg-destructive/10 text-destructive",
        avviso === "oggi" && "border-amber-600 bg-amber-50 text-amber-800",
        avviso === "imminente" &&
          "border-orange-500 bg-orange-50 text-orange-800",
        avviso === "prossimo" && "border-blue-500 bg-blue-50 text-blue-800",
        className,
      )}
    >
      {t(`interventi.alerts.${avviso}`)}
    </Badge>
  );
}
