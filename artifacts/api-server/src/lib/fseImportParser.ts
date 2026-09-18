import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  AGEA_MAX_BYTES,
  AGEA_MAX_COLUMNS,
  AGEA_MAX_ROWS,
  AGEA_PARSER_VERSION,
  AgeaParserError,
  normalizeAgeaKey,
  normalizeAgeaText,
  parseAgeaWorkbook,
  validateZipContainer,
  type ParsedAgeaRow,
} from "./ageaSifeadParser";
import { InventoryDecimal, InventoryDecimalError } from "./inventoryDecimal";

export const FSE_IMPORT_PARSER_VERSION = `${AGEA_PARSER_VERSION}-M3B.1`;
export const FSE_REGISTRY_PROFILE = "SIFEAD_REGISTRO_19COL_V2";
export const FSE_STOCK_PROFILE = "SIFEAD_GIACENZE_15COL_V1";

export type FseFileFormat = "XLSX" | "XLS" | "CSV";
export type FseFileProfile = "REGISTRO" | "GIACENZE";

type CellValue = string | number | boolean | Date | null | undefined;

export interface ParsedFseStockRow {
  numeroRiga: number;
  rawJson: Record<string, string | null>;
  fondoRaw: string | null;
  fondoNormalizzato: string | null;
  prodottoRaw: string;
  prodottoNormalizzato: string;
  lottoRaw: string | null;
  lottoNormalizzato: string | null;
  pesoUnitaRaw: string | null;
  pesoUnita: string | null;
  unitaMisuraPesoRaw: string | null;
  unitaMisuraPeso: "kg" | "l" | null;
  giacenzaPesoVolumeRaw: string | null;
  giacenzaPesoVolume: string | null;
  giacenzaPezziRaw: string | null;
  giacenzaPezzi: string | null;
  pezziPerColloRaw: string | null;
  pezziPerCollo: string | null;
  giacenzaColliRaw: string | null;
  giacenzaColli: string | null;
  dataScadenzaRaw: string | null;
  dataScadenza: string | null;
  balanceKey: string;
  blocking: boolean;
  errorCodes: string[];
  warningCodes: string[];
}

export interface ParsedFseFile {
  format: FseFileFormat;
  profile: FseFileProfile;
  profileCode: string;
  parserVersion: string;
  sheetName: string;
  sheetNames: string[];
  sha256File: string;
  dataRiferimento: string | null;
  registryRows: ParsedAgeaRow[];
  stockRows: ParsedFseStockRow[];
  warnings: string[];
}

const REGISTRY_HEADERS = [
  "Fondo",
  "Prodotto",
  "Giacenza al {data} Pezzi",
  "Giacenza al {data} KgLt",
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

const STOCK_HEADERS = [
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
] as const;

const FUND_MAP: Record<string, string> = {
  "FSE+": "FSE_PLUS",
  "FONDO NAZIONALE": "FONDO_NAZIONALE",
  "FONDO NAZIONALE COFINANZIATO": "FONDO_NAZIONALE_COFINANZIATO",
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rawText(cell: XLSX.CellObject | undefined): string | null {
  if (!cell || cell.v == null || cell.v === "") return null;
  if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
    return `${String(cell.v.getUTCDate()).padStart(2, "0")}/${String(cell.v.getUTCMonth() + 1).padStart(2, "0")}/${cell.v.getUTCFullYear()}`;
  }
  return String(cell.w ?? cell.v);
}

function value(cell: XLSX.CellObject | undefined): CellValue {
  if (!cell || cell.v == null || cell.v === "") return null;
  return cell.v as CellValue;
}

function cellAt(sheet: XLSX.WorkSheet, row: number, column: number) {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })] as
    | XLSX.CellObject
    | undefined;
}

function isoDate(day: number, month: number, year: number): string | null {
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  )
    return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseFseDate(
  input: CellValue,
  options: { date1904?: boolean } = {},
): string | null {
  if (input instanceof Date && !Number.isNaN(input.getTime()))
    return isoDate(
      input.getUTCDate(),
      input.getUTCMonth() + 1,
      input.getUTCFullYear(),
    );
  if (typeof input === "number" && Number.isFinite(input)) {
    const parsed = XLSX.SSF.parse_date_code(input, {
      date1904: options.date1904 === true,
    });
    return parsed ? isoDate(parsed.d, parsed.m, parsed.y) : null;
  }
  if (typeof input !== "string") return null;
  const raw = input.trim();
  const italian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (italian)
    return isoDate(Number(italian[1]), Number(italian[2]), Number(italian[3]));
  const standard = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (standard)
    return isoDate(
      Number(standard[3]),
      Number(standard[2]),
      Number(standard[1]),
    );
  return null;
}

