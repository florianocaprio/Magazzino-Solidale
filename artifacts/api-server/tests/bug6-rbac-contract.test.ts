import { describe, expect, it } from "vitest";
import {
  STANDARD_ROLE_PROFILES,
  ORDINARY_AREA_PERMISSION_MAP,
} from "../src/lib/seedRoles";
import { ALL_PERMISSION_KEYS } from "../src/lib/permissions";
import { LEGACY_ROLE_PROFILES } from "../src/lib/legacyRoleProfiles";
import {
  planRoleReconciliation,
  sameRoleConfiguration,
} from "../src/lib/roleReconciliation";
import { reportRequestSection } from "../src/lib/reporting/requestSection";
import { selectionPolicy } from "../src/lib/operationalSelections";
import { CATALOGO_MODULI } from "../src/lib/configurazioneAmbiente";
import {
  UNAVAILABLE_MODULES,
  MODULE_DEPENDENCIES,
} from "../src/lib/modulePolicy";
import type { SessionUser } from "../src/middlewares/auth";

const profile = (name: string) =>
  STANDARD_ROLE_PROFILES.find((role) => role.nome === name)!;
describe("BUG6 — contratti ruoli e manutenzione conservativa", () => {
  it("copre tutti e nove i profili, con operatori non amministrativi e grant conosciuti", () => {
    expect(STANDARD_ROLE_PROFILES.map((role) => role.nome).sort()).toEqual(
      [
        "Amministratore",
        "SuperAdmin",
        "Operatore",
        "Operatore Magazzino",
        "Operatore Logistica",
        "Operatore UDS",
        "Emporio",
        "Operatore Mensa",
        "Volontario",
      ].sort(),
    );
    for (const role of STANDARD_ROLE_PROFILES) {
      if (!["Amministratore", "SuperAdmin"].includes(role.nome))
        expect(role.isAdmin).toBe(false);
      expect(
        role.permessi.every((grant) =>
          (ALL_PERMISSION_KEYS as string[]).includes(grant),
        ),
      ).toBe(true);
    }
  });
  it("Volontario ha solo la lettura concordata, UDS ed Emporio non acquisiscono privilegi estranei", () => {
    expect(profile("Volontario").permessi).toEqual([
      "logistica.turni.view",
      "consegne.view",
      "maps.operational",
      "maps.route",
    ]);
    expect(profile("Volontario").aree).toEqual(["logistica"]);
    expect(profile("Emporio").aree).toEqual(["emporio"]);
    for (const grant of [
      "beneficiari.sensitive.view",
      "credito.adjust",
      "credito.monthly.execute",
      "emporio.sales.reverse",
      "emporio.cassa.force",
    ]) {
      expect(ORDINARY_AREA_PERMISSION_MAP.uds).not.toContain(grant);
      expect(ORDINARY_AREA_PERMISSION_MAP.emporio).not.toContain(grant);
    }
    expect(profile("Operatore").permessi).not.toContain("bolle.manage");
    expect(profile("Operatore Magazzino").permessi).not.toContain(
      "fornitori.manage",
    );
  });
  it("propone una sola volta la trasformazione esatta e conserva ID, custom e revoche", () => {
    const old = LEGACY_ROLE_PROFILES.find(
      (role) => role.nome === "Volontario",
    )!;
    const rows = [
      { ...old, id: 100 },
      { ...old, id: 101, nome: "Personalizzato" },
      { ...old, id: 102, permessi: ["private.custom"] },
    ];
    const result = planRoleReconciliation(
      rows,
      LEGACY_ROLE_PROFILES,
      STANDARD_ROLE_PROFILES,
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].id).toBe(100);
    expect(result.retained.map((role) => role.id)).toEqual([101, 102]);
    const applied = rows.map((role) =>
      role.id === 100 ? { ...role, ...result.changes[0].after } : role,
    );
    expect(
      planRoleReconciliation(
        applied,
        LEGACY_ROLE_PROFILES,
        STANDARD_ROLE_PROFILES,
      ).changes,
    ).toEqual([]);
    expect(sameRoleConfiguration(result.changes[0].before, old)).toBe(true);
  });
  it("la sezione client seleziona solo un percorso noto e non un'altra sorgente", () => {
    const req = (path: string, section?: unknown) => ({
      path,
      originalUrl: path,
      query: section == null ? {} : { section },
    });
    expect(reportRequestSection(req("/api/report/prepare", "uds"))).toBe("uds");
    expect(
      reportRequestSection(req("/api/report/prepare", ["uds", "mensa"])),
    ).toBeNull();
    expect(
      reportRequestSection(req("/api/report/prepare", "__proto__")),
    ).toBeNull();
    expect(reportRequestSection(req("/api/report/uds-fake"))).toBeNull();
    expect(
      reportRequestSection(req("/api/report/uds/interventi-giornalieri")),
    ).toBe("uds");
  });
  it("i selettori dipendono dal workflow e non concedono un'intera famiglia di route", () => {
    const user = {
      ...profile("Operatore"),
      isAdmin: false,
    } as unknown as SessionUser;
    expect(selectionPolicy(user, "consegne", "magazzini")).not.toBeNull();
    expect(selectionPolicy(user, "approvvigionamenti", "prodotti")).toBeNull();
    expect(selectionPolicy(user, "__proto__", "magazzini")).toBeNull();
    expect(
      selectionPolicy({ ...user, permessi: [] }, "consegne", "magazzini"),
    ).toBeNull();
  });
  it("catalogo esplicito, nessun modulo inventato per MAPS e future capability indisponibili", () => {
    expect(CATALOGO_MODULI.some((module) => module.codice === "MAPS")).toBe(
      false,
    );
    expect(MODULE_DEPENDENCIES.CARICHI).toEqual(["LOTTI"]);
    expect(MODULE_DEPENDENCIES.CREDITO_SOLIDALE).toBeUndefined();
    for (const code of UNAVAILABLE_MODULES)
      expect(
        CATALOGO_MODULI.find((module) => module.codice === code)?.attivoDefault,
      ).toBe(false);
  });
});
