import { describe, expect, it } from "vitest";
import { movementOperatorLabel } from "./movement-operator";

describe("movementOperatorLabel", () => {
  it("mostra lo snapshot audit quando disponibile", () => {
    expect(
      movementOperatorLabel("AIM-0042", "Non disponibile — dato precedente"),
    ).toBe("AIM-0042");
  });

  it("rende esplicito un movimento legacy senza autore", () => {
    expect(
      movementOperatorLabel(null, "Non disponibile — dato precedente"),
    ).toBe("Non disponibile — dato precedente");
  });
});
