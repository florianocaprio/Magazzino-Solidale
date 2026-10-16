// Run only against the isolated restored snapshot; never against live data.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  cohortFingerprint,
  inspectOrphanAssignments,
  removeApprovedOrphanAssignments,
  REPAIR_ACTION,
  REPAIR_KEY,
} from "./m67-orphan-assignments.mjs";

assert.equal(process.env.M67_ORPHANS_DISPOSABLE_DB, "verified");
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.pathname, "/m67_reconcile_clone");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
const archive = JSON.parse(
  fs.readFileSync(process.env.M67_ORPHANS_ARCHIVE, "utf8"),
);
assert.equal(archive.rows.length, 375);
assert.equal(cohortFingerprint(archive.rows), archive.fingerprint);
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const results = [];
const check = async (name, work) => {
  await work();
  results.push({ name, result: "PASS" });
};
const state = async () =>
  (
    await db.query(`SELECT
  (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM turni_volontari t) AS assignments,
  (SELECT md5(coalesce(string_agg(to_jsonb(a)::text,'' ORDER BY id),'')) FROM audit_eventi a) AS audit,
  (SELECT array_agg(convalidated ORDER BY conname) FROM pg_constraint WHERE conrelid='turni_volontari'::regclass AND contype='f') AS validation`)
  ).rows[0];
