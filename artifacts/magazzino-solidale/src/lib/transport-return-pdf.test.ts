import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RientroTrasportoDettaglio } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  table: vi.fn(),
  text: vi.fn(),
  save: vi.fn(),
}));

vi.mock("jspdf", () => ({
  jsPDF: class {
    setFontSize() {}
    text(...args: unknown[]) {
      mocks.text(...args);
    }
    save(...args: unknown[]) {
      mocks.save(...args);
    }
  },
}));
vi.mock("jspdf-autotable", () => ({ default: mocks.table }));

import { generateTransportReturnPdf } from "./transport-return-pdf";

const detail: RientroTrasportoDettaglio = {
  id: 1,
  stato: "rientrato",
  magazzinoOrigineId: 2,
  rientroId: 3,
  dataRientro: new Date("2026-09-24"),
  partite: [
    {
      movimentoUscitaId: 4,
      prodottoId: 5,
      prodottoNome: "Pasta",
      lottoId: 6,
      codiceLotto: "L-6",
      quantitaUscita: "2",
      unitaMisura: "pz",
    },
  ],
  documenti: [
    {
      tipo: "deteriorata",
      movimentoUscitaId: 4,
      prodottoId: 5,
      lottoId: 6,
      quantita: "1",
      scaricoId: 7,
    },
    {
      tipo: "mancante",
      movimentoUscitaId: 4,
      prodottoId: 5,
      lottoId: 6,
      quantita: "1",
      scaricoId: null,
    },
  ],
};

describe("M4B.2 — PDF derivati dal rientro persistente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stampa il riepilogo completo e il singolo documento di anomalia senza duplicare dati", () => {
    const t = (key: string) => key;
    generateTransportReturnPdf(detail, "B-1", t);
    expect(mocks.table.mock.calls[0][1].body).toHaveLength(2);
    expect(mocks.save).toHaveBeenLastCalledWith("rientro-B-1.pdf");

    generateTransportReturnPdf(detail, "B-1", t, 1);
    expect(mocks.table.mock.calls[1][1].body).toHaveLength(1);
    expect(mocks.table.mock.calls[1][1].body[0][2]).toBe(
      "transportReturn.document.mancante",
    );
    expect(mocks.save).toHaveBeenLastCalledWith("rientro-B-1-mancante-4.pdf");
  });
});
