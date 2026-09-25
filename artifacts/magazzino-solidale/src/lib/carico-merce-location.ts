export type CaricoMerceTab = "carichi" | "raccolte" | "lotti";

export function parseCaricoMerceTab(search: string): CaricoMerceTab {
  const requested = new URLSearchParams(search).get("tab");
  return requested === "raccolte" || requested === "lotti"
    ? requested
    : "carichi";
}

export function canonicalLegacyLottiSearch(search: string): string {
  const old = new URLSearchParams(search);
  const tab = old.get("tab");
  const next = new URLSearchParams();
  next.set("tab", tab === "carichi" || tab === "agea" ? "carichi" : "lotti");
  if (tab === "scadenza" && !old.has("inScadenza"))
    next.set("inScadenza", "true");
  for (const key of [
    "prodottoId",
    "magazzinoId",
    "fondoOrigine",
    "inScadenza",
  ]) {
    const value = old.get(key);
    if (value) next.set(key, value);
  }
  return `/carico-merce?${next.toString()}`;
}
