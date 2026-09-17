import { describe, expect, it } from "vitest";
import type { Magazzino, Prodotto } from "@workspace/api-client-react";
import {
  isCaricoRowDraftDirty,
  normalizeUiQuantity,
  operationalWarehousesForArea,
  productForBarcode,
  shouldAcceptBarcodeScan,
  type CaricoRowDraft,
  visibleProducts,
} from "./carico-merce";
import { barcodeCameraErrorKey } from "@/components/barcode-scanner-button";
import { caricoPratiche } from "@/lib/i18n/namespaces/caricoPratiche";

const product = (overrides: Partial<Prodotto> = {}): Prodotto =>
  ({
    id: 1,
    codice: "PASTA-01",
    nome: "Pasta",
    tipoProdotto: "alimentare",
    unitaMisura: "pz",
    codiceBarre: "8001234567890",
    quantitaFrazionabile: false,
    lottoFisicoObbligatorio: false,
    gestioneScadenza: false,
    fsePlus: false,
    scortaMinima: 0,
    scortaConsigliata: 0,
    abilitatoEmporio: false,
    creditoSolidaleValore: 0,
    quantitaMassimaPerSpesa: null,
    quantitaMassimaMensile: null,
    attivo: true,
    dataCreazione: "2026-09-17T00:00:00Z",
    ...overrides,
  }) as Prodotto;

const warehouse = (overrides: Partial<Magazzino>): Magazzino =>
  ({
    id: 1,
    codice: "M1",
    nome: "Deposito",
    areaOperativaId: 10,
    tipoMagazzino: "logistico",
    stato: "attivo",
    dataCreazione: "2026-09-17T00:00:00Z",
    ...overrides,
  }) as Magazzino;

const rowDraft = (overrides: Partial<CaricoRowDraft> = {}): CaricoRowDraft => ({
  quantita: "5.000000",
  fondoOrigine: "NESSUN_FONDO",
  codiceLottoProduttore: "LOT-A",
  dataScadenza: "2027-12-31",
  fattoreKgLtPezzo: "",
  note: "",
  ...overrides,
});

describe("Carico Merce M3A", () => {
  it("mostra l'elenco prodotti anche senza ricerca e filtra per nome/codice", () => {
    const products = [
      product(),
      product({ id: 2, codice: "RISO", nome: "Riso" }),
    ];
    expect(visibleProducts(products, "")).toHaveLength(2);
    expect(visibleProducts(products, "pasta").map((item) => item.id)).toEqual([
      1,
    ]);
    expect(visibleProducts(products, "RISO").map((item) => item.id)).toEqual([
      2,
    ]);
  });

  it("seleziona il barcode noto e deduplica scansioni ravvicinate", () => {
    expect(productForBarcode([product()], "8001234567890")?.id).toBe(1);
    expect(productForBarcode([product()], "SCONOSCIUTO")).toBeUndefined();
    expect(shouldAcceptBarcodeScan(null, "800", 1000)).toBe(true);
    expect(
      shouldAcceptBarcodeScan({ value: "800", at: 1000 }, "800", 2000),
    ).toBe(false);
    expect(
      shouldAcceptBarcodeScan({ value: "800", at: 1000 }, "800", 3500),
    ).toBe(true);
  });

  it("usa solo magazzini attivi della stessa Area per i nuovi carichi", () => {
    const result = operationalWarehousesForArea(
      [
        warehouse({}),
        warehouse({ id: 2, stato: "inattivo" }),
        warehouse({ id: 3, areaOperativaId: 20 }),
      ],
      10,
    );
    expect(result.map((item) => item.id)).toEqual([1]);
  });

  it("normalizza la virgola decimale senza arrotondare", () => {
    expect(normalizeUiQuantity(" 1,250001 ")).toBe("1.250001");
  });

  it("confronta deterministicamente il draft con quantità e null normalizzati", () => {
    expect(
      isCaricoRowDraftDirty(
        rowDraft({ quantita: " 5,0 ", codiceLottoProduttore: " LOT-A " }),
        rowDraft(),
      ),
    ).toBe(false);
    expect(isCaricoRowDraftDirty(rowDraft({ quantita: "8" }), rowDraft())).toBe(
      true,
    );
  });

  it("rileva lotto produttore e scadenza modificati ma non salvati", () => {
    expect(
      isCaricoRowDraftDirty(
        rowDraft({ codiceLottoProduttore: "LOT-B" }),
        rowDraft(),
      ),
    ).toBe(true);
    expect(
      isCaricoRowDraftDirty(
        rowDraft({ dataScadenza: "2028-01-31" }),
        rowDraft(),
      ),
    ).toBe(true);
  });

  it("traduce rifiuto e assenza della fotocamera senza bloccare la selezione manuale", () => {
    expect(barcodeCameraErrorKey({ name: "NotAllowedError" })).toBe(
      "barcodeScanner.errPermission",
    );
    expect(barcodeCameraErrorKey({ name: "NotFoundError" })).toBe(
      "barcodeScanner.errNoCamera",
    );
    expect(visibleProducts([product()], "")).toHaveLength(1);
  });

  it("mantiene completa la chiave Carico Merce in tutte le sei lingue", () => {
    const italianKeys = Object.keys(caricoPratiche.it).sort();
    for (const language of ["es", "en", "fr", "de", "ar"] as const) {
      expect(Object.keys(caricoPratiche[language]).sort()).toEqual(italianKeys);
    }
    expect(caricoPratiche.en.area).toBe("Operational Area");
    expect(caricoPratiche.ar.register).toBe("تسجيل الصفوف الجديدة");
  });
});
