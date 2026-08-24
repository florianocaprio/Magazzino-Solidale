import { describe, expect, it } from "vitest";
import {
  applyAllAreaPermissions,
  applyAreaSelection,
  applyPermissionSelection,
  areaCheckboxState,
  existingRoleSelection,
  type AreaPermissionDefinition,
} from "./area-permissions";

const catalog: AreaPermissionDefinition[] = [
  {
    key: "magazzino",
    permessi: ["magazzino.view", "magazzino.stock.adjust", "bolle.view"],
  },
  {
    key: "sociale",
    permessi: ["sociale.interventi.view", "bolle.view"],
  },
  { key: "generale", permessi: [] },
];

describe("selezione permessi suggeriti per Area", () => {
  it("seleziona tutti i permessi Magazzino senza duplicati", () => {
    const result = applyAreaSelection(
      { aree: [], permessi: ["magazzino.view"] },
      "magazzino",
      true,
      catalog,
    );

    expect(result).toEqual({
      aree: ["magazzino"],
      permessi: ["magazzino.view", "magazzino.stock.adjust", "bolle.view"],
    });
  });

  it("rimuove i permessi esclusivi quando Magazzino viene deselezionato", () => {
    const result = applyAreaSelection(
      {
        aree: ["magazzino"],
        permessi: ["magazzino.view", "magazzino.stock.adjust", "extra.manual"],
      },
      "magazzino",
      false,
      catalog,
    );

    expect(result).toEqual({ aree: [], permessi: ["extra.manual"] });
  });

  it("conserva un permesso condiviso richiesto da un'altra Area", () => {
    const result = applyAreaSelection(
      {
        aree: ["magazzino", "sociale"],
        permessi: ["magazzino.view", "sociale.interventi.view", "bolle.view"],
      },
      "magazzino",
      false,
      catalog,
    );

    expect(result).toEqual({
      aree: ["sociale"],
      permessi: ["sociale.interventi.view", "bolle.view"],
    });
  });

  it("non modifica un ruolo esistente al semplice caricamento", () => {
    const persisted = {
      aree: ["magazzino"],
      permessi: ["magazzino.view"],
    };

    expect(existingRoleSelection(persisted)).toEqual(persisted);
  });

  it("consente di deselezionare un singolo permesso lasciando l'Area", () => {
    const permessi = applyPermissionSelection(
      ["magazzino.view", "magazzino.stock.adjust"],
      "magazzino.stock.adjust",
      false,
    );

    expect(permessi).toEqual(["magazzino.view"]);
    expect(
      areaCheckboxState("magazzino", ["magazzino"], permessi, catalog),
    ).toBe("indeterminate");
  });

  it("distingue checked, indeterminate e unchecked", () => {
    expect(
      areaCheckboxState(
        "magazzino",
        ["magazzino"],
        ["magazzino.view", "magazzino.stock.adjust", "bolle.view"],
        catalog,
      ),
    ).toBe(true);
    expect(
      areaCheckboxState(
        "magazzino",
        ["magazzino"],
        ["magazzino.view"],
        catalog,
      ),
    ).toBe("indeterminate");
    expect(
      areaCheckboxState("magazzino", [], ["magazzino.view"], catalog),
    ).toBe(false);
  });

  it("applica le azioni Tutti e Nessuno senza cambiare l'Area", () => {
    const all = applyAllAreaPermissions([], "magazzino", true, catalog);
    expect(all).toEqual([
      "magazzino.view",
      "magazzino.stock.adjust",
      "bolle.view",
    ]);
    expect(applyAllAreaPermissions(all, "magazzino", false, catalog)).toEqual(
      [],
    );
  });
});
