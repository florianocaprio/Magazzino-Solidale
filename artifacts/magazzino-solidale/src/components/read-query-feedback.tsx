import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function readFailureKind(error: unknown, hasPreviousData: boolean) {
  const candidate = error as {
    status?: number;
    response?: { status?: number };
  } | null;
  const status = candidate?.status ?? candidate?.response?.status;
  return status === 401 || status === 403
    ? "denied"
    : hasPreviousData
      ? "stale"
      : "failed";
}

/** A failed read is not an authorized empty result. Never expose cached rows here. */
export function ReadQueryFeedback({
  query,
}: {
  query: {
    isError: boolean;
    error: unknown;
    data?: unknown;
    isFetching: boolean;
    refetch: () => unknown;
  };
}) {
  const { t } = useTranslation();
  if (!query.isError) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/50 p-4 space-y-2"
    >
      <p>
        {t(
          `common.read${readFailureKind(query.error, query.data !== undefined)}`,
        )}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={query.isFetching}
        onClick={() => {
          void query.refetch();
        }}
      >
        {t("common.readRetry")}
      </Button>
    </div>
  );
}
