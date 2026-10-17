import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import {
  repositoryRoot as root,
  testPlan,
  apiTargets,
  browserTarget,
  assertDisposableIdentity,
  assertLocalDockerEndpoint,
} from "./quality-gates-plan.mjs";
import { withExclusiveTestEnvironment } from "./m63-test-guards.mjs";

const { Client } = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
)("pg");
const { getMigrationStatus } =
  await import("../lib/db/scripts/migration-runner.mjs");
const plan = testPlan();
const mode = process.argv[2];
assert.ok(
  ["plan", "api", "browser"].includes(mode),
  "Use plan, api or browser",
);
const only = process.argv.slice(3);
const inventory = {
  api: Object.fromEntries(
    Object.entries(plan.groups).map(([g, fs]) => [
      g,
      fs.map((f) => path.relative(root, f)),
    ]),
  ),
  browser: plan.browser.map((f) => ({
    file: path.relative(root, f),
    ...browserTarget(path.basename(f)),
  })),
};
if (mode === "plan") {
  console.log(JSON.stringify(inventory, null, 2));
  process.exit(0);
}
const dockerContext = JSON.parse(
  execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }),
)[0];
assertLocalDockerEndpoint(
  process.env.DOCKER_HOST ?? dockerContext.Endpoints.docker.Host,
);
const token = randomUUID();
const prefix = `magazzino-quality-${token.slice(0, 8)}`;
const network = prefix + "-net";
const output = path.resolve(
  process.env.CI_RESULTS_DIR ??
    path.join(root, "test-results/quality-gates", mode, token),
);
mkdirSync(output, { recursive: true, mode: 0o700 });
writeFileSync(
  path.join(output, "inventory.json"),
  JSON.stringify(inventory, null, 2),
);
const redactions = [];
const redact = (text) =>
  redactions.reduce((s, secret) => s.split(secret).join("[REDACTED]"), text);
