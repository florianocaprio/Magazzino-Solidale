// Only the R2 disposable launcher may opt into the canonical synthetic Demo seed.
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { initializeBaseData } from "../src/lib/baseData";
import { seedDemoEnvironmentData } from "../src/lib/demoEnvironment";

const target = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.M62C_R2_DISPOSABLE_DB, "verified");
assert.equal(target.hostname, "127.0.0.1");
assert.ok(["58621", "58461"].includes(target.port));
assert.ok(
  [
    "m62c_r2_m4",
    "m5c2a_r2_e2e",
    "m5c1_r2_e2e",
    "m62c_r2_mensa",
    "m61_e2e",
  ].includes(target.pathname.slice(1)),
);
assert.ok(process.env.SUPER_ADMIN_INITIAL_EMAIL?.endsWith("@example.invalid"));
assert.ok(process.env.SUPER_ADMIN_INITIAL_PASSWORD);
try {
  await initializeBaseData();
  const { rows: actors } = await pool.query(
    "SELECT u.id, u.must_change_password, r.nome FROM utenti u JOIN ruoli r ON r.id=u.ruolo_id WHERE u.username='sadmin'",
  );
  assert.equal(actors.length, 1);
  assert.equal(actors[0].nome, "SuperAdmin");
  // First-login password completion is performed via HTTP by the launcher.
  assert.equal(actors[0].must_change_password, true);
  if (["/m62c_r2_m4", "/m62c_r2_mensa", "/m61_e2e"].includes(target.pathname)) {
    await seedDemoEnvironmentData(actors[0].id);
  }
  console.log(
    "R2 canonical bootstrap complete; first-login activation still required",
  );
} finally {
  await pool.end();
}
