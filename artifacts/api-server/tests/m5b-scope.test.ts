/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { RichiestaMagazzino } from "@workspace/db";
import { canReadM5bRequest } from "../src/lib/m5bRequestAccess";

const actor = {
  isAdmin: false,
  permessi: ["richieste_magazzino.view"],
  aree: ["magazzino"],
  areaOperativaId: 1,
  centroAscoltoId: 11,
  zonaUdsId: null,
};
const row = (changes: Partial<RichiestaMagazzino>) =>
  ({
    areaOperativaId: 1,
    centroAscoltoId: null,
    tipoDestinatario: "ente",
    sorgente: "operativa",
    zonaUdsIdSnapshot: null,
    ...changes,
  }) as RichiestaMagazzino;

describe("M5B-P0 — scope della coda operativa senza Centro", () => {
  it("mostra al Magazzino del Centro una richiesta Ente condivisa nella stessa Area", () => {
    expect(canReadM5bRequest(actor, row({}))).toBe(true);
  });
  it("non allarga il Centro delle richieste sociali", () => {
    expect(
      canReadM5bRequest(
        actor,
        row({ tipoDestinatario: "beneficiario", centroAscoltoId: 12 }),
      ),
    ).toBe(false);
  });
  it("non trasforma una cartella sociale senza Centro in richiesta operativa condivisa", () => {
    expect(
      canReadM5bRequest(
        actor,
        row({
          tipoDestinatario: "beneficiario",
          sorgente: "beneficiario",
          centroAscoltoId: null,
        }),
      ),
    ).toBe(false);
  });
  it("non attraversa l'Area Operativa", () => {
    expect(canReadM5bRequest(actor, row({ areaOperativaId: 2 }))).toBe(false);
  });
});
