import { describe, expect, it } from "vitest";
import type { Lotto } from "@workspace/api-client-react";
import {
  filterPhysicalLots,
  physicalLotState,
  scannedPhysicalLotDraft,
  suggestedPhysicalLotDraft,
  suggestedPhysicalLots,
} from "./carico-lotti";
import { canonicalLegacyLottiSearch } from "./carico-merce-location";
import { uxCaricoLotti } from "./i18n/namespaces/uxCaricoLotti";

function lot(override: Partial<Lotto> = {}): Lotto {
  return {
    id: 1,
    prodottoId: 10,
    prodottoNome: "Pasta",
    prodottoCodice: "P-10",
    lottoLogicoId: 20,
    codiceLotto: "PASTA-1",
    dataScadenza: "2026-12-31",
    dataCarico: "2026-09-17",
    quantitaCaricata: 10,
    quantitaResidua: 10,
    quantitaCaricataPrecisa: "10.000000",
    quantitaResiduaPrecisa: "10.000000",
    disponibileReale: 8,
    disponibileRealePrecisa: "8.000000",
    magazzinoId: 30,
    areaOperativaId: 40,
    fornitoreId: 50,
    fsePlus: false,
    fondoOrigine: "NESSUN_FONDO",
    dataCreazione: "2026-09-17T12:00:00Z",
    ...override,
  } as Lotto;
}

const filters = {
  areaId: 40,
  warehouse: "all",
  product: "all",
  activity: "all",
  supplier: "all",
  fund: "all",
  status: "all",
  expiry: "",
  search: "",
  today: "2026-09-25",
};

describe("UX-CARICO-LOTTI — filtri e stato dei lotti fisici", () => {
  it("espone gli stessi testi operativi nelle sei lingue", () => {
    const expected = Object.keys(uxCaricoLotti.it).sort();
    for (const language of Object.values(uxCaricoLotti))
      expect(Object.keys(language).sort()).toEqual(expected);
  });
  it("esclude altre Aree, magazzini, prodotti, raccolte, fornitori e fondi", () => {
    const rows = [
      lot(),
      lot({ id: 2, areaOperativaId: 41 }),
      lot({ id: 3, magazzinoId: 31 }),
    ];
    expect(filterPhysicalLots(rows, filters).map((row) => row.id)).toEqual([
      1, 3,
    ]);
    expect(
      filterPhysicalLots(rows, {
        ...filters,
        warehouse: "30",
        product: "10",
        activity: "20",
        supplier: "50",
        fund: "NESSUN_FONDO",
      }).map((row) => row.id),
    ).toEqual([1]);
    expect(filterPhysicalLots(rows, { ...filters, product: "11" })).toEqual([]);
    expect(
      filterPhysicalLots([lot({ areaOperativaId: null })], filters),
    ).toEqual([]);
    expect(
      filterPhysicalLots([lot({ areaOperativaId: null })], {
        ...filters,
        areaId: 0,
      }),
    ).toHaveLength(1);
  });

  it("cerca su nome, codice prodotto e codice produttore", () => {
    for (const search of ["pasta", "p-10", "PASTA-1"])
      expect(filterPhysicalLots([lot()], { ...filters, search })).toHaveLength(
        1,
      );
    expect(filterPhysicalLots([lot()], { ...filters, search: "riso" })).toEqual(
      [],
    );
  });

  it("deriva esaurito, scaduto, non distribuibile e in scadenza senza nuovo saldo", () => {
    expect(
      physicalLotState(
        lot({ quantitaResiduaPrecisa: "0.000000" }),
        filters.today,
      ),
    ).toBe("exhausted");
    expect(
      physicalLotState(lot({ dataScadenza: "2026-09-24" }), filters.today),
    ).toBe("expired");
    expect(
      physicalLotState(
        lot({ disponibileRealePrecisa: "0.000000" }),
        filters.today,
      ),
    ).toBe("unavailable");
    expect(
      physicalLotState(lot({ dataScadenza: "2026-10-01" }), filters.today),
    ).toBe("expiring");
    expect(physicalLotState(lot(), filters.today)).toBe("available");
  });

  it("suggerisce solo partite del prodotto e magazzino correnti, senza modificare i dati", () => {
    const rows = [
      lot(),
      lot({ id: 2, prodottoId: 11 }),
      lot({ id: 3, magazzinoId: 31 }),
      lot({ id: 4, codiceLotto: null }),
    ];
    expect(suggestedPhysicalLots(rows, 10, 30).map((row) => row.id)).toEqual([
      1,
    ]);
    expect(
      suggestedPhysicalLots([lot({ quantitaResiduaPrecisa: "0" })], 10, 30),
    ).toHaveLength(1);
    expect(rows[0].quantitaResiduaPrecisa).toBe("10.000000");
  });

  it("lo scanner scrive solo il codice lotto; il suggerimento non cambia quantità o stock", () => {
    const draft = {
      quantita: "7",
      fondoOrigine: "NESSUN_FONDO" as const,
      codiceLottoProduttore: "",
      dataScadenza: "",
      fattoreKgLtPezzo: "",
      note: "bozza",
    };
    const scanned = scannedPhysicalLotDraft(draft, "LOT-RAW-2");
    expect(scanned).toMatchObject({
      quantita: "7",
      codiceLottoProduttore: "LOT-RAW-2",
      note: "bozza",
    });
    const known = lot({ fattoreKgLtPezzo: "0.5" });
    const suggested = suggestedPhysicalLotDraft(scanned, known);
    expect(suggested).toMatchObject({
      quantita: "7",
      codiceLottoProduttore: "PASTA-1",
      dataScadenza: "2026-12-31",
      fattoreKgLtPezzo: "0.5",
    });
    expect(known.quantitaResiduaPrecisa).toBe("10.000000");
    expect(draft.codiceLottoProduttore).toBe("");
  });

  it("mantiene i deep-link utili del vecchio /lotti e normalizza i tab", () => {
    expect(
      canonicalLegacyLottiSearch("?tab=partite&prodottoId=10&magazzinoId=30"),
    ).toBe("/carico-merce?tab=lotti&prodottoId=10&magazzinoId=30");
    expect(canonicalLegacyLottiSearch("?tab=carichi")).toBe(
      "/carico-merce?tab=carichi",
    );
    expect(canonicalLegacyLottiSearch("?tab=agea")).toBe(
      "/carico-merce?tab=carichi",
    );
    expect(canonicalLegacyLottiSearch("?tab=scadenza")).toBe(
      "/carico-merce?tab=lotti&inScadenza=true",
    );
  });
});
