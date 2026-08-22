/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  FASCE_CONSEGNA_TURNO,
  FASCE_TURNO,
  fasciaTurnoFromConsegna,
  isFasciaConsegna,
  isFasciaTurno,
} from "../src/lib/logisticaPolicy";

describe("mapping canonico fasce Logistica", () => {
  it("deriva validazione e mapping Consegna/Turno dalla stessa fonte", () => {
    expect(FASCE_TURNO).toEqual(["09-13", "14-18", "18-20"]);
    expect(FASCE_CONSEGNA_TURNO).toEqual({
      Mattina: FASCE_TURNO[0],
      Pomeriggio: FASCE_TURNO[1],
      Sera: FASCE_TURNO[2],
    });
    for (const [consegna, turno] of Object.entries(FASCE_CONSEGNA_TURNO)) {
      expect(isFasciaConsegna(consegna)).toBe(true);
      expect(isFasciaTurno(turno)).toBe(true);
      expect(fasciaTurnoFromConsegna(consegna)).toBe(turno);
    }
    expect(fasciaTurnoFromConsegna("09-13")).toBeNull();
    expect(isFasciaConsegna("Notte")).toBe(false);
  });
});