function decimal(
  raw: string | null,
  field: string,
  row: number,
): string | null {
  if (raw == null || raw.trim() === "") return null;
  const normalized = raw.trim();
  if (/[eE]/.test(normalized))
    throw new AgeaParserError(
      "DECIMALE_NON_VALIDO",
      `${field} in riga ${row} usa notazione scientifica`,
    );
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(normalized))
    throw new AgeaParserError(
      "DECIMALE_AMBIGUO",
      `${field} in riga ${row} usa una convenzione numerica ambigua`,
    );
  try {
    return InventoryDecimal.parse(normalized.replace(",", "."), {
      allowNegative: true,
    }).toDb();
  } catch (error) {
    if (error instanceof InventoryDecimalError)
      throw new AgeaParserError(
        "DECIMALE_NON_VALIDO",
        `${field} in riga ${row}: ${error.message}`,
      );
    throw error;
  }
}

export function detectFseFileFormat(buffer: Buffer): FseFileFormat {
  if (buffer.length === 0 || buffer.length > AGEA_MAX_BYTES)
    throw new AgeaParserError(
      "DIMENSIONE_FILE_NON_VALIDA",
      "Il file deve essere compreso tra 1 byte e 10 MB",
    );
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    validateZipContainer(buffer);
    return "XLSX";
  }
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  )
    return "XLS";
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0))
    throw new AgeaParserError(
      "FORMATO_FILE_NON_RICONOSCIUTO",
      "Il contenuto non è XLSX, XLS binario o CSV testuale",
    );
  return "CSV";
}

function readWorkbook(buffer: Buffer, format: FseFileFormat): XLSX.WorkBook {
  try {
    const csvText =
      format === "CSV" ? buffer.toString("utf8").replace(/^\uFEFF/, "") : null;
    const delimiter = csvText == null ? undefined : detectCsvDelimiter(csvText);
    const workbook = XLSX.read(csvText ?? buffer, {
      type: csvText == null ? "buffer" : "string",
      raw: true,
      cellDates: false,
      cellFormula: true,
      cellNF: true,
      cellStyles: false,
      bookVBA: true,
      dense: false,
      WTF: true,
      ...(delimiter ? { FS: delimiter } : {}),
    });
    if ((workbook as XLSX.WorkBook & { vbaraw?: unknown }).vbaraw)
      throw new AgeaParserError(
        "MACRO_NON_AMMESSE",
        "I file con macro non sono ammessi",
      );
    return workbook;
  } catch (error) {
    if (error instanceof AgeaParserError) throw error;
    throw new AgeaParserError(
      "FILE_NON_LEGGIBILE",
      "Il file non è leggibile nel formato dichiarato dal contenuto",
    );
  }
}

