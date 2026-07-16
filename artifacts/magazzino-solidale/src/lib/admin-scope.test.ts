import { describe, expect, it } from "vitest";
import { ruoliNelPerimetro } from "./admin-scope";

describe("amministratore limitato", () => {
  const ruoli = [
    { nome: "Sociale", aree: ["sociale"] },
    { nome: "Sociale e logistica", aree: ["sociale", "logistica"] },
    { nome: "SuperAdmin", aree: ["amministrazione"] },
  ];

  it("vede soltanto ruoli compresi nel proprio perimetro e mai SuperAdmin", () => {
    expect(ruoliNelPerimetro(ruoli, ["sociale"], false).map((r) => r.nome)).toEqual(["Sociale"]);
  });

  it("lascia al Super Admin l'intero catalogo", () => {
    expect(ruoliNelPerimetro(ruoli, [], true)).toEqual(ruoli);
  });
});
