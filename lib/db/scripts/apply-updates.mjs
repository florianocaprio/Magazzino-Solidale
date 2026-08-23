import { fileURLToPath } from "node:url";
import {
  getMigrationStatus,
  runMigrations,
  verifyMigrations,
} from "./migration-runner.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const updatesDirectory = fileURLToPath(new URL("../updates", import.meta.url));
const manifestPath = fileURLToPath(
  new URL("../legacy-migrations-baseline.json", import.meta.url),
);
const command = process.argv[2] ?? "update";

function printStatus(status) {
  console.log(`Ledger inizializzato: ${status.initialized ? "sì" : "no"}`);
  console.log(`Totale file: ${status.totalFiles}`);
  console.log(`Applicate: ${status.appliedFiles}`);
  console.log(`Pendenti: ${status.pendingFiles.length}`);
  console.log(`Checksum mismatch: ${status.checksumMismatches.length}`);
  console.log(`File applicati mancanti: ${status.appliedFilesMissing.length}`);
  console.log(`Out-of-order: ${status.outOfOrderFiles.length}`);
  console.log(
    `Ultima esecuzione: ${status.lastRun ? `${status.lastRun.status} ${status.lastRun.started_at.toISOString()}` : "nessuna"}`,
  );
}

try {
  if (command === "update") {
    const result = await runMigrations({
      databaseUrl,
      updatesDirectory,
      manifestPath,
    });
    console.log(
      `Migration completate: applicate=${result.appliedFiles} skipped=${result.skippedFiles} pending=0`,
    );
  } else if (command === "status") {
    printStatus(
      await getMigrationStatus({
        databaseUrl,
        updatesDirectory,
        manifestPath,
      }),
    );
  } else if (command === "verify") {
    const result = await verifyMigrations({
      databaseUrl,
      updatesDirectory,
      manifestPath,
    });
    console.log(
      `Verifica migration completata: ledger=${result.initialized ? "inizializzato" : "non inizializzato"} applicate=${result.appliedFiles} pending=${result.pendingFiles}`,
    );
  } else {
    throw new Error(`Comando migration non supportato: ${command}`);
  }
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : "MIGRATION_RUNNER_FAILED";
  const message = error instanceof Error ? error.message : "Errore migration";
  console.error(`${code}: ${message}`);
  process.exitCode = 1;
}
