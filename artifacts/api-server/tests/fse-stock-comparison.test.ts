import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseFseFile } from "../src/lib/fseImportParser";
import { compareFseStock } from "../src/lib/fseStockComparison";

const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  book,
  XLSX.utils.aoa_to_sheet([
    [
      "Denominazione OpN",
      "Denominazione OpC",
      "Denominazione OpT",
      "CodiceAccesso",
      "Fondo",
      "Prodotto",
      "Lotto",
      "PesoUnita",
      "UnitaMisuraPeso",
      "GiacenzaPesoVolume",
      "GiacenzaPezzi",
      "PezziPerCollo",
      "GiacenzaColli",
      "CheckModificaGiacenza",
      "Scadenza",
    ],
    [
      "OpN",
      "OpC",
      "OpT",
      "TEST",
      "FSE+",
      "Pasta",
      "L-1",
      0.5,
      "KG",
      5,
      10,
      10,
      1,
      null,
      "31/12/2026",
    ],
  ]),
  "Table1",
);
const [row] = parseFseFile(
  Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })),
  { profile: "GIACENZE" },
).stockRows;
const product = { id: 1, nome: "Pasta locale", unitaMisura: "pz" };
const mapping = new Map([[row.prodottoNormalizzato, product.id]]);
const stock = {
  prodottoId: 1,
  fondoOrigine: "FSE_PLUS",
  codiceLotto: "L-1",
  dataScadenza: "2026-12-31",
  quantitaResidua: "10.000000",
  fattoreKgLtPezzo: "0.500000000",
};

describe("confronto fisico FSE+ senza nuovi carichi", () => {
  it("coincide anche se il saldo locale è ripartito in più partite", () => {
    expect(
      compareFseStock(
        [row],
        mapping,
        [product],
        [
          { ...stock, quantitaResidua: "3" },
          { ...stock, quantitaResidua: "7" },
        ],
      ),
    ).toEqual({
      allineato: true,
      righeFile: 1,
      righeCoincidenti: 1,
      differenze: [],
    });
  });
  it.each([
    { quantitaResidua: "9.999999" },
    { codiceLotto: "L-2" },
    { fondoOrigine: "FONDO_NAZIONALE" },
    { fattoreKgLtPezzo: "0.4" },
    { fattoreKgLtPezzo: null },
    { dataScadenza: "2026-12-30" },
  ])(
    "rileva quantità, lotto, fondo, conversione o scadenza diversi: %j",
    (change) => {
      expect(
        compareFseStock([row], mapping, [product], [{ ...stock, ...change }])
          .allineato,
      ).toBe(false);
    },
  );
  it("rileva anche lotti locali assenti dal file senza compensarli con lotti mancanti", () => {
    const result = compareFseStock(
      [row],
      mapping,
      [product],
      [stock, { ...stock, codiceLotto: "EXTRA", quantitaResidua: "2" }],
    );
    expect(result.allineato).toBe(false);
    expect(result.differenze[0]).toMatchObject({
      lotto: "EXTRA",
      quantitaFile: "0",
      quantitaLocale: "2",
    });
  });
  it("non dichiara allineati file vuoti, righe errate, non associate o duplicate", () => {
    expect(compareFseStock([], mapping, [product], []).allineato).toBe(false);
    expect(
      compareFseStock([row], new Map(), [product], [stock]).allineato,
    ).toBe(false);
    expect(
      compareFseStock(
        [{ ...row, blocking: true, errorCodes: ["FONDO_NON_VALIDO"] }],
        mapping,
        [product],
        [stock],
      ).allineato,
    ).toBe(false);
    expect(
      compareFseStock([row, row], mapping, [product], [stock]).allineato,
    ).toBe(false);
  });
  it("confronta l’unità operativa kg, mantenendo il controllo sui pezzi e sulla dimensione kg/l", () => {
    expect(
      compareFseStock(
        [row],
        mapping,
        [{ ...product, unitaMisura: "kg" }],
        [{ ...stock, quantitaResidua: "5" }],
      ).allineato,
    ).toBe(true);
    expect(
      compareFseStock(
        [row],
        mapping,
        [{ ...product, unitaMisura: "l" }],
        [{ ...stock, quantitaResidua: "5" }],
      ).allineato,
    ).toBe(false);
  });
  it("ignora partite esaurite ma non quantità residue positive", () => {
    expect(
      compareFseStock(
        [row],
        mapping,
        [product],
        [stock, { ...stock, codiceLotto: "VECCHIO", quantitaResidua: "0" }],
      ).allineato,
    ).toBe(true);
  });
});
