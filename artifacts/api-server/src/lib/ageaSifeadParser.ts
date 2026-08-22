import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { InventoryDecimal, InventoryDecimalError } from "./inventoryDecimal";

export const AGEA_TRACE_CODE = "SIFEAD_REGISTRO_XLSX_OSSERVATO_V1";
export const AGEA_PARSER_VERSION = "2.0B.1";
export const AGEA_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const AGEA_MAX_BYTES = 10 * 1024 * 1024;
export const AGEA_MAX_ROWS = 10_000;
export const AGEA_MAX_COLUMNS = 100;

const STATIC_HEADERS = [
  "Fondo",
  "Prodotto",
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
] as const;

const FUND_MAP: Record<string, string> = {
  "FSE+": "FSE_PLUS",
  "Fondo Nazionale": "FONDO_NAZIONALE",
  "Fondo Nazionale cofinanziato": "FONDO_NAZIONALE_COFINANZIATO",
};

const ACTIVITY_MAP: Record<string, string> = {
  Pacchi: "PACCHI",
  Emporio: "EMPORIO",
  Domiciliare: "DOMICILIARE",
  Mensa: "MENSA",
  Strada: "UDS_STRADA",
};

export class AgeaParserError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type CellValue = string | number | boolean | Date | null | undefined;

export interface ParsedAgeaRow {
  numeroRiga: number;
  rawJson: Record<string, string | null>;
  fondoRaw: string | null;
  fondoNormalizzato: string | null;
  prodottoRaw: string;
  prodottoNormalizzato: string;
  lottoRaw: string | null;
  lottoNormalizzato: string | null;
  numeroDocumentoRaw: string | null;
  numeroDocumentoNormalizzato: string | null;
  dataDocumentoRaw: string | null;
  dataDocumento: string | null;
  dataCaricoMagazzinoRaw: string | null;
  dataCaricoRisolta: string | null;
  dataCaricoFonte: string | null;
  mittenteDestinatarioRaw: string | null;
  movimentoKgLtRaw: string | null;
  movimentoKgLt: string | null;
  movimentoPezziRaw: string | null;
  movimentoPezzi: string | null;
  saldoMovimentoKgLtRaw: string | null;
  saldoMovimentoKgLt: string | null;
  saldoMovimentoPezziRaw: string | null;
  saldoMovimentoPezzi: string | null;
  saldoFinaleKgLtRaw: string | null;
  saldoFinaleKgLt: string | null;
  saldoFinalePezziRaw: string | null;
  saldoFinalePezzi: string | null;
  noteRaw: string | null;
  attivitaRaw: string | null;
  attivitaNormalizzata: string | null;
  pacchiRaw: string | null;
  pastiRaw: string | null;
  saltuariRaw: string | null;
  continuativiRaw: string | null;
  tipoMovimentoEsterno: string;
  identityBaseHash: string;
  identityOccurrence: number;
  identityKey: string;
  contentHash: string;
  statoRiga: string;
  blocking: boolean;
  errorCodes: string[];
  warningCodes: string[];
}

export interface ParsedAgeaWorkbook {
  sheetName: string;
  dataRiferimento: string;
  rows: ParsedAgeaRow[];
  warnings: string[];
  sha256File: string;
  counts: {
    total: number;
    carichi: number;
    distribuzioni: number;
    resi: number;
    nonClassificate: number;
    bloccanti: number;
  };
}

export function normalizeAgeaText(
  value: string | null | undefined,
): string | null {
  const text = value?.normalize("NFC").trim().replace(/\s+/g, " ") ?? "";
  return text || null;
}

