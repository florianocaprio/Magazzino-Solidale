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
const zodUrl = new URL(
  "../../../lib/api-zod/src/generated/api.ts",
  import.meta.url,
);

describe("M2 — coerenza OpenAPI e generated", () => {
  it("espone Catalogo, lotto fisico e comandi del lotto logico con semantica distinta", async () => {
    const spec = await readFile(specUrl, "utf8");
    expect(spec).toContain("quantitaFrazionabile:");
    expect(spec).toContain("lottoFisicoObbligatorio:");
    expect(spec).toContain("lottoLogicoId:");
    expect(spec).not.toContain("gestioneLotto:");
    for (const operation of [
      "listLottiLogici",
      "getLottoLogico",
      "createLottoLogico",
      "updateLottoLogico",
      "closeLottoLogico",
      "reopenLottoLogico",
      "archiveLottoLogico",
    ]) {
      expect(spec).toContain(`operationId: ${operation}`);
    }
  });

  it("ha rigenerato client React e validatori Zod dalla sorgente", async () => {
    const [client, schemas, zod] = await Promise.all([
      readFile(clientUrl, "utf8"),
      readFile(schemasUrl, "utf8"),
      readFile(zodUrl, "utf8"),
    ]);
    for (const generated of [schemas, zod]) {
      expect(generated).toContain("quantitaFrazionabile");
      expect(generated).toContain("lottoFisicoObbligatorio");
      expect(generated).toContain("lottoLogicoId");
    }
    expect(client).toContain("useCreateLottoLogico");
    expect(client).toContain("useCloseLottoLogico");
    expect(client).toContain("useReopenLottoLogico");
    expect(client).toContain("useArchiveLottoLogico");
  });
});
