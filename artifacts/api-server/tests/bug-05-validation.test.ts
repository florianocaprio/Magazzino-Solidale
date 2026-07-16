import { describe, expect, it } from "vitest";
import { hasFutureBirthDate, isSupportedLogoType, validateCapacita } from "../src/lib/bug5Validation";

describe("BUG 5 - validazioni indipendenti dal database", () => {
  const today = new Date(2026, 6, 16, 12);

  it("accetta ieri e oggi, rifiuta domani", () => {
    expect(hasFutureBirthDate("2026-07-15", today)).toBe(false);
    expect(hasFutureBirthDate("2026-07-16", today)).toBe(false);
    expect(hasFutureBirthDate("2026-07-17", today)).toBe(true);
  });

  it("accetta capacità zero e decimale in kg", () => {
    expect(validateCapacita({ capacitaColli: 0, capacitaKg: 0 })).toBeNull();
    expect(validateCapacita({ capacitaColli: 12, capacitaKg: 25.5 })).toBeNull();
  });

  it("rifiuta valori negativi e colli decimali", () => {
    expect(validateCapacita({ capacitaColli: -1 })).toMatch(/non negativo/);
    expect(validateCapacita({ capacitaColli: 1.5 })).toMatch(/intero/);
    expect(validateCapacita({ capacitaKg: -0.1 })).toMatch(/non negativo/);
  });

  it("accetta solo formati immagine supportati per il logo", () => {
    expect(isSupportedLogoType("image/png")).toBe(true);
    expect(isSupportedLogoType("image/jpeg; charset=binary")).toBe(true);
    expect(isSupportedLogoType("image/svg+xml")).toBe(false);
    expect(isSupportedLogoType("application/x-sh")).toBe(false);
  });
});
