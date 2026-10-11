import { it, expect } from "vitest";
import { interventoLogisticLabel } from "./interventi-logistics";
it.each([
  [{ richiestaStato: "annullata" }, "requestCancelled"],
  [{ richiestaStato: "chiusa" }, "requestClosed"],
  [
    { richiestaStato: "presa_in_carico", bollaStato: "confermato" },
    "readyToPlan",
  ],
  [
    {
      richiestaStato: "presa_in_carico",
      bollaStato: "confermato",
      consegnaId: 1,
      consegnaStato: "annullata",
    },
    "readyToPlan",
  ],
  [{ richiestaStato: "inviata", ambiguo: true }, "ambiguous"],
] as const)("T13 proiezione %j", (fields, expected) => {
  expect(
    interventoLogisticLabel({
      richiestaId: 1,
      richiestaCodice: "R1",
      ...fields,
    }),
  ).toBe(expected);
});
