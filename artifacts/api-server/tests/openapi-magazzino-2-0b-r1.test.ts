/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const specUrl = new URL("../../../lib/api-spec/openapi.yaml", import.meta.url);
const clientUrl = new URL(
  "../../../lib/api-client-react/src/generated/api.ts",
  import.meta.url,
);
const fixerUrl = new URL(
  "../../../lib/api-spec/scripts/fix-binary-upload.mjs",
  import.meta.url,
);

function pathBlock(spec: string, path: string, nextPath: string): string {
  return spec.slice(spec.indexOf(`  ${path}:`), spec.indexOf(`  ${nextPath}:`));
}

describe("Magazzino 2.0B-R1 — contratto AGEA", () => {
  it("dichiara filtri, descrizioni distinte e mutation versionate sui path runtime", async () => {
    const spec = await readFile(specUrl, "utf8");
    const rows = pathBlock(
      spec,
      "/agea/importazioni/{id}/righe",
      "/agea/importazioni/{id}/partite",
    );
    for (const parameter of ["page", "pageSize", "stato", "fondo", "tipo", "q"])
      expect(rows).toContain(`name: ${parameter}`);
    expect(spec).toContain(
      "operationId: listAgeaImportazioneDescrizioniDaMappare",
    );
    expect(spec).toContain("operationId: updateAgeaImportazioneRigaDataCarico");
    expect(spec).toContain("operationId: updateAgeaImportazioneRigaLotto");
    for (const operation of [
      "recalculateAgeaImportazione",
      "confirmAgeaImportazione",
      "cancelAgeaImportazione",
    ]) {
      const start = spec.indexOf(`operationId: ${operation}`);
      const block = spec.slice(start, start + 900);
      expect(block).toContain("required: true");
      expect(block).toMatch(/Agea(?:Versione|ImportConferma)Input/);
      expect(block).toContain('"200":');
    }
    expect(spec).toMatch(
      /AgeaImportConfermaInput:[\s\S]*?required: \[versione\]/,
    );
    expect(spec).toMatch(
      /AgeaMappaturaProdottoUpdate:[\s\S]*?required: \[prodottoId, versione\]/,
    );
  });

  it("rigenera client e fixer binario in modo deterministico e puntuale", async () => {
    const [client, fixer] = await Promise.all([
      readFile(clientUrl, "utf8"),
      readFile(fixerUrl, "utf8"),
    ]);
    expect(client).toContain("useListAgeaImportazioneDescrizioniDaMappare");
    expect(client).toContain("useUpdateAgeaImportazioneRigaDataCarico");
    expect(client).toContain("useUpdateAgeaImportazioneRigaLotto");
    expect(client.match(/body: analyzeAgeaImportazioneBody/g)).toHaveLength(1);
    expect(fixer).toContain("occurrences !== 1");
    expect(fixer).toContain("duplicateOccurrences !== 1");
  });

  it("dichiara gli error response AGEA applicabili con un DTO comune", async () => {
    const spec = await readFile(specUrl, "utf8");
    const cases = [
      [
        "/agea/importazioni/analizza",
        "/agea/importazioni/{id}",
        ["400", "403", "413", "415"],
      ],
      [
        "/agea/importazioni/{id}",
        "/agea/importazioni/{id}/righe",
        ["400", "403", "404"],
      ],
      [
        "/agea/importazioni/{id}/righe",
        "/agea/importazioni/{id}/partite",
        ["400", "403", "404"],
      ],
      [
        "/agea/importazioni/{id}/partite",
        "/agea/importazioni/{id}/descrizioni-da-mappare",
        ["400", "403", "404"],
      ],
      [
        "/agea/importazioni/{id}/descrizioni-da-mappare",
        "/agea/importazioni/{id}/righe/{rigaId}/data-carico",
        ["400", "403", "404"],
      ],
      [
        "/agea/importazioni/{id}/righe/{rigaId}/data-carico",
        "/agea/importazioni/{id}/righe/{rigaId}/lotto",
        ["400", "403", "404", "409"],
      ],
      [
        "/agea/importazioni/{id}/righe/{rigaId}/lotto",
        "/agea/importazioni/{id}/partite/{partitaId}",
        ["400", "403", "404", "409"],
      ],
      [
        "/agea/importazioni/{id}/partite/{partitaId}",
        "/agea/importazioni/{id}/ricalcola",
        ["400", "403", "404", "409"],
      ],
      [
        "/agea/importazioni/{id}/ricalcola",
        "/agea/importazioni/{id}/conferma",
        ["400", "403", "404", "409"],
      ],
      [
        "/agea/importazioni/{id}/conferma",
        "/agea/importazioni/{id}/annulla",
        ["400", "403", "404", "409"],
      ],
      [
        "/agea/importazioni/{id}/annulla",
        "/agea/mappature-prodotti",
        ["400", "403", "404", "409"],
      ],
      [
        "/agea/mappature-prodotti",
        "/agea/mappature-prodotti/{id}",
        ["400", "403", "409"],
      ],
      ["/agea/mappature-prodotti/{id}", "/lotti", ["400", "403", "404", "409"]],
    ] as const;
    for (const [path, nextPath, statuses] of cases) {
      const block = pathBlock(spec, path, nextPath);
      for (const status of statuses)
        expect(block).toContain(
          `"${status}": { $ref: "#/components/responses/`,
        );
    }
    expect(spec).toMatch(
      /AgeaErrorResponse:[\s\S]*?required: \[error\][\s\S]*?code: \{ type: string \}/,
    );
    expect(spec).toMatch(/AgeaCorrezioneLottoInput:[\s\S]*?maxLength: 80/);
  });
});
