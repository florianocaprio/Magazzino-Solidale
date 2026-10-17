import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  testPlan,
  apiGroup,
  apiTargets,
  browserTarget,
  partitionBrowser,
  assertDisposableIdentity,
  assertLocalDockerEndpoint,
} from "./quality-gates-plan.mjs";

test("provisioning refuses remote Docker endpoints before any mutation", () => {
  assertLocalDockerEndpoint("unix:///var/run/docker.sock");
  for (const endpoint of [
    "ssh://remote",
    "tcp://127.0.0.1:2375",
    "https://remote",
    "",
  ])
    assert.throws(() => assertLocalDockerEndpoint(endpoint));
});

test("every API and browser file has one environment and its direct guards are accounted for", () => {
  const plan = testPlan();
  assert.equal(
    new Set(Object.values(plan.groups).flat()).size,
    plan.api.length,
  );
  assert.equal(new Set(plan.browser).size, plan.browser.length);
  for (const group of Object.keys(apiTargets))
    assert.match(group, /^[a-z0-9-]+$/, "Group must be a safe container label");
  assert.deepEqual(apiTargets.core, {
    port: 59671,
    database: "m67a_dev",
    flags: ["M67A"],
  });
  assert.equal(browserTarget("m5c1-r2-formal.spec.ts").database, "m5c1_r2_e2e");
  assert.equal(browserTarget("mensa-workflows.spec.ts").port, 58461);
  assert.equal(browserTarget("fse-m64-d64.spec.ts").port, 58641);
});

test("FSE snapshot acceptance keeps its full workload on a separate fresh database", () => {
  const plan = testPlan();
  assert.equal(apiGroup("fse-r2-acceptance.test.ts"), "fse");
  assert.equal(plan.groups.fse.length, 1);
  assert.equal(path.basename(plan.groups.fse[0]), "fse-r2-acceptance.test.ts");
  assert.ok(
    !plan.groups.general.some((f) => f.endsWith("/fse-r2-acceptance.test.ts")),
  );
  assert.deepEqual(apiTargets.fse, {
    port: 59673,
    database: "quality_fse_snapshot",
    flags: [],
  });
});

test("the four CI browser partitions cover every spec exactly once", () => {
  const files = testPlan().browser;
  const partitions = Array.from({ length: 4 }, (_, i) =>
    partitionBrowser(files, i, 4),
  );
  assert.ok(partitions.every((files) => files.length > 0));
  assert.equal(new Set(partitions.flat()).size, files.length);
  assert.deepEqual(partitions.flat().sort(), [...files].sort());
});

test("invalid or duplicate browser partition inputs fail instead of dropping tests", () => {
  for (const [files, index, count] of [
    [[], 0, 4],
    [["a", "b"], -1, 2],
    [["a", "b"], 2, 2],
    [["a", "b"], 0, 0],
    [["a", "b"], 0, 3],
    [["a", "a"], 0, 2],
  ])
    assert.throws(() => partitionBrowser(files, index, count));
});

test("a new unassigned disposable guard fails inventory instead of silently skipping or attesting it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "magazzino-ci-plan-"));
  try {
    mkdirSync(path.join(root, "artifacts/api-server/tests"), {
      recursive: true,
    });
    mkdirSync(path.join(root, "artifacts/magazzino-solidale/e2e"), {
      recursive: true,
    });
    writeFileSync(
      path.join(root, "artifacts/api-server/tests/new.test.ts"),
      'process.env.NEW_DISPOSABLE_DB === "verified"',
    );
    writeFileSync(
      path.join(root, "artifacts/magazzino-solidale/e2e/example.spec.ts"),
      "",
    );
    assert.throws(() => testPlan(root), /unassigned NEW guard/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

const expected = {
  id: "created-container-id",
  token: "unique-owner",
  database: "m67a_dev",
  network: "unique-network",
  port: 59671,
};
const valid = () => ({
  Id: expected.id,
  Config: {
    Labels: {
      "magazzino.quality-gates": expected.token,
      "magazzino.quality-database": expected.database,
    },
  },
  State: { Running: true },
  Mounts: [],
  HostConfig: { Tmpfs: { "/var/lib/postgresql/data": "rw" } },
  NetworkSettings: {
    Networks: { [expected.network]: {} },
    Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "59671" }] },
  },
});
test("only the exact running loopback container with tmpfs is accepted", () =>
  assertDisposableIdentity(valid(), expected));
for (const [name, mutate] of [
  ["another container", (c) => (c.Id = "other")],
  [
    "another owner",
    (c) => (c.Config.Labels["magazzino.quality-gates"] = "other"),
  ],
  [
    "another database",
    (c) => (c.Config.Labels["magazzino.quality-database"] = "production"),
  ],
  ["stopped", (c) => (c.State.Running = false)],
  [
    "persistent mount",
    (c) => c.Mounts.push({ Type: "volume", Name: "persistent" }),
  ],
  ["missing tmpfs", (c) => (c.HostConfig.Tmpfs = {})],
  ["shared network", (c) => (c.NetworkSettings.Networks.other = {})],
  [
    "external listener",
    (c) => (c.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0"),
  ],
  [
    "wrong port",
    (c) => (c.NetworkSettings.Ports["5432/tcp"][0].HostPort = "8082"),
  ],
])
  test(`refuses ${name}`, () => {
    const candidate = valid();
    mutate(candidate);
    assert.throws(() => assertDisposableIdentity(candidate, expected));
  });
