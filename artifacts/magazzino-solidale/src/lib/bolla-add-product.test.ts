import { describe, expect, it } from "vitest";
import {
  AUTO_FEFO_LOT,
  bollaAddProductInput,
  selectedPhysicalLot,
} from "./bolla-add-product";

describe("Bolla — scelta lotto e unità catalogo", () => {
  const latte = {
    id: 12,
    unitaMisura: "l",
    lottoFisicoObbligatorio: false,
  };

  it("torna da un lotto selezionato ad Automatico FEFO senza inviare lottoId", () => {
    expect(selectedPhysicalLot("123")).toBe("123");
    const automatico = selectedPhysicalLot(AUTO_FEFO_LOT);
    expect(automatico).toBe("");
    expect(bollaAddProductInput(latte, automatico, "3")).toEqual({
      prodottoId: 12,
      lottoId: undefined,
      quantita: "3",
      unitaMisura: "l",
    });
  });

  it("usa sempre l'unità canonica l del Latte, mai pz o lt", () => {
    expect(bollaAddProductInput(latte, "123", "3")).toEqual({
      prodottoId: 12,
      lottoId: 123,
      quantita: "3",
      unitaMisura: "l",
    });
  });

  it("non lascia passare un prodotto con lotto fisico obbligatorio senza lotto", () => {
    expect(() =>
      bollaAddProductInput(
        { ...latte, lottoFisicoObbligatorio: true },
        "",
        "3",
      ),
    ).toThrow("Seleziona il lotto fisico");
  });
});