let sequence = 0;
const results = [];
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/DISPOSABLE_DB$|^DATABASE_URL$|^E2E_DATABASE_URL$|^M5A_RUNNER_TEST_|^SUPER_ADMIN_INITIAL_|^E2E_(PASSWORD|USERNAME)$/.test(
        k,
      ),
  ),
);
const baseEnv = {
  ...cleanEnvironment,
  NODE_ENV: "test",
  COOKIE_SECURE: "false",
  COOKIE_SAMESITE: "lax",
  MAPS_PUBLIC_GEOCODING_ALLOWED: "false",
  NOMINATIM_BASE_URL: "http://127.0.0.1:1",
};
const docker = (args) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
async function run(command, args, env, label) {
  const filename = `${String(++sequence).padStart(3, "0")}-${label}.log`;
  const fd = openSync(path.join(output, filename), "wx", 0o600);
  const started = Date.now();
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.lastIndexOf("\n");
      if (end >= 0) {
        const text = redact(buffer.slice(0, end + 1));
        writeSync(fd, text);
        tail = (tail + text).slice(-3500);
        buffer = buffer.slice(end + 1);
      }
    });
    stream.on("end", () => {
      if (buffer) writeSync(fd, redact(buffer));
    });
  }
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => closeSync(fd));
  results.push({
    label,
    code,
    durationMs: Date.now() - started,
    log: filename,
  });
  writeFileSync(
    path.join(output, "steps.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${label}: ${code === 0 ? "PASS" : "FAIL"} (${Math.round((Date.now() - started) / 1000)}s)`,
  );
  if (code !== 0) throw new Error(`${label}: exit ${code}\n${tail}`);
}
async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function sql(url, text, values = []) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}
async function environment(target, label, action) {
  await portFree(target.port);
  const name = `${prefix}-${label}`;
  assert.match(name, /^[a-z0-9-]+$/);
  assert.match(target.database, /^[a-z0-9_]+$/);
  const password = randomBytes(24).toString("hex");
  redactions.push(password);
  if (process.env.GITHUB_ACTIONS === "true")
    console.log(`::add-mask::${password}`);
  const user = "quality_test";
  const url = `postgresql://${user}:${password}@127.0.0.1:${target.port}/${target.database}`;
  let id;
  try {
    id = execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "-d",
        "--name",
        name,
        "--label",
        `magazzino.quality-gates=${token}`,
        "--label",
        `magazzino.quality-database=${target.database}`,
        "--network",
        network,
        "--tmpfs",
        "/var/lib/postgresql/data:rw",
        "-p",
        `127.0.0.1:${target.port}:5432`,
        "-e",
        "POSTGRES_USER=" + user,
        "-e",
        "POSTGRES_PASSWORD",
        "-e",
        "POSTGRES_DB=" + target.database,
        "postgres:16",
      ],
      {
        env: { ...cleanEnvironment, POSTGRES_PASSWORD: password },
        encoding: "utf8",
      },
    ).trim();
    docker([
      "exec",
      name,
      "sh",
      "-ec",
      `until pg_isready -U ${user} -d ${target.database}; do sleep 1; done`,
    ]);
    const inspect = JSON.parse(docker(["inspect", name]))[0];
    assertDisposableIdentity(inspect, { id, token, network, ...target });
    const {
      rows: [identity],
    } = await sql(
      url,
      `SELECT current_database() AS database,
      current_user AS username, current_setting('server_version_num')::int AS version,
      (pg_control_system()).system_identifier::text AS system_identifier,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS tables`,
    );
    assert.equal(identity.database, target.database);
    assert.equal(identity.username, user);
    assert.equal(Math.floor(identity.version / 10000), 16);
    assert.equal(identity.tables, 0);
    const marker = `quality-gates:${token}:${label}`;
    await sql(url, `COMMENT ON DATABASE "${target.database}" IS '${marker}'`);
    const env = {
      ...baseEnv,
      DATABASE_URL: url,
      E2E_DATABASE_URL: url,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      UPLOAD_DIR: path.join(output, label + "-uploads"),
      QUALITY_TEST_IDENTITY: JSON.stringify({ ...identity, marker }),
    };
    if (label.startsWith("e2e-reporting-")) {
      env.REPORTING_EVIDENCE_DIR = mkdtempSync(
        "/private/tmp/magazzino-m66-quality-",
      );
      env.REPORTING_RUN = token;
    }
    // Attestation is generated only AFTER inspecting this exact new container
    // and connecting to its empty, named PostgreSQL16 database.
    for (const flag of target.flags) env[flag + "_DISPOSABLE_DB"] = "verified";
    writeFileSync(
      path.join(output, label + "-identity.json"),
      JSON.stringify(
        {
          container: name,
          id,
          network,
          token,
          ...target,
          ...identity,
          marker,
          mounts: inspect.Mounts,
        },
        null,
        2,
      ),
    );
    console.log(
      `Verified disposable ${label}: 127.0.0.1:${target.port}/${target.database}`,
    );
    await action(env, identity, marker);
  } finally {
    if (id) {
      const state = JSON.parse(docker(["inspect", name]))[0];
      assertDisposableIdentity(state, { id, token, network, ...target });
      docker(["stop", name]);
      // --rm removal can finish just after stop returns. Wait for the observed
      // disappearance, without restarting containers or retrying failed tests.
      const deadline = Date.now() + 10_000;
      while (docker(["container", "ls", "-a", "--filter", "id=" + id, "-q"])) {
        assert.ok(
          Date.now() < deadline,
          "Disposable container removal did not complete",
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log(`Removed disposable ${name}`);
    }
  }
}
const ledgerOptions = (env) => ({
  databaseUrl: env.DATABASE_URL,
  updatesDirectory: path.join(root, "lib/db/updates"),
  manifestPath: path.join(root, "lib/db/legacy-migrations-baseline.json"),
});
async function assertLedger(env, label) {
  await run(
    "pnpm",
    ["--filter", "@workspace/db", "run", "update"],
    env,
    label + "-migrate",
  );
  const status = await getMigrationStatus(ledgerOptions(env));
  assert.ok(status.totalFiles > 0);
  assert.equal(status.initialized, true);
  assert.equal(status.appliedFiles, status.totalFiles);
  for (const field of [
    "pendingFiles",
    "checksumMismatches",
    "appliedFilesMissing",
    "outOfOrderFiles",
  ])
    assert.deepEqual(status[field], []);
  writeFileSync(
    path.join(output, label + "-ledger.json"),
    JSON.stringify(status, null, 2),
  );
}
async function bootstrap(env, target, label, browser) {
  if (browser) {
    const initial = randomBytes(24).toString("hex") + "-Initial1!";
    const final = randomBytes(24).toString("hex") + "-Final2!";
    redactions.push(initial, final);
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::add-mask::${initial}`);
      console.log(`::add-mask::${final}`);
    }
    Object.assign(env, {
      FRESH_DB_INITIAL_PASSWORD: initial,
      FRESH_DB_FINAL_PASSWORD: final,
      FRESH_DB_API_PORT: "19480",
      E2E_USERNAME: "sadmin",
      E2E_PASSWORD: final,
      DEMO_USER_INITIAL_PASSWORD: final,
    });
    await portFree(19480);
    await run("pnpm", ["test:fresh-db"], env, label + "-fresh");
    if (target.demo)
      await run(
        "pnpm",
        [
          "--filter",
          "@workspace/api-server",
          "environment:data",
          "seed-demo",
          "--super-admin=sadmin",
        ],
        env,
        label + "-demo",
      );
    if (target.seed === "m5c1") {
      const status = await getMigrationStatus(ledgerOptions(env));
      Object.assign(env, {
        M5C1_E2E_EXPECTED_PORT: String(target.port),
        M5C1_E2E_EXPECTED_DATABASE: target.database,
        M5C1_E2E_EXPECTED_LEDGER: String(status.totalFiles),
        M5C1_E2E_PASSWORD: final,
      });
      await run(
        "pnpm",
        [
          "--filter",
          "@workspace/api-server",
          "exec",
          "tsx",
          "tests/m5c1-e2e-seed.mjs",
        ],
        env,
        label + "-fixture",
      );
    }
    if (target.seed === "m5b") {
      await run(
        "pnpm",
        [
          "--filter",
          "@workspace/api-server",
          "exec",
          "tsx",
          "tests/helpers/quality-m5b-browser-seed.ts",
        ],
        env,
        label + "-fixture",
      );
    }
  } else {
    // Canonical schema bootstrap is safe here only because the named DB was
    // just verified empty; incremental migrations always use the ledger runner.
    await run(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push"],
      env,
      label + "-schema",
    );
    await assertLedger(env, label);
    await run(
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "tsx",
        "tests/helpers/quality-ci-bootstrap.ts",
      ],
      env,
      label + "-base",
    );
  }
  await assertLedger(env, label + "-replay");
}

await withExclusiveTestEnvironment(
  path.join(
    process.platform === "darwin" ? "/private/tmp" : tmpdir(),
    "magazzino-m63-test-ports.lock",
  ),
  { mode, token, output },
  async () => {
    docker([
      "network",
      "create",
      "--label",
      `magazzino.quality-gates=${token}`,
      network,
    ]);
    try {
      if (mode === "api") {
        if (!only.length) {
          const fresh = {
            port: 59672,
            database: "quality_fresh",
            flags: [],
            demo: false,
          };
          await environment(fresh, "api-fresh", async (env) => {
            await bootstrap(env, fresh, "api-fresh", true);
          });
        }
        for (const [group, files] of Object.entries(plan.groups)) {
          if (only.length && !only.includes(group)) continue;
          await environment(apiTargets[group], "api-" + group, async (env) => {
            await bootstrap(env, apiTargets[group], group, false);
            if (group === "general")
              await run(
                "pnpm",
                ["--filter", "@workspace/db", "run", "test:migrations"],
                env,
                "runner-postgresql",
              );
            await run(
              "pnpm",
              [
                "--filter",
                "@workspace/api-server",
                "exec",
                "vitest",
                "run",
                ...files.map((f) =>
                  path.relative(path.join(root, "artifacts/api-server"), f),
                ),
                "--maxWorkers=1",
                "--reporter=default",
                "--reporter=json",
                "--outputFile=" + path.join(output, `api-${group}.json`),
              ],
              env,
              "api-" + group,
            );
            await assertLedger(env, "api-" + group + "-final");
          });
        }
        assert.ok(
          !only.length || only.every((g) => Object.hasOwn(plan.groups, g)),
          "Unknown API group",
        );
      } else {
        await portFree(19671);
        await portFree(19672);
        const selected = plan.browser.filter(
          (f) => !only.length || only.includes(path.basename(f)),
        );
        assert.equal(
          selected.length,
          only.length || plan.browser.length,
          "Unknown/duplicate browser spec",
        );
        for (const file of selected) {
          const filename = path.basename(file),
            name = filename.replace(/\.spec\.ts$/, "");
          const target = browserTarget(filename);
          await environment(target, "e2e-" + name, async (env) => {
            await bootstrap(env, target, name, true);
            Object.assign(env, {
              QUALITY_E2E_FILE: filename,
              QUALITY_E2E_OUTPUT: path.join(output, name + "-results"),
              QUALITY_E2E_JSON: path.join(output, "e2e-" + name + ".json"),
              E2E_MODE: "true",
            });
            await run(
              "pnpm",
              [
                "--filter",
                "@workspace/magazzino-solidale",
                "exec",
                "playwright",
                "test",
                "--config",
                "playwright.ci.config.ts",
              ],
              env,
              "e2e-" + name,
            );
            await assertLedger(env, name + "-final");
          });
        }
      }
    } finally {
      const ids = docker([
        "container",
        "ls",
        "-a",
        "--filter",
        `label=magazzino.quality-gates=${token}`,
        "-q",
      ]);
      assert.equal(
        ids,
        "",
        "Disposable containers remain; refusing network removal",
      );
      docker(["network", "rm", network]);
      console.log("Removed named temporary network; no volumes were created.");
    }
  },
);
console.log(
  `${mode}: complete ${only.length ? "TARGETED" : "FULL"} campaign PASS; evidence: ${output}`,
);
