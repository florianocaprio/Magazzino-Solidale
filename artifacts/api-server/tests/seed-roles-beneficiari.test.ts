import { describe, expect, it } from "vitest";
import { defaultEmporioPermissions } from "../src/lib/seedRoles";

describe("permessi del ruolo Emporio standard", () => {
  it("usa le API dedicate senza ereditare beneficiari.view", () => {
    expect(defaultEmporioPermissions([
      "beneficiari.view",
      "permesso.custom",
    ])).toEqual(expect.arrayContaining([
      "credito.view",
      "emporio.access.view",
      "emporio.access.manage",
      "permesso.custom",
    ]));
    expect(defaultEmporioPermissions(["beneficiari.view"])).not.toContain("beneficiari.view");
  });
});
