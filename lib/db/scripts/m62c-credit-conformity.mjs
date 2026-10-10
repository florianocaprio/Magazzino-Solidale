import assert from "node:assert/strict";
import { Client } from "pg";

// Development-only, read-only inspection. Never discovers or defaults to a DB.
assert.equal(process.env.M62C_DISPOSABLE_DB, "verified");
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "58621");
assert.ok(["/m62a", "/m62c_upgrade"].includes(url.pathname));
const fields = {
  beneficiari: ["credito_solidale_saldo", "credito_solidale_mensile_assegnato"],
  prodotti: ["credito_solidale_valore"],
  credito_solidale_movimenti: [
    "variazione_credito",
    "saldo_prima",
    "saldo_dopo",
    "quota_mensile_assegnata",
  ],
  sessioni_cassa_emporio: [
    "saldo_credito_iniziale",
    "totale_credito_previsto",
    "credito_residuo_previsto",
  ],
  sessioni_cassa_emporio_righe: ["credito_unitario", "credito_totale"],
  spese_emporio: ["totale_credito_consumati", "saldo_prima", "saldo_dopo"],
  spese_emporio_righe: ["credito_unitario", "credito_totale"],
  spese_emporio_storni: ["credito_restituito"],
  spese_emporio_storni_righe: ["credito_restituito"],
  politiche_credito_solidale: [
    "credito_base_nucleo",
    "credito_per_componente",
    "bonus_minore",
    "bonus_anziano",
    "bonus_disabile",
    "credito_minimo_mensile",
    "credito_massimo_mensile",
  ],
};
const client = new Client({ connectionString: url.href });
await client.connect();
try {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  const anomalies = [];
  for (const [table, columns] of Object.entries(fields)) {
    for (const field of columns) {
      const signed = [
        "variazione_credito",
        "credito_residuo_previsto",
      ].includes(field);
      const rows =
        await client.query(`SELECT id, "${field}"::text AS value FROM "${table}"
        WHERE "${field}" IS NOT NULL AND ("${field}" <> trunc("${field}")
          OR abs("${field}") > 99999999 OR "${field}"::text IN ('NaN','Infinity','-Infinity')
          ${signed ? "" : `OR "${field}" < 0`}) ORDER BY id`);
      anomalies.push(...rows.rows.map((row) => ({ table, field, ...row })));
    }
  }
  await client.query("COMMIT");
  // IDs and economic values only: no names, contact details or credentials.
  console.log(
    JSON.stringify(
      { readOnly: true, checkedTables: Object.keys(fields).length, anomalies },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