function detectCsvDelimiter(text: string): ";" | "," | "\t" {
  const counts = new Map<";" | "," | "\t", number>([
    [";", 0],
    [",", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) break;
    if (!quoted && counts.has(character as ";" | "," | "\t")) {
      const delimiter = character as ";" | "," | "\t";
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  );
  if (ranked[0][1] === 0 || ranked[0][1] === ranked[1][1])
    throw new AgeaParserError(
      "SEPARATORE_CSV_AMBIGUO",
      "Il separatore CSV non è riconoscibile in modo univoco",
    );
  return ranked[0][0];
}

function headerMap(sheet: XLSX.WorkSheet): {
  range: XLSX.Range;
  original: string[];
  byKey: Map<string, number>;
} | null {
  if (!sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  if (rows > AGEA_MAX_ROWS + 1 || columns > AGEA_MAX_COLUMNS)
    throw new AgeaParserError(
      "LIMITE_TRACCIATO_SUPERATO",
      "Il foglio supera i limiti di 10.000 righe o 100 colonne",
    );
  const original = Array.from({ length: columns }, (_, index) =>
    rawText(cellAt(sheet, range.s.r, range.s.c + index)),
  ).map((item) => item ?? "");
  const byKey = new Map<string, number>();
  for (let index = 0; index < original.length; index += 1) {
    const key = normalizeAgeaKey(original[index]);
    if (!key) continue;
    if (byKey.has(key))
      throw new AgeaParserError(
        "INTESTAZIONE_DUPLICATA",
        `La colonna ${original[index]} è presente più volte`,
      );
    byKey.set(key, range.s.c + index);
  }
  return { range, original, byKey };
}

type RecognizedSheet = {
  name: string;
  sheet: XLSX.WorkSheet;
  headers: NonNullable<ReturnType<typeof headerMap>>;
  profile: FseFileProfile;
  referenceDate: string | null;
  registryPieceHeader?: string;
  registryKgHeader?: string;
};

function recognizeSheet(
  name: string,
  sheet: XLSX.WorkSheet,
): RecognizedSheet | null {
  const headers = headerMap(sheet);
  if (!headers) return null;
  const keys = [...headers.byKey.keys()];
  const stockRequired = STOCK_HEADERS.map(
    (header) => normalizeAgeaKey(header)!,
  );
  if (stockRequired.every((header) => headers.byKey.has(header)))
    return {
      name,
      sheet,
      headers,
      profile: "GIACENZE",
      referenceDate: null,
    };
  const staticRegistry = REGISTRY_HEADERS.filter(
    (header) => !header.includes("{data}"),
  ).map((header) => normalizeAgeaKey(header)!);
  const pieces = keys
    .map((key) => ({
      key,
      match: /^GIACENZA AL (\d{2}\/\d{2}\/\d{4}) PEZZI$/.exec(key),
    }))
    .find((item) => item.match);
  const kg = keys
    .map((key) => ({
      key,
      match: /^GIACENZA AL (\d{2}\/\d{2}\/\d{4}) KGLT$/.exec(key),
    }))
    .find((item) => item.match);
  if (
    pieces?.match &&
    kg?.match &&
    pieces.match[1] === kg.match[1] &&
    staticRegistry.every((header) => headers.byKey.has(header))
  )
    return {
      name,
      sheet,
      headers,
      profile: "REGISTRO",
      referenceDate: parseFseDate(pieces.match[1]),
      registryPieceHeader: pieces.key,
      registryKgHeader: kg.key,
    };
  return null;
}

function selectRecognizedSheet(
  workbook: XLSX.WorkBook,
  profile: FseFileProfile,
  requestedSheet?: string,
): RecognizedSheet {
  const recognized = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return sheet ? recognizeSheet(name, sheet) : null;
  }).filter(
    (item): item is RecognizedSheet => item != null && item.profile === profile,
  );
  if (requestedSheet) {
    const selected = recognized.find((item) => item.name === requestedSheet);
    if (!selected)
      throw new AgeaParserError(
        "FOGLIO_NON_VALIDO",
        "Il foglio scelto non contiene il tracciato richiesto",
      );
    return selected;
  }
  if (recognized.length !== 1)
    throw new AgeaParserError(
      "FOGLIO_AMBIGUO",
      recognized.length === 0
        ? "Nessun foglio contiene il tracciato richiesto"
        : "Più fogli contengono il tracciato: scegliere esplicitamente il foglio",
    );
  return recognized[0];
}

function assertNoUnsafeFormula(sheet: XLSX.WorkSheet, range: XLSX.Range): void {
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = cellAt(sheet, row, column);
      if (cell?.f && cell.v == null)
        throw new AgeaParserError(
          "VALORE_FORMULA_NON_DISPONIBILE",
          `Formula senza valore cached in riga ${row + 1}`,
        );
      if (typeof cell?.v === "string" && /^[=+@]/.test(cell.v.trimStart()))
        throw new AgeaParserError(
          "CONTENUTO_ATTIVO_NON_AMMESSO",
          `Contenuto attivo non ammesso in riga ${row + 1}`,
        );
    }
  }
}

