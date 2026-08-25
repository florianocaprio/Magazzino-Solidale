/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  insertBollaSchema,
  insertConsegnaSchema,
  insertInterventoSchema,
  pool,
} from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260829_reporting_2_0_hardening.sql",
  import.meta.url,
);
const residualMigrationUrl = new URL(
  "../../../lib/db/updates/20260830_reporting_2_0_residual_workflow_hardening.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

async function rejectsAtSavepoint(
  client: Awaited<ReturnType<typeof pool.connect>>,
  name: string,
  query: string,
  values: unknown[] = [],
) {
  await client.query(`SAVEPOINT ${name}`);
  await expect(client.query(query, values)).rejects.toThrow();
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
}

describe("Reporting 2.0 hardening migration", () => {
  it("mantiene gli snapshot fuori dai payload pubblici", () => {
    const bolla = insertBollaSchema.parse({
      numeroBolla: "PUBLIC-SNAPSHOT",
      dataBolla: "2026-08-24",
      beneficiarioId: 1,
      magazzinoId: 1,
      areaOperativaIdSnapshot: 999,
      centroAscoltoIdSnapshot: 999,
      numeroComponentiNucleoSnapshot: 999,
    });
    const delivery = insertConsegnaSchema.parse({
      codice: "PUBLIC-SNAPSHOT",
      beneficiarioId: 1,
      tipoConsegna: "in_sede",
      dataPrevista: "2026-08-24",
      magazzinoId: 1,
      areaOperativaIdSnapshot: 999,
      centroAscoltoIdSnapshot: 999,
    });
    const intervention = insertInterventoSchema.parse({
      beneficiarioId: 1,
      tipoIntervento: "test",
      areaOperativaIdSnapshot: 999,
      centroAscoltoIdSnapshot: 999,
      zonaUdsIdSnapshot: 999,
    });
    for (const parsed of [bolla, delivery, intervention]) {
      expect(parsed).not.toHaveProperty("areaOperativaIdSnapshot");
      expect(parsed).not.toHaveProperty("centroAscoltoIdSnapshot");
      expect(parsed).not.toHaveProperty("numeroComponentiNucleoSnapshot");
      expect(parsed).not.toHaveProperty("zonaUdsIdSnapshot");
    }
  });

  it("è additiva, idempotente e rende immutabili territorio e snapshot storici", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    const residualMigrationSql = await readFile(residualMigrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrationSql).not.toMatch(
      /\bUPDATE\s+(public\.)?(bolle|consegne|interventi|operazioni_distribuzione_magazzino)\b/i,
    );
    expect(residualMigrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(residualMigrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(residualMigrationSql).not.toMatch(
      /\bUPDATE\s+(public\.)?(bolle|consegne|interventi|operazioni_distribuzione_magazzino)\b/i,
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migrationSql);
      await client.query(residualMigrationSql);

      const areaA = await client.query<{ id: number }>(
        "INSERT INTO aree_operative (nome) VALUES ('Reporting hardening A') RETURNING id",
      );
      const areaB = await client.query<{ id: number }>(
        "INSERT INTO aree_operative (nome) VALUES ('Reporting hardening B') RETURNING id",
      );
      const areaAId = areaA.rows[0].id;
      const areaBId = areaB.rows[0].id;
      const centreA = await client.query<{ id: number }>(
        "INSERT INTO centri_di_ascolto (nome, area_operativa_id) VALUES ('Reporting hardening A', $1) RETURNING id",
        [areaAId],
      );
      const centreB = await client.query<{ id: number }>(
        "INSERT INTO centri_di_ascolto (nome, area_operativa_id) VALUES ('Reporting hardening B', $1) RETURNING id",
        [areaBId],
      );
      const centreAId = centreA.rows[0].id;
      const centreBId = centreB.rows[0].id;
      const user = await client.query<{ id: number }>(
        "INSERT INTO utenti (username, password_hash, nome) VALUES ('reporting-hardening-user', 'test', 'Test') RETURNING id",
      );
      const warehouse = await client.query<{ id: number }>(
        "INSERT INTO magazzini (codice, nome) VALUES ('RPT-HARD', 'Reporting hardening shared') RETURNING id",
      );
      const beneficiary = await client.query<{ id: number }>(
        "INSERT INTO beneficiari (codice, nome, cognome) VALUES ('RPT-HARD', 'Test', 'Reporting') RETURNING id",
      );
      const beneficiaryId = beneficiary.rows[0].id;

      await rejectsAtSavepoint(
        client,
        "bolla_mixed_territory",
        `INSERT INTO bolle (
           numero_bolla, data_bolla, beneficiario_id, magazzino_id,
           area_operativa_id_snapshot, centro_ascolto_id_snapshot
         ) VALUES ('RPT-HARD-MIX-B', '2026-08-24', $1, $2, $3, $4)`,
        [beneficiaryId, warehouse.rows[0].id, areaAId, centreBId],
      );
      await rejectsAtSavepoint(
        client,
        "delivery_mixed_territory",
        `INSERT INTO consegne (
           codice, beneficiario_id, tipo_consegna, data_prevista, magazzino_id,
           area_operativa_id_snapshot, centro_ascolto_id_snapshot
         ) VALUES ('RPT-HARD-MIX-C', $1, 'in_sede', '2026-08-24', $2, $3, $4)`,
        [beneficiaryId, warehouse.rows[0].id, areaAId, centreBId],
      );
      await rejectsAtSavepoint(
        client,
        "intervention_mixed_territory",
        `INSERT INTO interventi (
           beneficiario_id, tipo_intervento, ambito, stato,
           area_operativa_id_snapshot, centro_ascolto_id_snapshot
         ) VALUES ($1, 'reporting mixed', 'sociale', 'concluso', $2, $3)`,
        [beneficiaryId, areaAId, centreBId],
      );
      await expect(
        client.query(
          `INSERT INTO interventi (
             beneficiario_id, tipo_intervento, ambito, stato,
             area_operativa_id_snapshot, centro_ascolto_id_snapshot
           ) VALUES ($1, 'reporting area only', 'sociale', 'concluso', $2, NULL)`,
          [beneficiaryId, areaAId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      const bolla = await client.query<{ id: number }>(
        `INSERT INTO bolle (numero_bolla, data_bolla, beneficiario_id, magazzino_id)
         VALUES ('RPT-HARD-B', '2026-08-24', $1, $2) RETURNING id`,
        [beneficiaryId, warehouse.rows[0].id],
      );
      await expect(
        client.query(
          `UPDATE bolle SET area_operativa_id_snapshot=$1,
             centro_ascolto_id_snapshot=$2, numero_componenti_nucleo_snapshot=2
           WHERE id=$3`,
          [areaAId, centreAId, bolla.rows[0].id],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await rejectsAtSavepoint(
        client,
        "bolla_rewrite",
        "UPDATE bolle SET area_operativa_id_snapshot=$1 WHERE id=$2",
        [areaBId, bolla.rows[0].id],
      );
      await rejectsAtSavepoint(
        client,
        "bolla_clear",
        "UPDATE bolle SET centro_ascolto_id_snapshot=NULL WHERE id=$1",
        [bolla.rows[0].id],
      );
      await rejectsAtSavepoint(
        client,
        "bolla_invalid_household",
        `INSERT INTO bolle (
           numero_bolla, data_bolla, beneficiario_id, magazzino_id,
           numero_componenti_nucleo_snapshot
         ) VALUES ('RPT-HARD-ZERO', '2026-08-24', $1, $2, 0)`,
        [beneficiaryId, warehouse.rows[0].id],
      );

      const delivery = await client.query<{ id: number }>(
        `INSERT INTO consegne (
           codice, beneficiario_id, tipo_consegna, data_prevista, magazzino_id
         ) VALUES ('RPT-HARD-C', $1, 'in_sede', '2026-08-24', $2) RETURNING id`,
        [beneficiaryId, warehouse.rows[0].id],
      );
      await client.query(
        "UPDATE consegne SET area_operativa_id_snapshot=$1, centro_ascolto_id_snapshot=$2 WHERE id=$3",
        [areaAId, centreAId, delivery.rows[0].id],
      );
      await rejectsAtSavepoint(
        client,
        "delivery_rewrite",
        "UPDATE consegne SET centro_ascolto_id_snapshot=$1 WHERE id=$2",
        [centreBId, delivery.rows[0].id],
      );

      const intervention = await client.query<{ id: number }>(
        `INSERT INTO interventi (beneficiario_id, tipo_intervento, ambito, stato)
         VALUES ($1, 'reporting', 'sociale', 'concluso') RETURNING id`,
        [beneficiaryId],
      );
      await client.query(
        "UPDATE interventi SET area_operativa_id_snapshot=$1, centro_ascolto_id_snapshot=$2 WHERE id=$3",
        [areaAId, centreAId, intervention.rows[0].id],
      );
      await rejectsAtSavepoint(
        client,
        "intervention_rewrite",
        "UPDATE interventi SET area_operativa_id_snapshot=$1 WHERE id=$2",
        [areaBId, intervention.rows[0].id],
      );

      const operation = await client.query<{ id: number }>(
        `INSERT INTO operazioni_distribuzione_magazzino (
           magazzino_id, data_distribuzione, canale_operativo,
           dominio_origine, entita_origine_tipo, entita_origine_id, creato_da
         ) VALUES ($1, '2026-08-24', 'PACCHI', 'TEST', 'RPT_HARD', 1, $2)
         RETURNING id`,
        [warehouse.rows[0].id, user.rows[0].id],
      );
      await expect(
        client.query(
          `UPDATE operazioni_distribuzione_magazzino
           SET territorio_classificazione='attribuito',
               area_operativa_id_snapshot=$1, centro_ascolto_id_snapshot=$2
           WHERE id=$3`,
          [areaAId, centreAId, operation.rows[0].id],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await rejectsAtSavepoint(
        client,
        "operation_mixed_territory",
        `INSERT INTO operazioni_distribuzione_magazzino (
           magazzino_id, data_distribuzione, canale_operativo,
           dominio_origine, entita_origine_tipo, entita_origine_id, creato_da,
           territorio_classificazione, area_operativa_id_snapshot,
           centro_ascolto_id_snapshot
         ) VALUES ($1, '2026-08-24', 'PACCHI', 'TEST', 'RPT_HARD_MIX', 2, $2,
           'attribuito', $3, $4)`,
        [warehouse.rows[0].id, user.rows[0].id, areaAId, centreBId],
      );
      await expect(
        client.query(
          `UPDATE operazioni_distribuzione_magazzino
           SET numero_pasti=12 WHERE id=$1`,
          [operation.rows[0].id],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        client.query(
          `UPDATE operazioni_distribuzione_magazzino
           SET numero_pasti=12 WHERE id=$1`,
          [operation.rows[0].id],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await rejectsAtSavepoint(
        client,
        "operation_statistics_rewrite",
        `UPDATE operazioni_distribuzione_magazzino
         SET numero_pasti=13 WHERE id=$1`,
        [operation.rows[0].id],
      );
      await rejectsAtSavepoint(
        client,
        "operation_rewrite",
        `UPDATE operazioni_distribuzione_magazzino
         SET area_operativa_id_snapshot=$1, centro_ascolto_id_snapshot=$2
         WHERE id=$3`,
        [areaBId, centreBId, operation.rows[0].id],
      );
      await rejectsAtSavepoint(
        client,
        "operation_classification_rewrite",
        `UPDATE operazioni_distribuzione_magazzino
         SET territorio_classificazione='universale',
             area_operativa_id_snapshot=NULL, centro_ascolto_id_snapshot=NULL
         WHERE id=$1`,
        [operation.rows[0].id],
      );

      await rejectsAtSavepoint(
        client,
        "delete_referenced_centre",
        "DELETE FROM centri_di_ascolto WHERE id=$1",
        [centreAId],
      );
      await rejectsAtSavepoint(
        client,
        "delete_referenced_area",
        "DELETE FROM aree_operative WHERE id=$1",
        [areaAId],
      );

      await client.query(
        `INSERT INTO fse_fascicoli_sociali_snapshot (
           beneficiario_id, data_riferimento, origine_snapshot,
           versione_profilo, hash_canonico
         ) VALUES ($1, '2026-08-24', 'import_fse', 1, repeat('a', 64))`,
        [beneficiaryId],
      );
      await rejectsAtSavepoint(
        client,
        "duplicate_authoritative_version",
        `INSERT INTO fse_fascicoli_sociali_snapshot (
           beneficiario_id, data_riferimento, origine_snapshot,
           versione_profilo, hash_canonico
         ) VALUES ($1, '2026-08-25', 'aggiornamento_manuale', 1, repeat('b', 64))`,
        [beneficiaryId],
      );
      await expect(
        client.query(
          `INSERT INTO fse_fascicoli_sociali_snapshot (
             beneficiario_id, data_riferimento, origine_snapshot,
             versione_profilo, hash_canonico
           ) VALUES ($1, '2026-08-25', 'export_fse', 1, repeat('c', 64))`,
          [beneficiaryId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      const beforeReplay = await client.query(`
        SELECT
          (SELECT count(*)::int FROM beneficiari) AS beneficiari,
          (SELECT count(*)::int FROM bolle) AS bolle,
          (SELECT count(*)::int FROM consegne) AS consegne,
          (SELECT count(*)::int FROM interventi) AS interventi,
          (SELECT count(*)::int FROM operazioni_distribuzione_magazzino) AS operazioni
      `);
      await client.query(migrationSql);
      await client.query(residualMigrationSql);
      const afterReplay = await client.query(`
        SELECT
          (SELECT count(*)::int FROM beneficiari) AS beneficiari,
          (SELECT count(*)::int FROM bolle) AS bolle,
          (SELECT count(*)::int FROM consegne) AS consegne,
          (SELECT count(*)::int FROM interventi) AS interventi,
          (SELECT count(*)::int FROM operazioni_distribuzione_magazzino) AS operazioni
      `);
      expect(afterReplay.rows[0]).toEqual(beforeReplay.rows[0]);

      const constraints = await client.query<{
        conname: string;
        confdeltype: string;
      }>(`
        SELECT conname, confdeltype FROM pg_constraint
        WHERE conname = ANY(ARRAY[
          'bolle_area_snapshot_fk', 'bolle_centro_snapshot_fk',
          'consegne_area_snapshot_fk', 'consegne_centro_snapshot_fk',
          'interventi_area_snapshot_fk', 'interventi_centro_snapshot_fk',
          'operazioni_distribuzione_area_snapshot_fk',
          'operazioni_distribuzione_centro_snapshot_fk'
        ])
      `);
      expect(constraints.rows).toHaveLength(8);
      expect(
        constraints.rows.every((constraint) => constraint.confdeltype === "r"),
      ).toBe(true);

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
