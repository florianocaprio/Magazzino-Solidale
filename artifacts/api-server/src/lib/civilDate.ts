const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isCivilYearMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = YEAR_MONTH.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1000 && month >= 1 && month <= 12;
}

export function civilMonth(value: string): string {
  return value.slice(0, 7);
}
