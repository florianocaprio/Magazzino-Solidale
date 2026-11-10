import { expect, it } from "vitest";
import {
  equalReportingDecimals,
  formatLogisticsQuantity,
  formatReportingDecimal,
} from "./reporting-number";

it("preserves integers beyond MAX_SAFE_INTEGER and all fractional digits", () => {
  expect(formatReportingDecimal("9007199254740993.100002", "en-US")).toBe(
    "9,007,199,254,740,993.100002",
  );
  expect(formatReportingDecimal("-0.300000", "it-IT")).toBe("-0,300000");
  expect(formatReportingDecimal("0", "it")).toBe("0");
  expect(formatReportingDecimal("ND", "ar")).toBe("ND");
});

it("arrotonda per eccesso kg e litri conservando la precisione del valore di partenza", () => {
  expect(formatLogisticsQuantity("1387.920000000000", "kg", "it-IT")).toBe(
    "1388",
  );
  expect(formatLogisticsQuantity("12.000000", "l", "it-IT")).toBe("12");
  expect(formatLogisticsQuantity("-12.920000", "Lt", "it-IT")).toBe("-12");
  expect(formatLogisticsQuantity("0.000001", "kg", "it-IT")).toBe("1");
  expect(formatLogisticsQuantity("9007199254740993.000001", "l", "en-US")).toBe(
    "9,007,199,254,740,994",
  );
  expect(formatLogisticsQuantity("3244.000000", "pz", "it-IT")).toBe(
    new Intl.NumberFormat("it-IT").format(3244),
  );
  expect(formatLogisticsQuantity("2.500000", "pz", "it-IT")).toBe("2,5");
  expect(formatLogisticsQuantity(null, "kg", "it-IT")).toBeUndefined();
});

it("confronta le giacenze esatte anche quando hanno scale decimali diverse", () => {
  expect(equalReportingDecimals("1387.9200000000", "1387.920000")).toBe(true);
  expect(equalReportingDecimals("3244.000000", "3244")).toBe(true);
  expect(equalReportingDecimals("0.3", "-0.3")).toBe(false);
  expect(equalReportingDecimals("1.1", "1.2")).toBe(false);
  expect(equalReportingDecimals("9007199254740993", "9007199254740992")).toBe(
    false,
  );
});
