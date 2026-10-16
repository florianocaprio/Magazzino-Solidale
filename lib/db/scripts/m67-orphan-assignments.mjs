// Explicit maintenance, never an application startup migration.
// Official execution requires separate approval and the verified DB identity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const REPAIR_ACTION = "M67_ASSEGNAZIONE_ORFANA_RIMOSSA";
export const REPAIR_KEY = "m67-p2-orphans-20261016";
export const OFFICIAL_AUTHORIZATION =
  "Floriano: bonifica ufficiale 8082 dei soli 375 orfani archiviati, 2026-10-16";
const constraints = [
  "turni_volontari_turno_restrict_fk",
  "turni_volontari_volontario_fk",
];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function cohortFingerprint(rows) {
  return createHash("sha256")
    .update(JSON.stringify(canonical([...rows].sort((a, b) => a.id - b.id))))
    .digest("hex");
}

export async function inspectOrphanAssignments(db) {
  const rows = (
    await db.query(`
    SELECT to_jsonb(tv) AS row,
      NOT EXISTS(SELECT 1 FROM public.turni t WHERE t.id=tv.turno_id) AS missing_turno,
      NOT EXISTS(SELECT 1 FROM public.volontari v WHERE v.id=tv.volontario_id) AS missing_volontario
    FROM public.turni_volontari tv
    WHERE NOT EXISTS(SELECT 1 FROM public.turni t WHERE t.id=tv.turno_id)
      OR NOT EXISTS(SELECT 1 FROM public.volontari v WHERE v.id=tv.volontario_id)
    ORDER BY tv.id
  `)
  ).rows;
  return {
    rows: rows.map((r) => r.row),
    count: rows.length,
    bothMissing: rows.filter((r) => r.missing_turno && r.missing_volontario)
      .length,
    fingerprint: cohortFingerprint(rows.map((r) => r.row)),
  };
}