export function normalizeAgeaKey(
  value: string | null | undefined,
): string | null {
  return normalizeAgeaText(value)?.toLocaleUpperCase("it-IT") ?? null;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function datePartsToIso(
  day: number,
  month: number,
  year: number,
): string | null {
  if (
    year < 1900 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  )
    return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseAgeaDate(value: CellValue): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return datePartsToIso(
      value.getUTCDate(),
      value.getUTCMonth() + 1,
      value.getUTCFullYear(),
    );
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Nel tracciato osservato il numero 23 è un placeholder, non una data.
    if (value === 23) return null;
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? datePartsToIso(parsed.d, parsed.m, parsed.y) : null;
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match
    ? datePartsToIso(Number(match[1]), Number(match[2]), Number(match[3]))
    : null;
}

function rawText(cell: XLSX.CellObject | undefined): string | null {
  if (!cell || cell.v == null || cell.v === "") return null;
  if (cell.v instanceof Date) {
    return `${String(cell.v.getUTCDate()).padStart(2, "0")}/${String(cell.v.getUTCMonth() + 1).padStart(2, "0")}/${cell.v.getUTCFullYear()}`;
  }
  return String(cell.w ?? cell.v).trim() || null;
}

function decimalText(
  cell: XLSX.CellObject | undefined,
  field: string,
  row: number,
): string | null {
  if (!cell || cell.v == null || cell.v === "") return null;
  const raw =
    typeof cell.v === "number" ? String(cell.v) : String(cell.v).trim();
  if (/[eE]/.test(raw))
    throw new AgeaParserError(
      "DECIMALE_NON_VALIDO",
      `${field} in riga ${row} usa notazione scientifica`,
    );
  try {
    return InventoryDecimal.parse(raw, { allowNegative: true }).toDb();
  } catch (error) {
    if (error instanceof InventoryDecimalError)
      throw new AgeaParserError(
        "DECIMALE_NON_VALIDO",
        `${field} in riga ${row}: ${error.message}`,
      );
    throw error;
  }
}

function cellAt(
  sheet: XLSX.WorkSheet,
  row: number,
  column: number,
): XLSX.CellObject | undefined {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })] as
    | XLSX.CellObject
    | undefined;
}

function validateSheet(
  sheet: XLSX.WorkSheet,
): { dataRiferimento: string; headers: string[]; range: XLSX.Range } | null {
  if (!sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  if (rows > AGEA_MAX_ROWS + 1 || columns > AGEA_MAX_COLUMNS)
    throw new AgeaParserError(
      "LIMITE_TRACCIATO_SUPERATO",
      "Il foglio supera i limiti di 10.000 righe o 100 colonne",
    );
  if (columns !== 19) return null;
  const headers = Array.from(
    { length: columns },
    (_, index) => rawText(cellAt(sheet, range.s.r, range.s.c + index)) ?? "",
  );
  const pieces = /^Giacenza al (\d{2}\/\d{2}\/\d{4}) Pezzi$/.exec(headers[2]);
  const kgLt = /^Giacenza al (\d{2}\/\d{2}\/\d{4}) KgLt$/.exec(headers[3]);
  if (!pieces || !kgLt || pieces[1] !== kgLt[1]) return null;
  const required = [headers[0], headers[1], ...headers.slice(4)];
  if (
    required.length !== STATIC_HEADERS.length ||
    required.some((header, index) => header !== STATIC_HEADERS[index])
  )
    return null;
  const dataRiferimento = parseAgeaDate(pieces[1]);
  return dataRiferimento ? { dataRiferimento, headers, range } : null;
}

function classify(
  pieces: string | null,
  kgLt: string | null,
  destination: string | null,
) {
  const values = [pieces, kgLt]
    .filter((value): value is string => value != null)
    .map((value) => InventoryDecimal.parse(value, { allowNegative: true }));
  const nonZero = values.filter((value) => !value.isZero());
  if (nonZero.length === 0) return "RIGA_SENZA_MOVIMENTO";
  if (nonZero.every((value) => value.isPositive())) return "CARICO";
  if (nonZero.every((value) => value.isNegative())) {
    const normalized = normalizeAgeaKey(destination);
    if (normalized === "DISTRIBUZIONE INDIGENTI") return "DISTRIBUZIONE";
    if (normalized?.startsWith("RESO:")) return "RESO";
    return "MOVIMENTO_NEGATIVO_NON_CLASSIFICATO";
  }
  return "SEGNO_INCOERENTE";
}

function selectSheet(workbook: XLSX.WorkBook) {
  const valid = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return sheet ? { name, sheet, validation: validateSheet(sheet) } : null;
  }).filter(
    (
      item,
    ): item is NonNullable<typeof item> & {
      validation: NonNullable<ReturnType<typeof validateSheet>>;
    } => Boolean(item?.validation),
  );
  const table1 = valid.find((item) => item.name === "Table1");
  if (table1) return table1;
  if (valid.length !== 1)
    throw new AgeaParserError(
      "FOGLIO_AMBIGUO",
      valid.length === 0
        ? "Nessun foglio contiene il tracciato AGEA osservato"
        : "Più fogli contengono un tracciato AGEA valido",
    );
  return valid[0];
}

