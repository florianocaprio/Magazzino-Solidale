export const FASCE_ETA_PRESUNTE = ["0_17", "18_29", "30_64", "65_plus"] as const;

export type FasciaEtaPresunta = (typeof FASCE_ETA_PRESUNTE)[number];
export type FasciaEtaCorrente = FasciaEtaPresunta | "non_determinata";
export type FasciaEtaOrigine = "calcolata" | "presunta" | "non_determinata";

export interface FasciaEtaRisolta {
  fascia: FasciaEtaCorrente;
  origine: FasciaEtaOrigine;
}

interface DateOnlyParts {
  year: number;
  month: number;
  day: number;
}

function parseDateOnly(value: string): DateOnlyParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function referenceDateParts(referenceDate: Date): DateOnlyParts | null {
  if (Number.isNaN(referenceDate.getTime())) return null;
  return {
    year: referenceDate.getFullYear(),
    month: referenceDate.getMonth() + 1,
    day: referenceDate.getDate(),
  };
}

export function isFasciaEtaPresunta(value: unknown): value is FasciaEtaPresunta {
  return FASCE_ETA_PRESUNTE.includes(value as FasciaEtaPresunta);
}

export function calcolaEta(
  dataNascita: string | null | undefined,
  referenceDate = new Date(),
): number | null {
  if (!dataNascita) return null;
  const birth = parseDateOnly(dataNascita);
  const reference = referenceDateParts(referenceDate);
  if (!birth || !reference) return null;

  if (
    birth.year > reference.year ||
    (birth.year === reference.year && birth.month > reference.month) ||
    (birth.year === reference.year && birth.month === reference.month && birth.day > reference.day)
  ) {
    return null;
  }

  let age = reference.year - birth.year;
  if (birth.month > reference.month || (birth.month === reference.month && birth.day > reference.day)) {
    age -= 1;
  }
  return age;
}

export function fasciaEtaDaEta(age: number): FasciaEtaPresunta {
  if (age <= 17) return "0_17";
  if (age <= 29) return "18_29";
  if (age <= 64) return "30_64";
  return "65_plus";
}

export function risolviFasciaEta(
  dataNascita: string | null | undefined,
  fasciaEtaPresunta: string | null | undefined,
  referenceDate = new Date(),
): FasciaEtaRisolta {
  const age = calcolaEta(dataNascita, referenceDate);
  if (age != null) return { fascia: fasciaEtaDaEta(age), origine: "calcolata" };
  if (isFasciaEtaPresunta(fasciaEtaPresunta)) {
    return { fascia: fasciaEtaPresunta, origine: "presunta" };
  }
  return { fascia: "non_determinata", origine: "non_determinata" };
}
