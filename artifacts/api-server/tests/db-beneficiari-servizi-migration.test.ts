/* @vitest-environment node */
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { pool } from "@workspace/db";
afterAll(() => pool.end());

it("ripara solo FSE e territori certi, abilita il primo credito senza toccare saldi e conserva revoche; replay senza modifiche", async () => {
  const client = await pool.connect();
  const migration = readFileSync(new URL("../../../lib/db/updates/20261020_z_beneficiari_servizi.sql", import.meta.url), "utf8");
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE politiche_credito_solidale(id integer PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE aree_operative(id integer PRIMARY KEY, attivo boolean) ON COMMIT DROP;
      CREATE TEMP TABLE centri_di_ascolto(id integer PRIMARY KEY, area_operativa_id integer, attivo boolean) ON COMMIT DROP;
      CREATE TEMP TABLE beneficiari(id integer PRIMARY KEY, area_operativa_id integer, centro_ascolto_id integer,
        zona_uds_id integer, stato_anagrafica text, uds boolean DEFAULT false, attivo boolean DEFAULT true,
        credito_solidale_abilitato boolean DEFAULT false, credito_solidale_stato text DEFAULT 'non_abilitato',
        credito_solidale_data_abilitazione timestamp, credito_solidale_saldo numeric DEFAULT 123,
        versione integer DEFAULT 1, data_aggiornamento timestamp DEFAULT '2026-01-01') ON COMMIT DROP;
      CREATE TEMP TABLE fse_fascicoli_sociali(beneficiario_id integer, origine_fascicolo text, codice_fascicolo_normalizzato text) ON COMMIT DROP;
      CREATE TEMP TABLE emporio_abilitazioni(beneficiario_id integer, area_operativa_id integer, stato text, data_effetto timestamp) ON COMMIT DROP;
      INSERT INTO aree_operative VALUES(1,true),(2,true);
      INSERT INTO centri_di_ascolto VALUES(1,1,true),(2,2,true);
      INSERT INTO beneficiari(id,area_operativa_id,centro_ascolto_id,stato_anagrafica) VALUES
        (1,NULL,1,'provvisoria'),(2,1,1,'provvisoria'),(3,1,1,'completa'),
        (4,1,1,'completa'),(5,1,2,'provvisoria'),(6,NULL,NULL,'provvisoria');
      UPDATE beneficiari SET credito_solidale_stato='revocato',credito_solidale_data_abilitazione='2026-01-01' WHERE id=4;
      INSERT INTO fse_fascicoli_sociali VALUES(1,'import_fse','fse1'),(5,'import_fse','fse5');
      INSERT INTO emporio_abilitazioni VALUES(3,1,'attivo','2026-01-01'),(4,1,'attivo','2026-01-01');
    `);
    await client.query(migration);
    const first = (await client.query("SELECT * FROM beneficiari ORDER BY id")).rows;
    expect(first[0]).toMatchObject({ area_operativa_id: 1, stato_anagrafica: "completa", versione: 2 });
    expect(first[1]).toMatchObject({ stato_anagrafica: "provvisoria", versione: 1 });
    expect(first[2]).toMatchObject({ credito_solidale_abilitato: true, credito_solidale_stato: "attivo", versione: 2 });
    expect(first[3]).toMatchObject({ credito_solidale_abilitato: false, credito_solidale_stato: "revocato", versione: 1 });
    expect(first[4]).toMatchObject({ area_operativa_id: 1, stato_anagrafica: "provvisoria", versione: 1 });
    expect(first[5]).toMatchObject({ area_operativa_id: null, versione: 1 });
    expect(first.every((row) => Number(row.credito_solidale_saldo) === 123 && row.politica_credito_solidale_id === null)).toBe(true);
    await client.query(migration);
    expect((await client.query("SELECT * FROM beneficiari ORDER BY id")).rows).toEqual(first);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
