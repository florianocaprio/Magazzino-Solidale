/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const specUrl = new URL("../../../lib/api-spec/openapi.yaml", import.meta.url);
const clientUrl = new URL(
  "../../../lib/api-client-react/src/generated/api.ts",
  import.meta.url,
);

function pathBlock(spec: string, path: string, nextPath: string): string {
  return spec.slice(spec.indexOf(`  ${path}:`), spec.indexOf(`  ${nextPath}:`));
}

describe("Magazzino 2.0A-R1 — coerenza OpenAPI e client generato", () => {
  it("colloca replay e PATCH Lotto sui path runtime corretti", async () => {
    const spec = await readFile(specUrl, "utf8");
    const magazzini = pathBlock(spec, "/magazzini", "/magazzini/{id}");
    const carichi = pathBlock(spec, "/carichi", "/carichi/{id}");
    const lotto = pathBlock(spec, "/lotti/{id}", "/lotti/{id}/rettifica");
    const rettifica = pathBlock(
      spec,
      "/lotti/{id}/rettifica",
      "/movimenti",
    );
    expect(magazzini).not.toContain("CaricoMagazzinoDettaglio");
    expect(carichi).toContain('"200":');
    expect(carichi).toContain('"201":');
    expect(lotto).toContain("operationId: updateLotto");
    expect(rettifica).toContain("operationId: rettificaLotto");
    expect(rettifica).not.toContain("operationId: updateLotto");
  });

  it("mantiene i contratti Orval privi di contaminazione tra risorse", async () => {
    const client = await readFile(clientUrl, "utf8");
    expect(client).toMatch(
      /export const createMagazzino[\s\S]*?Promise<Magazzino>/,
    );
    expect(client).toMatch(
      /export const createCarico[\s\S]*?Promise<CaricoMagazzinoDettaglio>/,
    );
    expect(client).toContain("`/api/lotti/${id}`");
    expect(client).toContain("`/api/lotti/${id}/rettifica`");
  });
});
