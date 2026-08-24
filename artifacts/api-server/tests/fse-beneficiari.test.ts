import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { beneficiariTable, nucleoFamiliareTable } from "@workspace/db";
import {
  buildFseBeneficiariWorkbook,
  calcolaDemografiaNucleo,
  confrontaDemografia,
  FSE_BENEFICIARI_HEADERS,
  mapActiveToFseState,
  mapDeliveryToFseActivity,
  mapFseActivityToDelivery,
  mapFseStateToActive,
  normalizeFseCode,
  parseFseBeneficiariWorkbook,
  parseFseDate,
  validateFseHeaders,
  validateFseRows,
} from "../src/lib/fseBeneficiari";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    "Nome Referente fascicolo": "Persona",
    "Cognome Referente fascicolo": "Test",
    "Codice fascicolo": " FSE-AbC ",
    "Data di presa in carico": "24/08/2026",
    "Numero componenti fascicolo": 1,
    "Tipologia di Attività": "Pacchi",
    "Stato attuale": "Attivo",
    Donne: 0,
    Uomini: 1,
    "Età<18": 0,
    "Età 18-29": 0,
    "Età 30-64": 1,
    "Età>=65": 0,
    "Origine straniera e minoranze": 0,
    Disabili: 0,
    "Cittadini di Paesi Terzi": 0,
    "Senzatetto o colpiti da esclusione abitativa": 0,
    ...overrides,
  };
}

function exportedRow() {
  const row = Object.fromEntries(FSE_BENEFICIARI_HEADERS.map((header) => [header, 0])) as
    Record<(typeof FSE_BENEFICIARI_HEADERS)[number], string | number | Date>;
  row[FSE_BENEFICIARI_HEADERS[0]] = "Persona";
  row[FSE_BENEFICIARI_HEADERS[1]] = "Test";
  row[FSE_BENEFICIARI_HEADERS[2]] = "ABC";
  row[FSE_BENEFICIARI_HEADERS[3]] = new Date("2026-08-24T12:00:00Z");
  row[FSE_BENEFICIARI_HEADERS[4]] = 1;
  row[FSE_BENEFICIARI_HEADERS[5]] = "Pacchi";
  row[FSE_BENEFICIARI_HEADERS[6]] = "Attivo";
  row[FSE_BENEFICIARI_HEADERS[8]] = 1;
  row[FSE_BENEFICIARI_HEADERS[11]] = 1;
  return row;
}

