import { expect, it } from "vitest";
import { movementPhysicalEffect } from "../src/lib/movementPhysicalEffect";

it.each([
  ["carico", "donazione", -1],
  ["trasferimento", "entrata", -1],
  ["scarico", "consegna", 1],
  ["trasferimento", "uscita", 1],
  ["esito", "consegna", 0],
] as const)(
  "canonical reversal of %s/%s has physical effect %s",
  (tipoMovimento, tipoDettaglio, effect) => {
    expect(
      movementPhysicalEffect(
        { tipoMovimento: "storno", tipoDettaglio: "storno_bolla" },
        { tipoMovimento, tipoDettaglio },
      ),
    ).toBe(effect);
  },
);

it("never assigns an arbitrary effect to a reversal without its original", () => {
  expect(() =>
    movementPhysicalEffect({
      tipoMovimento: "storno",
      tipoDettaglio: "legacy",
    }),
  ).toThrow("Movimento origine dello storno assente");
});

it("rejects an unknown original rather than presenting a guessed sign", () => {
  expect(() =>
    movementPhysicalEffect(
      { tipoMovimento: "storno", tipoDettaglio: "legacy" },
      { tipoMovimento: "unknown", tipoDettaglio: "legacy" },
    ),
  ).toThrow("Tipo movimento fisico sconosciuto");
});
