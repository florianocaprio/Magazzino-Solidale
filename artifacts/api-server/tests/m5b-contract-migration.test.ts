/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("M5B — contratto additivo e vincoli dichiarati", () => {
  it("dichiara FK tipizzate, slot corrente unico e nessun backfill inventariale", async () => {
    const migration = await read(
      "../../../lib/db/updates/20260926_m5b_raccordo_documenti.sql",
    );
    for (const token of [
      "REFERENCES richieste_magazzino(id) ON DELETE RESTRICT",
      "REFERENCES bolle(id) ON DELETE RESTRICT",
      "REFERENCES trasferimenti(id) ON DELETE RESTRICT",
      "richieste_magazzino_documenti_tipo_check",
      "richieste_magazzino_documenti_corrente_unique",
      "richieste_magazzino_documenti_bolla_unique",
      "richieste_magazzino_documenti_trasferimento_unique",
      "interventi_deleghe_m4",
    ])
      expect(migration).toContain(token);
    expect(migration).not.toMatch(
      /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:FROM\s+)?(?:lotti|movimenti|bolle|richieste_magazzino)\b/i,
    );
  });

  it("espone comando, storico e lookup inverso nel contratto generato", async () => {
    const [spec, client, zod] = await Promise.all([
      read("../../../lib/api-spec/openapi.yaml"),
      read("../../../lib/api-client-react/src/generated/api.ts"),
      read("../../../lib/api-zod/src/generated/api.ts"),
    ]);
    for (const operation of [
      "createRichiestaMagazzinoDocumento",
      "getRichiestaMagazzinoDocumenti",
      "getDocumentoOperativoRichiesta",
    ]) {
      expect(spec).toContain(`operationId: ${operation}`);
      expect(client).toContain(`export const ${operation}`);
    }
    expect(zod).toContain("export const CreateRichiestaMagazzinoDocumentoBody");
    expect(spec).not.toContain("/richieste-magazzino/{id}/chiudi");
  });
});
