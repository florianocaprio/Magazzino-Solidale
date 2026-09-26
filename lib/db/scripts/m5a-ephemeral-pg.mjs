import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { Client } from "pg";

const exec = promisify(execFile);
const scopeLabel = "magazzino-solidale.m5a.test";
const image = "postgres:16-alpine";
const baseSha = "07bd2c676eb247a759d39a5af2dede13fc13e50e";

async function docker(...args) {
  const result = await exec("docker", args, { maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

function databaseUrl(manifest, password, database) {
  if (!manifest.databases.includes(database) && database !== "postgres") {
    throw new Error("Database fuori dalla sessione M5A");
  }
  const url = new URL("postgresql://127.0.0.1");
  url.username = "m5a_test";
  url.password = password;
  url.port = String(manifest.port);
  url.pathname = `/${database}`;
  return url.toString();
}

async function checkIdentity(manifest, password, database) {
  const client = new Client({
    connectionString: databaseUrl(manifest, password, database),
  });
  await client.connect();
  try {
    const identity = (
      await client.query(`
      SELECT current_database() AS database, current_user AS username,
             (pg_control_system()).system_identifier::text AS system_identifier,
             (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) AS token
    `)
    ).rows[0];
    if (
      identity.database !== database ||
      identity.username !== "m5a_test" ||
      identity.system_identifier !== manifest.systemIdentifier ||
      identity.token !== `m5a-test:${manifest.runId}`
    )
      throw new Error("Identità PostgreSQL M5A non corrispondente");
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}

async function readSession(directory) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  const password = (
    await readFile(path.join(directory, "postgres.password"), "utf8")
  ).trim();
  if (
    !manifest.runId ||
    !manifest.containerId ||
    !manifest.networkId ||
    !password
  ) {
    throw new Error("Manifest M5A incompleto");
  }
  const labels = await docker(
    "inspect",
    "--format",
    "{{json .Config.Labels}}",
    manifest.containerId,
  );
  const parsed = JSON.parse(labels);
  if (
    parsed[scopeLabel] !== "true" ||
    parsed["m5a-session"] !== manifest.runId
  ) {
    throw new Error("Identità container M5A non corrispondente");
  }
  const port = await docker("port", manifest.containerId, "5432/tcp");
  if (port !== `127.0.0.1:${manifest.port}`)
    throw new Error("Mapping porta M5A mutato");
  return { manifest, password };
}

async function setup() {
  const version = await docker("version", "--format", "{{.Server.Version}}");
  if (Number(version.split(".")[0]) < 28)
    throw new Error("Docker <28: loopback non garantito");
  const host = await docker(
    "context",
    "inspect",
    "--format",
    "{{.Endpoints.docker.Host}}",
  );
  if (!host.startsWith("unix://"))
    throw new Error("Contesto Docker non locale");
  const imageId = await docker(
    "image",
    "inspect",
    image,
    "--format",
    "{{.Id}}",
  );
  const runId = randomBytes(6).toString("hex");
  const directory = await mkdtemp(path.join(tmpdir(), `m5a-test-${runId}-`));
  const password = randomBytes(32).toString("hex");
  const networkName = `m5a-test-net-${runId}`;
  const containerName = `m5a-test-pg-${runId}`;
  const databases = [`m5a_fresh_${runId}`, `m5a_upgrade_${runId}`];
  const manifest = {
    runId,
    directory,
    image,
    imageId,
    dockerVersion: version,
    dockerHost: host,
    networkName,
    containerName,
    databases,
  };
  const manifestPath = path.join(directory, "manifest.json");
  const passwordPath = path.join(directory, "postgres.password");
  const envPath = path.join(directory, "postgres.env");
  await writeFile(passwordPath, `${password}\n`, { mode: 0o600 });
  await writeFile(
    envPath,
    `POSTGRES_USER=m5a_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=postgres\nPGDATA=/var/lib/postgresql/data/pgdata\n`,
    { mode: 0o600 },
  );
  try {
    manifest.networkId = await docker(
      "network",
      "create",
      "--driver",
      "bridge",
      "--label",
      `${scopeLabel}=true`,
      "--label",
      `m5a-session=${runId}`,
      networkName,
    );
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    manifest.containerId = await docker(
      "run",
      "-d",
      "--name",
      containerName,
      "--network",
      networkName,
      "--label",
      `${scopeLabel}=true`,
      "--label",
      `m5a-session=${runId}`,
      "--env-file",
      envPath,
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,nodev,size=1024m",
      "--memory",
      "1536m",
      "--cpus",
      "2",
      "--pids-limit",
      "256",
      "--restart",
      "no",
      "-p",
      "127.0.0.1::5432",
      image,
    );
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const mounts = JSON.parse(
      await docker(
        "inspect",
        "--format",
        "{{json .Mounts}}",
        manifest.containerId,
      ),
    );
    const tmpfs = JSON.parse(
      await docker(
        "inspect",
        "--format",
        "{{json .HostConfig.Tmpfs}}",
        manifest.containerId,
      ),
    );
    const actualMount = await docker(
      "exec",
      manifest.containerId,
      "sh",
      "-c",
      "grep ' /var/lib/postgresql/data tmpfs ' /proc/mounts",
    );
    if (
      mounts.length !== 0 ||
      tmpfs?.["/var/lib/postgresql/data"] !== "rw,nosuid,nodev,size=1024m" ||
      !actualMount.includes(" /var/lib/postgresql/data tmpfs ")
    ) {
      throw new Error("Mount PostgreSQL non esclusivamente tmpfs");
    }
    const published = await docker("port", manifest.containerId, "5432/tcp");
    if (!/^127\.0\.0\.1:\d+$/.test(published))
      throw new Error("Porta PostgreSQL non limitata a loopback");
    manifest.port = Number(published.split(":")[1]);
    let admin;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        admin = new Client({
          connectionString: databaseUrl(manifest, password, "postgres"),
        });
        await admin.connect();
        break;
      } catch {
        await admin?.end().catch(() => {});
        admin = undefined;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!admin)
      throw new Error("PostgreSQL temporaneo non pronto entro 20 secondi");
    try {
      const row = (
        await admin.query(
          "SELECT (pg_control_system()).system_identifier::text AS id, current_setting('server_version') AS version",
        )
      ).rows[0];
      manifest.systemIdentifier = row.id;
      manifest.postgresVersion = row.version;
      for (const database of databases) {
        await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
        await admin.query(
          `COMMENT ON DATABASE "${database}" IS 'm5a-test:${runId}'`,
        );
      }
    } finally {
      await admin.end();
    }
    for (const database of databases) {
      const checked = await checkIdentity(manifest, password, database);
      await checked.end();
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await rm(envPath);
    console.log(`M5A_SESSION_DIR=${directory}`);
    console.log(
      `PostgreSQL=${manifest.postgresVersion} image=${imageId} container=${manifest.containerId} network=${manifest.networkId} port=127.0.0.1:${manifest.port}`,
    );
  } catch (error) {
    console.error(`SETUP_FAILED: ${error.message}`);
    console.error(`SESSION_DIR=${directory}`);
    throw error;
  }
}

async function verify(directory) {
  const { manifest, password } = await readSession(directory);
  for (const database of manifest.databases) {
    const client = await checkIdentity(manifest, password, database);
    await client.end();
  }
  console.log(
    `VERIFY_OK run=${manifest.runId} databases=${manifest.databases.join(",")}`,
  );
}

async function convertMarker(directory) {
  const { manifest, password } = await readSession(directory);
  for (const database of manifest.databases) {
    const client = new Client({
      connectionString: databaseUrl(manifest, password, database),
    });
    await client.connect();
    try {
      const identity = (
        await client.query(`
        SELECT current_database() AS database, current_user AS username,
               (pg_control_system()).system_identifier::text AS system_identifier,
               (SELECT token FROM m5a_test_meta.session_marker) AS token,
               (SELECT count(*)::integer FROM pg_catalog.pg_tables WHERE schemaname = 'm5a_test_meta') AS marker_tables
      `)
      ).rows[0];
      if (
        identity.database !== database ||
        identity.username !== "m5a_test" ||
        identity.system_identifier !== manifest.systemIdentifier ||
        identity.token !== manifest.runId ||
        identity.marker_tables !== 1
      ) {
        throw new Error(
          "Vecchio marker M5A non identificato: conversione negata",
        );
      }
      if (database === manifest.databases[0]) {
        const count = (
          await client.query(
            "SELECT count(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
          )
        ).rows[0].count;
        if (count !== 0)
          throw new Error("Fresh già popolato: conversione rifiutata");
      }
      await client.query(
        `COMMENT ON DATABASE "${database}" IS 'm5a-test:${manifest.runId}'`,
      );
      await client.query("DROP TABLE m5a_test_meta.session_marker");
      await client.query("DROP SCHEMA m5a_test_meta");
    } finally {
      await client.end();
    }
    const checked = await checkIdentity(manifest, password, database);
    await checked.end();
  }
  console.log(`MARKER_CONVERTED run=${manifest.runId} marker=database_comment`);
}

function isolatedEnvironment(url, sourceVersion) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key !== "DATABASE_URL" &&
        !key.startsWith("PG") &&
        !key.startsWith("POSTGRES") &&
        !key.startsWith("MIGRATION_") &&
        !key.startsWith("FRESH_DB_"),
    ),
  );
  return {
    ...environment,
    DATABASE_URL: url,
    MIGRATION_SOURCE_VERSION: sourceVersion,
    NODE_ENV: "test",
    MAPS_PUBLIC_GEOCODING_ALLOWED: "false",
  };
}

