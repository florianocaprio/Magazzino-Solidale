import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGEA_XLSX_CONTENT_TYPE,
  analyzeAgeaImportazione,
} from "@workspace/api-client-react";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adapter upload binario AGEA", () => {
  it("invia il Blob XLSX senza JSON.stringify e conserva i metadati validati in query", async () => {
    const file = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
      type: AGEA_XLSX_CONTENT_TYPE,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await analyzeAgeaImportazione(file, {
      magazzinoId: 7,
      modalita: "SOLO_ANALISI",
      nomeFile: "registro AGEA.xlsx",
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("magazzinoId=7");
    expect(url).toContain("modalita=SOLO_ANALISI");
    expect(url).toContain("nomeFile=registro+AGEA.xlsx");
    expect(options.body).toBe(file);
    expect(new Headers(options.headers).get("Content-Type")).toBe(
      AGEA_XLSX_CONTENT_TYPE,
    );
  });
});
