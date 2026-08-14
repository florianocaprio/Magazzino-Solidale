import { and, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { interventiTable } from "@workspace/db";
import {
  dataCivileEuropeRome,
  isDateOnly,
  type InterventoStato,
} from "./interventiWorkflow";

export const INTERVENTO_VISTE = [
  "da_pianificare",
  "pianificati",
  "oggi",
  "in_corso",
  "conclusi",
  "annullati",
] as const;

export const INTERVENTO_ORDINAMENTI = [
  "data",
  "priorita",
  "beneficiario",
  "operatore",
] as const;

export type InterventoVista = (typeof INTERVENTO_VISTE)[number];
export type InterventoOrdinamento = (typeof INTERVENTO_ORDINAMENTI)[number];

const ROME_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function civilParts(date: Date) {
  return Object.fromEntries(
    ROME_PARTS.formatToParts(date).map(({ type, value }) => [type, value]),
  );
}

function addCivilDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Converte una data/ora civile di Roma in un istante, senza usare il TZ del processo. */
export function dateTimeEuropeRomeToUtc(
  dateOnly: string,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  if (!isDateOnly(dateOnly)) throw new Error("Data civile non valida");
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !Number.isInteger(second) ||
    second < 0 ||
    second > 59
  ) {
    throw new Error("Ora civile non valida");
  }

  const [year, month, day] = dateOnly.split("-").map(Number);
  const target = {
    year: String(year).padStart(4, "0"),
    month: String(month).padStart(2, "0"),
    day: String(day).padStart(2, "0"),
    hour: String(hour).padStart(2, "0"),
    minute: String(minute).padStart(2, "0"),
    second: String(second).padStart(2, "0"),
  };
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const matches: Date[] = [];

  // Gli offset reali sono multipli di 15 minuti; il ciclo rende espliciti
  // anche i casi ambigui/inesistenti dei cambi d'ora.
  for (
    let offsetMinutes = -14 * 60;
    offsetMinutes <= 14 * 60;
    offsetMinutes += 15
  ) {
    const candidate = new Date(localAsUtc - offsetMinutes * 60_000);
    const parts = civilParts(candidate);
    if (
      parts.year === target.year &&
      parts.month === target.month &&
      parts.day === target.day &&
      parts.hour === target.hour &&
      parts.minute === target.minute &&
      parts.second === target.second
    ) {
      matches.push(candidate);
    }
  }

  if (matches.length === 0) {
    throw new Error("La data e ora non esistono nel fuso Europe/Rome");
  }
  // Nel rientro all'ora solare l'ora 02:xx esiste due volte: scegliamo
  // deterministically la prima occorrenza (ancora in ora legale).
  return matches.sort((left, right) => left.getTime() - right.getTime())[0];
}

export function intervalloGiornoEuropeRome(dateOnly: string): {
  start: Date;
  end: Date;
} {
  return {
    start: dateTimeEuropeRomeToUtc(dateOnly),
    end: dateTimeEuropeRomeToUtc(addCivilDays(dateOnly, 1)),
  };
}

export function intervalloOggiEuropeRome(referenceDate = new Date()): {
  date: string;
  start: Date;
  end: Date;
} {
  const date = dataCivileEuropeRome(referenceDate);
  return { date, ...intervalloGiornoEuropeRome(date) };
}

function inRange(
  column:
    | typeof interventiTable.dataOraPianificata
    | typeof interventiTable.dataOraAvvio,
  start: Date,
  end: Date,
) {
  return and(gte(column, start), lt(column, end))!;
}

export function condizioneVistaInterventi(
  vista: InterventoVista,
  referenceDate = new Date(),
): SQL {
  const today = intervalloOggiEuropeRome(referenceDate);
  switch (vista) {
    case "da_pianificare":
      return eq(interventiTable.stato, "da_pianificare");
    case "pianificati":
      return and(
        eq(interventiTable.stato, "pianificato"),
        gte(interventiTable.dataOraPianificata, today.end),
      )!;
    case "oggi":
      return or(
        and(
          eq(interventiTable.stato, "pianificato"),
          inRange(interventiTable.dataOraPianificata, today.start, today.end),
        ),
        and(
          eq(interventiTable.stato, "in_corso"),
          or(
            inRange(interventiTable.dataOraPianificata, today.start, today.end),
            inRange(interventiTable.dataOraAvvio, today.start, today.end),
          ),
        ),
      )!;
    case "in_corso":
      return eq(interventiTable.stato, "in_corso");
    case "conclusi":
      return eq(interventiTable.stato, "concluso");
    case "annullati":
      return inArray(interventiTable.stato, [
        "annullato",
        "mancata_presentazione",
      ] satisfies InterventoStato[]);
  }
}

export function prioritaOrdineSql(): SQL {
  return sql`case ${interventiTable.priorita}
    when 'urgente' then 1
    when 'alta' then 2
    when 'normale' then 3
    when 'bassa' then 4
    else 5 end`;
}

export function durataIntervalloCivile(da: string, a: string): number {
  if (!isDateOnly(da) || !isDateOnly(a)) {
    throw new Error("da e a devono essere date nel formato YYYY-MM-DD");
  }
  const start = Date.parse(`${da}T00:00:00Z`);
  const end = Date.parse(`${a}T00:00:00Z`);
  if (end < start) throw new Error("a non può precedere da");
  return Math.round((end - start) / 86_400_000) + 1;
}

export function intervalloDateEuropeRome(
  da: string,
  a: string,
): {
  start: Date;
  end: Date;
} {
  const days = durataIntervalloCivile(da, a);
  if (days > 366) throw new Error("L'intervallo non può superare 366 giorni");
  return {
    start: dateTimeEuropeRomeToUtc(da),
    end: dateTimeEuropeRomeToUtc(addCivilDays(a, 1)),
  };
}
