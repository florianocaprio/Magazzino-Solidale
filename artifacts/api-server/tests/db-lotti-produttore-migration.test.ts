/* @vitest-environment node */
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { pool } from "@workspace/db";
afterAll(() => pool.end());
it("BUG18 — upgrade additivo e replay: conserva tutte le colonne storiche, lascia link e origini incerti vuoti", async () => {
  const client = await pool.connect();
  const migration = readFileSync(
    new URL(
      "../../../lib/db/updates/20261020_lotti_produttore.sql",
      import.meta.url,
    ),
    "utf8",
  );
  try {
    await client.query("BEGIN");
    // Only the disposable test database is changed; rollback restores the current schema.
    await client.query(
      "DROP VIEW IF EXISTS m2_anomalie_quantita_legacy; DROP TRIGGER IF EXISTS lotti_produttore_link_guard ON lotti; ALTER TABLE lotti DROP COLUMN lotto_produttore_id; ALTER TABLE carico_pratica_righe DROP COLUMN lotto_produttore_id; DROP TABLE lotti_produttore CASCADE",
    );
    const snapshot = `SELECT (SELECT coalesce(jsonb_agg(to_jsonb(t)-'lotto_produttore_id' ORDER BY id),'[]') FROM lotti t) lotti, (SELECT coalesce(jsonb_agg(to_jsonb(t)-'lotto_produttore_id' ORDER BY id),'[]') FROM carico_pratica_righe t) righe, (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM movimenti t) movimenti`;
    const before = (await client.query(snapshot)).rows;
    await client.query(migration);
    await client.query(migration);
    expect((await client.query(snapshot)).rows).toEqual(before);
    expect(
      (await client.query("SELECT count(*)::int n FROM lotti_produttore"))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await client.query(
          "SELECT count(*)::int n FROM lotti WHERE lotto_produttore_id IS NOT NULL",
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
