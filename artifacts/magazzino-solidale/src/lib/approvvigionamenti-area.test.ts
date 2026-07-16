import { describe, expect, it } from "vitest";
import { fornitoriAttiviPerArea } from "./approvvigionamenti-area";

describe("filtro fornitori per Area", () => {
  const fornitori = [
    { id: 1, cittaId: 10, attivo: true },
    { id: 2, cittaId: 20, attivo: true },
    { id: 3, cittaId: 10, attivo: false },
  ];

  it("non propone fornitori prima di scegliere l'Area", () => {
    expect(fornitoriAttiviPerArea(fornitori, undefined)).toEqual([]);
  });

  it("mostra soltanto fornitori attivi associati all'Area selezionata", () => {
    expect(fornitoriAttiviPerArea(fornitori, 10).map((f) => f.id)).toEqual([1]);
    expect(fornitoriAttiviPerArea(fornitori, 20).map((f) => f.id)).toEqual([2]);
  });
});
