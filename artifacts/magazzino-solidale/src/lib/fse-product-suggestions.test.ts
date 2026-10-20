import { expect, it } from "vitest";
import { suggestFseProducts } from "./fse-product-suggestions";
const product = (id: number, nome: string, attivo = true) => ({
  id,
  nome,
  attivo,
  codice: `P-${id}`,
  unitaMisura: "pz",
});
it("propone nomi pertinenti anche con descrizione FSE ripetuta, senza includere inattivi o coincidenze solo numeriche", () => {
  const suggestions = suggestFseProducts(
    "Olio di semi di girasole da 1 L - Olio di semi di girasole",
    [
      product(1, "Olio di semi di girasole da 1 L"),
      product(2, "Olio di semi di girasole"),
      product(3, "Latte da 1 L"),
      product(4, "Olio di semi di girasole da 1 L", false),
    ],
  );
  expect(suggestions.map((p) => p.id)).toEqual([1, 2]);
});
it("distingue formati nel punteggio, limita le proposte e lascia vuoti i casi senza corrispondenza", () => {
  expect(
    suggestFseProducts("Latte intero 1 L", [
      product(1, "Latte intero 2 L"),
      product(2, "Latte intero 1 L"),
    ])[0].id,
  ).toBe(2);
  expect(suggestFseProducts("xyz", [product(1, "Riso")])).toEqual([]);
  expect(suggestFseProducts("", [product(1, "Riso")])).toEqual([]);
  expect(
    suggestFseProducts(
      "Riso",
      [1, 2, 3, 4].map((id) => product(id, "Riso")),
    ),
  ).toHaveLength(3);
});
