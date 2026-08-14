import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const updatesDirectory = fileURLToPath(new URL("../updates", import.meta.url));
const updateFiles = (await readdir(updatesDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();

  for (const updateFile of updateFiles) {
    const updatePath = path.join(updatesDirectory, updateFile);
    const sql = await readFile(updatePath, "utf8");

    console.log(`Applico aggiornamento DB: ${updateFile}`);
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "magazzino-solidale:db-updates",
      ]);
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.log(`Aggiornamento DB completato: ${updateFile}`);
  }
} finally {
  await client.end();
}
