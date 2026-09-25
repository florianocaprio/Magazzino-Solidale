import { describe, expect, it } from "vitest";
import {
  canonicalLegacyLottiSearch,
  parseCaricoMerceTab,
} from "./carico-merce-location";

describe("Carico Merce — tab da query string", () => {
  it.each([
    ["", "carichi"],
    ["tab=carichi", "carichi"],
    ["tab=raccolte", "raccolte"],
    ["?tab=lotti", "lotti"],
    ["tab=xyz", "carichi"],
    ["tab=", "carichi"],
  ] as const)("legge %s come %s", (search, expected) => {
    expect(parseCaricoMerceTab(search)).toBe(expected);
  });

  it("mantiene il redirect legacy ai tab corretti", () => {
    expect(canonicalLegacyLottiSearch("?tab=carichi")).toBe(
      "/carico-merce?tab=carichi",
    );
    expect(canonicalLegacyLottiSearch("?tab=scadenza")).toBe(
      "/carico-merce?tab=lotti&inScadenza=true",
    );
  });
});
