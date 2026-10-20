type CatalogProduct = {
  id: number;
  nome: string;
  codice: string;
  attivo: boolean;
  unitaMisura: string;
};
const stopWords = new Set([
  "di",
  "da",
  "del",
  "della",
  "delle",
  "dei",
  "degli",
  "con",
  "in",
  "per",
  "e",
  "a",
  "al",
  "alla",
]);
function tokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("it-IT")
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => !stopWords.has(word)) ?? [],
  );
}

/** Suggerimenti nominativi, mai un'associazione automatica. Numeri e formati
 * restano nel confronto per distinguere confezioni diverse dello stesso alimento. */
export function suggestFseProducts<T extends CatalogProduct>(
  description: string,
  products: T[],
): T[] {
  const external = tokens(description);
  if (!external.size) return [];
  return products
    .filter((product) => product.attivo)
    .map((product) => {
      const name = tokens(product.nome);
      const common = [...name].filter((word) => external.has(word));
      const score = name.size
        ? (2 * common.length) / (name.size + external.size)
        : 0;
      return {
        product,
        score,
        meaningful: common.some((word) => /\p{L}{3}/u.test(word)),
      };
    })
    .filter(({ score, meaningful }) => score >= 0.5 && meaningful)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.product.nome.localeCompare(b.product.nome, "it") ||
        a.product.id - b.product.id,
    )
    .slice(0, 3)
    .map(({ product }) => product);
}
