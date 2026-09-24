import { describe, expect, it } from "vitest";
import {
  formatReturnUnits,
  returnLineDifference,
  returnQuantityUnits,
} from "./transport-return";

const base = {
  idonea: "18",
  deteriorata: "1",
  scaduta: "0",
  mancante: "1",
  rubata: "0",
};

describe("M4B.2 — form di rientro con decimali esatti", () => {
  it("classifica esattamente 18 + 1 + 1 su 20", () => {
    expect(returnLineDifference("20.000000", base)).toBe(0n);
  });
  it("impedisce conferma per over-return, under-return e valori invalidi", () => {
    expect(returnLineDifference("20", { ...base, idonea: "19" })).toBe(
      -1_000_000n,
    );
    expect(returnLineDifference("20", { ...base, idonea: "17" })).toBe(
      1_000_000n,
    );
    expect(returnLineDifference("20", { ...base, mancante: "-1" })).toBeNull();
    expect(
      returnLineDifference("20", { ...base, mancante: "0.0000001" }),
    ).toBeNull();
  });
  it("non perde la sesta cifra decimale", () => {
    expect(
      returnLineDifference("1.000001", {
        ...base,
        idonea: "1",
        deteriorata: "0",
        mancante: "0.000001",
      }),
    ).toBe(0n);
    expect(formatReturnUnits(returnQuantityUnits("0,123456")!)).toBe(
      "0.123456",
    );
  });
});
