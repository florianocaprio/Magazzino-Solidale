import { sql, type SQL } from "drizzle-orm";
import { calcolaEta, fasciaEtaDaEta, type FasciaEtaCorrente } from "@workspace/api-zod";

export function reportingAgeBand(
  dataNascita: string | null | undefined,
  fasciaPresunta: string | null | undefined,
  referenceDate: string,
): FasciaEtaCorrente {
  const age = dataNascita
    ? calcolaEta(dataNascita, new Date(`${referenceDate}T12:00:00Z`))
    : null;
  if (age != null) return fasciaEtaDaEta(age);
  if (["0_17", "18_29", "30_64", "65_plus"].includes(fasciaPresunta ?? "")) {
    return fasciaPresunta as FasciaEtaCorrente;
  }
  return "non_determinata";
}

/** Shared SQL definition used by every aggregate requiring age bands. */
export function reportingAgeBandSql(
  dataNascita: SQL,
  fasciaPresunta: SQL,
  referenceDate: string,
): SQL {
  return sql`CASE
    WHEN ${dataNascita} IS NOT NULL AND age(${referenceDate}::date, ${dataNascita}) < interval '18 years' THEN '0_17'
    WHEN ${dataNascita} IS NOT NULL AND age(${referenceDate}::date, ${dataNascita}) < interval '30 years' THEN '18_29'
    WHEN ${dataNascita} IS NOT NULL AND age(${referenceDate}::date, ${dataNascita}) < interval '65 years' THEN '30_64'
    WHEN ${dataNascita} IS NOT NULL THEN '65_plus'
    WHEN ${fasciaPresunta} IN ('0_17', '18_29', '30_64', '65_plus') THEN ${fasciaPresunta}
    ELSE 'non_determinata'
  END`;
}