function validateZipContainer(buffer: Buffer): void {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const searchStart = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0)
    throw new AgeaParserError(
      "ZIP_NON_VALIDO",
      "La struttura ZIP del file XLSX non è valida",
    );
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entries === 0 ||
    entries > 5_000 ||
    centralOffset + centralSize > buffer.length
  )
    throw new AgeaParserError(
      "ZIP_NON_SICURO",
      "Contenitore ZIP64, sovradimensionato o incoerente non ammesso",
    );
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== centralSignature
    )
      throw new AgeaParserError(
        "ZIP_NON_VALIDO",
        "Directory centrale ZIP non valida",
      );
    const flags = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || flags & 1)
      throw new AgeaParserError(
        "ZIP_NON_SICURO",
        "Archivi ZIP64 o cifrati non sono ammessi",
      );
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > buffer.length)
      throw new AgeaParserError("ZIP_NON_VALIDO", "Nome entry ZIP non valido");
    const name = buffer.subarray(offset + 46, nameEnd).toString("utf8");
    const normalizedName = name.replace(/\\/g, "/").toLowerCase();
    if (
      normalizedName.startsWith("/") ||
      normalizedName.split("/").includes("..")
    )
      throw new AgeaParserError(
        "ZIP_PATH_NON_SICURO",
        "Il contenitore contiene un percorso non sicuro",
      );
    if (
      normalizedName.endsWith("vbaproject.bin") ||
      normalizedName.startsWith("xl/embeddings/")
    )
      throw new AgeaParserError(
        "MACRO_NON_AMMESSE",
        "Macro e oggetti incorporati non sono ammessi",
      );
    totalUncompressed += uncompressed;
    if (
      totalUncompressed > 100 * 1024 * 1024 ||
      uncompressed > 50 * 1024 * 1024 ||
      (compressed > 0 &&
        uncompressed > 1024 * 1024 &&
        uncompressed / compressed > 200)
    )
      throw new AgeaParserError(
        "ZIP_BOMB_RILEVATA",
        "Il rapporto di compressione o la dimensione espansa non sono sicuri",
      );
    offset = nameEnd + extraLength + commentLength;
  }
}