async function runLogged(command, args, options, logPath, secrets) {
  const redact = (value) =>
    (Array.isArray(secrets) ? secrets : [secrets])
      .filter(Boolean)
      .reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
  try {
    const result = await exec(command, args, {
      ...options,
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeout ?? 180_000,
    });
    await writeFile(logPath, redact(`${result.stdout}\n${result.stderr}`));
  } catch (error) {
    await writeFile(
      logPath,
      redact(`${error.stdout ?? ""}\n${error.stderr ?? ""}`),
    );
    throw new Error(`${path.basename(command)} fallito; vedere ${logPath}`);
  }
}

async function base(directory) {
  const { manifest, password } = await readSession(directory);
  const database = manifest.databases[1];
  const client = await checkIdentity(manifest, password, database);
  try {
    const row = (
      await client.query(`
      SELECT count(*)::integer AS tables FROM pg_catalog.pg_tables WHERE schemaname = 'public'
    `)
    ).rows[0];
    if (row.tables !== 0)
      throw new Error("Il DB upgrade non è vuoto: baseline rifiutata");
  } finally {
    await client.end();
  }
  const root = process.cwd();
  const archivePath = path.join(directory, "base-07bd2c.tar");
  const baseRoot = path.join(directory, "base-07bd2c");
  await mkdir(baseRoot);
  await exec("git", ["archive", "--format=tar", "-o", archivePath, baseSha], {
    cwd: root,
    maxBuffer: 1024 * 1024,
  });
  await exec("tar", ["-xf", archivePath, "-C", baseRoot], {
    maxBuffer: 1024 * 1024,
  });
  await symlink(
    path.join(root, "lib/db/node_modules"),
    path.join(baseRoot, "lib/db/node_modules"),
  );
  await symlink(
    path.join(root, "node_modules"),
    path.join(baseRoot, "node_modules"),
  );
  const url = databaseUrl(manifest, password, database);
  const env = isolatedEnvironment(url, baseSha);
  const guarded = await checkIdentity(manifest, password, database);
  await guarded.end();
  await runLogged(
    path.join(baseRoot, "lib/db/node_modules/.bin/drizzle-kit"),
    ["push", "--config", path.join(baseRoot, "lib/db/drizzle.config.ts")],
    { cwd: baseRoot, env },
    path.join(directory, "base-schema-push.log"),
    password,
  );
  const checked = await checkIdentity(manifest, password, database);
  await checked.end();
  await runLogged(
    process.execPath,
    [path.join(baseRoot, "lib/db/scripts/apply-updates.mjs"), "update"],
    { cwd: baseRoot, env },
    path.join(directory, "base-ledger-update.log"),
    password,
  );
  await runLogged(
    process.execPath,
    [path.join(baseRoot, "lib/db/scripts/apply-updates.mjs"), "verify"],
    { cwd: baseRoot, env },
    path.join(directory, "base-ledger-verify.log"),
    password,
  );
  const finalClient = await checkIdentity(manifest, password, database);
  try {
    const result = (
      await finalClient.query(`
      SELECT (SELECT count(*)::integer FROM app_meta.schema_migrations) AS applied,
             to_regclass('public.richieste_magazzino') IS NULL AS no_m5a
    `)
    ).rows[0];
    if (result.applied !== 42 || !result.no_m5a)
      throw new Error(
        `Baseline non valida: ledger=${result.applied} noM5A=${result.no_m5a}`,
      );
    console.log(
      `BASE_OK run=${manifest.runId} ledger=42 noM5A=true archive=${archivePath}`,
    );
  } finally {
    await finalClient.end();
  }
}

