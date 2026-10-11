import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  resolveBrowserGroup,
  withExclusiveTestEnvironment,
  renameIdleTestDatabase,
} from "./m63-test-guards.mjs";

for (const [name, file] of Object.entries({
  m63: "m63-interventi.spec.ts",
  m5: "m5c2a-r2-continuity-real.spec.ts",
  m5c1: "m5c1-r2-formal.spec.ts",
  m4: "m4b2-transport-return.spec.ts",
  mensa: "mensa-workflows.spec.ts",
  emporio: "emporio-rettifiche-m62c.spec.ts",
  consegne: "consegne-workflows.spec.ts",
})) {
  test(`exact group ${name} retains its identity`, () => {
    const group = resolveBrowserGroup(name);
    assert.equal(group.files[0], file);
    group.files.length = 0;
    assert.equal(resolveBrowserGroup(name).files[0], file);
  });
}
test("invalid or ambiguous aliases cannot select another group", () => {
  for (const name of [
    "m",
    "m5c",
    "m63x",
    "m630",
    "consegne4",
    "__proto__",
    "constructor",
  ]) {
    assert.throws(() => resolveBrowserGroup(name), /Unknown/);
  }
});
test("a separate browser process is denied while API owns the environment, then admitted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m63-lease-test-"));
  const lock = join(dir, "environment.lock");
  const marker = join(dir, "browser-started");
  const moduleUrl = new URL("./m63-test-guards.mjs", import.meta.url).href;
  const code = `import {withExclusiveTestEnvironment} from ${JSON.stringify(moduleUrl)};
    import {writeFileSync} from 'node:fs';
    try {await withExclusiveTestEnvironment(${JSON.stringify(lock)}, 'browser', async()=>writeFileSync(${JSON.stringify(marker)}, 'started'));}
    catch (error) {console.error(error.message);process.exitCode=23;}`;
  try {
    await withExclusiveTestEnvironment(lock, "api", async () => {
      const denied = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        { encoding: "utf8" },
      );
      assert.equal(denied.status, 23);
      assert.match(denied.stderr, /already owned/);
      assert.equal(existsSync(marker), false);
    });
    assert.equal(existsSync(lock), false);
    const admitted = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code],
      { encoding: "utf8" },
    );
    assert.equal(admitted.status, 0, admitted.stderr);
    assert.equal(existsSync(marker), true);
    assert.equal(existsSync(lock), false);
  } finally {
    if (existsSync(marker)) unlinkSync(marker);
    if (existsSync(lock)) unlinkSync(lock);
    rmdirSync(dir);
  }
});
test("failure releases the lease only after the action settles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m63-lease-error-")),
    lock = join(dir, "lock");
  try {
    await assert.rejects(
      withExclusiveTestEnvironment(lock, "api", async () => {
        assert.equal(existsSync(lock), true);
        throw new Error("synthetic failure");
      }),
      /synthetic failure/,
    );
    assert.equal(existsSync(lock), false);
  } finally {
    rmdirSync(dir);
  }
});
test("stale lock is not silently discarded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m63-stale-")),
    lock = join(dir, "lock");
  writeFileSync(lock, "interrupted owner");
  try {
    await assert.rejects(
      withExclusiveTestEnvironment(lock, "browser", async () =>
        assert.fail("must not run"),
      ),
      /already owned/,
    );
    assert.equal(existsSync(lock), true);
  } finally {
    unlinkSync(lock);
    rmdirSync(dir);
  }
});
test("active PostgreSQL clients prevent rename", async () => {
  const queries = [];
  await assert.rejects(
    renameIdleTestDatabase(
      {
        query: async (...args) => {
          queries.push(args);
          return { rowCount: 1 };
        },
      },
      "m62a",
      "m63_api_evidence",
    ),
    /Active clients/,
  );
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0][1], ["m62a"]);
});
test("idle guarded database may be renamed; other targets are rejected", async () => {
  const queries = [],
    client = {
      query: async (...args) => {
        queries.push(args);
        return { rowCount: 0 };
      },
    };
  await renameIdleTestDatabase(client, "m62a", "m63_api_evidence");
  assert.match(
    queries[1][0],
    /^ALTER DATABASE "m62a" RENAME TO "m63_api_evidence"$/,
  );
  await assert.rejects(
    renameIdleTestDatabase(client, "postgres", "m63_api_evidence"),
  );
  await assert.rejects(renameIdleTestDatabase(client, "m62a", "unsafe;target"));
  assert.equal(queries.length, 2);
});
