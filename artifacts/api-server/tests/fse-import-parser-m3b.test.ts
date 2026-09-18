/* @vitest-environment node */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  detectFseFileFormat,
  parseFseDate,
  parseFseFile,
} from "../src/lib/fseImportParser";
import { AGEA_MAX_BYTES } from "../src/lib/ageaSifeadParser";

const registryHeaders = [
  "Fondo",
  "Prodotto",
  "Giacenza al 17/09/2026 Pezzi",
  "Giacenza al 17/09/2026 KgLt",
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

const stockHeaders = [
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
];

const originalRegistryPath = process.env.FSE_REGISTRY_ORIGINAL_PATH;
const originalStockPath = process.env.FSE_STOCK_ORIGINAL_PATH;
const originalsAvailable = Boolean(originalRegistryPath && originalStockPath);

function workbook(
  headers: string[],
  rows: unknown[][],
  bookType: "xlsx" | "biff8" = "xlsx",
) {
  const value = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    value,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    "Dati esportati",
  );
  return Buffer.from(XLSX.write(value, { type: "buffer", bookType }));
}

function registryRow(document = "DOC-1", quantity = 53) {
  return [
    "Fondo Nazionale",
    "Salame test",
    53,
    17.04586,
    document,
    "17/09/2026",
    "",
    "006544",
    "Organizzazione ricevente",
    17.04586,
    quantity,
    53,
    17.04586,
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

describe("parser FSE+/AGEA M3B", () => {
  it("riconosce il Registro XLSX per intestazione e conserva lotto, data esterna e fallback", () => {
    const parsed = parseFseFile(workbook(registryHeaders, [registryRow()]), {
      profile: "REGISTRO",
    });
    expect(parsed).toMatchObject({
      format: "XLSX",
      profile: "REGISTRO",
      sheetName: "Dati esportati",
      dataRiferimento: "2026-09-17",
    });
    expect(parsed.registryRows[0]).toMatchObject({
      lottoRaw: "006544",
      lottoNormalizzato: "006544",
      dataDocumento: "2026-09-17",
      dataCaricoMagazzinoRaw: null,
      dataCaricoFonte: "DATA_DOCUMENTO_FALLBACK",
      movimentoPezzi: "53.000000",
      movimentoKgLt: "17.045860",
    });
  });

  it("supporta un vero XLS binario e non lo confonde con un XLSX rinominato", () => {
    const binary = workbook(registryHeaders, [registryRow()], "biff8");
    expect(detectFseFileFormat(binary)).toBe("XLS");
    expect(
      parseFseFile(binary, { profile: "REGISTRO" }).registryRows,
    ).toHaveLength(1);
    expect(
      detectFseFileFormat(workbook(registryHeaders, [registryRow()])),
    ).toBe("XLSX");
  });

  it("legge CSV UTF-8 con BOM, punto e virgola, virgola decimale, quote e testo multilinea", () => {
    const escaped = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const row = registryRow().map(String);
    row[9] = "17,04586";
    row[13] = "nota, con virgola\ne seconda riga";
    const csv = `\uFEFF${registryHeaders.map(escaped).join(";")}\n${row.map(escaped).join(";")}\n`;
    const parsed = parseFseFile(Buffer.from(csv, "utf8"), {
      profile: "REGISTRO",
    });
    expect(parsed.format).toBe("CSV");
    expect(parsed.registryRows[0]).toMatchObject({
      movimentoKgLt: "17.045860",
      noteRaw: "nota, con virgola\ne seconda riga",
    });
  });

  it("riconosce Giacenze 15 colonne senza esporre CodiceAccesso nel modello operativo", () => {
    const expirySerial = XLSX.SSF.parse_date_code(46738) ? 46738 : 46738;
    const parsed = parseFseFile(
      workbook(stockHeaders, [
        [
          "OpN",
          "OpC",
          "OpT",
          "segreto-di-test",
          "Fondo Nazionale",
          "Salame test",
          "006544",
          "0,321620",
          "Kg",
          "17,04586",
          53,
          40,
          1,
          false,
          expirySerial,
        ],
      ]),
      { profile: "GIACENZE", referenceDate: "2026-09-17" },
    );
    expect(parsed.stockRows[0]).toMatchObject({
      lottoRaw: "006544",
      pesoUnita: "0.321620",
      giacenzaPesoVolume: "17.045860",
      giacenzaPezzi: "53.000000",
    });
    expect(parsed.stockRows[0]).not.toHaveProperty("codiceAccesso");
  });

  it("mantiene identità semantica quando cambiano ordine, quantità di riepilogo e data export", () => {
    const first = parseFseFile(
      workbook(registryHeaders, [registryRow("DOC-A"), registryRow("DOC-B")]),
      { profile: "REGISTRO" },
    );
    const laterHeaders = registryHeaders.map((header) =>
      header.replace("17/09/2026", "18/09/2026"),
    );
    const secondRows = [registryRow("DOC-B"), registryRow("DOC-A")];
    secondRows.forEach((row) => {
      row[2] = 999;
      row[3] = 888;
      row[11] = 777;
      row[12] = 666;
    });
    const second = parseFseFile(workbook(laterHeaders, secondRows), {
      profile: "REGISTRO",
    });
    const identities = (rows: typeof first.registryRows) =>
      rows.map((row) => [row.numeroDocumentoRaw, row.identityKey]).sort();
    expect(identities(second.registryRows)).toEqual(
      identities(first.registryRows),
    );
  });

  it("segnala la molteplicità indistinguibile senza assegnare occurrence instabili", () => {
    const parsed = parseFseFile(
      workbook(registryHeaders, [registryRow(), registryRow()]),
      { profile: "REGISTRO" },
    );
    expect(parsed.registryRows).toHaveLength(2);
    expect(parsed.registryRows.every((row) => row.blocking)).toBe(true);
    expect(parsed.registryRows[0].errorCodes).toContain("MOLTEPLICITA_AMBIGUA");
    expect(parsed.registryRows[0].identityKey).toBe(
      parsed.registryRows[1].identityKey,
    );
  });

  it("gestisce date italiane, ISO, seriali 1900/1904 e rifiuta date americane", () => {
    expect(parseFseDate("17/09/2026")).toBe("2026-09-17");
    expect(parseFseDate("2026-09-17")).toBe("2026-09-17");
    expect(parseFseDate("09/17/2026")).toBeNull();
    expect(parseFseDate("31/02/2026")).toBeNull();
    expect(parseFseDate(1, { date1904: true })).toBe("1904-01-02");
  });

  it("preserva il sistema date 1904 anche nel profilo Registro", () => {
    const value = XLSX.utils.book_new();
    value.Workbook = { WBProps: { date1904: true } };
    const row = registryRow();
    row[5] = 1;
    XLSX.utils.book_append_sheet(
      value,
      XLSX.utils.aoa_to_sheet([registryHeaders, row]),
      "Registro 1904",
    );
    const parsed = parseFseFile(
      Buffer.from(XLSX.write(value, { type: "buffer", bookType: "xlsx" })),
      { profile: "REGISTRO" },
    );
    expect(parsed.registryRows[0].dataDocumento).toBe("1904-01-02");
  });

  it("richiede la scelta esplicita quando più fogli hanno lo stesso profilo", () => {
    const value = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      value,
      XLSX.utils.aoa_to_sheet([registryHeaders, registryRow("DOC-A")]),
      "Primo",
    );
    XLSX.utils.book_append_sheet(
      value,
      XLSX.utils.aoa_to_sheet([registryHeaders, registryRow("DOC-B")]),
      "Secondo",
    );
    const bytes = Buffer.from(
      XLSX.write(value, { type: "buffer", bookType: "xlsx" }),
    );
    expect(() => parseFseFile(bytes, { profile: "REGISTRO" })).toThrow(
      /scegliere esplicitamente/i,
    );
    expect(
      parseFseFile(bytes, { profile: "REGISTRO", sheetName: "Secondo" })
        .registryRows[0].numeroDocumentoRaw,
    ).toBe("DOC-B");
  });

  it("rifiuta file corrotti, oltre limite e contenuti CSV attivi", () => {
    expect(() =>
      parseFseFile(Buffer.from("PK\u0003\u0004corrotto"), {
        profile: "REGISTRO",
      }),
    ).toThrow(/leggibile|riconosciuto|zip/i);
    expect(() => detectFseFileFormat(Buffer.alloc(AGEA_MAX_BYTES + 1))).toThrow(
      /compreso|10 MB/i,
    );

    const row = registryRow().map(String);
    row[13] = '=HYPERLINK("https://invalid.example")';
    const csv = `${registryHeaders.join(";")}\n${row.join(";")}\n`;
    expect(() =>
      parseFseFile(Buffer.from(csv), { profile: "REGISTRO" }),
    ).toThrow(/contenuto attivo/i);
  });

  it.runIf(originalsAvailable)(
    "T01/T04/T06 legge i due originali e ricalcola profili, movimenti e sette saldi",
    () => {
      const registryBytes = readFileSync(originalRegistryPath!);
      const stockBytes = readFileSync(originalStockPath!);
      expect(createHash("sha256").update(registryBytes).digest("hex")).toBe(
        "4e4b8ba724a35cb048d42070299c34b3ecfe673206390c8fde2d67c20488c901",
      );
      expect(createHash("sha256").update(stockBytes).digest("hex")).toBe(
        "e1b4ab9c0b647adb0f3fb48bb4f0f76b493aee005933cb0a223a3218cba554de",
      );
      const registryWorkbook = XLSX.read(registryBytes, { type: "buffer" });
      const stockWorkbook = XLSX.read(stockBytes, { type: "buffer" });
      expect(registryWorkbook.SheetNames).toContain("Table1");
      expect(stockWorkbook.SheetNames).toContain("Table1");
      expect(registryWorkbook.Sheets.Table1["!ref"]).toBe("A1:S240");
      expect(stockWorkbook.Sheets.Table1["!ref"]).toBe("A1:O8");

      const registry = parseFseFile(registryBytes, { profile: "REGISTRO" });
      const stock = parseFseFile(stockBytes, {
        profile: "GIACENZE",
        referenceDate: "2026-09-17",
      });
      const loads = registry.registryRows.filter(
        (row) => row.tipoMovimentoEsterno === "CARICO",
      );
      const distributions = registry.registryRows.filter(
        (row) => row.tipoMovimentoEsterno === "DISTRIBUZIONE",
      );
      const returns = registry.registryRows.filter(
        (row) => row.tipoMovimentoEsterno === "RESO",
      );
      const sumPieces = (rows: typeof registry.registryRows) =>
        rows.reduce((total, row) => total + Number(row.movimentoPezzi ?? 0), 0);
      expect(registry).toMatchObject({
        format: "XLSX",
        profile: "REGISTRO",
        sheetName: "Table1",
        dataRiferimento: "2026-09-17",
      });
      expect(registry.registryRows).toHaveLength(239);
      expect(loads).toHaveLength(80);
      expect(distributions).toHaveLength(158);
      expect(returns).toHaveLength(1);
      expect(sumPieces(loads)).toBe(24_216);
      expect(sumPieces([...distributions, ...returns])).toBe(-23_039);
      expect(
        registry.registryRows.filter((row) => row.dataDocumento),
      ).toHaveLength(239);
      expect(
        registry.registryRows.filter((row) => row.dataCaricoMagazzinoRaw),
      ).toHaveLength(0);
      expect(
        new Set(registry.registryRows.map((row) => row.fondoNormalizzato)),
      ).toEqual(
        new Set([
          "FSE_PLUS",
          "FONDO_NAZIONALE",
          "FONDO_NAZIONALE_COFINANZIATO",
        ]),
      );

      expect(stock).toMatchObject({
        format: "XLSX",
        profile: "GIACENZE",
        sheetName: "Table1",
      });
      expect(stock.stockRows).toHaveLength(7);
      expect(
        stock.stockRows.reduce(
          (total, row) => total + Number(row.giacenzaPezzi ?? 0),
          0,
        ),
      ).toBe(1_177);
      expect(
        stock.stockRows.map((row) => ({
          lot: row.lottoRaw,
          pieces: row.giacenzaPezzi,
          weight: row.giacenzaPesoVolume,
          factor: row.pesoUnita,
          expiry: row.dataScadenza,
        })),
      ).toEqual([
        {
          lot: "25332L3P02",
          pieces: "384.000000",
          weight: "30.720000",
          factor: "0.080000",
          expiry: "2027-12-31",
        },
        {
          lot: "LB111456",
          pieces: "274.000000",
          weight: "137.000000",
          factor: "0.500000",
          expiry: "2028-05-25",
        },
        {
          lot: "LA081316",
          pieces: "200.000000",
          weight: "100.000000",
          factor: "0.500000",
          expiry: "2028-05-11",
        },
        {
          lot: "LB111426",
          pieces: "26.000000",
          weight: "13.000000",
          factor: "0.500000",
          expiry: "2028-05-22",
        },
        {
          lot: "L154642",
          pieces: "160.000000",
          weight: "160.000000",
          factor: "1.000000",
          expiry: "2026-12-30",
        },
        {
          lot: "7829294",
          pieces: "80.000000",
          weight: "80.000000",
          factor: "1.000000",
          expiry: "2028-05-21",
        },
        {
          lot: "006544",
          pieces: "53.000000",
          weight: "17.045860",
          factor: "0.321620",
          expiry: "2026-11-08",
        },
      ]);
    },
  );
});
