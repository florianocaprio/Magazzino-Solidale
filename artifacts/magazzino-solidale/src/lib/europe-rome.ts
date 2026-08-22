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

function parts(date: Date): Record<string, string> {
  return Object.fromEntries(
    ROME_PARTS.formatToParts(date).map(({ type, value }) => [type, value]),
  );
}

export function isCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

export function civilDateEuropeRome(value: string | Date): string {
  const formatted = parts(typeof value === "string" ? new Date(value) : value);
  return `${formatted.year}-${formatted.month}-${formatted.day}`;
}

export function timeEuropeRome(value: string | Date): string {
  const formatted = parts(typeof value === "string" ? new Date(value) : value);
  return `${formatted.hour}:${formatted.minute}`;
}

export function todayEuropeRome(referenceDate = new Date()): string {
  return civilDateEuropeRome(referenceDate);
}

export function formatDateEuropeRome(value: string | Date): string {
  const civil =
    typeof value === "string" && isCivilDate(value)
      ? value
      : civilDateEuropeRome(value);
  const [year, month, day] = civil.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateOrDateTimeEuropeRome(value: string | Date): string {
  if (typeof value === "string" && isCivilDate(value)) {
    return formatDateEuropeRome(value);
  }
  const formatted = parts(typeof value === "string" ? new Date(value) : value);
  return `${formatted.day}/${formatted.month}/${formatted.year} ${formatted.hour}:${formatted.minute}`;
}

export function dateTimeEuropeRomeToIso(
  dateOnly: string,
  time: string,
): string {
  if (!isCivilDate(dateOnly)) throw new Error("Data non valida");
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error("Ora non valida");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Ora non valida");

  const [year, month, day] = dateOnly.split("-").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const wanted = {
    year: String(year).padStart(4, "0"),
    month: String(month).padStart(2, "0"),
    day: String(day).padStart(2, "0"),
    hour: String(hour).padStart(2, "0"),
    minute: String(minute).padStart(2, "0"),
  };
  const matches: Date[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(localAsUtc - offset * 60_000);
    const candidateParts = parts(candidate);
    if (
      candidateParts.year === wanted.year &&
      candidateParts.month === wanted.month &&
      candidateParts.day === wanted.day &&
      candidateParts.hour === wanted.hour &&
      candidateParts.minute === wanted.minute
    ) {
      matches.push(candidate);
    }
  }
  if (matches.length === 0) {
    throw new Error("La data e ora non esistono nel fuso Europe/Rome");
  }
  return matches
    .sort((left, right) => left.getTime() - right.getTime())[0]
    .toISOString();
}

export function monthRange(month: string): { da: string; a: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Mese non valido");
  const [year, numericMonth] = month.split("-").map(Number);
  if (numericMonth < 1 || numericMonth > 12) throw new Error("Mese non valido");
  const lastDay = new Date(Date.UTC(year, numericMonth, 0)).getUTCDate();
  return {
    da: `${month}-01`,
    a: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function shiftMonth(month: string, delta: number): string {
  const range = monthRange(month);
  const [year, numericMonth] = range.da.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, numericMonth - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}
