import * as XLSX from "xlsx";

export function massivoFixture(
  overrides: Record<string, unknown> = {},
  options: {
    duplicateHeader?: boolean;
    missingHeader?: boolean;
    date1904?: boolean;
  } = {},
) {
  const values: Record<string, unknown> = {
    CodiceFascicolo: "MASS-TEST",
    DataPresaInCarico: "20/10/2026",
    NomeReferenteNucleoFamiliare: "Persona",
    CognomeReferenteNucleoFamiliare: "Massiva",
    CodiceFiscaleReferenteNucleo: "RSSMRA90A01H501U",
    DataDiNascitaReferenteNucleoFamiliare: "01/01/1990",
    SessoReferenteNucleoFamiliare: "Donna",
    TipologiaDiSupporto: "P",
    StatoFascicolo: "Attivo",
    TotaleDonne: 2,
    TotaleUomini: 1,
    TotaleMinore18: 1,
    "Totale18-29": 0,
    "Totale30-64": 1,
    TotaleMaggioreUguale65: 1,
    TotaleStranieriMinoranze: 0,
    TotaleDisabili: 1,
    TotaleCittadiniPaesiTerzi: 0,
    TotaleSenzaTetto: 0,
    ...overrides,
  };
  const headers = Object.keys(values).filter(
    (key) => !options.missingHeader || key !== "TotaleMinore18",
  );
  if (options.duplicateHeader) headers.push(headers[0]);
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [],
    ["Configuratore"],
    [],
    [],
    [],
    [],
    [],
    headers,
    headers.map((key) => values[key]),
  ]);
  sheet.Z25000 = { t: "s", v: "Solo formula tecnica / nessuna identità" };
  sheet["!ref"] = `A1:Z25000`;
  XLSX.utils.book_append_sheet(book, sheet, "Configuratore file csv");
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["valori tecnici"]]),
    "Dati",
  );
  book.Workbook = {
    Sheets: [
      { name: "Configuratore file csv", Hidden: 0 },
      { name: "Dati", Hidden: 1 },
    ],
    WBProps: { date1904: options.date1904 ?? false },
  };
  return XLSX.write(book, { type: "buffer", bookType: "xlsm" }) as Buffer;
}