function canonicalRegistryBuffer(
  selected: RecognizedSheet,
  date1904: boolean,
): Buffer {
  const { headers, sheet } = selected;
  const normalizedHeaders = REGISTRY_HEADERS.map((header) => {
    if (header === "Giacenza al {data} Pezzi")
      return selected.registryPieceHeader!;
    if (header === "Giacenza al {data} KgLt") return selected.registryKgHeader!;
    return normalizeAgeaKey(header)!;
  });
  const displayHeaders = normalizedHeaders.map((key) => {
    const entry = headers.original.find(
      (header) => normalizeAgeaKey(header) === key,
    );
    return entry ?? key;
  });
  const rows: CellValue[][] = [];
  for (let row = headers.range.s.r + 1; row <= headers.range.e.r; row += 1) {
    const values = normalizedHeaders.map((key) => {
      const column = headers.byKey.get(key)!;
      const cell = cellAt(sheet, row, column);
      if (
        [
          "LOTTO",
          "NUMERO DOCUMENTO",
          "PRODOTTO",
          "FONDO",
          "MITTENTE / DESTINATARIO",
        ].includes(key)
      )
        return rawText(cell);
      if (["DATA DOCUMENTO", "DATA CARICO MAGAZZINO"].includes(key)) {
        const original = value(cell);
        if (typeof original === "number" || original instanceof Date)
          return parseFseDate(original, { date1904 }) ?? original;
      }
      return value(cell);
    });
    if (values.some((item) => item != null && item !== "")) rows.push(values);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([displayHeaders, ...rows]),
    "Table1",
  );
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
}

export function fseSemanticIdentityHash(input: {
  fondo: string | null;
  prodotto: string;
  numeroDocumento: string | null;
  dataDocumento: string | null;
  lotto: string | null;
  natura: string;
  mittenteDestinatario: string | null;
}): string {
  return hash({
    version: "M3B-SEMANTIC-V1",
    ...input,
  });
}

export function fseMovementContentHash(input: {
  movimentoKgLt: string | null;
  movimentoPezzi: string | null;
  dataOperativaProposta: string | null;
  lotto: string | null;
  fondo: string | null;
}): string {
  return hash({
    version: "M3B-CONTENT-V1",
    ...input,
  });
}

