import { afterEach, expect, it, vi } from "vitest";
import { addDateOnlyDays, earliestPlanningDate, isNotFutureDateOnly, isValidDateOnly, todayDateOnly } from "./date-only";
afterEach(() => vi.useRealTimers());
it("usa il giorno civile di Roma anche prima della mezzanotte UTC", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T22:30:00Z"));
  expect(todayDateOnly()).toBe("2026-10-19");
  expect(isNotFutureDateOnly("2026-10-19")).toBe(true);
  expect(isNotFutureDateOnly("2026-10-20")).toBe(false);
  expect(isNotFutureDateOnly("2026-02-30")).toBe(false);
  expect(isNotFutureDateOnly("2024-02-29")).toBe(true);
  expect(isValidDateOnly("2025-02-29")).toBe(false);
});
it.each([
  ["2026-03-30T00:30:00+02:00", "2026-03-23"],
  ["2026-10-26T00:30:00+01:00", "2026-10-19"],
  ["2027-01-03T00:30:00+01:00", "2026-12-27"],
])("calcola sette giorni civili senza dipendere da ora legale o anno (%s)", (clock, expected) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(clock));
  expect(earliestPlanningDate()).toBe(expected);
  expect(addDateOnlyDays(earliestPlanningDate(), 7)).toBe(todayDateOnly());
});
