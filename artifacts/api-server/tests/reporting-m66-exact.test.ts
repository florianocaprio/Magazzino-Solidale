import { expect, it } from "vitest";
import { numericMetrics } from "../src/lib/reporting/shared";
import { monthSeries } from "../src/lib/reporting/sql";

it("AC-12 SQL strings survive values above MAX_SAFE_INTEGER and decimal 0.1/0.2", () => {
  const projected = numericMetrics({
    count: "9007199254740993",
    decimal: "0.300000",
  });
  expect(projected.exact).toEqual({
    count: "9007199254740993",
    decimal: "0.300000",
  });
  expect(projected.count).toBe(Number("9007199254740993")); // graph only
  expect(
    monthSeries(
      [
        {
          mese: "2026-01",
          totale: "9007199254740993",
          compensation: "-0.300000",
        },
      ],
      "totale",
      "compensation",
    )[0],
  ).toMatchObject({
    exactValue: "9007199254740993",
    exactSecondaryValue: "-0.300000",
  });
});
