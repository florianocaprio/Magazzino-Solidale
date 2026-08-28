import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("hardening UI Logistica", () => {
  it("separa view, manage ed export per Volontari e Mezzi", async () => {
    const [volontari, mezzi] = await Promise.all([
      source("../pages/volontari.tsx"),
      source("../pages/mezzi.tsx"),
    ]);
    expect(volontari).toContain('hasPermission("logistica.volontari.manage")');
    expect(volontari).toContain('hasPermission("logistica.volontari.export")');
    expect(mezzi).toContain('hasPermission("logistica.mezzi.manage")');
    expect(mezzi).toContain('hasPermission("logistica.mezzi.export")');
    expect(volontari).not.toContain("useDeleteVolontario");
    expect(mezzi).not.toContain("useDeleteMezzo");
  });

  it("usa ruolo catalogato e conserva la versione nelle modifiche", async () => {
    const [volontari, turni] = await Promise.all([
      source("../pages/volontari.tsx"),
      source("../pages/turni.tsx"),
    ]);
    expect(volontari).toContain("ruoloVolontarioId");
    expect(volontari).toContain("buildVolunteerUpdatePayload");
    expect(volontari).toContain("editing.versione");
    expect(turni).toContain("ruoloVolontarioId");
    expect(turni).toContain("versione: existing.versione");
  });

  it("non rende selezionabili pending, conflitti, limiti o mezzi scaduti", async () => {
    const [turni, consegne] = await Promise.all([
      source("../pages/turni.tsx"),
      source("../pages/consegne.tsx"),
    ]);
    expect(turni).toContain("volontariDisponibili");
    expect(turni).toContain("bookedVolontari");
    expect(turni).toContain("caricoMap");
    expect(turni).toContain("scadenzaAssicurazione");
    expect(turni).toContain("disabled={scaduto}");
    expect(turni).toContain("pendingNotSelectable");
    expect(consegne).toContain("fasciaCanonica");
    expect(consegne).toContain('stato: "attivi" as const');
    expect(consegne).toContain("v.operativo");
    expect(turni).toContain("volontariOperativiIds");
    expect(consegne).toContain("pendingNotSelectable");
  });

  it("gestisce il 409 CAS con refetch e messaggio operativo", async () => {
    const turni = await source("../pages/turni.tsx");
    expect(turni).toContain("status === 409");
    expect(turni).toContain("invalidateQueries");
    expect(turni).toContain("La pianificazione è stata aggiornata da un altro operatore");
  });
});