export async function removeApprovedOrphanAssignments(db, approval) {
  const official = approval.environment === "authorized-official-8082";
  if (official) {
    assert.equal(approval.authorization, OFFICIAL_AUTHORIZATION);
    assert.equal(approval.database, "magazzino");
    assert.equal(approval.composeProject, "magazzino-solidale");
    assert.equal(approval.containerName, "magazzino-postgres");
    assert.equal(
      approval.archiveVerifiedFingerprint,
      "c7dcae81e4bdc5da88cf6f135e695bd9e0868e56950804151401dc9640aa17cb",
    );
  } else {
    assert.equal(approval.environment, "verified-disposable-clone");
    assert.equal(
      approval.authorization,
      "Floriano: eliminazione dei 375 record orfani, prova su DB effimero",
    );
    assert.ok(
      ["m67_orphans_clone", "m67_reconcile_clone"].includes(approval.database),
    );
  }
  assert.equal(approval.expectedCount, 375, "Only the approved 375-row cohort");
  assert.match(approval.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(approval.archiveVerifiedFingerprint, approval.fingerprint);
  assert.match(approval.backupSha256, /^[0-9a-f]{64}$/);
  assert.match(approval.systemIdentifier, /^\d+$/);
  assert.match(approval.correlationId, /^[0-9a-f-]{36}$/i);

  const identity = (
    await db.query(`SELECT current_database() AS database,
    (pg_control_system()).system_identifier::text AS system_identifier`)
  ).rows[0];
  assert.equal(identity.database, approval.database);
  assert.equal(identity.system_identifier, approval.systemIdentifier);

  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='30s'");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      REPAIR_KEY,
    ]);
    // Block parent creation/removal, child writes and concurrent audit batches
    // while comparing the exact archived set and applying this one-off repair.
    await db.query(
      "LOCK TABLE public.turni, public.volontari, public.turni_volontari, public.turni_consegne, public.audit_eventi IN SHARE ROW EXCLUSIVE MODE",
    );
    const inbound = (
      await db.query(`SELECT conname FROM pg_constraint
      WHERE contype='f' AND confrelid='public.turni_volontari'::regclass`)
    ).rows;
    assert.equal(
      inbound.length,
      0,
      "Unexpected dependent FK: no cascading deletion allowed",
    );
    const deleteTriggers = (
      await db.query(`SELECT tgname FROM pg_trigger
      WHERE tgrelid='public.turni_volontari'::regclass
        AND NOT tgisinternal AND tgenabled<>'D' AND (tgtype::int & 8)=8`)
    ).rows;
    assert.equal(deleteTriggers.length, 0, "Unexpected DELETE trigger");
    const fks = (
      await db.query(
        `SELECT conname,confrelid::regclass::text AS parent,
      pg_get_constraintdef(oid) AS definition, convalidated, condeferrable
      FROM pg_constraint WHERE conrelid='public.turni_volontari'::regclass
      AND contype='f' AND conname=ANY($1::text[]) ORDER BY conname`,
        [constraints],
      )
    ).rows;
    assert.equal(fks.length, 2, "Expected canonical FK pair");
    for (const fk of fks) {
      const column = fk.conname.includes("turno_restrict")
        ? "turno_id"
        : "volontario_id";
      const parent = column === "turno_id" ? "turni" : "volontari";
      assert.equal(fk.parent, parent);
      assert.equal(fk.condeferrable, false);
      assert.equal(
        fk.definition.replace(/ NOT VALID$/, ""),
        `FOREIGN KEY (${column}) REFERENCES ${parent}(id) ON DELETE RESTRICT`,
      );
    }
    const cohort = await inspectOrphanAssignments(db);
    const existingAudit = (
      await db.query(
        `SELECT entita_id, changes, metadata
      FROM public.audit_eventi WHERE azione=$1 AND metadata->>'repairKey'=$2
      ORDER BY entita_id`,
        [REPAIR_ACTION, REPAIR_KEY],
      )
    ).rows;
    if (cohort.count === 0) {
      assert.equal(
        existingAudit.length,
        approval.expectedCount,
        "Empty cohort without complete prior repair audit",
      );
      assert.equal(
        cohortFingerprint(existingAudit.map((e) => e.changes.before)),
        approval.fingerprint,
      );
      assert.ok(
        existingAudit.every(
          (e) => e.metadata.cohortFingerprint === approval.fingerprint,
        ),
      );
      assert.ok(fks.every((fk) => fk.convalidated));
      await db.query("COMMIT");
      return { status: "ALREADY_REPAIRED", deleted: 0, auditAdded: 0 };
    }
    assert.equal(
      existingAudit.length,
      0,
      "Partial or conflicting prior repair",
    );
    assert.equal(cohort.count, approval.expectedCount, "Orphan count drift");
    assert.equal(
      cohort.bothMissing,
      approval.expectedCount,
      "Do not delete partly recoverable assignments",
    );
    assert.equal(
      cohort.fingerprint,
      approval.fingerprint,
      "Archived cohort drift",
    );
    const ids = cohort.rows.map((r) => r.id);
    const sources = (
      await db.query(
        `SELECT count(*)::int AS count FROM public.turni_consegne
      WHERE turno_id=ANY($1::int[]) OR volontario_id=ANY($2::int[])`,
        [
          cohort.rows.map((r) => r.turno_id),
          cohort.rows.map((r) => r.volontario_id),
        ],
      )
    ).rows[0].count;
    assert.equal(
      sources,
      0,
      "Delivery provenance present: manual review required",
    );
    const deleted = (
      await db.query(
        `DELETE FROM public.turni_volontari tv
      WHERE tv.id=ANY($1::int[])
        AND NOT EXISTS(SELECT 1 FROM public.turni t WHERE t.id=tv.turno_id)
        AND NOT EXISTS(SELECT 1 FROM public.volontari v WHERE v.id=tv.volontario_id)
      RETURNING to_jsonb(tv) AS row`,
        [ids],
      )
    ).rows.map((r) => r.row);
    assert.equal(deleted.length, approval.expectedCount);
    assert.equal(cohortFingerprint(deleted), approval.fingerprint);
    // System maintenance actor, not an invented authenticated user. Preserve
    // full preimages in the existing append-only audit; never alter old events.
    const audit = await db.query(
      `INSERT INTO public.audit_eventi
      (correlation_id,azione,entita_tipo,entita_id,actor_type,actor_code_snapshot,
       motivo,changes,metadata,operation_key,previous_event_id)
      SELECT $1::uuid,$2,'turno_volontario',r.id,'system','m67-orphan-assignment-repair',
        $3,jsonb_build_object('before',r.row,'after',NULL),$4::jsonb,
        $5 || ':' || r.id,
        (SELECT max(a.id) FROM public.audit_eventi a WHERE a.entita_tipo='turno_volontario' AND a.entita_id=r.id)
      FROM (SELECT (value->>'id')::int AS id,value AS row FROM jsonb_array_elements($6::jsonb)) r
      RETURNING id`,
      [
        approval.correlationId,
        REPAIR_ACTION,
        approval.authorization,
        JSON.stringify({
          repairKey: REPAIR_KEY,
          cohortFingerprint: approval.fingerprint,
          sourceBackupSha256: approval.backupSha256,
          disposableRehearsal: !official,
        }),
        REPAIR_KEY,
        JSON.stringify(deleted),
      ],
    );
    assert.equal(audit.rowCount, approval.expectedCount);
    for (const name of constraints)
      await db.query(
        `ALTER TABLE public.turni_volontari VALIDATE CONSTRAINT "${name}"`,
      );
    assert.equal((await inspectOrphanAssignments(db)).count, 0);
    await db.query("COMMIT");
    return {
      status: "REPAIRED",
      deleted: deleted.length,
      auditAdded: audit.rowCount,
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
