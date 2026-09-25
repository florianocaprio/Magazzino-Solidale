import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const requiredTextClass = "text-blue-700 dark:text-blue-300";

type ProductLotRequirementLabelProps = {
  name: string;
  lotRequired: boolean;
  description?: string | null;
};

export function ProductLotRequirementLabel({
  name,
  lotRequired,
  description,
}: ProductLotRequirementLabelProps) {
  const { t } = useTranslation();

  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "min-w-0 break-words font-medium",
            lotRequired ? requiredTextClass : "text-foreground",
          )}
        >
          {name}
        </span>
        {lotRequired && (
          <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300">
            {t("uxCaricoLotti.lotRequired")}
          </span>
        )}
      </span>
      {description && (
        <span
          className={cn(
            "block max-w-[250px] truncate text-xs",
            lotRequired ? requiredTextClass : "text-muted-foreground",
          )}
        >
          {description}
        </span>
      )}
    </span>
  );
}
