import { createHash } from "node:crypto";
import { calcolaEta, fasciaEtaDaEta } from "@workspace/api-zod";
import * as XLSX from "xlsx";

export const FSE_BENEFICIARI_HEADERS = [
  "Nome Referente fascicolo",
  "Cognome Referente fascicolo",
  "Codice fascicolo",
  "Data di presa in carico",
  "Numero componenti fascicolo",
  "Tipologia di Attività",
  "Stato attuale",
  "Donne",
  "Uomini",
  "Età<18",
  "Età 18-29",
  "Età 30-64",
  "Età>=65",
  "Origine straniera e minoranze",
  "Disabili",
  "Cittadini di Paesi Terzi",
  "Senzatetto o colpiti da esclusione abitativa",
] as const;

export const FSE_BENEFICIARI_SHEET = "Table1";
export const FSE_TIPOLOGIE_ATTIVITA = ["Pacchi", "Domiciliare"] as const;
export const FSE_STATI_ATTUALI = ["Attivo"] as const;

export type FseBeneficiariHeader = (typeof FSE_BENEFICIARI_HEADERS)[number];
export type FseTipologiaAttivita = (typeof FSE_TIPOLOGIE_ATTIVITA)[number];
export type FseStatoAttuale = (typeof FSE_STATI_ATTUALI)[number];

export type FseBeneficiariRow = {
  nome: string;
  cognome: string;
  codiceFascicolo: string;
  dataPresaInCarico: string;
  numeroComponenti: number;
  tipologiaAttivita: FseTipologiaAttivita;
  statoAttuale: FseStatoAttuale;
  donne: number;
  uomini: number;
  eta017: number;
  eta1829: number;
  eta3064: number;
  eta65Plus: number;
  origineStranieraMinoranze: number;
  disabili: number;
  cittadiniPaesiTerzi: number;
  senzaTettoEsclusioneAbitativa: number;
  hash: string;
};

export type FseRowValidation = {
  numeroRiga: number;
  codiceFascicolo: string | null;
  row: FseBeneficiariRow | null;
  errori: string[];
  warning: string[];
};

export type DemografiaSnapshot = Pick<
  FseBeneficiariRow,
  "numeroComponenti" | "donne" | "uomini" | "eta017" | "eta1829" | "eta3064" | "eta65Plus"
>;

export type DemografiaNucleo = DemografiaSnapshot & {
  origine: "anagrafica_calcolata" | "snapshot_fse";
  dettaglioCompleto: boolean;
  problemi: string[];
};

type PersonaDemografica = { dataNascita: string | null; sesso: string | null };

function normalizeContractText(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("it-IT");
}

export function normalizeFseCode(value: unknown): string | null {
  const normalized = normalizeContractText(value);
  return normalized || null;
}

function dateOnlyFromParts(year: number, month: number, day: number): string | null {
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseFseDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? dateOnlyFromParts(parsed.y, parsed.m, parsed.d) : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateOnlyFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const raw = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return dateOnlyFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const italian = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(raw);
  return italian
    ? dateOnlyFromParts(Number(italian[3]), Number(italian[2]), Number(italian[1]))
    : null;
}

export function mapFseActivityToDelivery(value: unknown): boolean | null {
  if (value === "Pacchi") return false;
  if (value === "Domiciliare") return true;
  return null;
}

export function mapDeliveryToFseActivity(consegnaDomicilio: boolean): FseTipologiaAttivita {
  return consegnaDomicilio ? "Domiciliare" : "Pacchi";
}

export function mapFseStateToActive(value: unknown): boolean | null {
  return value === "Attivo" ? true : null;
}

export function mapActiveToFseState(attivo: boolean): FseStatoAttuale | null {
  return attivo ? "Attivo" : null;
}

function integerCount(value: unknown, label: string, max: number, errors: string[]): number {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    errors.push(`${label}: valore obbligatorio.`);
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    errors.push(`${label}: atteso intero tra 0 e ${max}.`);
    return 0;
  }
  return parsed;
}

export function validateFseHeaders(headers: unknown[]): { errori: string[]; warning: string[] } {
  const normalized = headers.map(normalizeContractText);
  const errori: string[] = [];
  const warning: string[] = [];
  const seen = new Set<string>();

  normalized.forEach((header, index) => {
    if (!header) return;
    if (seen.has(header)) errori.push(`Colonna duplicata in posizione ${index + 1}: ${String(headers[index]).trim()}.`);
    seen.add(header);
  });

  FSE_BENEFICIARI_HEADERS.forEach((expected, index) => {
    const actual = normalized[index];
    if (actual !== normalizeContractText(expected)) {
      errori.push(actual
        ? `Colonna ${index + 1} non valida: attesa ${expected}.`
        : `Colonna obbligatoria mancante: ${expected}.`);
    }
  });

  for (let index = FSE_BENEFICIARI_HEADERS.length; index < headers.length; index++) {
    if (normalized[index]) warning.push(`Colonna extra ignorata: ${String(headers[index]).trim()}.`);
  }
  return { errori: [...new Set(errori)], warning };
}

