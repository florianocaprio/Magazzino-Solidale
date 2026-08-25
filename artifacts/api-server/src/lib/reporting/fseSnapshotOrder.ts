import { sql, type SQL } from "drizzle-orm";

type SnapshotOrderColumns = {
  dataRiferimento: SQL;
  origineSnapshot: SQL;
  attendibilitaDato: SQL;
  versioneProfilo: SQL;
  dataCreazione: SQL;
  id: SQL;
};

/**
 * Ordinamento as-of autorevole condiviso. La data delimita la storia; a pari
 * data una fonte derivata di export non può superare manuale/import/migrazione.
 */
export function authoritativeFseSnapshotOrder(c: SnapshotOrderColumns): SQL {
  return sql`${c.dataRiferimento} DESC,
    CASE ${c.origineSnapshot}
      WHEN 'aggiornamento_manuale' THEN 4
      WHEN 'import_fse' THEN 3
      WHEN 'migrazione_esplicita' THEN 2
      WHEN 'export_fse' THEN 1
      ELSE 0
    END DESC,
    CASE ${c.attendibilitaDato}
      WHEN 'operatore_verificato' THEN 3
      WHEN 'fonte_fse_dichiarata' THEN 2
      WHEN 'anagrafica_derivata' THEN 1
      ELSE 0
    END DESC,
    ${c.versioneProfilo} DESC,
    ${c.dataCreazione} DESC,
    ${c.id} DESC`;
}

export const authoritativeSnapshotOrderForAliasS = authoritativeFseSnapshotOrder({
  dataRiferimento: sql`s.data_riferimento`,
  origineSnapshot: sql`s.origine_snapshot`,
  attendibilitaDato: sql`s.attendibilita_dato`,
  versioneProfilo: sql`s.versione_profilo`,
  dataCreazione: sql`s.data_creazione`,
  id: sql`s.id`,
});