const identity = (
  await db.query("SELECT (pg_control_system()).system_identifier::text AS id")
).rows[0].id;
const approval = {
  environment: "verified-disposable-clone",
  expectedCount: 375,
  fingerprint: archive.fingerprint,
  archiveVerifiedFingerprint: archive.fingerprint,
  backupSha256: archive.backupSha256,
  systemIdentifier: identity,
  correlationId: randomUUID(),
  database: "m67_reconcile_clone",
  authorization:
    "Floriano: eliminazione dei 375 record orfani, prova su DB effimero",
};
const original = await state();
const oldAuditMax = (
  await db.query("SELECT coalesce(max(id),0) AS id FROM audit_eventi")
).rows[0].id;
const oldAuditHash = (
  await db.query(
    "SELECT md5(coalesce(string_agg(to_jsonb(a)::text,'' ORDER BY id),'')) AS hash FROM audit_eventi a",
  )
).rows[0].hash;
const validBefore = (
  await db.query(
    "SELECT to_jsonb(tv) AS row FROM turni_volontari tv JOIN turni t ON t.id=tv.turno_id JOIN volontari v ON v.id=tv.volontario_id ORDER BY tv.id",
  )
).rows.map((r) => r.row);
const connections = [];
try {
  await check("exact archived cohort and three valid assignments", async () => {
    const cohort = await inspectOrphanAssignments(db);
    assert.equal(cohort.count, 375);
    assert.equal(cohort.bothMissing, 375);
    assert.equal(cohort.fingerprint, archive.fingerprint);
    assert.equal(validBefore.length, 3);
  });
  await check(
    "non-disposable environment rejected without writes",
    async () => {
      await assert.rejects(
        removeApprovedOrphanAssignments(db, {
          ...approval,
          environment: "official",
        }),
      );
      assert.deepEqual(await state(), original);
    },
  );
  await check("wrong PostgreSQL system identity rejected", async () => {
    await assert.rejects(
      removeApprovedOrphanAssignments(db, {
        ...approval,
        systemIdentifier: "1",
      }),
    );
    assert.deepEqual(await state(), original);
  });
  await check("count or archive mismatch rejected", async () => {
    await assert.rejects(
      removeApprovedOrphanAssignments(db, { ...approval, expectedCount: 374 }),
    );
    await assert.rejects(
      removeApprovedOrphanAssignments(db, {
        ...approval,
        archiveVerifiedFingerprint: "0".repeat(64),
      }),
    );
    assert.deepEqual(await state(), original);
  });
  await check("changed cohort fingerprint rolls back", async () => {
    await assert.rejects(
      removeApprovedOrphanAssignments(db, {
        ...approval,
        fingerprint: "0".repeat(64),
        archiveVerifiedFingerprint: "0".repeat(64),
      }),
      /Archived cohort drift/,
    );
    assert.deepEqual(await state(), original);
  });
  await check("unexpected dependent FK prevents deletion", async () => {
    await db.query(
      "CREATE TABLE public.m67_orphan_dependency_probe (id integer REFERENCES turni_volontari(id) ON DELETE CASCADE)",
    );
    try {
      await assert.rejects(
        removeApprovedOrphanAssignments(db, approval),
        /Unexpected dependent FK/,
      );
      assert.deepEqual(await state(), original);
    } finally {
      await db.query("DROP TABLE public.m67_orphan_dependency_probe");
    }
  });
  await check(
    "audit failure after DELETE rolls back rows and validation",
    async () => {
      let deleted = false;
      const fault = {
        query: async (...args) => {
          if (/INSERT INTO public\.audit_eventi/.test(args[0])) {
            assert.ok(deleted);
            throw Error("injected-audit-failure");
          }
          const r = await db.query(...args);
          if (/^DELETE FROM public\.turni_volontari/.test(args[0])) {
            assert.equal(r.rowCount, 375);
            deleted = true;
          }
          return r;
        },
      };
      await assert.rejects(
        removeApprovedOrphanAssignments(fault, approval),
        /injected-audit-failure/,
      );
      assert.ok(deleted);
      assert.deepEqual(await state(), original);
    },
  );
  await check(
    "concurrent repairs serialize on observable PostgreSQL lock; one deletion",
    async () => {
      const a = new pg.Client({ connectionString: url.toString() }),
        b = new pg.Client({ connectionString: url.toString() });
      connections.push(a, b);
      await a.connect();
      await b.connect();
      const pidA = (await a.query("SELECT pg_backend_pid() AS id")).rows[0].id;
      const pidB = (await b.query("SELECT pg_backend_pid() AS id")).rows[0].id;
      let signalDeleted, resume;
      const deleted = new Promise((resolve) => {
        signalDeleted = resolve;
      });
      const paused = new Promise((resolve) => {
        resume = resolve;
      });
      const wrapped = {
        query: async (...args) => {
          const r = await a.query(...args);
          if (/^DELETE FROM public\.turni_volontari/.test(args[0])) {
            signalDeleted();
            await paused;
          }
          return r;
        },
      };
      const first = removeApprovedOrphanAssignments(wrapped, approval);
      await Promise.race([
        deleted,
        first.then(() => {
          throw Error("Expected DELETE barrier");
        }),
      ]);
      const second = removeApprovedOrphanAssignments(b, {
        ...approval,
        correlationId: randomUUID(),
      });
      let observed = false;
      try {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const row = (
            await db.query(
              "SELECT wait_event_type,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1",
              [pidB],
            )
          ).rows[0];
          if (row?.wait_event_type === "Lock" && row.blockers.includes(pidA)) {
            observed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      } finally {
        resume();
      }
      const [one, two] = await Promise.all([first, second]);
      assert.ok(observed, "Actual PostgreSQL blocking must be observed");
      assert.deepEqual(one, {
        status: "REPAIRED",
        deleted: 375,
        auditAdded: 375,
      });
      assert.deepEqual(two, {
        status: "ALREADY_REPAIRED",
        deleted: 0,
        auditAdded: 0,
      });
    },
  );
  await check(
    "valid assignments preserved and only 375 audit preimages added",
    async () => {
      const remaining = (
        await db.query(
          "SELECT to_jsonb(tv) AS row FROM turni_volontari tv ORDER BY id",
        )
      ).rows.map((r) => r.row);
      assert.deepEqual(remaining, validBefore);
      const events = (
        await db.query(
          "SELECT * FROM audit_eventi WHERE azione=$1 AND metadata->>'repairKey'=$2 ORDER BY entita_id",
          [REPAIR_ACTION, REPAIR_KEY],
        )
      ).rows;
      assert.equal(events.length, 375);
      assert.equal(
        cohortFingerprint(events.map((e) => e.changes.before)),
        archive.fingerprint,
      );
      assert.ok(
        events.every(
          (e) =>
            e.actor_type === "system" &&
            e.actor_user_id === null &&
            e.changes.after === null,
        ),
      );
      const oldHash = (
        await db.query(
          "SELECT md5(coalesce(string_agg(to_jsonb(a)::text,'' ORDER BY id),'')) AS hash FROM audit_eventi a WHERE id<=$1",
          [oldAuditMax],
        )
      ).rows[0].hash;
      assert.equal(oldHash, oldAuditHash);
    },
  );
  await check("replay is idempotent and does not add audit", async () => {
    const before = await state();
    assert.deepEqual(await removeApprovedOrphanAssignments(db, approval), {
      status: "ALREADY_REPAIRED",
      deleted: 0,
      auditAdded: 0,
    });
    assert.deepEqual(await state(), before);
  });
  await check(
    "canonical foreign keys validated and reject new orphans",
    async () => {
      const valid = validBefore[0];
      const scenarios = [
        [-2147483000, valid.volontario_id, "turni_volontari_turno_restrict_fk"],
        [valid.turno_id, -2147483000, "turni_volontari_volontario_fk"],
      ];
      assert.ok((await state()).validation.every((v) => v));
      for (const [turno, volontario, constraint] of scenarios) {
        await db.query("BEGIN");
        try {
          await assert.rejects(
            db.query(
              "INSERT INTO turni_volontari(id,turno_id,volontario_id) VALUES(-2147483000,$1,$2)",
              [turno, volontario],
            ),
            (error) =>
              error.code === "23503" && error.constraint === constraint,
          );
        } finally {
          await db.query("ROLLBACK");
        }
      }
    },
  );
  await check(
    "all remaining NOT VALID constraints validate on repaired clone",
    async () => {
      const rows = (
        await db.query(
          "SELECT conrelid::regclass::text AS table_name,conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated",
        )
      ).rows;
      assert.equal(rows.length, 29);
      await db.query("BEGIN");
      try {
        for (const r of rows)
          await db.query(
            `ALTER TABLE public."${r.table_name.replaceAll('"', '""')}" VALIDATE CONSTRAINT "${r.conname.replaceAll('"', '""')}"`,
          );
      } finally {
        await db.query("ROLLBACK");
      }
    },
  );
  console.log(
    JSON.stringify({
      pass: results.length,
      fail: 0,
      skip: 0,
      results,
      deleted: 375,
      retained: 3,
      auditAdded: 375,
      remainingOrphans: (await inspectOrphanAssignments(db)).count,
    }),
  );
} finally {
  for (const c of connections) await c.end();
  await db.end();
}
