import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const target = (port, database, flags = [], options = {}) => ({
  port,
  database,
  flags,
  ...options,
});

export const apiTargets = {
  core: target(59671, "m67a_dev", ["M67A"]),
  reporting: target(59666, "m66_dev", ["REPORTING_TEST"]),
  interventi: target(58631, "m63_final", ["M63"]),
  mensa: target(58461, "m61_final"),
  emporio: target(58621, "m62a", ["M62A", "M62A_F1", "M62B", "M62C"]),
  maps: target(59671, "m67_final_maps"),
  // Keep the 5,000-movement snapshot workload independent of planner/table
  // statistics and dead tuples left by the general API fixture lifecycle.
  fse: target(59673, "quality_fse_snapshot"),
  general: target(58621, "m5c2a_r2_final", [
    "M5A_TEST",
    "M5B_TEST",
    "M5C1_TEST",
    "M5C2A_TEST",
    "M5C2A_R2",
    "MENSA_FIX",
  ]),
};

export function apiGroup(filename) {
  if (filename === "fse-r2-acceptance.test.ts") return "fse";
  if (filename.startsWith("m67")) return "core";
  if (filename.startsWith("reporting-m66-")) return "reporting";
  if (filename.startsWith("m63-")) return "interventi";
  if (filename === "mensa.test.ts") return "mensa";
  if (/^(emporio-|cassa-emporio|credito-automatico)/.test(filename))
    return "emporio";
  if (filename === "maps.test.ts") return "maps";
  return "general";
}

export function browserTarget(filename) {
  if (filename.startsWith("m67"))
    return target(59671, "m67a_dev", ["M67A"], { demo: false });
  if (filename === "m63-interventi.spec.ts")
    return target(58631, "m63_e2e", ["M63"], { demo: false });
  if (["reporting-m66.spec.ts", "reporting-review.spec.ts"].includes(filename))
    return target(59666, "m66_dev", ["REPORTING_TEST"], { demo: true });
  if (filename.startsWith("fse-m64"))
    return target(58641, "m64_browser", ["M64"], { demo: true });
  if (
    [
      "emporio-security-m62a.spec.ts",
      "emporio-uat-f1.spec.ts",
      "emporio-rettifiche-m62c.spec.ts",
      "credito-automatico-f1.spec.ts",
      "emporio-workflows.spec.ts",
    ].includes(filename)
  )
    return target(58621, "m62a", ["M62A", "M62A_F1", "M62B", "M62C"], {
      demo: true,
    });
  if (filename.startsWith("mensa-"))
    return target(58461, "m61_e2e", ["M5C1_TEST"], { demo: true });
  if (
    ["m5c1-r2-formal.spec.ts", "m5c1-centro-richiesta.spec.ts"].includes(
      filename,
    )
  )
    return target(58621, "m5c1_r2_e2e", ["M5C1_TEST"], {
      demo: false,
      seed: "m5c1",
    });
  if (filename === "m5c2a-r1-sheet-real.spec.ts")
    return target(58621, "m5c2a_r1", ["M5C2A_TEST"], { demo: false });
  if (filename === "m5c2a-r2-continuity-real.spec.ts")
    return target(58621, "m5c2a_r2_e2e", ["M5C2A_TEST"], { demo: true });
  if (
    ["richieste-magazzino-m5b.spec.ts", "m5b-r2-revoca.spec.ts"].includes(
      filename,
    )
  )
    return target(58621, "m5b_ci_e2e", ["M5B_TEST"], {
      demo: false,
      seed: "m5b",
    });
  return target(58621, "m62c_r2_m4", [], { demo: true });
}

export function partitionBrowser(files, index, count) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= files.length);
  assert.ok(Number.isInteger(index) && index >= 0 && index < count);
  assert.equal(new Set(files).size, files.length);
  return files.filter((_, position) => position % count === index);
}

function discover(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? discover(path.join(directory, entry.name), suffix)
        : entry.name.endsWith(suffix)
          ? [path.join(directory, entry.name)]
          : [],
    )
    .sort();
}

export function testPlan(root = repositoryRoot) {
  const api = discover(
    path.join(root, "artifacts/api-server/tests"),
    ".test.ts",
  );
  const browser = discover(
    path.join(root, "artifacts/magazzino-solidale/e2e"),
    ".spec.ts",
  );
  assert.ok(api.length > 0 && browser.length > 0, "Test inventory is empty");
  const groups = Object.fromEntries(
    Object.keys(apiTargets).map((g) => [g, []]),
  );
  for (const file of api) groups[apiGroup(path.basename(file))].push(file);
  assert.equal(new Set(Object.values(groups).flat()).size, api.length);
  // Any new direct guard must be accounted for, not silently skipped or enabled.
  for (const file of [...api, ...browser]) {
    const group = api.includes(file)
      ? apiTargets[apiGroup(path.basename(file))]
      : browserTarget(path.basename(file));
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /process\.env\.([A-Z0-9_]+)_DISPOSABLE_DB/g,
    ))
      assert.ok(
        group.flags.includes(match[1]),
        `${file}: unassigned ${match[1]} guard`,
      );
  }
  return { api, browser, groups };
}

export function assertDisposableIdentity(container, expected) {
  assert.equal(container.Id, expected.id);
  assert.equal(
    container.Config.Labels?.["magazzino.quality-gates"],
    expected.token,
  );
  assert.equal(
    container.Config.Labels?.["magazzino.quality-database"],
    expected.database,
  );
  assert.equal(container.State.Running, true);
  assert.deepEqual(container.Mounts, []);
  assert.ok(container.HostConfig.Tmpfs?.["/var/lib/postgresql/data"]);
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [
    expected.network,
  ]);
  assert.deepEqual(container.NetworkSettings.Ports["5432/tcp"], [
    { HostIp: "127.0.0.1", HostPort: String(expected.port) },
  ]);
}

export function assertLocalDockerEndpoint(endpoint) {
  assert.match(
    endpoint,
    /^unix:\/\/\//,
    "CI requires a local Unix Docker socket",
  );
}
