import { describe, expect, it } from "vitest";
import {
  canSearchBeneficiarioDuplicates,
  buildBeneficiarioDuplicateParams,
  requireGlobalBeneficiarioArea,
} from "./beneficiario-create-ui";

describe("creazione Beneficiario globale per Area", () => {
  it("richiede sempre l'Area anche per una normale anagrafica Sociale", () => {
    expect(() => requireGlobalBeneficiarioArea(true, undefined)).toThrow(/Area/);
    expect(() => requireGlobalBeneficiarioArea(true, "abc")).toThrow(/Area/);
    expect(requireGlobalBeneficiarioArea(true, "12")).toBe(12);
    expect(requireGlobalBeneficiarioArea(false, undefined)).toBeUndefined();
  });

  it("non avvia la ricerca duplicati globale senza Area e la abilita dopo la selezione", () => {
    const base = { open: true, dismissed: false, hasInput: true, isGlobal: true };
    expect(canSearchBeneficiarioDuplicates(base)).toBe(false);
    expect(canSearchBeneficiarioDuplicates({ ...base, areaId: 1 })).toBe(true);
    expect(canSearchBeneficiarioDuplicates({ ...base, areaId: 2 })).toBe(true);
    expect(canSearchBeneficiarioDuplicates({ ...base, areaId: 1, dismissed: true })).toBe(false);
    expect(buildBeneficiarioDuplicateParams(" Mario ", " Rossi ", true, 1)).toEqual({
      nome: "Mario",
      cognome: "Rossi",
      areaOperativaId: 1,
    });
    expect(buildBeneficiarioDuplicateParams("Mario", "Rossi", true, 2).areaOperativaId).toBe(2);
  });
});