function versionRegistryIdentity(rows: ParsedAgeaRow[]): ParsedAgeaRow[] {
  const groups = new Map<string, ParsedAgeaRow[]>();
  for (const row of rows) {
    const identity = fseSemanticIdentityHash({
      fondo: row.fondoNormalizzato,
      prodotto: row.prodottoNormalizzato,
      numeroDocumento: row.numeroDocumentoNormalizzato,
      dataDocumento: row.dataDocumento,
      lotto: row.lottoNormalizzato,
      natura: row.tipoMovimentoEsterno,
      mittenteDestinatario: normalizeAgeaKey(row.mittenteDestinatarioRaw),
    });
    const content = fseMovementContentHash({
      movimentoKgLt: row.movimentoKgLt,
      movimentoPezzi: row.movimentoPezzi,
      dataOperativaProposta: row.dataCaricoRisolta,
      lotto: row.lottoNormalizzato,
      fondo: row.fondoNormalizzato,
    });
    row.identityBaseHash = identity;
    row.identityKey = identity;
    row.identityOccurrence = 1;
    row.contentHash = content;
    groups.set(identity, [...(groups.get(identity) ?? []), row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.blocking = true;
      row.statoRiga = "AMBIGUA";
      row.errorCodes = [
        ...new Set([...row.errorCodes, "MOLTEPLICITA_AMBIGUA"]),
      ];
    }
  }
  return rows;
}

function stockRows(selected: RecognizedSheet, date1904: boolean) {
  const rows: ParsedFseStockRow[] = [];
  const { headers, sheet } = selected;
  const key = (name: (typeof STOCK_HEADERS)[number]) =>
    headers.byKey.get(normalizeAgeaKey(name)!)!;
  for (let row = headers.range.s.r + 1; row <= headers.range.e.r; row += 1) {
    const cells = STOCK_HEADERS.map((name) => cellAt(sheet, row, key(name)));
    if (cells.every((cell) => cell == null || cell.v == null || cell.v === ""))
      continue;
    const rawJson = Object.fromEntries(
      STOCK_HEADERS.map((name, index) => [name, rawText(cells[index])]),
    );
    const fondoRaw = rawText(cells[4]);
    const prodottoRaw = rawText(cells[5]);
    const lottoRaw = rawText(cells[6]);
    const errors: string[] = [];
    const warnings: string[] = [];
    const fund = FUND_MAP[normalizeAgeaKey(fondoRaw) ?? ""] ?? null;
    if (!fund) errors.push("FONDO_NON_RICONOSCIUTO");
    if (!prodottoRaw) errors.push("PRODOTTO_MANCANTE");
    const unitRaw = normalizeAgeaKey(rawText(cells[8]));
    const unit =
      unitRaw === "KG"
        ? "kg"
        : unitRaw === "L" || unitRaw === "LT"
          ? "l"
          : null;
    if (unitRaw && !unit) errors.push("UNITA_PESO_NON_RICONOSCIUTA");
    const pieces = decimal(rawText(cells[10]), "GiacenzaPezzi", row + 1);
    const quantity = decimal(rawText(cells[9]), "GiacenzaPesoVolume", row + 1);
    if (pieces == null && quantity == null) errors.push("GIACENZA_MANCANTE");
    const expiryRaw = rawText(cells[14]);
    const expiry = parseFseDate(value(cells[14]), { date1904 });
    if (expiryRaw && !expiry) errors.push("SCADENZA_NON_VALIDA");
    const normalizedProduct = normalizeAgeaKey(prodottoRaw) ?? "";
    const normalizedLot = normalizeAgeaKey(lottoRaw);
    rows.push({
      numeroRiga: row + 1,
      rawJson,
      fondoRaw,
      fondoNormalizzato: fund,
      prodottoRaw: prodottoRaw ?? "",
      prodottoNormalizzato: normalizedProduct,
      lottoRaw,
      lottoNormalizzato: normalizedLot,
      pesoUnitaRaw: rawText(cells[7]),
      pesoUnita: decimal(rawText(cells[7]), "PesoUnita", row + 1),
      unitaMisuraPesoRaw: rawText(cells[8]),
      unitaMisuraPeso: unit,
      giacenzaPesoVolumeRaw: rawText(cells[9]),
      giacenzaPesoVolume: quantity,
      giacenzaPezziRaw: rawText(cells[10]),
      giacenzaPezzi: pieces,
      pezziPerColloRaw: rawText(cells[11]),
      pezziPerCollo: decimal(rawText(cells[11]), "PezziPerCollo", row + 1),
      giacenzaColliRaw: rawText(cells[12]),
      giacenzaColli: decimal(rawText(cells[12]), "GiacenzaColli", row + 1),
      dataScadenzaRaw: expiryRaw,
      dataScadenza: expiry,
      balanceKey: hash({
        version: "M3B-BALANCE-V1",
        fondo: fund,
        prodotto: normalizedProduct,
        lotto: normalizedLot,
      }),
      blocking: errors.length > 0,
      errorCodes: errors,
      warningCodes: warnings,
    });
  }
  return rows;
}

export function parseFseFile(
  buffer: Buffer,
  options: {
    profile: FseFileProfile;
    sheetName?: string;
    referenceDate?: string;
  },
): ParsedFseFile {
  const format = detectFseFileFormat(buffer);
  const workbook = readWorkbook(buffer, format);
  const selected = selectRecognizedSheet(
    workbook,
    options.profile,
    options.sheetName,
  );
  assertNoUnsafeFormula(selected.sheet, selected.headers.range);
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const registryRows =
    options.profile === "REGISTRO"
      ? versionRegistryIdentity(
          parseAgeaWorkbook(canonicalRegistryBuffer(selected, date1904)).rows,
        )
      : [];
  const parsedStockRows =
    options.profile === "GIACENZE" ? stockRows(selected, date1904) : [];
  const referenceDate =
    selected.referenceDate ??
    (options.referenceDate ? parseFseDate(options.referenceDate) : null);
  if (options.referenceDate && !referenceDate)
    throw new AgeaParserError(
      "DATA_RIFERIMENTO_NON_VALIDA",
      "La data di riferimento deve essere YYYY-MM-DD",
    );
  return {
    format,
    profile: options.profile,
    profileCode:
      options.profile === "REGISTRO" ? FSE_REGISTRY_PROFILE : FSE_STOCK_PROFILE,
    parserVersion: FSE_IMPORT_PARSER_VERSION,
    sheetName: selected.name,
    sheetNames: workbook.SheetNames,
    sha256File: createHash("sha256").update(buffer).digest("hex"),
    dataRiferimento: referenceDate,
    registryRows,
    stockRows: parsedStockRows,
    warnings:
      options.profile === "GIACENZE" && !selected.referenceDate
        ? ["DATA_RIFERIMENTO_DA_CONFERMARE"]
        : [],
  };
}
