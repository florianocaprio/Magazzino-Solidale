import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";

const browserGroups = {
  m63: {
    port: 58631,
    db: "m63_e2e",
    files: ["m63-interventi.spec.ts"],
    seed: false,
  },
  m5: {
    port: 58621,
    db: "m5c2a_r2_e2e",
    files: ["m5c2a-r2-continuity-real.spec.ts"],
  },
  m5c1: { port: 58621, db: "m5c1_r2_e2e", files: ["m5c1-r2-formal.spec.ts"] },
  m4: {
    port: 58621,
    db: "m62c_r2_m4",
    files: ["m4b2-transport-return.spec.ts", "consegne-workflows.spec.ts"],
  },
  mensa: { port: 58461, db: "m61_e2e", files: ["mensa-workflows.spec.ts"] },
  emporio: {
    port: 58621,
    db: "m62a",
    files: ["emporio-rettifiche-m62c.spec.ts"],
    seed: false,
  },
  consegne: {
    port: 58621,
    db: "m62c_r2_m4",
    files: ["consegne-workflows.spec.ts"],
  },
};

export function resolveBrowserGroup(name) {
  // Le cifre fanno parte dell'identità: m5c1 non è m5c, m63 non è m.
  assert.ok(
    Object.hasOwn(browserGroups, name),
    `Unknown M6.3 browser group: ${name}`,
  );
  return structuredClone(browserGroups[name]);
}

// Tutti i launcher che usano le stesse porte devono condividere QUESTO lock,
// non un lock diverso per cartella evidenze. Nessun recupero automatico di lock
// stale: dopo un crash occorre verificare prima processi e connessioni residue.
export async function withExclusiveTestEnvironment(lockPath, context, action) {
  const token = randomUUID();
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      "M6.3 test environment already owned; no DB or browser operation started",
      { cause: error },
    );
  }
  try {
    writeFileSync(fd, JSON.stringify({ token, pid: process.pid, context }));
  } catch (error) {
    closeSync(fd);
    // Un file incompleto resta bloccante, non autorizza un secondo processo.
    throw error;
  }
  closeSync(fd);
  try {
    return await action();
  } finally {
    assert.equal(
      JSON.parse(readFileSync(lockPath, "utf8")).token,
      token,
      "Test lock ownership changed; refusing release",
    );
    unlinkSync(lockPath);
  }
}

export async function renameIdleTestDatabase(client, source, destination) {
  assert.ok(["m62a", "m62c_r2_m4", "m5c2a_r2_m63"].includes(source));
  assert.match(destination, /^m63_[a-z0-9_]+$/);
  const active = await client.query(
    "select pid from pg_stat_activity where datname=$1",
    [source],
  );
  assert.equal(
    active.rowCount,
    0,
    `Active clients on ${source}; refusing rename`,
  );
  // PostgreSQL verifica nuovamente le connessioni durante ALTER DATABASE.
  // Nessuna terminazione di backend per forzare l'operazione.
  await client.query(`ALTER DATABASE "${source}" RENAME TO "${destination}"`);
}