describe("contratto Beneficiari FSE+", () => {
  it("richiede i 17 header nello stesso ordine", () => {
    expect(validateFseHeaders([...FSE_BENEFICIARI_HEADERS]).errori).toEqual([]);
    const reversed = [...FSE_BENEFICIARI_HEADERS];
    [reversed[0], reversed[1]] = [reversed[1], reversed[0]];
    expect(validateFseHeaders(reversed).errori).toHaveLength(2);
  });

  it("rifiuta header mancante o duplicato e segnala extra finali", () => {
    expect(validateFseHeaders(FSE_BENEFICIARI_HEADERS.slice(1)).errori.length).toBeGreaterThan(0);
    expect(validateFseHeaders([...FSE_BENEFICIARI_HEADERS, FSE_BENEFICIARI_HEADERS[0]]).errori.join(" ")).toContain("duplicata");
    expect(validateFseHeaders([...FSE_BENEFICIARI_HEADERS, "Extra"]).warning).toEqual(["Colonna extra ignorata: Extra."]);
  });

  it("normalizza il codice soltanto per confronto", () => {
    expect(normalizeFseCode(" FSE-AbC ")).toBe("fse-abc");
  });

  it.each([
    ["24/08/2026", "2026-08-24"],
    ["2026-08-24", "2026-08-24"],
    [46258, "2026-08-24"],
    ["31/02/2026", null],
  ])("interpreta date italiane, ISO ed Excel %#", (input, expected) => {
    expect(parseFseDate(input)).toBe(expected);
  });

  it("accetta numeri interi memorizzati come stringhe", () => {
    const [result] = validateFseRows([validRow({
      "Numero componenti fascicolo": "1",
      Donne: "0",
      Uomini: "1",
      "Età<18": "0",
      "Età 18-29": "0",
      "Età 30-64": "1",
      "Età>=65": "0",
      "Origine straniera e minoranze": "0",
      Disabili: "0",
      "Cittadini di Paesi Terzi": "0",
      "Senzatetto o colpiti da esclusione abitativa": "0",
    })]);
    expect(result.errori).toEqual([]);
  });

  it.each([
    [{ "Codice fascicolo": "" }, "Codice fascicolo obbligatorio"],
    [{ Donne: 1 }, "Donne + Uomini"],
    [{ "Età<18": -1, "Età 30-64": 2 }, "atteso intero"],
    [{ "Età 30-64": 1.5 }, "atteso intero"],
    [{ Disabili: 2 }, "atteso intero"],
    [{ "Origine straniera e minoranze": "" }, "valore obbligatorio"],
    [{ "Data di presa in carico": "31/02/2026" }, "Data di presa in carico"],
    [{ "Tipologia di Attività": "Altro" }, "Tipologia attività"],
    [{ "Stato attuale": "Chiuso" }, "Stato FSE+"],
  ])("rifiuta righe non conformi %#", (override, message) => {
    expect(validateFseRows([validRow(override)])[0].errori.join(" ")).toContain(message);
  });

  it("rileva codici duplicati case-insensitive", () => {
    const rows = validateFseRows([validRow(), validRow({ "Codice fascicolo": "fse-abc" })]);
    expect(rows[1].errori).toContain("Codice fascicolo duplicato nel file.");
  });

  it("centralizza i mapping Pacchi, Domiciliare e Attivo", () => {
    expect(mapFseActivityToDelivery("Pacchi")).toBe(false);
    expect(mapFseActivityToDelivery("Domiciliare")).toBe(true);
    expect(mapFseActivityToDelivery("Altro")).toBeNull();
    expect(mapDeliveryToFseActivity(false)).toBe("Pacchi");
    expect(mapDeliveryToFseActivity(true)).toBe("Domiciliare");
    expect(mapFseStateToActive("Attivo")).toBe(true);
    expect(mapFseStateToActive("Chiuso")).toBeNull();
    expect(mapActiveToFseState(true)).toBe("Attivo");
    expect(mapActiveToFseState(false)).toBeNull();
  });

  it("calcola un nucleo misto di cinque persone", () => {
    const beneficiary = { numComponenti: 5, dataNascita: "1961-05-15", sesso: "F" };
    const members = [
      { dataNascita: "2010-01-01", sesso: "M" },
      { dataNascita: "2000-01-01", sesso: "F" },
      { dataNascita: "1980-01-01", sesso: "M" },
      { dataNascita: "1950-01-01", sesso: "F" },
    ];
    expect(calcolaDemografiaNucleo(
      beneficiary,
      members,
      new Date("2026-05-14T12:00:00Z"),
    )).toMatchObject({
      numeroComponenti: 5,
      donne: 3,
      uomini: 2,
      eta017: 1,
      eta1829: 1,
      eta3064: 2,
      eta65Plus: 1,
      dettaglioCompleto: true,
    });
  });

  it.each([
    ["2008-08-25", "2026-08-24T12:00:00Z", "2026-08-25T12:00:00Z", "eta017", "eta1829"],
    ["1996-08-25", "2026-08-24T12:00:00Z", "2026-08-25T12:00:00Z", "eta1829", "eta3064"],
    ["1961-08-25", "2026-08-24T12:00:00Z", "2026-08-25T12:00:00Z", "eta3064", "eta65Plus"],
  ])("cambia fascia al compleanno senza persistenza %#", (birth, beforeDate, afterDate, beforeKey, afterKey) => {
    const person = { numComponenti: 1, dataNascita: birth, sesso: "F" };
    const before = calcolaDemografiaNucleo(person, [], new Date(beforeDate));
    const after = calcolaDemografiaNucleo(person, [], new Date(afterDate));
    expect(before[beforeKey as keyof typeof before]).toBe(1);
    expect(after[afterKey as keyof typeof after]).toBe(1);
  });

  it("applica Europe/Rome anche sul cambio di giorno UTC", () => {
    const person = { numComponenti: 1, dataNascita: "2008-08-25", sesso: "M" };
    expect(calcolaDemografiaNucleo(person, [], new Date("2026-08-24T21:59:59Z")).eta017).toBe(1);
    expect(calcolaDemografiaNucleo(person, [], new Date("2026-08-24T22:00:00Z")).eta1829).toBe(1);
  });

  it("usa una data storica di riferimento", () => {
    const person = { numComponenti: 1, dataNascita: "1961-05-15", sesso: "F" };
    expect(calcolaDemografiaNucleo(person, [], new Date("2025-12-31T12:00:00Z")).eta3064).toBe(1);
    expect(calcolaDemografiaNucleo(person, [], new Date("2026-12-31T12:00:00Z")).eta65Plus).toBe(1);
  });

  it("usa uno snapshot coerente senza creare persone fittizie", () => {
    const snapshot = { numeroComponenti: 3, donne: 2, uomini: 1, eta017: 1, eta1829: 0, eta3064: 2, eta65Plus: 0 };
    expect(calcolaDemografiaNucleo(
      { numComponenti: 3, dataNascita: null, sesso: null },
      [],
      new Date(),
      snapshot,
    )).toMatchObject({ ...snapshot, origine: "snapshot_fse", dettaglioCompleto: false });
  });

  it("non usa uno snapshot incoerente come fallback", () => {
    const snapshot = { numeroComponenti: 3, donne: 3, uomini: 1, eta017: 1, eta1829: 0, eta3064: 2, eta65Plus: 0 };
    const result = calcolaDemografiaNucleo(
      { numComponenti: 3, dataNascita: null, sesso: null },
      [],
      new Date(),
      snapshot,
    );
    expect(result.origine).toBe("anagrafica_calcolata");
    expect(result.problemi).toContain("SNAPSHOT_SESSO_NON_ALLINEATO");
  });

  it("confronta snapshot e anagrafica completa evidenziando le differenze", () => {
    const calculated = calcolaDemografiaNucleo(
      { numComponenti: 1, dataNascita: "1990-01-01", sesso: "F" },
      [],
      new Date("2026-08-24T12:00:00Z"),
    );
    const comparison = confrontaDemografia({
      numeroComponenti: 1,
      donne: 0,
      uomini: 1,
      eta017: 0,
      eta1829: 0,
      eta3064: 1,
      eta65Plus: 0,
    }, calculated);
    expect(comparison.stato).toBe("non_allineato");
    expect(comparison.differenze.map((difference) => difference.dato)).toEqual(["Donne", "Uomini"]);
  });

  it("non persiste fascia corrente né fascia presunta sui familiari", () => {
    expect("fasciaEtaCorrente" in beneficiariTable).toBe(false);
    expect("fasciaEtaCorrente" in nucleoFamiliareTable).toBe(false);
    expect("fasciaEtaPresunta" in nucleoFamiliareTable).toBe(false);
  });

  it("esporta Table1 con 17 colonne, ordine canonico e una vera cella data", () => {
    const workbook = XLSX.read(
      buildFseBeneficiariWorkbook([exportedRow()]),
      { type: "buffer", cellDates: true },
    );
    expect(workbook.SheetNames).toEqual(["Table1"]);
    const sheet = workbook.Sheets.Table1!;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })[0]).toEqual([...FSE_BENEFICIARI_HEADERS]);
    expect(sheet.D2.t).toBe("d");
    expect(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0]).toHaveLength(17);
  });

  it("copre il round-trip export → parser senza colonne proprietarie", () => {
    const parsed = parseFseBeneficiariWorkbook(buildFseBeneficiariWorkbook([exportedRow()]));
    expect(parsed.sheetNames).toEqual(["Table1"]);
    expect(parsed.header.errori).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].errori).toEqual([]);
    expect(Object.keys(parsed.rawRows[0])).toEqual([...FSE_BENEFICIARI_HEADERS]);
  });
});
