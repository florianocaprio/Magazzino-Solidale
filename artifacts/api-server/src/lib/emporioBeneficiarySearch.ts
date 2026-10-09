import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { beneficiariTable, tessereBeneficiariTable } from "@workspace/db";
import { dataCivileEuropeRome } from "./interventiWorkflow";

export function emporioValidCardCondition(search: string): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${tessereBeneficiariTable} t
    where t.beneficiario_id = ${beneficiariTable.id} and t.codice = ${search}
    and t.stato = 'attiva' and t.data_revoca is null
    and (t.data_scadenza is null or t.data_scadenza >= ${dataCivileEuropeRome(new Date())}::date))`;
}
export function emporioBeneficiarySearchCondition(
  search: string,
  cardOnly = false,
): SQL {
  const card = emporioValidCardCondition(search);
  if (cardOnly || search.startsWith("MS-")) return card;
  const prefix = (s: string) => s.replace(/[\\%_]/g, "\\$&") + "%";
  return or(
    card,
    eq(beneficiariTable.codice, search),
    and(
      ...search
        .trim()
        .split(/\s+/)
        .map((term) =>
          or(
            ilike(beneficiariTable.nome, prefix(term)),
            ilike(beneficiariTable.cognome, prefix(term)),
            ilike(beneficiariTable.nome, `% ${prefix(term)}`),
            ilike(beneficiariTable.cognome, `% ${prefix(term)}`),
          ),
        ),
    ),
  )!;
}
