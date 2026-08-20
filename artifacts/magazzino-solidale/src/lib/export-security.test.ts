import { describe, expect, it } from "vitest";
import { sanitizeSpreadsheetCell } from "./export";

describe("sicurezza export XLSX", () => {
  it.each(["=HYPERLINK(\"https://example.test\")", "+1+1", "-2+3", "@SUM(A1:A2)"])(
    "neutralizza il valore testuale %s",
    (value) => {
      expect(sanitizeSpreadsheetCell(value)).toBe(`'${value}`);
    },
  );

  it("non altera testo ordinario o numeri statistici, inclusi quelli negativi", () => {
    expect(sanitizeSpreadsheetCell("Mario Rossi")).toBe("Mario Rossi");
    expect(sanitizeSpreadsheetCell(-12.5)).toBe(-12.5);
    expect(sanitizeSpreadsheetCell(42)).toBe(42);
  });
});
