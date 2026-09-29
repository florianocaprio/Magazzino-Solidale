import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetBollaQueryKey,
  getGetDocumentoOperativoQueryKey,
  getListBolleQueryKey,
  getListDocumentiOperativiQueryKey,
  getListGiacenzeQueryKey,
} from "@workspace/api-client-react";
import {
  bollaErrorMessage,
  invalidateBollaViews,
} from "./bolla-query-invalidation";

describe("R2 — source of truth Bolla collegata", () => {
  it("invalida dettaglio operativo, Bolla canonica, liste e giacenze", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await invalidateBollaViews(client, 17);
    for (const key of [
      getGetBollaQueryKey(17),
      getGetDocumentoOperativoQueryKey("bolla", 17),
      getListDocumentiOperativiQueryKey(),
      getListBolleQueryKey(),
      getListGiacenzeQueryKey(),
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
  });

  it("mostra l'errore reale del client generato", () => {
    expect(
      bollaErrorMessage(
        { data: { error: "Volontario non valido" } },
        "fallback",
      ),
    ).toBe("Volontario non valido");
    expect(
      bollaErrorMessage(
        { response: { data: { error: "Fuori area" } } },
        "fallback",
      ),
    ).toBe("Fuori area");
    expect(bollaErrorMessage({ message: "Errore rete" }, "fallback")).toBe(
      "Errore rete",
    );
  });
});