async function snapshotPublic(client) {
  const tables = (
    await client.query(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    )
  ).rows;
  const snapshot = {};
  for (const { tablename } of tables) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    const rows = (
      await client.query(
        `SELECT to_jsonb(t)::text AS payload FROM public.${quoted} t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
    snapshot[tablename] = {
      count: rows.length,
      sha256: createHash("sha256")
        .update(rows.map((row) => row.payload).join("\n"))
        .digest("hex"),
    };
  }
  return snapshot;
}

async function fixture(directory) {
  const { manifest, password } = await readSession(directory);
  const database = manifest.databases[1];
  const client = await checkIdentity(manifest, password, database);
  const ids = {};
  try {
    const baseline = (
      await client.query(
        "SELECT (SELECT count(*)::integer FROM app_meta.schema_migrations) AS ledger, to_regclass('public.richieste_magazzino') IS NULL AS no_m5a",
      )
    ).rows[0];
    if (baseline.ledger !== 42 || !baseline.no_m5a)
      throw new Error("Fixture richiede ledger 42 senza M5A");
    await client.query("BEGIN");
    const one = async (sql, params = []) =>
      (await client.query(sql, params)).rows[0].id;
    try {
      ids.areaA = await one(
        "INSERT INTO aree_operative (nome, sigla, codice_matricola) VALUES ('M5A Area A', 'MA', 'M5AA') RETURNING id",
      );
      ids.areaB = await one(
        "INSERT INTO aree_operative (nome, sigla, codice_matricola) VALUES ('M5A Area B', 'MB', 'M5AB') RETURNING id",
      );
      ids.centroA = await one(
        "INSERT INTO centri_di_ascolto (nome, area_operativa_id) VALUES ('M5A Centro A', $1) RETURNING id",
        [ids.areaA],
      );
      ids.centroB = await one(
        "INSERT INTO centri_di_ascolto (nome, area_operativa_id) VALUES ('M5A Centro B', $1) RETURNING id",
        [ids.areaB],
      );
      ids.zonaA = await one(
        "INSERT INTO zone_uds (nome, area_operativa_id) VALUES ('M5A Zona A', $1) RETURNING id",
        [ids.areaA],
      );
      ids.roleSocial = await one(
        "INSERT INTO ruoli (nome, aree, permessi) VALUES ('Operatore', '[\"sociale\"]'::jsonb, '[\"bolle.view\"]'::jsonb) RETURNING id",
      );
      ids.roleWarehouse = await one(
        "INSERT INTO ruoli (nome, aree, permessi) VALUES ('Operatore Magazzino', '[\"magazzino\"]'::jsonb, '[\"bolle.view\"]'::jsonb) RETURNING id",
      );
      ids.roleCustom = await one(
        "INSERT INTO ruoli (nome, aree, permessi) VALUES ('M5A custom read-only', '[\"magazzino\"]'::jsonb, '[\"giacenze.view\"]'::jsonb) RETURNING id",
      );
      ids.userSocial = await one(
        "INSERT INTO utenti (username, password_hash, nome, ruolo_id, centro_ascolto_id, area_operativa_id, zona_uds_id) VALUES ('m5a-sociale', 'synthetic-not-for-login', 'M5A Sociale', $1, $2, $3, $4) RETURNING id",
        [ids.roleSocial, ids.centroA, ids.areaA, ids.zonaA],
      );
      ids.userWarehouse = await one(
        "INSERT INTO utenti (username, password_hash, nome, ruolo_id, area_operativa_id) VALUES ('m5a-magazzino', 'synthetic-not-for-login', 'M5A Magazzino', $1, $2) RETURNING id",
        [ids.roleWarehouse, ids.areaA],
      );
      ids.userCustom = await one(
        "INSERT INTO utenti (username, password_hash, nome, ruolo_id, area_operativa_id) VALUES ('m5a-custom', 'synthetic-not-for-login', 'M5A Custom', $1, $2) RETURNING id",
        [ids.roleCustom, ids.areaB],
      );
      ids.warehouseA1 = await one(
        "INSERT INTO magazzini (codice, nome, area_operativa_id, centro_ascolto_id) VALUES ('M5A-A1', 'M5A Deposito A1', $1, $2) RETURNING id",
        [ids.areaA, ids.centroA],
      );
      ids.warehouseA2 = await one(
        "INSERT INTO magazzini (codice, nome, area_operativa_id, centro_ascolto_id) VALUES ('M5A-A2', 'M5A Deposito A2', $1, $2) RETURNING id",
        [ids.areaA, ids.centroA],
      );
      ids.warehouseB = await one(
        "INSERT INTO magazzini (codice, nome, area_operativa_id, centro_ascolto_id) VALUES ('M5A-B1', 'M5A Deposito B1', $1, $2) RETURNING id",
        [ids.areaB, ids.centroB],
      );
      ids.product = await one(
        "INSERT INTO prodotti (codice, nome, tipo_prodotto, unita_misura) VALUES ('M5A-P1', 'Pasta sintetica', 'alimentare', 'pz') RETURNING id",
      );
      ids.beneficiaryA = await one(
        "INSERT INTO beneficiari (codice, cognome, nome, centro_ascolto_id, area_operativa_id, zona_uds_id, uds, num_componenti) VALUES ('M5A-B1', 'Test', 'Ada', $1, $2, $3, true, 2) RETURNING id",
        [ids.centroA, ids.areaA, ids.zonaA],
      );
      ids.beneficiaryB = await one(
        "INSERT INTO beneficiari (codice, cognome, nome, centro_ascolto_id, area_operativa_id) VALUES ('M5A-B2', 'Test', 'Bruno', $1, $2) RETURNING id",
        [ids.centroB, ids.areaB],
      );
      ids.interventionSocial = await one(
        "INSERT INTO interventi (beneficiario_id, operatore_id, data_intervento, tipo_intervento, stato, ambito, area_operativa_id_snapshot, centro_ascolto_id_snapshot) VALUES ($1, $2, DATE '2026-09-24', 'Ascolto', 'concluso', 'sociale', $3, $4) RETURNING id",
        [ids.beneficiaryA, ids.userSocial, ids.areaA, ids.centroA],
      );
      ids.interventionUds = await one(
        "INSERT INTO interventi (beneficiario_id, operatore_id, data_intervento, tipo_intervento, stato, ambito, area_operativa_id_snapshot, centro_ascolto_id_snapshot, zona_uds_id_snapshot) VALUES ($1, $2, DATE '2026-09-25', 'UDS', 'concluso', 'uds', $3, $4, $5) RETURNING id",
        [ids.beneficiaryA, ids.userSocial, ids.areaA, ids.centroA, ids.zonaA],
      );
      ids.material = await one(
        "INSERT INTO interventi_materiali (intervento_id, prodotto_id, descrizione_snapshot, unita_misura_snapshot, quantita_prevista, quantita_consegnata, magazzino_id) VALUES ($1, $2, 'Pasta sintetica', 'pz', 2.000, 0.000, $3) RETURNING id",
        [ids.interventionSocial, ids.product, ids.warehouseA1],
      );
      ids.lot = await one(
        "INSERT INTO lotti (prodotto_id, data_carico, quantita_caricata, quantita_residua, magazzino_id, codice_lotto) VALUES ($1, DATE '2026-09-24', 10.000000, 8.000000, $2, 'M5A-FISICO') RETURNING id",
        [ids.product, ids.warehouseA1],
      );
      ids.loadMovement = await one(
        "INSERT INTO movimenti (tipo_movimento, tipo_dettaglio, data_movimento, magazzino_id, prodotto_id, lotto_id, quantita, unita_misura, operatore_id) VALUES ('carico', 'entrata', DATE '2026-09-24', $1, $2, $3, 10.000000, 'pz', $4) RETURNING id",
        [ids.warehouseA1, ids.product, ids.lot, ids.userWarehouse],
      );
      ids.bolla = await one(
        "INSERT INTO bolle (numero_bolla, data_bolla, beneficiario_id, magazzino_id, stato, area_operativa_id_snapshot, centro_ascolto_id_snapshot, destinatario_nome_snapshot, destinatario_snapshot_congelato) VALUES ('M5A-BOLLA-1', DATE '2026-09-25', $1, $2, 'pronta', $3, $4, 'Ada Test', true) RETURNING id",
        [ids.beneficiaryA, ids.warehouseA1, ids.areaA, ids.centroA],
      );
      ids.bollaRow = await one(
        "INSERT INTO bolla_righe (bolla_id, prodotto_id, lotto_id, quantita, unita_misura) VALUES ($1, $2, $3, 2.000000, 'pz') RETURNING id",
        [ids.bolla, ids.product, ids.lot],
      );
      ids.reservation = await one(
        "INSERT INTO prenotazioni_magazzino (bolla_id, riga_bolla_id, prodotto_id, lotto_id, magazzino_id, quantita) VALUES ($1, $2, $3, $4, $5, 2.000000) RETURNING id",
        [ids.bolla, ids.bollaRow, ids.product, ids.lot, ids.warehouseA1],
      );
      ids.delivery = await one(
        "INSERT INTO consegne (codice, beneficiario_id, tipo_consegna, data_prevista, magazzino_id, area_operativa_id_snapshot, centro_ascolto_id_snapshot, stato) VALUES ('M5A-CONS-1', $1, 'domicilio', DATE '2026-09-27', $2, $3, $4, 'pianificata') RETURNING id",
        [ids.beneficiaryA, ids.warehouseA1, ids.areaA, ids.centroA],
      );
      ids.transferRequested = await one(
        "INSERT INTO trasferimenti (codice, magazzino_origine_id, magazzino_destino_id, data_richiesta, stato, operatore_id) VALUES ('M5A-TR-REQ', $1, $2, DATE '2026-09-25', 'richiesto', $3) RETURNING id",
        [ids.warehouseA1, ids.warehouseA2, ids.userWarehouse],
      );
      ids.transferRequestedRow = await one(
        "INSERT INTO trasferimento_righe (trasferimento_id, prodotto_id, lotto_id, quantita, unita_misura) VALUES ($1, $2, $3, 1.000000, 'pz') RETURNING id",
        [ids.transferRequested, ids.product, ids.lot],
      );
      ids.transferTransit = await one(
        "INSERT INTO trasferimenti (codice, magazzino_origine_id, magazzino_destino_id, data_richiesta, data_esecuzione, stato, operatore_id) VALUES ('M5A-TR-TRANSIT', $1, $2, DATE '2026-09-25', DATE '2026-09-25', 'in_transito', $3) RETURNING id",
        [ids.warehouseA1, ids.warehouseB, ids.userWarehouse],
      );
      ids.transferTransitRow = await one(
        "INSERT INTO trasferimento_righe (trasferimento_id, prodotto_id, lotto_id, quantita, unita_misura) VALUES ($1, $2, $3, 2.000000, 'pz') RETURNING id",
        [ids.transferTransit, ids.product, ids.lot],
      );
      ids.transferMovement = await one(
        "INSERT INTO movimenti (tipo_movimento, tipo_dettaglio, data_movimento, magazzino_id, prodotto_id, lotto_id, quantita, unita_misura, trasferimento_id, operatore_id) VALUES ('trasferimento', 'uscita', DATE '2026-09-25', $1, $2, $3, 2.000000, 'pz', $4, $5) RETURNING id",
        [
          ids.warehouseA1,
          ids.product,
          ids.lot,
          ids.transferTransit,
          ids.userWarehouse,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const snapshot = await snapshotPublic(client);
    const exactQuantities = {
      lotti: (
        await client.query(
          "SELECT id, quantita_caricata::text, quantita_residua::text FROM lotti ORDER BY id",
        )
      ).rows,
      movimenti: (
        await client.query(
          "SELECT id, quantita::text, tipo_movimento, tipo_dettaglio FROM movimenti ORDER BY id",
        )
      ).rows,
      prenotazioni: (
        await client.query(
          "SELECT id, quantita::text, stato FROM prenotazioni_magazzino ORDER BY id",
        )
      ).rows,
    };
    await writeFile(
      path.join(directory, "upgrade-fixture-ids.json"),
      JSON.stringify(ids, null, 2),
    );
    await writeFile(
      path.join(directory, "upgrade-pre-snapshot.json"),
      JSON.stringify({ tables: snapshot, exactQuantities }, null, 2),
    );
    console.log(
      `FIXTURE_OK tables=${Object.keys(snapshot).length} populated=${Object.values(snapshot).filter((entry) => entry.count > 0).length} exactStock=${exactQuantities.lotti[0].quantita_residua}`,
    );
  } finally {
    await client.end();
  }
}

function compareSnapshots(before, after) {
  const differences = [];
  for (const [table, expected] of Object.entries(before)) {
    const actual = after[table];
    if (
      !actual ||
      actual.count !== expected.count ||
      actual.sha256 !== expected.sha256
    ) {
      differences.push({ table, expected, actual: actual ?? null });
    }
  }
  return differences;
}

async function upgrade(directory) {
  const { manifest, password } = await readSession(directory);
  const database = manifest.databases[1];
  const before = JSON.parse(
    await readFile(path.join(directory, "upgrade-pre-snapshot.json"), "utf8"),
  );
  const client = await checkIdentity(manifest, password, database);
  try {
    const check = (
      await client.query(
        "SELECT (SELECT count(*)::integer FROM app_meta.schema_migrations) AS ledger, to_regclass('public.richieste_magazzino') IS NULL AS no_m5a",
      )
    ).rows[0];
    if (check.ledger !== 42 || !check.no_m5a)
      throw new Error("Upgrade richiede 42 migration e nessuna tabella M5A");
    if (compareSnapshots(before.tables, await snapshotPublic(client)).length)
      throw new Error("Snapshot pre-upgrade non corrispondente alla fixture");
  } finally {
    await client.end();
  }
  const url = databaseUrl(manifest, password, database);
  const env = isolatedEnvironment(url, "m5a-test-working-tree");
  await runLogged(
    process.execPath,
    [path.join(process.cwd(), "lib/db/scripts/apply-updates.mjs"), "update"],
    { cwd: process.cwd(), env },
    path.join(directory, "m5a-ledger-update.log"),
    password,
  );
  const afterClient = await checkIdentity(manifest, password, database);
  let firstEvidence;
  try {
    const ledger = (
      await afterClient.query(`
      SELECT count(*)::integer AS count,
             count(*) FILTER (WHERE filename = '20260925_m5a_richieste_magazzino.sql')::integer AS m5a
      FROM app_meta.schema_migrations
    `)
    ).rows[0];
    const run = (
      await afterClient.query(
        "SELECT id, status, applied_files, skipped_files, pending_files FROM app_meta.schema_migration_runs ORDER BY id DESC LIMIT 1",
      )
    ).rows[0];
    const items = (
      await afterClient.query(
        "SELECT status, count(*)::integer AS count FROM app_meta.schema_migration_run_items WHERE run_id = $1 GROUP BY status ORDER BY status",
        [run.id],
      )
    ).rows;
    const requests = (
      await afterClient.query(
        "SELECT count(*)::integer AS count FROM richieste_magazzino",
      )
    ).rows[0].count;
    const after = await snapshotPublic(afterClient);
    const differences = compareSnapshots(before.tables, after);
    firstEvidence = {
      ledger,
      run,
      items,
      requests,
      differences,
      tableCount: Object.keys(after).length,
    };
    await writeFile(
      path.join(directory, "upgrade-first-evidence.json"),
      JSON.stringify(firstEvidence, null, 2),
    );
    if (
      ledger.count !== 43 ||
      ledger.m5a !== 1 ||
      run.status !== "SUCCESS" ||
      run.applied_files !== 1 ||
      run.skipped_files !== 42 ||
      requests !== 0 ||
      differences.length
    ) {
      throw new Error(
        "Prima esecuzione upgrade non conforme; vedere upgrade-first-evidence.json",
      );
    }
  } finally {
    await afterClient.end();
  }
  await runLogged(
    process.execPath,
    [path.join(process.cwd(), "lib/db/scripts/apply-updates.mjs"), "verify"],
    { cwd: process.cwd(), env },
    path.join(directory, "m5a-ledger-verify.log"),
    password,
  );
  const replayGuard = await checkIdentity(manifest, password, database);
  await replayGuard.end();
  await runLogged(
    process.execPath,
    [path.join(process.cwd(), "lib/db/scripts/apply-updates.mjs"), "update"],
    { cwd: process.cwd(), env },
    path.join(directory, "m5a-ledger-replay.log"),
    password,
  );
  const finalClient = await checkIdentity(manifest, password, database);
  try {
    const count = (
      await finalClient.query(
        "SELECT count(*)::integer AS count FROM app_meta.schema_migrations",
      )
    ).rows[0].count;
    const run = (
      await finalClient.query(
        "SELECT id, status, applied_files, skipped_files, pending_files FROM app_meta.schema_migration_runs ORDER BY id DESC LIMIT 1",
      )
    ).rows[0];
    const differences = compareSnapshots(
      before.tables,
      await snapshotPublic(finalClient),
    );
    const requests = (
      await finalClient.query(
        "SELECT count(*)::integer AS count FROM richieste_magazzino",
      )
    ).rows[0].count;
    const replayEvidence = { ledger: count, run, requests, differences };
    await writeFile(
      path.join(directory, "upgrade-replay-evidence.json"),
      JSON.stringify(replayEvidence, null, 2),
    );
    if (
      count !== 43 ||
      run.status !== "SUCCESS" ||
      run.applied_files !== 0 ||
      run.skipped_files !== 43 ||
      requests !== 0 ||
      differences.length
    ) {
      throw new Error(
        "Secondo run non idempotente; vedere upgrade-replay-evidence.json",
      );
    }
    console.log(
      `UPGRADE_OK ledger=42->43 firstApplied=${firstEvidence.run.applied_files} firstSkipped=${firstEvidence.run.skipped_files} replayApplied=${run.applied_files} replaySkipped=${run.skipped_files} businessDiff=${differences.length}`,
    );
  } finally {
    await finalClient.end();
  }
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function catalogSnapshot(client) {
  const tables = (
    await client.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
           character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)
  ).rows;
  const constraints = (
    await client.query(`
    SELECT c.conrelid::regclass::text AS table_name, c.conname AS name,
           c.contype AS type, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' ORDER BY table_name, name
  `)
  ).rows;
  const indexes = (
    await client.query(`
    SELECT tablename AS table_name, indexname AS name, indexdef AS definition
    FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname
  `)
  ).rows;
  return { tables, constraints, indexes };
}

async function fresh(directory) {
  const { manifest, password } = await readSession(directory);
  const database = manifest.databases[0];
  const client = await checkIdentity(manifest, password, database);
  try {
    const count = (
      await client.query(
        "SELECT count(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
      )
    ).rows[0].count;
    if (count !== 0) throw new Error("DB fresh non vuoto: bootstrap rifiutato");
  } finally {
    await client.end();
  }
  const port = await freeLoopbackPort();
  const env = isolatedEnvironment(
    databaseUrl(manifest, password, database),
    "m5a-test-working-tree",
  );
  for (const key of Object.keys(env))
    if (key.startsWith("MAIL_") || key.startsWith("SMTP_")) delete env[key];
  env.FRESH_DB_INITIAL_PASSWORD = randomBytes(24).toString("hex");
  env.FRESH_DB_FINAL_PASSWORD = `${env.FRESH_DB_INITIAL_PASSWORD}-Changed1`;
  env.FRESH_DB_API_PORT = String(port);
  env.SESSION_SECRET = randomBytes(32).toString("hex");
  await runLogged(
    "pnpm",
    ["--filter", "@workspace/db", "run", "test:fresh"],
    { cwd: process.cwd(), env },
    path.join(directory, "m5a-fresh-gate.log"),
    [
      password,
      env.FRESH_DB_INITIAL_PASSWORD,
      env.FRESH_DB_FINAL_PASSWORD,
      env.SESSION_SECRET,
    ],
  );
  const checked = await checkIdentity(manifest, password, database);
  try {
    const ledger = (
      await checked.query(
        "SELECT count(*)::integer AS count FROM app_meta.schema_migrations",
      )
    ).rows[0].count;
    const requests = (
      await checked.query(
        "SELECT count(*)::integer AS count FROM richieste_magazzino",
      )
    ).rows[0].count;
    if (ledger !== 43 || requests !== 0)
      throw new Error(
        `Fresh non valido: ledger=${ledger} richieste=${requests}`,
      );
    const catalog = await catalogSnapshot(checked);
    await writeFile(
      path.join(directory, "fresh-catalog.json"),
      JSON.stringify(catalog, null, 2),
    );
    console.log(
      `FRESH_OK ledger=${ledger} richieste=${requests} tables=${new Set(catalog.tables.map((row) => row.table_name)).size}`,
    );
  } finally {
    await checked.end();
  }
}

async function parity(directory) {
  const { manifest, password } = await readSession(directory);
  const freshClient = await checkIdentity(
    manifest,
    password,
    manifest.databases[0],
  );
  const upgradeClient = await checkIdentity(
    manifest,
    password,
    manifest.databases[1],
  );
  try {
    const freshCatalog = await catalogSnapshot(freshClient);
    const upgradeCatalog = await catalogSnapshot(upgradeClient);
    const differences = {};
    const semanticKey = (category, row) => {
      if (
        category === "constraints" &&
        row.type === "f" &&
        row.table_name === "richieste_magazzino"
      ) {
        return JSON.stringify({
          table_name: row.table_name,
          type: row.type,
          definition: row.definition,
        });
      }
      return JSON.stringify(row);
    };
    for (const category of ["tables", "constraints", "indexes"]) {
      const left = new Set(
        freshCatalog[category].map((row) => semanticKey(category, row)),
      );
      const right = new Set(
        upgradeCatalog[category].map((row) => semanticKey(category, row)),
      );
      differences[category] = {
        freshOnly: [...left].filter((item) => !right.has(item)),
        upgradeOnly: [...right].filter((item) => !left.has(item)),
      };
    }
    await writeFile(
      path.join(directory, "fresh-upgrade-parity-semantic.json"),
      JSON.stringify(differences, null, 2),
    );
    const count = Object.values(differences).reduce(
      (sum, category) =>
        sum + category.freshOnly.length + category.upgradeOnly.length,
      0,
    );
    console.log(
      `PARITY_${count === 0 ? "OK" : "DIFF"} differences=${count} columns=${differences.tables.freshOnly.length + differences.tables.upgradeOnly.length} constraints=${differences.constraints.freshOnly.length + differences.constraints.upgradeOnly.length} indexes=${differences.indexes.freshOnly.length + differences.indexes.upgradeOnly.length}`,
    );
    if (count) process.exitCode = 1;
  } finally {
    await freshClient.end();
    await upgradeClient.end();
  }
}

async function constraints(directory) {
  const { manifest, password } = await readSession(directory);
  const database = manifest.databases[1];
  const ids = JSON.parse(
    await readFile(path.join(directory, "upgrade-fixture-ids.json"), "utf8"),
  );
  const before = JSON.parse(
    await readFile(path.join(directory, "upgrade-pre-snapshot.json"), "utf8"),
  );
  const client = await checkIdentity(manifest, password, database);
  const results = [];
  const baseInsert = `INSERT INTO richieste_magazzino
    (codice, tipo_destinatario, beneficiario_id, area_operativa_id, centro_ascolto_id,
     sorgente, intervento_id, destinatario_nome_snapshot, area_nome_snapshot, bisogno, inviato_da)
    VALUES ($1, 'beneficiario', $2, $3, $4, 'intervento_sociale', $5,
            'Ada Test', 'M5A Area A', 'Bisogno sintetico', $6) RETURNING id`;
  const params = (code) => [
    code,
    ids.beneficiaryA,
    ids.areaA,
    ids.centroA,
    ids.interventionSocial,
    ids.userSocial,
  ];
  try {
    await client.query("BEGIN");
    const requestId = (
      await client.query(baseInsert, params("RM-M5A-CONSTRAINT-1"))
    ).rows[0].id;
    const rejects = async (name, sql, values, expectedCode) => {
      await client.query("SAVEPOINT constraint_case");
      let actualCode = null;
      try {
        await client.query(sql, values);
      } catch (error) {
        actualCode = error.code;
      }
      await client.query("ROLLBACK TO SAVEPOINT constraint_case");
      assert.equal(actualCode, expectedCode, name);
      results.push({ name, code: actualCode });
    };
    await rejects(
      "duplicate-code",
      baseInsert,
      params("RM-M5A-CONSTRAINT-1"),
      "23505",
    );
    await rejects(
      "active-intervention-unique",
      baseInsert,
      params("RM-M5A-CONSTRAINT-2"),
      "23505",
    );
    await rejects(
      "version-positive",
      "UPDATE richieste_magazzino SET versione = 0 WHERE id = $1",
      [requestId],
      "23514",
    );
    await rejects(
      "area-required",
      "UPDATE richieste_magazzino SET area_operativa_id = NULL WHERE id = $1",
      [requestId],
      "23502",
    );
    await rejects(
      "recipient-exclusive",
      "UPDATE richieste_magazzino SET magazzino_destinatario_id = $2 WHERE id = $1",
      [requestId, ids.warehouseA2],
      "23514",
    );
    await rejects(
      "recipient-fk",
      "UPDATE richieste_magazzino SET beneficiario_id = 999999 WHERE id = $1",
      [requestId],
      "23503",
    );
    await rejects(
      "state-actor",
      "UPDATE richieste_magazzino SET stato = 'presa_in_carico' WHERE id = $1",
      [requestId],
      "23514",
    );
    await rejects(
      "state-enum",
      "UPDATE richieste_magazzino SET stato = 'inventato' WHERE id = $1",
      [requestId],
      "23514",
    );
    await client.query(
      "UPDATE richieste_magazzino SET stato = 'annullata', annullato_da = $2, annullato_at = now(), motivo_annullamento = 'Sostituita' WHERE id = $1",
      [requestId, ids.userSocial],
    );
    await client.query(baseInsert, params("RM-M5A-CONSTRAINT-3"));
    results.push({ name: "partial-index-after-cancel", code: "PASS" });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  const first = await checkIdentity(manifest, password, database);
  const second = await checkIdentity(manifest, password, database);
  const monitor = await checkIdentity(manifest, password, database);
  let firstCommittedId = null;
  try {
    await first.query("BEGIN");
    await second.query("BEGIN");
    firstCommittedId = (
      await first.query(baseInsert, params("RM-M5A-CONCURRENT-1"))
    ).rows[0].id;
    const secondPid = (await second.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const competing = second
      .query(baseInsert, params("RM-M5A-CONCURRENT-2"))
      .then(
        () => "unexpected-success",
        (error) => error.code,
      );
    let observedLock = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = (
        await monitor.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
          [secondPid],
        )
      ).rows[0];
      if (state?.wait_event_type === "Lock") {
        observedLock = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!observedLock)
      throw new Error("Concorrenza: attesa lock PostgreSQL non osservata");
    await first.query("COMMIT");
    assert.equal(
      await competing,
      "23505",
      "Secondo inserimento concorrente deve perdere l'indice unico",
    );
    await second.query("ROLLBACK");
    await monitor.query("DELETE FROM richieste_magazzino WHERE id = $1", [
      firstCommittedId,
    ]);
    firstCommittedId = null;
    results.push({
      name: "concurrent-partial-unique",
      code: "PASS",
      lockObserved: true,
      loserSqlState: "23505",
    });
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    if (firstCommittedId != null)
      await monitor.query("DELETE FROM richieste_magazzino WHERE id = $1", [
        firstCommittedId,
      ]);
    await first.end();
    await second.end();
    await monitor.end();
  }
  const checked = await checkIdentity(manifest, password, database);
  try {
    assert.equal(
      (
        await checked.query(
          "SELECT count(*)::integer AS count FROM richieste_magazzino",
        )
      ).rows[0].count,
      0,
    );
    assert.deepEqual(
      compareSnapshots(before.tables, await snapshotPublic(checked)),
      [],
    );
  } finally {
    await checked.end();
  }
  await writeFile(
    path.join(directory, "m5a-constraints-evidence.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `CONSTRAINTS_OK cases=${results.length} concurrentLock=true businessDiff=0`,
  );
}

async function apiTests(directory, targeted) {
  const { manifest, password } = await readSession(directory);
  const database = manifest.databases[0];
  const checked = await checkIdentity(manifest, password, database);
  try {
    const ledger = (
      await checked.query(
        "SELECT count(*)::integer AS count FROM app_meta.schema_migrations",
      )
    ).rows[0].count;
    if (ledger !== 43) throw new Error("API test richiede fresh ledger 43");
  } finally {
    await checked.end();
  }
  const env = isolatedEnvironment(
    databaseUrl(manifest, password, database),
    "m5a-test-working-tree",
  );
  for (const key of Object.keys(env))
    if (key.startsWith("MAIL_") || key.startsWith("SMTP_")) delete env[key];
  env.SESSION_SECRET = randomBytes(32).toString("hex");
  env.COOKIE_SECURE = "false";
  env.COOKIE_SAMESITE = "lax";
  env.M5A_TEST_DISPOSABLE_DB = "verified";
  const args = targeted
    ? [
        "--filter",
        "@workspace/api-server",
        "exec",
        "vitest",
        "run",
        "tests/richieste-magazzino-m5a.test.ts",
        "tests/richieste-magazzino-m5a-session.test.ts",
        "tests/m5a-contract-migration.test.ts",
      ]
    : ["--filter", "@workspace/api-server", "run", "test"];
  const logName = targeted ? "m5a-api-targeted.log" : "m5a-api-full.log";
  await runLogged(
    "pnpm",
    args,
    { cwd: process.cwd(), env, timeout: 600_000 },
    path.join(directory, logName),
    [password, env.SESSION_SECRET],
  );
  console.log(
    `API_${targeted ? "TARGETED" : "FULL"}_OK log=${path.join(directory, logName)}`,
  );
}

async function runnerTests(directory) {
  const { manifest, password } = await readSession(directory);
  const admin = new Client({
    connectionString: databaseUrl(manifest, password, "postgres"),
  });
  await admin.connect();
  try {
    const identity = (
      await admin.query(
        "SELECT (pg_control_system()).system_identifier::text AS id, (SELECT token FROM m5a_test_meta.session_marker) AS token",
      )
    ).rows[0];
    if (
      identity.id !== manifest.systemIdentifier ||
      identity.token !== manifest.runId
    )
      throw new Error("Istanza admin M5A non identificata");
  } finally {
    await admin.end();
  }
  const testDatabase = `m5a_runner_${manifest.runId}`;
  if (!manifest.databases.includes(testDatabase)) {
    manifest.databases.push(testDatabase);
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  }
  const env = isolatedEnvironment(
    databaseUrl(manifest, password, manifest.databases[0]),
    "m5a-test-working-tree",
  );
  env.M5A_RUNNER_TEST_DATABASE_NAME = testDatabase;
  env.M5A_RUNNER_TEST_SYSTEM_IDENTIFIER = manifest.systemIdentifier;
  env.M5A_RUNNER_TEST_SESSION_TOKEN = manifest.runId;
  env.M5A_RUNNER_TEST_PORT = String(manifest.port);
  await runLogged(
    "pnpm",
    ["--filter", "@workspace/db", "run", "test:migrations"],
    { cwd: process.cwd(), env, timeout: 180_000 },
    path.join(directory, "m5a-migration-runner-tests.log"),
    password,
  );
  const finalAdmin = new Client({
    connectionString: databaseUrl(manifest, password, "postgres"),
  });
  await finalAdmin.connect();
  try {
    const remains = (
      await finalAdmin.query(
        "SELECT count(*)::integer AS count FROM pg_database WHERE datname = $1",
        [testDatabase],
      )
    ).rows[0].count;
    if (remains !== 0)
      throw new Error("DB runner test non rimosso dal teardown");
  } finally {
    await finalAdmin.end();
  }
  manifest.databases = manifest.databases.filter(
    (name) => name !== testDatabase,
  );
  manifest.completedDatabases = [
    ...(manifest.completedDatabases ?? []),
    testDatabase,
  ];
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`RUNNER_TESTS_OK db=${testDatabase} removed=true`);
}

async function reducedMigrationTest(directory) {
  const { manifest, password } = await readSession(directory);
  const admin = new Client({
    connectionString: databaseUrl(manifest, password, "postgres"),
  });
  await admin.connect();
  try {
    const identity = (
      await admin.query(
        "SELECT (pg_control_system()).system_identifier::text AS id, (SELECT token FROM m5a_test_meta.session_marker) AS token",
      )
    ).rows[0];
    if (
      identity.id !== manifest.systemIdentifier ||
      identity.token !== manifest.runId
    )
      throw new Error("Istanza admin M5A non identificata");
  } finally {
    await admin.end();
  }
  const testDatabase = `m5a_reduced_${manifest.runId}`;
  if (!manifest.databases.includes(testDatabase)) {
    manifest.databases.push(testDatabase);
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  }
  const env = isolatedEnvironment(
    databaseUrl(manifest, password, "postgres"),
    "m5a-test-working-tree",
  );
  env.M5A_MIGRATION_TEST_ADMIN_URL = databaseUrl(
    manifest,
    password,
    "postgres",
  );
  env.M5A_MIGRATION_TEST_DATABASE_NAME = testDatabase;
  env.M5A_MIGRATION_TEST_SESSION_TOKEN = manifest.runId;
  env.M5A_MIGRATION_TEST_SYSTEM_IDENTIFIER = manifest.systemIdentifier;
  env.M5A_MIGRATION_TEST_PORT = String(manifest.port);
  await runLogged(
    process.execPath,
    [
      "--test",
      path.join(process.cwd(), "lib/db/scripts/m5a-migration.test.mjs"),
    ],
    { cwd: process.cwd(), env, timeout: 180_000 },
    path.join(directory, "m5a-reduced-migration-test.log"),
    password,
  );
  const finalAdmin = new Client({
    connectionString: databaseUrl(manifest, password, "postgres"),
  });
  await finalAdmin.connect();
  try {
    const remains = (
      await finalAdmin.query(
        "SELECT count(*)::integer AS count FROM pg_database WHERE datname = $1",
        [testDatabase],
      )
    ).rows[0].count;
    if (remains !== 0)
      throw new Error("DB reduced test non rimosso dal teardown");
  } finally {
    await finalAdmin.end();
  }
  manifest.databases = manifest.databases.filter(
    (name) => name !== testDatabase,
  );
  manifest.completedDatabases = [
    ...(manifest.completedDatabases ?? []),
    testDatabase,
  ];
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`REDUCED_MIGRATION_OK db=${testDatabase} removed=true`);
}

async function cleanup(directory) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  if (manifest.containerId) {
    const labels = JSON.parse(
      await docker(
        "inspect",
        "--format",
        "{{json .Config.Labels}}",
        manifest.containerId,
      ),
    );
    if (
      labels[scopeLabel] !== "true" ||
      labels["m5a-session"] !== manifest.runId
    )
      throw new Error("Container non identificato: cleanup negato");
    await docker("stop", manifest.containerId);
    await docker("rm", manifest.containerId);
  }
  if (manifest.networkId) {
    const labels = JSON.parse(
      await docker(
        "network",
        "inspect",
        "--format",
        "{{json .Labels}}",
        manifest.networkId,
      ),
    );
    if (
      labels[scopeLabel] !== "true" ||
      labels["m5a-session"] !== manifest.runId
    )
      throw new Error("Rete non identificata: cleanup negato");
    await docker("network", "rm", manifest.networkId);
  }
  await rm(path.join(directory, "postgres.password"), { force: true });
  await rm(path.join(directory, "postgres.env"), { force: true });
  console.log(
    `CLEANUP_OK run=${manifest.runId} container=${manifest.containerId ?? "none"} network=${manifest.networkId ?? "none"}`,
  );
}

const [command, directory] = process.argv.slice(2);
if (command === "setup") await setup();
else if (command === "verify" && directory) await verify(directory);
else if (command === "convert-marker" && directory)
  await convertMarker(directory);
else if (command === "base" && directory) await base(directory);
else if (command === "fixture" && directory) await fixture(directory);
else if (command === "upgrade" && directory) await upgrade(directory);
else if (command === "fresh" && directory) await fresh(directory);
else if (command === "parity" && directory) await parity(directory);
else if (command === "constraints" && directory) await constraints(directory);
else if (command === "api-targeted" && directory)
  await apiTests(directory, true);
else if (command === "api-full" && directory) await apiTests(directory, false);
else if (command === "runner-tests" && directory) await runnerTests(directory);
else if (command === "reduced-test" && directory)
  await reducedMigrationTest(directory);
else if (command === "cleanup" && directory) await cleanup(directory);
else
  throw new Error(
    "Uso: node m5a-ephemeral-pg.mjs setup|verify DIR|cleanup DIR",
  );
