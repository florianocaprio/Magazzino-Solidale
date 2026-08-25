/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const specUrl = new URL("../../../lib/api-spec/openapi.yaml", import.meta.url);
const clientUrl = new URL(
  "../../../lib/api-client-react/src/generated/api.ts",
  import.meta.url,
);
const schemasUrl = new URL(
  "../../../lib/api-client-react/src/generated/api.schemas.ts",
  import.meta.url,
);

describe("Magazzino 2.0C — coerenza OpenAPI e client generato", () => {
  it("espone l'intero router FSE+ e limita la paginazione a 200", async () => {
    const spec = await readFile(specUrl, "utf8");
    for (const path of [
      "/fse/rendicontazione/preview",
      "/fse/rendicontazione/eventi",
      "/fse/rendicontazione/righe",
      "/fse/rendicontazione/qualita",
      "/fse/exportazioni",
      "/fse/exportazioni/{id}/download",
      "/fse/exportazioni/{id}/marca-inserita",
      "/fse/riconciliazioni",
      "/fse/riconciliazioni/{id}/righe/{rigaId}",
      "/fse/monitoraggio",
      "/fse/monitoraggio/{id}",
      "/fse/resi-opc",
      "/fse/resi-opc/{id}/storno",
    ]) {
      expect(spec).toContain(`  ${path}:`);
    }
    expect(spec).toContain("FsePageSize:");
    expect(spec).toMatch(/FsePageSize:[\s\S]*?maximum: 200/);
    expect(spec).toContain("REPORTING_2_0_V1");
    expect(spec).toContain("exactValue:");
  });

  it("mantiene SDK e tipi allineati alle mutazioni versionate", async () => {
    const [client, schemas] = await Promise.all([
      readFile(clientUrl, "utf8"),
      readFile(schemasUrl, "utf8"),
    ]);
    for (const operation of [
      "getFseReportingPreview",
      "createFseExport",
      "downloadFseExport",
      "markFseExportManuallyEntered",
      "createFseReconciliation",
      "resolveFseReconciliationLine",
      "createFseMonitoring",
      "updateFseMonitoring",
      "createFseOpcReturn",
      "reverseFseOpcReturn",
    ]) {
      expect(client).toContain(`export const ${operation}`);
    }
    expect(schemas).toMatch(
      /export interface FseVersionInput[\s\S]*?versione: number/,
    );
    expect(schemas).toMatch(/export interface ReportKpi[\s\S]*?exactValue/);
    expect(schemas).toContain("reportingModelVersion");
  });
});
