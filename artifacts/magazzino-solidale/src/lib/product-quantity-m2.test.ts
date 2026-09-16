import { describe, expect, it } from "vitest";
import { LANGUAGE_CODES } from "./i18n/languages";
import { prodotti } from "./i18n/namespaces/prodotti";
import {
  fractionalQuantityAfterUnitChange,
  suggestedFractionalQuantity,
} from "./product-quantity-form";

describe("M2 — semantica quantità nel form Catalogo", () => {
  it("suggerisce i default iniziali per pz, confezioni, kg e litri", () => {
    expect(suggestedFractionalQuantity("pz")).toBe(false);
    expect(suggestedFractionalQuantity("cf")).toBe(false);
    expect(suggestedFractionalQuantity("kg")).toBe(true);
    expect(suggestedFractionalQuantity("l")).toBe(true);
    expect(suggestedFractionalQuantity("lt")).toBe(true);
  });

  it("aggiorna il suggerimento finché l'utente non modifica il toggle", () => {
    expect(
      fractionalQuantityAfterUnitChange({
        unitOfMeasure: "kg",
        currentValue: false,
        explicitlySet: false,
      }),
    ).toBe(true);
    expect(
      fractionalQuantityAfterUnitChange({
        unitOfMeasure: "pz",
        currentValue: true,
        explicitlySet: false,
      }),
    ).toBe(false);
  });

  it("preserva una scelta esplicita e il valore caricato in modifica", () => {
    expect(
      fractionalQuantityAfterUnitChange({
        unitOfMeasure: "kg",
        currentValue: false,
        explicitlySet: true,
      }),
    ).toBe(false);
    expect(
      fractionalQuantityAfterUnitChange({
        unitOfMeasure: "pz",
        currentValue: true,
        explicitlySet: true,
      }),
    ).toBe(true);
  });

  it("espone le etichette M2 in tutte le sei lingue", () => {
    expect(LANGUAGE_CODES).toHaveLength(6);
    for (const language of LANGUAGE_CODES) {
      const translations = prodotti[language] as Record<string, unknown>;
      for (const key of [
        "quantitaFrazionabile",
        "quantitaFrazionabileDesc",
        "lottoFisicoObbligatorio",
        "lottoFisicoObbligatorioDesc",
      ]) {
        expect(translations[key], `${language}.${key}`).toBeTypeOf("string");
        expect(String(translations[key])).not.toBe("");
      }
    }
  });
});
