import type { Magazzino, Prodotto } from "@workspace/api-client-react";

export function operationalWarehousesForArea(
  warehouses: Magazzino[] | undefined,
  areaOperativaId: number | null,
) {
  if (areaOperativaId == null) return [];
  return (warehouses ?? []).filter(
    (warehouse) =>
      warehouse.areaOperativaId === areaOperativaId &&
      warehouse.stato === "attivo",
  );
}

export function normalizeUiQuantity(value: string): string {
  return value.trim().replace(",", ".");
}

export function productForBarcode(
  products: Prodotto[] | undefined,
  barcode: string,
) {
  const normalized = barcode.trim();
  if (!normalized) return undefined;
  return (products ?? []).find(
    (product) => product.attivo && product.codiceBarre === normalized,
  );
}

export function visibleProducts(
  products: Prodotto[] | undefined,
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  return (products ?? [])
    .filter((product) => product.attivo)
    .filter(
      (product) =>
        !normalized ||
        product.nome.toLocaleLowerCase().includes(normalized) ||
        product.codice.toLocaleLowerCase().includes(normalized) ||
        product.codiceBarre?.toLocaleLowerCase().includes(normalized),
    );
}

export function newCommandKey(prefix = "carico-pratica") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function shouldAcceptBarcodeScan(
  previous: { value: string; at: number } | null,
  value: string,
  now: number,
) {
  return previous?.value !== value || now - previous.at >= 2500;
}
