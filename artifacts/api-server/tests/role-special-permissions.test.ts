import { describe, expect, it } from "vitest";
import { specialRolePermissions } from "../src/lib/roleSpecialPermissions";
import { ORDINARY_AREA_PERMISSION_MAP, PRODUCT_CATALOG_MANAGER_ROLE_NAME, STANDARD_ROLE_PROFILES } from "../src/lib/seedRoles";

describe("permessi speciali rispetto ai menu assegnati", () => {
  it.each(STANDARD_ROLE_PROFILES.filter((role) => role.nome !== PRODUCT_CATALOG_MANAGER_ROLE_NAME))("$nome è standard anche con un nome personalizzato", (profile) => {
    expect(specialRolePermissions({ ...profile, nome: "Altro nome" })).toEqual([]);
    expect(specialRolePermissions({ ...profile, permessi: profile.permessi.slice(0, 1) })).toEqual([]);
  });

  it("mantiene la gestione catalogo come capacità aggiuntiva", () => {
    const profile = STANDARD_ROLE_PROFILES.find((role) => role.nome === PRODUCT_CATALOG_MANAGER_ROLE_NAME)!;
    expect(specialRolePermissions(profile)).toContain("magazzino.products.manage");
  });

  it("la dotazione dei cinque menu del Centro non è un'aggiunta speciale", () => {
    const aree = ["generale", "magazzino", "sociale", "logistica", "analisi"];
    const permessi = [...new Set(aree.flatMap((area) => ORDINARY_AREA_PERMISSION_MAP[area]))];
    expect(specialRolePermissions({ aree, permessi })).toEqual([]);
    expect(permessi).toContain("credito.view");
    expect(permessi).toContain("emporio.access.manage");
    expect(aree).not.toContain("emporio");
  });

  it("segnala soltanto le aggiunte effettive, senza cambiare il ruolo", () => {
    const role = { aree: ["uds"], permessi: ["uds.directory.view", "credito.view", "credito.view", "legacy.extra"] };
    const before = structuredClone(role);
    expect(specialRolePermissions(role)).toEqual(["credito.view", "legacy.extra"]);
    expect(role).toEqual(before);
    expect(specialRolePermissions({ ...role, aree: ["uds", "emporio"] })).toEqual(["legacy.extra"]);
    expect(specialRolePermissions({ ...role, isAdmin: true })).toEqual([]);
    expect(specialRolePermissions({ ...role, isSuperAdmin: true })).toEqual([]);
  });
});
