import { spawn } from "node:child_process";
import { once } from "node:events";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const initialPassword = process.env.FRESH_DB_INITIAL_PASSWORD;
if (!initialPassword) throw new Error("FRESH_DB_INITIAL_PASSWORD is required");

const finalPassword = process.env.FRESH_DB_FINAL_PASSWORD ?? `${initialPassword}-Changed1`;
const port = Number(process.env.FRESH_DB_API_PORT ?? 18080);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("FRESH_DB_API_PORT must be a valid non-privileged port");
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function assertEmptyDatabase() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT count(*)::int AS count
      FROM pg_catalog.pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    `);
    if (result.rows[0].count !== 0) {
      throw new Error("Fresh DB gate refused a non-empty database");
    }
  } finally {
    await client.end();
  }
}

async function assertLedgerReady() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        to_regclass('app_meta.schema_migrations') IS NOT NULL AS initialized,
        to_regclass('public.movimenti') IS NOT NULL AS inventory_ledger,
        count(*)::int AS applied
      FROM app_meta.schema_migrations
    `);
    const row = result.rows[0];
    if (!row.initialized || !row.inventory_ledger || row.applied < 1) {
      throw new Error("Migration or inventory ledger is not initialized");
    }
  } finally {
    await client.end();
  }
}

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie");
  if (!raw) throw new Error("Login did not return a session cookie");
  return raw.split(";", 1)[0];
}

async function waitForApi(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`API exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("API did not become healthy");
}

async function apiCrudSmoke() {
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    "pnpm",
    ["--filter", "@workspace/api-server", "exec", "tsx", "src/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        SESSION_SECRET: "fresh-db-gate-session-secret-only",
        COOKIE_SECURE: "false",
        COOKIE_SAMESITE: "lax",
      },
      stdio: "inherit",
    },
  );

  try {
    await waitForApi(baseUrl, child);
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "sadmin", password: initialPassword }),
    });
    if (!login.ok) throw new Error(`Login smoke failed with ${login.status}`);
    const cookie = cookieFrom(login);

    const changePassword = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ newPassword: finalPassword }),
    });
    if (!changePassword.ok) {
      throw new Error(`Password change smoke failed with ${changePassword.status}`);
    }

    const created = await fetch(`${baseUrl}/api/aree-operative`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ nome: "Fresh DB smoke", sigla: "FD", attivo: true }),
    });
    if (created.status !== 201) {
      throw new Error(`CRUD create smoke failed with ${created.status}`);
    }
    const area = await created.json();
    const updated = await fetch(`${baseUrl}/api/aree-operative/${area.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ note: "fresh-db-gate" }),
    });
    if (!updated.ok) throw new Error(`CRUD update smoke failed with ${updated.status}`);

    const deactivated = await fetch(`${baseUrl}/api/aree-operative/${area.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    if (deactivated.status !== 204) {
      throw new Error(`CRUD delete smoke failed with ${deactivated.status}`);
    }
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode == null) await once(child, "exit");
  }
}

await assertEmptyDatabase();
await run("pnpm", ["--filter", "@workspace/db", "run", "push"]);
await run("pnpm", ["--filter", "@workspace/db", "run", "update"]);
await run(
  "pnpm",
  ["--filter", "@workspace/api-server", "run", "seed:base"],
  {
    SUPER_ADMIN_INITIAL_PASSWORD: initialPassword,
    SUPER_ADMIN_INITIAL_EMAIL: "fresh-db-gate@example.org",
  },
);
await assertLedgerReady();
await apiCrudSmoke();
await run("pnpm", ["--filter", "@workspace/db", "run", "update"]);
await run("pnpm", ["--filter", "@workspace/db", "run", "migrations:verify"]);
await run("pnpm", ["--filter", "@workspace/db", "run", "migrations:status"]);
console.log("Fresh DB gate completed: bootstrap, seed, API CRUD, replay and verify are green.");
