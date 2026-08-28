export const VOLONTARIO_TYPES = ["PERMANENTE", "TEMPORANEO"] as const;
export type VolontarioType = (typeof VOLONTARIO_TYPES)[number];

export const INSURANCE_STATES = [
  "TEMPORANEA",
  "MANCANTE",
  "VALIDA",
  "IN_SCADENZA",
  "SCADUTA",
  "NON_ANCORA_VALIDA",
] as const;
export type InsuranceState = (typeof INSURANCE_STATES)[number];

export type OperationalState = {
  operativo: boolean;
  motivoNonOperativo: string | null;
  statoAssicurazione: InsuranceState;
  scadenzaAssicurazione: string | null;
  sospesoManualmente: boolean;
  giornataTemporaneaValida: boolean | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function todayRome(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function parts(date: string): [number, number, number] {
  if (!isDateOnly(date)) throw new Error("Data non valida");
  return [
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
  ];
}

function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
}

export function addCalendarMonthsClamped(date: string, months: number): string {
  if (!Number.isSafeInteger(months))
    throw new Error("Durata in mesi non valida");
  const [year, month, day] = parts(date);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonthZero = ((zeroBased % 12) + 12) % 12;
  const targetMonth = targetMonthZero + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

/**
 * Scadenza inclusiva di una nuova copertura. Se la ricorrenza del giorno non
 * esiste (es. 29/02), il termine resta l'ultimo giorno del mese di arrivo.
 */
export function inclusiveCoverageEnd(start: string, months: number): string {
  if (!Number.isSafeInteger(months) || months <= 0)
    throw new Error("Durata in mesi non valida");
  const target = addCalendarMonthsClamped(start, months);
  const originalDay = parts(start)[2];
  const targetDay = parts(target)[2];
  return targetDay === originalDay ? addCalendarDays(target, -1) : target;
}

export function extendedCoverageEnd(
  currentEnd: string,
  months: number,
): string {
  if (!Number.isSafeInteger(months) || months <= 0)
    throw new Error("Durata in mesi non valida");
  return addCalendarMonthsClamped(currentEnd, months);
}

export function subtractCalendarMonths(date: string, months: number): string {
  return addCalendarMonthsClamped(date, -months);
}

export function normalizeCodiceFiscale(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return normalized || null;
}

export function normalizePhone(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const plus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/\D/g, "");
  return digits ? `${plus}${digits}` : null;
}

export function normalizeEmail(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

export function normalizeRoleName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeComparableText(value: unknown): string {
  return normalizeRoleName(value);
}

export function parseFullName(value: unknown): {
  nome: string | null;
  cognome: string | null;
  warning: string | null;
} {
  const raw = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!raw)
    return { nome: null, cognome: null, warning: "Cognome e Nome mancante" };
  if (raw.includes(",")) {
    const [cognome, ...rest] = raw.split(",").map((item) => item.trim());
    const nome = rest.join(" ").trim();
    return {
      nome: nome || null,
      cognome: cognome || null,
      warning:
        nome && cognome ? null : "Separazione del nominativo da verificare",
    };
  }
  const tokens = raw.split(" ");
  if (tokens.length < 2)
    return {
      nome: null,
      cognome: raw,
      warning: "Nome mancante o non separabile",
    };
  // Il tracciato storico dichiara “Cognome e Nome”: il primo token resta il
  // cognome e la preview evidenzia l'ambiguità per i cognomi composti.
  return {
    cognome: tokens[0],
    nome: tokens.slice(1).join(" "),
    warning:
      tokens.length > 2 ? "Verificare la separazione tra cognome e nome" : null,
  };
}

export function evaluateOperationalState(input: {
  approvazione: string;
  amministrativamenteAttivo: boolean;
  sospesoManualmente?: boolean;
  tipoVolontario: string;
  riferimento: string;
  coperture: Array<{
    dataInizio: string | null;
    dataFine: string;
    annullata: boolean;
  }>;
  giornataValida: boolean;
}): OperationalState {
  const isTemporary = input.tipoVolontario === "TEMPORANEO";
  const coperture = input.coperture
    .filter((item) => !item.annullata)
    .sort((left, right) => right.dataFine.localeCompare(left.dataFine));
  const current = coperture.find(
    (item) =>
      (item.dataInizio == null || item.dataInizio <= input.riferimento) &&
      item.dataFine >= input.riferimento,
  );
  const latest = coperture[0] ?? null;
  const future = coperture.find(
    (item) => item.dataInizio != null && item.dataInizio > input.riferimento,
  );
  let statoAssicurazione: InsuranceState;
  if (isTemporary) statoAssicurazione = "TEMPORANEA";
  else if (current) {
    const warningEnd = addCalendarDays(input.riferimento, 30);
    statoAssicurazione =
      current.dataFine <= warningEnd ? "IN_SCADENZA" : "VALIDA";
  } else if (future) statoAssicurazione = "NON_ANCORA_VALIDA";
  else if (latest) statoAssicurazione = "SCADUTA";
  else statoAssicurazione = "MANCANTE";

  const base = {
    statoAssicurazione,
    scadenzaAssicurazione: isTemporary
      ? null
      : (current?.dataFine ?? latest?.dataFine ?? future?.dataFine ?? null),
    sospesoManualmente:
      input.sospesoManualmente ?? !input.amministrativamenteAttivo,
    giornataTemporaneaValida: isTemporary ? input.giornataValida : null,
  };
  if (input.approvazione !== "approvato") {
    return {
      ...base,
      operativo: false,
      motivoNonOperativo:
        input.approvazione === "respinto"
          ? "APPROVAZIONE_RESPINTA"
          : "IN_ATTESA_APPROVAZIONE",
    };
  }
  if (!input.amministrativamenteAttivo) {
    return {
      ...base,
      operativo: false,
      motivoNonOperativo: "SOSPENSIONE_MANUALE",
    };
  }
  if (isTemporary) {
    return input.giornataValida
      ? { ...base, operativo: true, motivoNonOperativo: null }
      : {
          ...base,
          operativo: false,
          motivoNonOperativo: "GIORNATA_TEMPORANEA_MANCANTE",
        };
  }
  if (!current) {
    const reason =
      statoAssicurazione === "SCADUTA"
        ? "ASSICURAZIONE_SCADUTA"
        : statoAssicurazione === "NON_ANCORA_VALIDA"
          ? "ASSICURAZIONE_NON_ANCORA_VALIDA"
          : "ASSICURAZIONE_MANCANTE";
    return { ...base, operativo: false, motivoNonOperativo: reason };
  }
  return { ...base, operativo: true, motivoNonOperativo: null };
}
