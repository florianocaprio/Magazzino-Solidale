import { describe, expect, it } from "vitest";
import {
  cassaEmporioCapabilities,
  speseEmporioCapabilities,
} from "./emporio-permissions";

describe("capability UI Emporio", () => {
  it("non espone force, storno o Aggiorna Credito al ruolo Emporio standard", () => {
    const standard = new Set([
      "emporio.cassa.view",
      "emporio.cassa.operate",
      "emporio.sales.view",
      "emporio.sales.manage",
    ]);
    const hasPermission = (permission: string) => standard.has(permission);
    expect(cassaEmporioCapabilities(hasPermission)).toEqual({
      canOperate: true,
      canForce: false,
      canAdjustCredito: false,
    });
    expect(speseEmporioCapabilities(hasPermission)).toEqual({
      canManage: true,
      canReverse: false,
    });
  });

  it("abilita le azioni privilegiate soltanto con i grant dedicati", () => {
    const grants = new Set([
      "emporio.cassa.force",
      "credito.adjust",
      "emporio.sales.reverse",
    ]);
    const hasPermission = (permission: string) => grants.has(permission);
    expect(cassaEmporioCapabilities(hasPermission).canForce).toBe(true);
    expect(cassaEmporioCapabilities(hasPermission).canAdjustCredito).toBe(true);
    expect(speseEmporioCapabilities(hasPermission).canReverse).toBe(true);
  });
});
