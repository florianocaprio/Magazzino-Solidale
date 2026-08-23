/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { isCivilDate, isCivilYearMonth } from "../src/lib/civilDate";
import {
  accountingDisposition,
  accountingSign,
  signedInventoryValue,
} from "../src/lib/fseAccounting";

describe("Magazzino 2.0C-R1 — date civili e segno contabile", () => {
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"])(
    "rifiuta la data civile impossibile %s",
    (value) => expect(isCivilDate(value)).toBe(false),
  );

  it("accetta date e mesi civili reali", () => {
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(isCivilYearMonth("2026-08")).toBe(true);
    expect(isCivilYearMonth("2026-00")).toBe(false);
  });

  it("distingue lo storno in base alla natura originale", () => {
    expect(
      accountingSign({
        naturaContabile: "STORNO",
        naturaOriginale: "DISTRIBUZIONE_FINALE",
      }),
    ).toBe(1);
    expect(
      accountingSign({
        naturaContabile: "STORNO",
        naturaOriginale: "CARICO",
      }),
    ).toBe(-1);
    expect(
      accountingDisposition({
        naturaContabile: "STORNO",
        naturaOriginale: "RESO",
      }),
    ).toBe("CORREZIONE_RESO");
  });

  it("conserva esattamente valori oltre 2^53 con sei decimali", () => {
    expect(
      signedInventoryValue("9007199254740993.123456", {
        naturaContabile: "DISTRIBUZIONE_FINALE",
      }),
    ).toBe("-9007199254740993.123456");
    expect(
      signedInventoryValue(null, { naturaContabile: "CARICO" }),
    ).toBeNull();
    expect(
      signedInventoryValue("0.000000", { naturaContabile: "CARICO" }),
    ).toBe("0.000000");
  });
});
