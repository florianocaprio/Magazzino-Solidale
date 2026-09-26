/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("M5A — contratto, codegen e migration append-only", () => {
  it("mantiene una sola entità richiesta non inventariale e vincoli PostgreSQL", async () => {
    const sql = await read(
      "../../../lib/db/updates/20260925_m5a_richieste_magazzino.sql",
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS richieste_magazzino/);
    expect(sql).toMatch(
      /CREATE SEQUENCE IF NOT EXISTS richieste_magazzino_codice_seq/,
    );
    expect(sql).toMatch(/richieste_magazzino_intervento_attivo_unique/);
    expect(sql).toMatch(/stato IN \('inviata', 'presa_in_carico'\)/);
    for (const check of [
      "destinatario_check",
      "sorgente_check",
      "versione_check",
      "presa_check",
      "annullamento_check",
    ]) {
      expect(sql).toContain(`richieste_magazzino_${check}`);
    }
    expect(sql).not.toMatch(
      /\b(?:DELETE|TRUNCATE|UPDATE)\s+(?:FROM\s+)?(?:lotti|movimenti|interventi|bolle|consegne)\b/i,
    );
    expect(sql).not.toMatch(/ON DELETE CASCADE/i);
  });

  it("espone solo i sette endpoint M5A e rigenera client e Zod", async () => {
    const [spec, client, zod] = await Promise.all([
      read("../../../lib/api-spec/openapi.yaml"),
      read("../../../lib/api-client-react/src/generated/api.ts"),
      read("../../../lib/api-zod/src/generated/api.ts"),
    ]);
    for (const operation of [
      "listRichiesteMagazzino",
      "createRichiestaMagazzino",
      "getRichiestaMagazzino",
      "updateRichiestaMagazzino",
      "takeRichiestaMagazzino",
      "cancelRichiestaMagazzino",
      "getRichiestaMagazzinoStorico",
    ]) {
      expect(spec).toContain(`operationId: ${operation}`);
      expect(client).toContain(`export const ${operation}`);
    }
    expect(zod).toContain("CreateRichiestaMagazzinoBody");
    for (const forbidden of [
      "/richieste-magazzino/{id}/chiudi",
      "/richieste-magazzino/{id}/prenota",
      "/richieste-magazzino/{id}/genera-bolla",
    ]) {
      expect(spec).not.toContain(forbidden);
    }
  });

  it("mappa il segmento all'Area applicativa e lascia intatte le route legacy", async () => {
    const [areas, routes, handler] = await Promise.all([
      read("../src/lib/areas.ts"),
      read("../src/routes/index.ts"),
      read("../src/routes/richieste-magazzino.ts"),
    ]);
    expect(areas).toContain('"richieste-magazzino": ["sociale", "magazzino"]');
    expect(routes).toContain("router.use(richiesteMagazzinoRouter)");
    expect(handler).toContain('requireModulo("MAGAZZINO_SOLIDALE")');
    expect(handler).toContain('isModuloAttivo("CENTRO_ASCOLTO")');
    expect(handler).not.toContain('requireModulo("BOLLE")');
    expect(handler).not.toContain('requireModulo("CONSEGNE")');
  });
});
