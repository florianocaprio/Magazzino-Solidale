/* @vitest-environment node */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  AgeaParserError,
  parseAgeaDate,
  parseAgeaWorkbook,
} from "../src/lib/ageaSifeadParser";

const headers = [
  "Fondo",
  "Prodotto",
  "Giacenza al 20/08/2026 Pezzi",
  "Giacenza al 20/08/2026 KgLt",
  "Numero documento",
  "Data documento",
  "Data carico magazzino",
  "Lotto",
  "Mittente / destinatario",
  "Carico / scarico",
  "Carico / scarico pezzi",
  "Giacenza pezzi alla movimentazione",
  "Giacenza alla movimentazione",
  "Note",
  "Attività",
  "Pacchi",
  "Pasti",
  "Indigenti saltuari",
  "Indigenti continuativi",
];

function row(overrides: Record<number, string | number> = {}) {
  const values: Array<string | number> = [
    "FSE+",
    "Pasta di semola 500 g",
    10,
    "5,5",
    "DOC-1",
    "20/08/2026",
    23,
    "LOT  01",
    "AGEA",
    "5,5",
    10,
    10,
    "5,5",
    23,
    23,
    23,
    23,
    23,
    23,
  ];
  Object.entries(overrides).forEach(([index, value]) => {
    values[Number(index)] = value;
  });
  return values;
}

function workbookBuffer(
  rows: Array<Array<string | number>>,
  sheetName = "Table1",
) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    sheetName,
  );
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
}

describe("parser AGEA/SIFEAD osservato", () => {
  it("valida header dinamici, fondi, decimali e placeholder 23 senza usare floating point per le decisioni", () => {
    const parsed = parseAgeaWorkbook(workbookBuffer([row()]));
    expect(parsed).toMatchObject({
      sheetName: "Table1",
      dataRiferimento: "2026-08-20",
      counts: { total: 1, carichi: 1, distribuzioni: 0, resi: 0 },
    });
    expect(parsed.rows[0]).toMatchObject({
      fondoNormalizzato: "FSE_PLUS",
      prodottoNormalizzato: "PASTA DI SEMOLA 500 G",
      lottoNormalizzato: "LOT 01",
      movimentoKgLt: "5.500000",
      movimentoPezzi: "10.000000",
      dataCaricoRisolta: "2026-08-20",
      dataCaricoFonte: "DATA_DOCUMENTO_FALLBACK",
      noteRaw: "23",
      warningCodes: expect.arrayContaining([
        "PLACEHOLDER_23_OSSERVATO",
        "DATA_DOCUMENTO_FALLBACK",
      ]),
    });
    expect(parseAgeaDate(23)).toBeNull();
  });

  it("classifica distribuzione, reso, negativo ignoto, segni incoerenti e zero", () => {
    const parsed = parseAgeaWorkbook(
      workbookBuffer([
        row({ 8: "Distribuzione indigenti", 9: -1, 10: -2, 14: "Pacchi" }),
        row({ 4: "DOC-2", 8: "Reso: deposito", 9: -1, 10: -2 }),
        row({ 4: "DOC-3", 8: "Altro", 9: -1, 10: -2 }),
        row({ 4: "DOC-4", 9: 1, 10: -2 }),
        row({ 4: "DOC-5", 9: 0, 10: 0 }),
      ]),
    );
    expect(parsed.rows.map((item) => item.tipoMovimentoEsterno)).toEqual([
      "DISTRIBUZIONE",
      "RESO",
      "MOVIMENTO_NEGATIVO_NON_CLASSIFICATO",
      "SEGNO_INCOERENTE",
      "RIGA_SENZA_MOVIMENTO",
    ]);
    expect(parsed.rows[3]).toMatchObject({ blocking: true });
  });

  it("produce identity key stabili rispetto all'ordine delle righe distinguendo i content hash", () => {
    const first = parseAgeaWorkbook(
      workbookBuffer([row({ 9: 1, 10: 2 }), row({ 9: 2, 10: 4 })]),
    );
    const reversed = parseAgeaWorkbook(
      workbookBuffer([row({ 9: 2, 10: 4 }), row({ 9: 1, 10: 2 })]),
    );
    expect(
      first.rows.map((item) => [item.contentHash, item.identityKey]).sort(),
    ).toEqual(
      reversed.rows.map((item) => [item.contentHash, item.identityKey]).sort(),
    );
  });

  it("rifiuta firma non ZIP e Fondo non riconosciuto come blocking", () => {
    expect(() => parseAgeaWorkbook(Buffer.from("not-xlsx"))).toThrowError(
      expect.objectContaining<Partial<AgeaParserError>>({
        code: "FIRMA_XLSX_NON_VALIDA",
      }),
    );
    const parsed = parseAgeaWorkbook(
      workbookBuffer([row({ 0: "Fondo ignoto" })]),
    );
    expect(parsed.rows[0]).toMatchObject({
      fondoNormalizzato: null,
      blocking: true,
      errorCodes: ["FONDO_NON_RICONOSCIUTO"],
    });
  });

  it("preferisce Table1 fra più fogli validi e usa il cached value delle formule senza valutarle", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([headers, row({ 4: "OTHER" })]),
      "Altro",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([headers, row({ 4: "TABLE1" })]),
      "Table1",
    );
    expect(
      parseAgeaWorkbook(
        Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
      ).rows[0].numeroDocumentoRaw,
    ).toBe("TABLE1");

    const formulaWorkbook = XLSX.utils.book_new();
    const formulaSheet = XLSX.utils.aoa_to_sheet([headers, row()]);
    formulaSheet.J2 = { t: "n", f: "1+1", v: 5.5 };
    XLSX.utils.book_append_sheet(formulaWorkbook, formulaSheet, "Table1");
    const formulaParsed = parseAgeaWorkbook(
      Buffer.from(
        XLSX.write(formulaWorkbook, { type: "buffer", bookType: "xlsx" }),
      ),
    );
    expect(formulaParsed.rows[0].movimentoKgLt).toBe("5.500000");
  });
});