export function validateFseRows(rawRows: Array<Record<string, unknown>>): FseRowValidation[] {
  const seen = new Set<string>();
  return rawRows.map((raw, index) => {
    const errori: string[] = [];
    const warning: string[] = [];
    const text = (header: FseBeneficiariHeader) => String(raw[header] ?? "").trim();
    const nome = text(FSE_BENEFICIARI_HEADERS[0]);
    const cognome = text(FSE_BENEFICIARI_HEADERS[1]);
    const codiceFascicolo = text(FSE_BENEFICIARI_HEADERS[2]);
    const normalizedCode = normalizeFseCode(codiceFascicolo);
    const dataPresaInCarico = parseFseDate(raw[FSE_BENEFICIARI_HEADERS[3]]);
    const componentiRaw = raw[FSE_BENEFICIARI_HEADERS[4]];
    const numeroComponenti = typeof componentiRaw === "number"
      ? componentiRaw
      : Number(String(componentiRaw ?? "").trim());

    if (!nome || nome.length > 80) errori.push("Nome referente obbligatorio (massimo 80 caratteri).");
    if (!cognome || cognome.length > 80) errori.push("Cognome referente obbligatorio (massimo 80 caratteri).");
    if (!normalizedCode) errori.push("Codice fascicolo obbligatorio.");
    else if (codiceFascicolo.length > 255) errori.push("Codice fascicolo troppo lungo.");
    else if (seen.has(normalizedCode)) errori.push("Codice fascicolo duplicato nel file.");
    else seen.add(normalizedCode);
    if (!dataPresaInCarico) errori.push("Data di presa in carico non valida.");
    if (!Number.isInteger(numeroComponenti) || numeroComponenti <= 0) {
      errori.push("Numero componenti deve essere un intero positivo.");
    }

    const max = Number.isInteger(numeroComponenti) && numeroComponenti > 0 ? numeroComponenti : 0;
    const tipologia = text(FSE_BENEFICIARI_HEADERS[5]);
    const stato = text(FSE_BENEFICIARI_HEADERS[6]);
    if (mapFseActivityToDelivery(tipologia) == null) {
      errori.push(`Tipologia attività non supportata: ${tipologia || "vuota"}.`);
    }
    if (mapFseStateToActive(stato) == null) {
      errori.push(`Stato FSE+ non supportato: ${stato || "vuoto"}.`);
    }

    const values = FSE_BENEFICIARI_HEADERS.slice(7).map((header) =>
      integerCount(raw[header], header, max, errori));
    const [donne, uomini, eta017, eta1829, eta3064, eta65Plus, origine, disabili, paesiTerzi, esclusione] = values;
    if (donne + uomini !== max) errori.push("Donne + Uomini non coincide con Numero componenti.");
    if (eta017 + eta1829 + eta3064 + eta65Plus !== max) {
      errori.push("La somma delle fasce d'età non coincide con Numero componenti.");
    }

    if (errori.length) {
      return { numeroRiga: index + 2, codiceFascicolo: codiceFascicolo || null, row: null, errori, warning };
    }
    const payload = {
      nome,
      cognome,
      codiceFascicolo,
      dataPresaInCarico: dataPresaInCarico!,
      numeroComponenti: max,
      tipologiaAttivita: tipologia as FseTipologiaAttivita,
      statoAttuale: stato as FseStatoAttuale,
      donne,
      uomini,
      eta017,
      eta1829,
      eta3064,
      eta65Plus,
      origineStranieraMinoranze: origine,
      disabili,
      cittadiniPaesiTerzi: paesiTerzi,
      senzaTettoEsclusioneAbitativa: esclusione,
    };
    return {
      numeroRiga: index + 2,
      codiceFascicolo,
      row: { ...payload, hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") },
      errori,
      warning,
    };
  });
}

export function parseFseBeneficiariWorkbook(input: Buffer | Uint8Array) {
  const workbook = XLSX.read(input, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0] ?? null;
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    return { sheetNames: workbook.SheetNames, headers: [], rawRows: [], header: { errori: ["Workbook privo di fogli."], warning: [] }, rows: [] };
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headers = (matrix[0] ?? []).map((value) => String(value ?? ""));
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true, defval: null });
  const header = validateFseHeaders(headers);
  const sheetErrors = workbook.SheetNames.length === 1 && sheetName === FSE_BENEFICIARI_SHEET
    ? []
    : [`Il workbook deve contenere un solo foglio denominato ${FSE_BENEFICIARI_SHEET}.`];
  return {
    sheetNames: workbook.SheetNames,
    headers,
    rawRows,
    header: { errori: [...sheetErrors, ...header.errori], warning: header.warning },
    rows: validateFseRows(rawRows),
  };
}

