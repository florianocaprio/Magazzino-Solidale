/* @vitest-environment node */

import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

async function inRollback(
  operation: (
    client: Awaited<ReturnType<typeof pool.connect>>,
  ) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await operation(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

afterAll(async () => {
  await pool.end();
});

describe("vincoli referenziali Interventi e Turni", () => {
  it("impedisce un Intervento con Beneficiario orfano", async () => {
    await inRollback(async (client) => {
      await expect(
        client.query(
          "INSERT INTO interventi (beneficiario_id, tipo_intervento) VALUES ($1, $2)",
          [-2_000_000_001, "audit-fk-beneficiario"],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("impedisce un riferimento a una Bolla inesistente", async () => {
    await inRollback(async (client) => {
      const beneficiario = await client.query<{ id: number }>(
        `INSERT INTO beneficiari (codice, nome, cognome, sesso)
         VALUES ($1, 'Audit', 'FK', 'M') RETURNING id`,
        [`AUD-FK-${Date.now()}`],
      );
      await expect(
        client.query(
          `INSERT INTO interventi (beneficiario_id, bolla_id, tipo_intervento)
           VALUES ($1, $2, $3)`,
          [beneficiario.rows[0].id, -2_000_000_002, "audit-fk-bolla"],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("impedisce un Turno con Centro orfano", async () => {
    await inRollback(async (client) => {
      await expect(
        client.query(
          `INSERT INTO turni (centro_ascolto_id, data, fascia)
           VALUES ($1, '2099-01-01', 'audit')`,
          [-2_000_000_003],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("impedisce un Volontario orfano nell'associazione al Turno", async () => {
    await inRollback(async (client) => {
      const area = await client.query<{ id: number }>(
        "INSERT INTO aree_operative (nome) VALUES ($1) RETURNING id",
        [`Area Audit FK ${Date.now()}`],
      );
      const centro = await client.query<{ id: number }>(
        `INSERT INTO centri_di_ascolto (nome, area_operativa_id)
         VALUES ($1, $2) RETURNING id`,
        [`Centro Audit FK ${Date.now()}`, area.rows[0].id],
      );
      const turno = await client.query<{ id: number }>(
        `INSERT INTO turni (centro_ascolto_id, data, fascia)
         VALUES ($1, '2099-01-02', 'audit') RETURNING id`,
        [centro.rows[0].id],
      );
      await expect(
        client.query(
          "INSERT INTO turni_volontari (turno_id, volontario_id) VALUES ($1, $2)",
          [turno.rows[0].id, -2_000_000_004],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });
});
