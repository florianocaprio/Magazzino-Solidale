import * as XLSX from "xlsx";
import { isDateOnly } from "./volontariDomain";

export const VOLONTARI_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const VOLONTARI_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const VOLONTARI_HISTORICAL_HEADERS = [
  "N°",
  "Codice",
  "Cognome e Nome",
  "Città di Nascita",
  "Data N.",
  "Indirizzo di Residenza",
  "Cod. Fiscale",
  "Da Data",
  "A Data",
  "Cellulare",
  "Telefono",
  "Email",
  "Gruppo",
  "Categoria",
] as const;
export const VOLONTARI_EXTENDED_OPTIONAL_HEADERS = [
  "Tipo volontario",
  "Data servizio",
] as const;

export class VolontariWorkbookError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function dateFromUnknown(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const text = String(value).trim();
  if (isDateOnly(text)) return text;
  const match = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(text);
  if (match) {
    const result = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    return isDateOnly(result) ? result : null;
  }
  return null;
}

function cellText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export type ParsedVolunteerImportRow = {
  numeroRiga: number;
  originale: Record<string, unknown>;
  codice: string | null;
  nominativo: string | null;
  luogoNascita: string | null;
  dataNascita: string | null;
  indirizzoResidenza: string | null;
  codiceFiscale: string | null;
  dataInizioImportata: string | null;
  scadenzaAssicurazione: string | null;
  cellulare: string | null;
  telefono: string | null;
  email: string | null;
  gruppo: string | null;
  categoria: string | null;
  tipoVolontario: string | null;
  dataServizio: string | null;
  errori: string[];
};

export function parseVolontariWorkbook(buffer: Buffer): {
  sheetName: string;
  headers: string[];
  rows: ParsedVolunteerImportRow[];
} {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new VolontariWorkbookError("FIRMA_XLSX_NON_VALIDA", "Il file non è un workbook XLSX valido.");
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellFormula: false });
  } catch {
    throw new VolontariWorkbookError("XLSX_NON_LEGGIBILE", "Il workbook XLSX non è leggibile.");
  }
  if ((workbook as XLSX.WorkBook & { vbaraw?: unknown }).vbaraw) {
    throw new VolontariWorkbookError("MACRO_NON_AMMESSE", "I workbook con macro non sono ammessi.");
  }
  if (workbook.SheetNames.length !== 1) {
    throw new VolontariWorkbookError("FOGLI_NON_VALIDI", "Il workbook deve contenere un solo foglio.");
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new VolontariWorkbookError("FOGLIO_MANCANTE", "Il workbook non contiene righe leggibili.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headers = (matrix[0] ?? []).map((value) => String(value ?? "").trim());
  const missing = VOLONTARI_HISTORICAL_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new VolontariWorkbookError(
      "INTESTAZIONI_NON_VALIDE",
      `Intestazioni mancanti: ${missing.join(", ")}.`,
    );
  }
  const index = new Map(headers.map((header, position) => [header, position]));
  const rows = matrix.slice(1).flatMap((values, offset) => {
    if (values.every((value) => value == null || String(value).trim() === "")) return [];
    const get = (header: string) => values[index.get(header) ?? -1];
    const originale = Object.fromEntries(headers.map((header, position) => [header, values[position] ?? null]));
    const dataNascitaRaw = get("Data N.");
    const dataInizioRaw = get("Da Data");
    const scadenzaRaw = get("A Data");
    const servizioRaw = get("Data servizio");
    const dataNascita = dateFromUnknown(dataNascitaRaw);
    const dataInizioImportata = dateFromUnknown(dataInizioRaw);
    const scadenzaAssicurazione = dateFromUnknown(scadenzaRaw);
    const dataServizio = dateFromUnknown(servizioRaw);
    const errori: string[] = [];
    if (dataNascitaRaw != null && !dataNascita) errori.push("Data di nascita non valida");
    if (dataInizioRaw != null && !dataInizioImportata) errori.push("Da Data non valida");
    if (scadenzaRaw != null && !scadenzaAssicurazione) errori.push("A Data/scadenza assicurativa non valida");
    if (servizioRaw != null && !dataServizio) errori.push("Data servizio non valida");
    return [{
      numeroRiga: offset + 2,
      originale,
      codice: cellText(get("Codice")),
      nominativo: cellText(get("Cognome e Nome")),
      luogoNascita: cellText(get("Città di Nascita")),
      dataNascita,
      indirizzoResidenza: cellText(get("Indirizzo di Residenza")),
      codiceFiscale: cellText(get("Cod. Fiscale")),
      dataInizioImportata,
      scadenzaAssicurazione,
      cellulare: cellText(get("Cellulare")),
      telefono: cellText(get("Telefono")),
      email: cellText(get("Email")),
      gruppo: cellText(get("Gruppo")),
      categoria: cellText(get("Categoria")),
      tipoVolontario: cellText(get("Tipo volontario")),
      dataServizio,
      errori,
    } satisfies ParsedVolunteerImportRow];
  });
  if (!rows.length) throw new VolontariWorkbookError("NESSUNA_RIGA", "Il workbook non contiene volontari da analizzare.");
  if (rows.length > 2_000) throw new VolontariWorkbookError("TROPPE_RIGHE", "Il workbook supera il limite di 2.000 righe.");
  return { sheetName, headers, rows };
}

function workbookFromRows(headers: string[], rows: Array<Record<string, unknown>>, sheetName: string): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers, cellDates: false });
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address] as XLSX.CellObject;
    if (cell.v != null && typeof cell.v !== "string") continue;
    cell.t = "s";
    cell.z = "@";
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildHistoricalVolunteerWorkbook(rows: Array<Record<string, unknown>>): Buffer {
  return workbookFromRows([...VOLONTARI_HISTORICAL_HEADERS], rows, "Registro volontari");
}

export function buildExtendedVolunteerWorkbook(rows: Array<Record<string, unknown>>): Buffer {
  const headers = [
    "Codice",
    "Cognome",
    "Nome",
    "Tipo volontario",
    "Stato operativo",
    "Motivo non operativo",
    "Approvazione",
    "Ruolo",
    "Gruppo/Centro",
    "Scadenza assicurazione",
    "Corsi in scadenza",
    "Qualifiche in scadenza",
  ];
  return workbookFromRows(headers, rows, "Elenco operativo");
}
