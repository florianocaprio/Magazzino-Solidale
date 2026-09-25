import type { Lotto } from "@workspace/api-client-react";
import type { CaricoRowDraft } from "./carico-merce";

export function scannedPhysicalLotDraft(
  draft: CaricoRowDraft,
  code: string,
): CaricoRowDraft {
  return { ...draft, codiceLottoProduttore: code };
}

export function suggestedPhysicalLotDraft(
  draft: CaricoRowDraft,
  lot: Lotto,
): CaricoRowDraft {
  return {
    ...draft,
    codiceLottoProduttore: lot.codiceLotto ?? "",
    dataScadenza: lot.dataScadenza ?? "",
    fattoreKgLtPezzo: lot.fattoreKgLtPezzo ?? draft.fattoreKgLtPezzo,
  };
}

export function physicalLotState(lot: Lotto, today: string) {
  if (Number(lot.quantitaResiduaPrecisa) === 0) return "exhausted";
  if (lot.dataScadenza && lot.dataScadenza < today) return "expired";
  if (Number(lot.disponibileRealePrecisa) === 0) return "unavailable";
  const within30 = new Date(`${today}T00:00:00Z`);
  within30.setUTCDate(within30.getUTCDate() + 30);
  if (
    lot.dataScadenza &&
    lot.dataScadenza <= within30.toISOString().slice(0, 10)
  )
    return "expiring";
  return "available";
}

export type PhysicalLotFilters = {
  areaId: number;
  warehouse: string;
  product: string;
  activity: string;
  supplier: string;
  fund: string;
  status: string;
  expiry: string;
  search: string;
  today: string;
};

export function filterPhysicalLots(lots: Lotto[], filters: PhysicalLotFilters) {
  return lots.filter((lot) => {
    if (filters.areaId && lot.areaOperativaId !== filters.areaId) return false;
    if (
      filters.warehouse !== "all" &&
      lot.magazzinoId !== Number(filters.warehouse)
    )
      return false;
    if (filters.product !== "all" && lot.prodottoId !== Number(filters.product))
      return false;
    if (
      filters.activity !== "all" &&
      lot.lottoLogicoId !== Number(filters.activity)
    )
      return false;
    if (
      filters.supplier !== "all" &&
      lot.fornitoreId !== Number(filters.supplier)
    )
      return false;
    if (filters.fund !== "all" && lot.fondoOrigine !== filters.fund)
      return false;
    if (
      filters.status !== "all" &&
      physicalLotState(lot, filters.today) !== filters.status
    )
      return false;
    if (filters.expiry && lot.dataScadenza !== filters.expiry) return false;
    const term = filters.search.trim().toLocaleLowerCase();
    return (
      !term ||
      `${lot.prodottoNome ?? ""} ${lot.prodottoCodice ?? ""} ${lot.codiceLotto ?? ""}`
        .toLocaleLowerCase()
        .includes(term)
    );
  });
}

export function suggestedPhysicalLots(
  lots: Lotto[],
  productId: number,
  warehouseId: number,
) {
  return lots.filter(
    (lot) =>
      lot.prodottoId === productId &&
      lot.magazzinoId === warehouseId &&
      Boolean(lot.codiceLotto),
  );
}