export function parseAgeaWorkbook(buffer: Buffer): ParsedAgeaWorkbook {
  if (buffer.length === 0 || buffer.length > AGEA_MAX_BYTES)
    throw new AgeaParserError(
      "DIMENSIONE_FILE_NON_VALIDA",
      "Il file deve essere compreso tra 1 byte e 10 MB",
    );
  if (
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  )
    throw new AgeaParserError(
      "FIRMA_XLSX_NON_VALIDA",
      "Il contenuto non ha la firma ZIP prevista per XLSX",
    );
  validateZipContainer(buffer);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      raw: true,
      cellDates: false,
      cellFormula: true,
      cellNF: false,
      cellStyles: false,
      bookVBA: true,
      dense: false,
      WTF: true,
    });
  } catch {
    throw new AgeaParserError(
      "XLSX_NON_LEGGIBILE",
      "Il file XLSX non è leggibile",
    );
  }
  if ((workbook as XLSX.WorkBook & { vbaraw?: unknown }).vbaraw)
    throw new AgeaParserError(
      "MACRO_NON_AMMESSE",
      "I file XLSX con macro non sono ammessi",
    );
  const selected = selectSheet(workbook);
  const { sheet, validation } = selected;
  const rows: ParsedAgeaRow[] = [];
  for (let r = validation.range.s.r + 1; r <= validation.range.e.r; r += 1) {
    const cells = Array.from({ length: 19 }, (_, column) =>
      cellAt(sheet, r, validation.range.s.c + column),
    );
    if (cells.every((cell) => cell == null || cell.v == null || cell.v === ""))
      continue;
    for (const cell of cells) {
      if (cell?.f && cell.v == null)
        throw new AgeaParserError(
          "VALORE_FORMULA_NON_DISPONIBILE",
          `Formula senza valore cached in riga ${r + 1}`,
        );
    }
    const rawJson = Object.fromEntries(
      validation.headers.map((header, index) => [
        header,
        rawText(cells[index]),
      ]),
    );
    const fondoRaw = rawText(cells[0]);
    const prodottoRaw = rawText(cells[1]);
    if (!prodottoRaw)
      throw new AgeaParserError(
        "PRODOTTO_MANCANTE",
        `Descrizione prodotto mancante in riga ${r + 1}`,
      );
    const movimentoKgLt = decimalText(cells[9], "Carico / scarico", r + 1);
    const movimentoPezzi = decimalText(
      cells[10],
      "Carico / scarico pezzi",
      r + 1,
    );
    const mittenteDestinatarioRaw = rawText(cells[8]);
    const tipo = classify(
      movimentoPezzi,
      movimentoKgLt,
      mittenteDestinatarioRaw,
    );
    const dataDocumento = parseAgeaDate(cells[5]?.v as CellValue);
    const dataCarico = parseAgeaDate(cells[6]?.v as CellValue);
    const warnings: string[] = [];
    const errors: string[] = [];
    if (!FUND_MAP[fondoRaw ?? ""]) errors.push("FONDO_NON_RICONOSCIUTO");
    if (tipo === "SEGNO_INCOERENTE") errors.push("SEGNO_INCOERENTE");
    if (tipo === "MOVIMENTO_NEGATIVO_NON_CLASSIFICATO")
      warnings.push("MOVIMENTO_NEGATIVO_NON_CLASSIFICATO");
    if (tipo === "RIGA_SENZA_MOVIMENTO") warnings.push("RIGA_SENZA_MOVIMENTO");
    const dataCaricoRaw = rawText(cells[6]);
    if (!dataCarico && dataDocumento) warnings.push("DATA_DOCUMENTO_FALLBACK");
    if (!dataCarico && !dataDocumento && tipo === "CARICO")
      errors.push("DATA_CARICO_DA_COMPLETARE");
    const noteRaw = rawText(cells[13]);
    if (dataCaricoRaw === "23" || noteRaw === "23")
      warnings.push("PLACEHOLDER_23_OSSERVATO");
    const attivitaRaw = rawText(cells[14]);
    if (tipo !== "CARICO" && attivitaRaw && !ACTIVITY_MAP[attivitaRaw])
      warnings.push("ATTIVITA_NON_RICONOSCIUTA");
    const normalizedProduct = normalizeAgeaKey(prodottoRaw)!;
    const base = hash({
      fonte: "AGEA_SIFEAD",
      fondo: FUND_MAP[fondoRaw ?? ""] ?? null,
      prodotto: normalizedProduct,
      documento: normalizeAgeaKey(rawText(cells[4])),
      dataDocumento,
      lotto: normalizeAgeaKey(rawText(cells[7])),
      mittenteDestinatario: normalizeAgeaKey(mittenteDestinatarioRaw),
      direzione:
        tipo === "CARICO"
          ? "POSITIVA"
          : tipo === "RIGA_SENZA_MOVIMENTO"
            ? "ZERO"
            : tipo === "SEGNO_INCOERENTE"
              ? "MISTA"
              : "NEGATIVA",
      tipo,
    });
    const content = hash({
      movimentoPezzi,
      movimentoKgLt,
      saldoMovimentoPezzi: decimalText(
        cells[11],
        "Giacenza pezzi alla movimentazione",
        r + 1,
      ),
      saldoMovimentoKgLt: decimalText(
        cells[12],
        "Giacenza alla movimentazione",
        r + 1,
      ),
      attivita: normalizeAgeaKey(attivitaRaw),
      pacchi: rawText(cells[15]),
      pasti: rawText(cells[16]),
      saltuari: rawText(cells[17]),
      continuativi: rawText(cells[18]),
    });
    rows.push({
      numeroRiga: r + 1,
      rawJson,
      fondoRaw,
      fondoNormalizzato: FUND_MAP[fondoRaw ?? ""] ?? null,
      prodottoRaw,
      prodottoNormalizzato: normalizedProduct,
      lottoRaw: rawText(cells[7]),
      lottoNormalizzato: normalizeAgeaKey(rawText(cells[7])),
      numeroDocumentoRaw: rawText(cells[4]),
      numeroDocumentoNormalizzato: normalizeAgeaKey(rawText(cells[4])),
      dataDocumentoRaw: rawText(cells[5]),
      dataDocumento,
      dataCaricoMagazzinoRaw: dataCaricoRaw,
      dataCaricoRisolta: dataCarico ?? dataDocumento,
      dataCaricoFonte: dataCarico
        ? "DATA_CARICO_MAGAZZINO"
        : dataDocumento
          ? "DATA_DOCUMENTO_FALLBACK"
          : null,
      mittenteDestinatarioRaw,
      movimentoKgLtRaw: rawText(cells[9]),
      movimentoKgLt,
      movimentoPezziRaw: rawText(cells[10]),
      movimentoPezzi,
      saldoMovimentoPezziRaw: rawText(cells[11]),
      saldoMovimentoPezzi: decimalText(
        cells[11],
        "Giacenza pezzi alla movimentazione",
        r + 1,
      ),
      saldoMovimentoKgLtRaw: rawText(cells[12]),
      saldoMovimentoKgLt: decimalText(
        cells[12],
        "Giacenza alla movimentazione",
        r + 1,
      ),
      saldoFinalePezziRaw: rawText(cells[2]),
      saldoFinalePezzi: decimalText(cells[2], validation.headers[2], r + 1),
      saldoFinaleKgLtRaw: rawText(cells[3]),
      saldoFinaleKgLt: decimalText(cells[3], validation.headers[3], r + 1),
      noteRaw,
      attivitaRaw,
      attivitaNormalizzata: ACTIVITY_MAP[attivitaRaw ?? ""] ?? null,
      pacchiRaw: rawText(cells[15]),
      pastiRaw: rawText(cells[16]),
      saltuariRaw: rawText(cells[17]),
      continuativiRaw: rawText(cells[18]),
      tipoMovimentoEsterno: tipo,
      identityBaseHash: base,
      identityOccurrence: 0,
      identityKey: "",
      contentHash: content,
      statoRiga: errors.length ? "BLOCCATA" : "DA_MAPPARE",
      blocking: errors.length > 0,
      errorCodes: errors,
      warningCodes: [...new Set(warnings)],
    });
  }
  const groups = new Map<string, ParsedAgeaRow[]>();
  for (const row of rows)
    groups.set(row.identityBaseHash, [
      ...(groups.get(row.identityBaseHash) ?? []),
      row,
    ]);
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        left.contentHash.localeCompare(right.contentHash) ||
        left.numeroRiga - right.numeroRiga,
    );
    group.forEach((row, index) => {
      row.identityOccurrence = index + 1;
      row.identityKey = `${row.identityBaseHash}:${index + 1}`;
    });
  }
  return {
    sheetName: selected.name,
    dataRiferimento: validation.dataRiferimento,
    rows: rows.sort((left, right) => left.numeroRiga - right.numeroRiga),
    warnings: rows.some((row) =>
      row.warningCodes.includes("PLACEHOLDER_23_OSSERVATO"),
    )
      ? ["PLACEHOLDER_23_OSSERVATO"]
      : [],
    sha256File: createHash("sha256").update(buffer).digest("hex"),
    counts: {
      total: rows.length,
      carichi: rows.filter((row) => row.tipoMovimentoEsterno === "CARICO")
        .length,
      distribuzioni: rows.filter(
        (row) => row.tipoMovimentoEsterno === "DISTRIBUZIONE",
      ).length,
      resi: rows.filter((row) => row.tipoMovimentoEsterno === "RESO").length,
      nonClassificate: rows.filter((row) =>
        [
          "MOVIMENTO_NEGATIVO_NON_CLASSIFICATO",
          "RIGA_SENZA_MOVIMENTO",
        ].includes(row.tipoMovimentoEsterno),
      ).length,
      bloccanti: rows.filter((row) => row.blocking).length,
    },
  };
}
