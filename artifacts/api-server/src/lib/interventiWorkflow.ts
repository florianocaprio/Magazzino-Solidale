export const INTERVENTO_STATI = [
  "da_pianificare",
  "pianificato",
  "in_corso",
  "concluso",
  "annullato",
  "mancata_presentazione",
] as const;

export const INTERVENTO_AMBITI = ["sociale", "uds"] as const;
export const INTERVENTO_PRIORITA = [
  "bassa",
  "normale",
  "alta",
  "urgente",
] as const;

export type InterventoStato = (typeof INTERVENTO_STATI)[number];
export type InterventoAmbito = (typeof INTERVENTO_AMBITI)[number];
export type InterventoPriorita = (typeof INTERVENTO_PRIORITA)[number];
export type InterventoAvviso =
  | "scaduto"
  | "oggi"
  | "imminente"
  | "prossimo"
  | null;

const TRANSIZIONI: Readonly<
  Record<InterventoStato, readonly InterventoStato[]>
> = {
  da_pianificare: ["pianificato", "in_corso", "annullato"],
  pianificato: [
    "da_pianificare",
    "in_corso",
    "annullato",
    "mancata_presentazione",
  ],
  in_corso: ["concluso", "annullato"],
  concluso: [],
  annullato: [],
  mancata_presentazione: [],
};

const EUROPE_ROME_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function isInterventoStato(value: unknown): value is InterventoStato {
  return (
    typeof value === "string" &&
    INTERVENTO_STATI.includes(value as InterventoStato)
  );
}

export function isInterventoAmbito(value: unknown): value is InterventoAmbito {
  return (
    typeof value === "string" &&
    INTERVENTO_AMBITI.includes(value as InterventoAmbito)
  );
}

export function isInterventoPriorita(
  value: unknown,
): value is InterventoPriorita {
  return (
    typeof value === "string" &&
    INTERVENTO_PRIORITA.includes(value as InterventoPriorita)
  );
}

export function canTransitionIntervento(
  from: InterventoStato,
  to: InterventoStato,
): boolean {
  return TRANSIZIONI[from].includes(to);
}

export function dataCivileEuropeRome(referenceDate = new Date()): string {
  const parts = Object.fromEntries(
    EUROPE_ROME_DATE_FORMATTER.formatToParts(referenceDate).map(
      ({ type, value }) => [type, value],
    ),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function avvisoInterventoEuropeRome(
  dataOraPianificata: Date | null,
  stato: string,
  referenceDate = new Date(),
): InterventoAvviso {
  if (
    dataOraPianificata == null ||
    (stato !== "pianificato" && stato !== "in_corso")
  )
    return null;
  if (stato === "pianificato" && dataOraPianificata < referenceDate) {
    return "scaduto";
  }
  const today = dataCivileEuropeRome(referenceDate);
  const plannedDay = dataCivileEuropeRome(dataOraPianificata);
  if (plannedDay === today) return "oggi";
  const elapsedHours =
    (dataOraPianificata.getTime() - referenceDate.getTime()) / 3_600_000;
  if (elapsedHours >= 0 && elapsedHours <= 48) return "imminente";
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const [plannedYear, plannedMonth, plannedDate] = plannedDay
    .split("-")
    .map(Number);
  const civilDays =
    (Date.UTC(plannedYear, plannedMonth - 1, plannedDate) -
      Date.UTC(todayYear, todayMonth - 1, todayDay)) /
    86_400_000;
  return civilDays >= 0 && civilDays <= 7 ? "prossimo" : null;
}

export function parseIsoTimestamp(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new Error(`${field} deve essere un timestamp ISO con fuso orario`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} non valido`);
  }
  return parsed;
}

export function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addDaysToCivilDate(value: string, days: number): string {
  if (!isDateOnly(value) || !Number.isInteger(days)) {
    throw new Error("Data civile o numero di giorni non valido");
  }
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days, 12));
  return [
    result.getUTCFullYear(),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
