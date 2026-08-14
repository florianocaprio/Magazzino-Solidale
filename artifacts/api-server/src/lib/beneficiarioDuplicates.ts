import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface BeneficiarioDuplicateSearch {
  cittaId: number;
  search?: string;
  nome?: string;
  cognome?: string;
  soprannome?: string;
  telefono?: string;
  dataNascita?: string;
  excludeId?: number | null;
}

export interface BeneficiarioDuplicate {
  id: number;
  codice: string;
  nome: string;
  cognome: string;
  soprannome: string | null;
  dataNascita: string | null;
  telefono: string | null;
  cittaId: number;
  cittaNome: string | null;
  zonaUdsId: number | null;
  zonaUdsNome: string | null;
  centroAscoltoId: number | null;
  centroAscoltoNome: string | null;
  uds: boolean;
  score: number;
}

/** Ricerca anti-duplicato condivisa. La città è sempre obbligatoria e i record
 * legacy senza città restano esclusi dall'uguaglianza SQL. */
export async function searchBeneficiariDuplicates(
  input: BeneficiarioDuplicateSearch,
): Promise<BeneficiarioDuplicate[]> {
  const search = (input.search ?? "").trim().toLowerCase();
  const nome = (input.nome ?? "").trim();
  const cognome = (input.cognome ?? "").trim();
  const soprannome = (input.soprannome ?? "").trim().toLowerCase();
  const telefono = (input.telefono ?? "").trim();
  const dataNascita = (input.dataNascita ?? "").trim();
  const full = `${nome} ${cognome}`.trim().toLowerCase();
  if (search.length === 1) return [];
  if (!search && !full && !soprannome && !telefono && !dataNascita) return [];
  const searchLike = `%${search}%`;

  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT
        b.id, b.codice, b.nome, b.cognome, b.soprannome,
        b.data_nascita::text AS "dataNascita", b.telefono,
        b.citta_id AS "cittaId", c.nome AS "cittaNome",
        b.zona_uds_id AS "zonaUdsId", z.nome AS "zonaUdsNome",
        b.centro_ascolto_id AS "centroAscoltoId", ca.nome AS "centroAscoltoNome",
        b.uds AS "uds",
        (
          CASE WHEN ${search} <> '' THEN GREATEST(
            similarity(lower(coalesce(b.nome, '')), ${search}),
            similarity(lower(coalesce(b.cognome, '')), ${search}),
            similarity(lower(coalesce(b.nome, '') || ' ' || coalesce(b.cognome, '')), ${search}),
            similarity(lower(coalesce(b.cognome, '') || ' ' || coalesce(b.nome, '')), ${search}),
            similarity(lower(coalesce(b.soprannome, '')), ${search}),
            similarity(lower(coalesce(b.telefono, '')), ${search}),
            similarity(lower(coalesce(b.codice, '')), ${search}),
            similarity(lower(coalesce(b.codice_fiscale, '')), ${search}),
            CASE WHEN lower(coalesce(b.nome, '')) LIKE ${searchLike} THEN 0.7 ELSE 0 END,
            CASE WHEN lower(coalesce(b.cognome, '')) LIKE ${searchLike} THEN 0.7 ELSE 0 END,
            CASE WHEN lower(coalesce(b.nome, '') || ' ' || coalesce(b.cognome, '')) LIKE ${searchLike} THEN 0.8 ELSE 0 END,
            CASE WHEN lower(coalesce(b.cognome, '') || ' ' || coalesce(b.nome, '')) LIKE ${searchLike} THEN 0.8 ELSE 0 END,
            CASE WHEN lower(coalesce(b.soprannome, '')) LIKE ${searchLike} THEN 0.7 ELSE 0 END,
            CASE WHEN lower(coalesce(b.telefono, '')) LIKE ${searchLike} THEN 0.8 ELSE 0 END,
            CASE WHEN lower(coalesce(b.codice, '')) LIKE ${searchLike} THEN 0.9 ELSE 0 END,
            CASE WHEN lower(coalesce(b.codice_fiscale, '')) LIKE ${searchLike} THEN 0.9 ELSE 0 END
          ) ELSE 0 END
          + GREATEST(
            similarity(lower(coalesce(b.nome, '') || ' ' || coalesce(b.cognome, '')), ${full}),
            similarity(lower(coalesce(b.cognome, '') || ' ' || coalesce(b.nome, '')), ${full})
          )
          + CASE WHEN ${soprannome} <> '' THEN similarity(lower(coalesce(b.soprannome, '')), ${soprannome}) * 0.5 ELSE 0 END
          + CASE WHEN ${telefono} <> '' THEN (CASE WHEN b.telefono = ${telefono} THEN 0.5 ELSE similarity(coalesce(b.telefono, ''), ${telefono}) * 0.3 END) ELSE 0 END
          + CASE WHEN ${dataNascita} <> '' AND b.data_nascita IS NOT NULL AND b.data_nascita::text = ${dataNascita} THEN 0.4 ELSE 0 END
        )::float8 AS score
      FROM beneficiari b
      LEFT JOIN citta c ON c.id = b.citta_id
      LEFT JOIN zone_uds z ON z.id = b.zona_uds_id
      LEFT JOIN centri_di_ascolto ca ON ca.id = b.centro_ascolto_id
      WHERE b.citta_id = ${input.cittaId}::int
        AND (${input.excludeId ?? null}::int IS NULL OR b.id <> ${input.excludeId ?? null}::int)
    ) s
    WHERE s.score >= 0.2
    ORDER BY s.score DESC
    LIMIT 10
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    codice: String(row.codice),
    nome: String(row.nome),
    cognome: String(row.cognome),
    soprannome: (row.soprannome as string | null) ?? null,
    dataNascita: (row.dataNascita as string | null) ?? null,
    telefono: (row.telefono as string | null) ?? null,
    cittaId: Number(row.cittaId),
    cittaNome: (row.cittaNome as string | null) ?? null,
    zonaUdsId: (row.zonaUdsId as number | null) ?? null,
    zonaUdsNome: (row.zonaUdsNome as string | null) ?? null,
    centroAscoltoId: (row.centroAscoltoId as number | null) ?? null,
    centroAscoltoNome: (row.centroAscoltoNome as string | null) ?? null,
    uds: Boolean(row.uds),
    score: Math.round(Number(row.score) * 100) / 100,
  }));
}
