import { errorMessage } from "@/lib/api-error";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListLottiProduttore,
  getListLottiProduttoreQueryKey,
} from "@workspace/api-client-react";
import type { CaricoRowDraft } from "@/lib/carico-merce";
import { Button } from "./ui/button";
import { ProducerLotOriginBadge } from "./producer-lot-origin-badge";

export function ProducerLotLookup({
  areaId,
  productId,
  draft,
  disabled,
  onSelect,
}: {
  areaId: number;
  productId: number;
  draft: CaricoRowDraft;
  disabled: boolean;
  onSelect: (draft: CaricoRowDraft) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [conflict, setConflict] = useState(false);
  const q = draft.codiceLottoProduttore.trim() || undefined;
  useEffect(() => {
    setPage(1);
    setConflict(false);
  }, [q, areaId, productId]);
  const params = {
    areaOperativaId: areaId,
    prodottoId: productId,
    q,
    page,
    limit: 10,
  };
  const list = useListLottiProduttore(params, {
    query: {
      queryKey: getListLottiProduttoreQueryKey(params),
      enabled: open && areaId > 0 && !disabled,
    },
  });
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-auto min-h-11 max-w-full whitespace-normal text-left"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t("blocco07.lookup")}
        </Button>
        {draft.lottoProduttoreId != null && (
          <>
            <span className="text-xs">#{draft.lottoProduttoreId}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onSelect({ ...draft, lottoProduttoreId: null })}
            >
              {t("blocco07.clear")}
            </Button>
          </>
        )}
      </div>
      {conflict && (
        <p role="alert" className="text-sm text-destructive">
          {t("blocco07.conflict")}
        </p>
      )}
      {open && (
        <div
          className="space-y-2 rounded-md border p-2"
          aria-busy={list.isFetching}
        >
          {!list.isError && !list.isFetching && !list.data?.items.length && (
            <p className="text-sm text-muted-foreground">
              {t("blocco07.noMatches")}
            </p>
          )}
          {list.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(list.error, t("common.readfailed"))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void list.refetch()}
              >
                {t("common.readRetry")}
              </Button>
            </p>
          )}
          {!list.isError &&
            list.data?.items.map((lot) => (
              <Button
                key={lot.id}
                type="button"
                variant="ghost"
                className="h-auto w-full whitespace-normal justify-start text-left gap-2 flex-wrap"
                disabled={disabled || list.isFetching}
                onClick={() => {
                  // A cached response may only be selected in its original Area/product context.
                  if (
                    lot.areaOperativaId !== areaId ||
                    lot.prodottoId !== productId
                  )
                    return;
                  if (
                    draft.dataScadenza &&
                    lot.dataScadenza &&
                    draft.dataScadenza !== lot.dataScadenza
                  ) {
                    setConflict(true);
                    return;
                  }
                  onSelect({
                    ...draft,
                    lottoProduttoreId: lot.id,
                    codiceLottoProduttore: lot.codiceOriginale ?? "",
                    dataScadenza: draft.dataScadenza || lot.dataScadenza || "",
                  });
                  setOpen(false);
                }}
              >
                <span className="break-all">
                  {lot.codiceOriginale ?? lot.riferimentoInterno} ·{" "}
                  {lot.dataScadenza ?? "—"}
                </span>
                <ProducerLotOriginBadge origin={lot.origine} />
              </Button>
            ))}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 1 || list.isFetching}
              onClick={() => setPage(page - 1)}
            >
              {t("richiesteMagazzino.previous")}
            </Button>
            <span>{page}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!list.data?.hasMore || list.isFetching}
              onClick={() => setPage(page + 1)}
            >
              {t("richiesteMagazzino.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
