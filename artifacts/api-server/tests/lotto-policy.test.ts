import { describe, expect, it } from "vitest";
import {
  dataOperativaEuropeRome,
  isLottoDistribuibile,
} from "../src/lib/lottoPolicy";

describe("politica lotti — data civile Europe/Rome", () => {
  it("cambia data alla mezzanotte italiana estiva, non alla mezzanotte UTC", () => {
    expect(dataOperativaEuropeRome(new Date("2026-08-18T21:59:59Z"))).toBe(
      "2026-08-18",
    );
    expect(dataOperativaEuropeRome(new Date("2026-08-18T22:00:00Z"))).toBe(
      "2026-08-19",
    );
  });

  it("cambia data alla mezzanotte italiana in ora solare", () => {
    expect(dataOperativaEuropeRome(new Date("2026-12-18T22:59:59Z"))).toBe(
      "2026-12-18",
    );
    expect(dataOperativaEuropeRome(new Date("2026-12-18T23:00:00Z"))).toBe(
      "2026-12-19",
    );
  });

  it("considera distribuibile il lotto fino all'intera data civile di scadenza", () => {
    expect(isLottoDistribuibile(null, "2026-08-19")).toBe(true);
    expect(isLottoDistribuibile("2026-08-19", "2026-08-19")).toBe(true);
    expect(isLottoDistribuibile("2026-08-18", "2026-08-19")).toBe(false);
  });
});
