// Exercise the explicitly approved execution path ONLY in an isolated clone.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  cohortFingerprint,
  inspectOrphanAssignments,
  removeApprovedOrphanAssignments,
  OFFICIAL_AUTHORIZATION,
  REPAIR_ACTION,
} from "./m67-orphan-assignments.mjs";

assert.equal(process.env.M67_ORPHANS_DISPOSABLE_DB, "verified");
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.pathname, "/magazzino");
assert.equal(url.hostname, "127.0.0.1");
const archive = JSON.parse(fs.readFileSync(process.env.M67_ORPHANS_ARCHIVE));
assert.equal(cohortFingerprint(archive.rows), archive.fingerprint);
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const results = [];
const check = async (name, fn) => {
  await fn();
  results.push({ name, result: "PASS" });
};
try {
  const identity = (
    await db.query("SELECT (pg_control_system()).system_identifier::text AS id")
  ).rows[0].id;
  const approval = {
    environment: "authorized-official-8082",
    authorization: OFFICIAL_AUTHORIZATION,
    database: "magazzino",
    composeProject: "magazzino-solidale",
    containerName: "magazzino-postgres",
    systemIdentifier: identity,
    expectedCount: 375,
    fingerprint: archive.fingerprint,
    archiveVerifiedFingerprint: archive.fingerprint,
    backupSha256: archive.backupSha256,
    correlationId: randomUUID(),
  };
  for (const [key, value] of [
    ["authorization", "unapproved"],
    ["database", "another_database"],
    ["composeProject", "another_project"],
    ["containerName", "another_container"],
    ["systemIdentifier", "1"],
    ["archiveVerifiedFingerprint", "0".repeat(64)],
  ]) {
    await check(`reject mismatched ${key}`, async () => {
      await assert.rejects(
        removeApprovedOrphanAssignments(db, {
          ...approval,
          [key]: value,
        }),
      );
      assert.equal((await inspectOrphanAssignments(db)).count, 375);
    });
  }
  await check(
    "authorized path deletes exact cohort with truthful audit marker",
    async () => {
      assert.deepEqual(await removeApprovedOrphanAssignments(db, approval), {
        status: "REPAIRED",
        deleted: 375,
        auditAdded: 375,
      });
      const audit = (
        await db.query(
          "SELECT changes,metadata FROM audit_eventi WHERE azione=$1",
          [REPAIR_ACTION],
        )
      ).rows;
      assert.equal(audit.length, 375);
      assert.equal(
        cohortFingerprint(audit.map((e) => e.changes.before)),
        archive.fingerprint,
      );
      assert.ok(audit.every((e) => e.metadata.disposableRehearsal === false));
      assert.equal((await inspectOrphanAssignments(db)).count, 0);
    },
  );
  await check("authorized replay adds neither deletion nor audit", async () => {
    assert.deepEqual(await removeApprovedOrphanAssignments(db, approval), {
      status: "ALREADY_REPAIRED",
      deleted: 0,
      auditAdded: 0,
    });
  });
  console.log(JSON.stringify({ result: "PASS", tests: results }, null, 2));
} finally {
  await db.end();
}
