import { describe, expect, it } from "vitest";
import { ALL_AREAS, sanitizeRoleAreas } from "../src/lib/areas";
import {
  ALL_PERMISSION_KEYS,
  AREA_PERMISSION_MAP,
} from "../src/lib/permissions";

describe("catalogo esplicito Area -> permessi", () => {
  it("copre tutte le Aree e tutti i permessi assegnabili senza duplicati", () => {
    expect(Object.keys(AREA_PERMISSION_MAP).sort()).toEqual(
      ALL_AREAS.map((area) => area.key).sort(),
    );

    for (const permissions of Object.values(AREA_PERMISSION_MAP)) {
      expect(new Set(permissions).size).toBe(permissions.length);
      expect(
        permissions.every((key) => ALL_PERMISSION_KEYS.includes(key)),
      ).toBe(true);
    }

    const standardRolePermissions = new Set(
      Object.entries(AREA_PERMISSION_MAP)
        .filter(([area]) => area !== "amministrazione")
        .flatMap(([, permissions]) => permissions),
    );
    expect([...standardRolePermissions].sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
  });

  it("documenta i grant trasversali secondo route, menu e MAPS", () => {
    expect(AREA_PERMISSION_MAP.magazzino).toEqual(
      expect.arrayContaining(["bolle.view", "maps.operational"]),
    );
    expect(AREA_PERMISSION_MAP.sociale).toEqual(
      expect.arrayContaining([
        "beneficiari.view",
        "bolle.view",
        "logistica.turni.view",
        "logistica.volontari.view",
        "logistica.mezzi.view",
        "maps.route",
        "maps.operational",
      ]),
    );
    expect(AREA_PERMISSION_MAP.sociale).not.toContain(
      "credito.monthly.execute",
    );
    expect(AREA_PERMISSION_MAP.emporio).toContain("credito.monthly.execute");
    expect(AREA_PERMISSION_MAP.logistica).not.toContain("maps.operational");
    expect(AREA_PERMISSION_MAP.analisi).toEqual(
      expect.arrayContaining([
        "mensa.reports.view",
        "uds.reports.view",
        "magazzino.fse.view",
      ]),
    );
    expect(AREA_PERMISSION_MAP.amministrazione).toEqual([]);
  });

  it("riserva l'Area amministrazione ai ruoli admin", () => {
    expect(sanitizeRoleAreas(["generale", "amministrazione"], false)).toEqual([
      "generale",
    ]);
    expect(sanitizeRoleAreas(["generale", "amministrazione"], true)).toEqual([
      "generale",
      "amministrazione",
    ]);
  });
});
