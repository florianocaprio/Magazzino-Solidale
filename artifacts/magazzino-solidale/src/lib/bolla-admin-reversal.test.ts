import { describe, expect, it } from "vitest";
import { administrativeReversalReady } from "./bolla-admin-reversal";

const validGate = {
  canReverseAdmin: true,
  documentStatus: "consegnato",
  selectedRowIds: [11],
  reason: "Errore materiale documentato",
  confirmation: "BOL-2026-0042",
  documentNumber: "BOL-2026-0042",
};

describe("M4A — gate UI storno amministrativo Bolla", () => {
  it("abilita il comando soltanto con permesso amministrativo e bolla consegnata", () => {
    expect(administrativeReversalReady(validGate)).toBe(true);
    expect(
      administrativeReversalReady({ ...validGate, canReverseAdmin: false }),
    ).toBe(false);
    expect(
      administrativeReversalReady({
        ...validGate,
        documentStatus: "confermato",
      }),
    ).toBe(false);
  });

  it("richiede righe, motivo e conferma forte col numero documento", () => {
    expect(
      administrativeReversalReady({ ...validGate, selectedRowIds: [] }),
    ).toBe(false);
    expect(administrativeReversalReady({ ...validGate, reason: "  " })).toBe(
      false,
    );
    expect(
      administrativeReversalReady({ ...validGate, confirmation: "STORNA" }),
    ).toBe(false);
  });
});
