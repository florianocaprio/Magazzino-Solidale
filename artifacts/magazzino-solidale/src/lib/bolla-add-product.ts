export const AUTO_FEFO_LOT = "__auto__";

export type BollaCatalogProduct = {
  id: number;
  unitaMisura: string;
  lottoFisicoObbligatorio: boolean;
};

/** The UI sentinel is never sent to the inventory API. */
export function selectedPhysicalLot(value: string): string {
  return value === AUTO_FEFO_LOT ? "" : value;
}

export function bollaAddProductInput(
  product: BollaCatalogProduct,
  physicalLotId: string,
  quantity: string,
) {
  if (product.lottoFisicoObbligatorio && !physicalLotId) {
    throw new Error("Seleziona il lotto fisico");
  }
  return {
    prodottoId: product.id,
    lottoId: physicalLotId ? Number(physicalLotId) : undefined,
    quantita: quantity,
    unitaMisura: product.unitaMisura,
  };
}
