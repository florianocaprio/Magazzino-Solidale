import { useListFseImportSessions } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { registerBlocco07 } from "@/lib/i18n/namespaces/blocco07";
import i18n from "@/lib/i18n";
registerBlocco07(i18n);

/** One warehouse-scoped query: permissions/territory remain enforced by the API. */
export function FsePendingImports({
  warehouseId,
  warehouseName,
  onResume,
}: {
  warehouseId: number;
  warehouseName: string;
  onResume: (practiceId: number, sessionId: number) => void;
}) {
  const { t } = useTranslation();
  const { data } = useListFseImportSessions({ magazzinoId: warehouseId });
  const pending =
    data?.filter(
      (session) =>
        session.caricoPraticaId != null &&
        !["REGISTRATA", "ANNULLATA"].includes(session.stato),
    ) ?? [];
  if (!pending.length) return null;
  return (
    <section
      className="space-y-2 rounded-md border border-teal-300 bg-teal-50 p-4 dark:bg-teal-950/30"
      aria-label={t("blocco07.pendingImports")}
    >
      <h2 className="font-semibold">
        {t("blocco07.pendingImports")} · {warehouseName}
      </h2>
      {pending.map((session) => (
        <div
          key={session.id}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            #{session.id} ·{" "}
            {t(
              session.modalita === "SALDO_INIZIALE"
                ? "caricoPratiche.fseInitialBalance"
                : "caricoPratiche.fseNewLoads",
            )}{" "}
            ·{" "}
            {session.dataRiferimentoSaldo ?? session.dataCreazione.slice(0, 10)}
          </span>
          <Button
            variant="outline"
            onClick={() => onResume(session.caricoPraticaId!, session.id)}
          >
            {t("blocco07.resumePractice", { id: session.caricoPraticaId })}
          </Button>
        </div>
      ))}
    </section>
  );
}
