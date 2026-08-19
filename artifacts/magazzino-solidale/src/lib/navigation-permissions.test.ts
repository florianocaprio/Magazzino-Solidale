import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/layout";

describe("permission gate della navigazione operativa", () => {
  it.each([
    ["beneficiari", "beneficiari.view"],
    ["udsAnagrafica", "beneficiari.view"],
    ["emporioCreditiSaldo", "credito.view"],
    ["emporioAccessi", "emporio.access.view"],
  ])("protegge %s con %s", (key, permission) => {
    expect(NAV_ITEMS.find((item) => item.key === key)?.permission).toBe(permission);
  });
});