const acceptancePath = process.env.AGEA_ACCEPTANCE_XLSX;

describe.runIf(Boolean(acceptancePath && existsSync(acceptancePath)))(
  "acceptance sul registro AGEA reale (file esterno al repository)",
  () => {
    it("riproduce gli aggregati osservati senza includere il file nei fixture", () => {
      const parsed = parseAgeaWorkbook(readFileSync(acceptancePath!));
      const parties = new Set(
        parsed.rows.map((item) =>
          [
            item.fondoNormalizzato,
            item.prodottoNormalizzato,
            item.lottoNormalizzato,
          ].join("|"),
        ),
      );
      const positiveParties = new Set(
        parsed.rows
          .filter((item) =>
            [item.saldoFinalePezzi, item.saldoFinaleKgLt].some(
              (value) => value != null && BigInt(value.replace(".", "")) > 0n,
            ),
          )
          .map((item) =>
            [
              item.fondoNormalizzato,
              item.prodottoNormalizzato,
              item.lottoNormalizzato,
            ].join("|"),
          ),
      );
      const documentDates = new Set(
        parsed.rows
          .filter(
            (item) =>
              item.tipoMovimentoEsterno === "CARICO" &&
              item.numeroDocumentoNormalizzato &&
              item.dataDocumento,
          )
          .map(
            (item) =>
              `${item.numeroDocumentoNormalizzato}|${item.dataDocumento}`,
          ),
      );
      expect(parsed.dataRiferimento).toBe("2026-08-20");
      expect(parsed.counts).toEqual({
        total: 239,
        carichi: 80,
        distribuzioni: 158,
        resi: 1,
        nonClassificate: 0,
        bloccanti: 0,
      });
      expect(
        new Set(parsed.rows.map((item) => item.prodottoNormalizzato)).size,
      ).toBe(53);
      expect(parties.size).toBe(79);
      expect(positiveParties.size).toBe(7);
      expect(
        new Set(parsed.rows.map((item) => item.fondoNormalizzato)).size,
      ).toBe(3);
      expect(documentDates.size).toBe(19);
    });
  },
);
