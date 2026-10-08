import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aggregatiConsumiMensa } from "../src/lib/mensaService";

describe("M6.1 regressioni test-first", () => {
  it("somma decimali esatta e separa prodotto/unità storiche", () => {
    const rows = ["0.1", "0.2"].map((quantita) => ({
      causale: "consumo",
      prodottoId: 1,
      prodottoNome: "Latte",
      unitaMisura: "l",
      quantita,
    }));
    const result = aggregatiConsumiMensa([
      ...rows,
      { ...rows[0], unitaMisura: "pz", quantita: "2" },
    ]);
    expect(result.consumiPerProdotto).toHaveLength(2);
    expect(result.consumiPerUnitaMisura).toEqual([
      { unitaMisura: "l", quantita: 0.3 },
      { unitaMisura: "pz", quantita: 2 },
    ]);
  });
  it("una modifica al Magazzino non cambia lo stato del servizio Mensa", () => {
    const source = readFileSync(
      new URL("../src/lib/mensaMagazzinoSync.ts", import.meta.url),
      "utf8",
    );
    expect(
      source.slice(
        source.indexOf("if (existing)"),
        source.indexOf("const [created]"),
      ),
    ).not.toContain("attiva:");
  });
});