function snapshotProblems(snapshot: DemografiaSnapshot): string[] {
  const values = Object.values(snapshot);
  const problemi: string[] = [];
  if (!Number.isInteger(snapshot.numeroComponenti) || snapshot.numeroComponenti <= 0) {
    problemi.push("SNAPSHOT_NUMERO_COMPONENTI_NON_VALIDO");
  }
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > snapshot.numeroComponenti)) {
    problemi.push("SNAPSHOT_CONTEGGI_NON_VALIDI");
  }
  if (snapshot.donne + snapshot.uomini !== snapshot.numeroComponenti) {
    problemi.push("SNAPSHOT_SESSO_NON_ALLINEATO");
  }
  if (snapshot.eta017 + snapshot.eta1829 + snapshot.eta3064 + snapshot.eta65Plus !== snapshot.numeroComponenti) {
    problemi.push("SNAPSHOT_FASCE_NON_ALLINEATE");
  }
  return problemi;
}

export function calcolaDemografiaNucleo(
  beneficiario: PersonaDemografica & { numComponenti: number },
  nucleo: PersonaDemografica[],
  dataRiferimento: Date,
  snapshot?: DemografiaSnapshot | null,
): DemografiaNucleo {
  const persone = [beneficiario, ...nucleo];
  const problemi: string[] = [];
  if (persone.length !== beneficiario.numComponenti) problemi.push("NUMERO_COMPONENTI_NON_ALLINEATO");
  if (persone.some((persona) => calcolaEta(persona.dataNascita, dataRiferimento) == null)) {
    problemi.push("DATA_NASCITA_MANCANTE_O_INVALIDA");
  }
  if (persone.some((persona) => !persona.sesso)) problemi.push("SESSO_MANCANTE");
  if (persone.some((persona) => persona.sesso === "ALTRO")) problemi.push("SESSO_NON_RAPPRESENTABILE_FSE");
  if (persone.some((persona) => persona.sesso != null && !["M", "F", "ALTRO"].includes(persona.sesso))) {
    problemi.push("SESSO_NON_VALIDO");
  }
  const dettaglioCompleto = problemi.length === 0;
  if (!dettaglioCompleto && snapshot) {
    const problemiSnapshot = snapshotProblems(snapshot);
    if (problemiSnapshot.length === 0) {
      return { ...snapshot, origine: "snapshot_fse", dettaglioCompleto, problemi };
    }
    problemi.push(...problemiSnapshot);
  }

  const result: DemografiaSnapshot = {
    numeroComponenti: persone.length,
    donne: 0,
    uomini: 0,
    eta017: 0,
    eta1829: 0,
    eta3064: 0,
    eta65Plus: 0,
  };
  for (const persona of persone) {
    if (persona.sesso === "F") result.donne++;
    if (persona.sesso === "M") result.uomini++;
    const eta = calcolaEta(persona.dataNascita, dataRiferimento);
    if (eta == null) continue;
    const fascia = fasciaEtaDaEta(eta);
    if (fascia === "0_17") result.eta017++;
    else if (fascia === "18_29") result.eta1829++;
    else if (fascia === "30_64") result.eta3064++;
    else result.eta65Plus++;
  }
  return { ...result, origine: "anagrafica_calcolata", dettaglioCompleto, problemi: [...new Set(problemi)] };
}

export function confrontaDemografia(snapshot: DemografiaSnapshot | null, calcolata: DemografiaNucleo) {
  if (!snapshot || !calcolata.dettaglioCompleto) return { stato: "non_confrontabile" as const, differenze: [] };
  const labels: Array<[keyof DemografiaSnapshot, string]> = [
    ["numeroComponenti", "Componenti"],
    ["donne", "Donne"],
    ["uomini", "Uomini"],
    ["eta017", "0–17"],
    ["eta1829", "18–29"],
    ["eta3064", "30–64"],
    ["eta65Plus", "65+"],
  ];
  const differenze = labels
    .filter(([key]) => snapshot[key] !== calcolata[key])
    .map(([key, dato]) => ({ dato, snapshot: snapshot[key], calcolato: calcolata[key] }));
  return { stato: differenze.length ? "non_allineato" as const : "coerente" as const, differenze };
}

export function buildFseBeneficiariWorkbook(
  rows: Array<Record<FseBeneficiariHeader, string | number | Date>>,
) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...FSE_BENEFICIARI_HEADERS], cellDates: true });
  worksheet["!cols"] = FSE_BENEFICIARI_HEADERS.map((header) => ({
    wch: Math.min(42, Math.max(12, header.length + 2)),
  }));
  for (let row = 2; row <= rows.length + 1; row++) {
    if (worksheet[`D${row}`]) worksheet[`D${row}`].z = "dd/mm/yyyy";
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, FSE_BENEFICIARI_SHEET);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: true }) as Buffer;
}
