import { expect, it } from "vitest";
import { formatReportingDecimal } from "./reporting-number";

it("preserves integers beyond MAX_SAFE_INTEGER and all fractional digits", () => {
  expect(formatReportingDecimal("9007199254740993.100002", "en-US")).toBe(
    "9,007,199,254,740,993.100002",
  );
  expect(formatReportingDecimal("-0.300000", "it-IT")).toBe("-0,300000");
  expect(formatReportingDecimal("0", "it")).toBe("0");
  expect(formatReportingDecimal("ND", "ar")).toBe("ND");
});
