/* @vitest-environment node */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEventiTable, db, pool, utentiTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  AuditOperationKeyConflictError,
  auditFields,
  recordAuditEvent,
  systemAuditContext,
} from "../src/lib/auditEvent";

const suffix = `${process.pid}-${Date.now().toString(36)}`;
let userId: number;

beforeAll(async () => {
  [{ id: userId }] = await db
    .insert(utentiTable)
    .values({
      username: `audit_m1c_${suffix}`.slice(0, 60),
      passwordHash: "x",
      nome: "Audit",
      cognome: "M1C",
      matricola: `AUD-${suffix}`.slice(0, 20),
    })
    .returning({ id: utentiTable.id });
});

afterAll(async () => {
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await pool.end();
});

describe("audit_eventi M1C", () => {
  it("applica allowlist e rimuove dati sensibili anche annidati", async () => {
    const eventId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "M1C_TEST_SYSTEM",
          initiatedByUserId: userId,
          initiatedByCodeSnapshot: `AUD-${suffix}`.slice(0, 20),
          operationKey: `sanitize-${suffix}`,
        }),
        azione: "M1C_SANITIZE_TEST",
        entitaTipo: "test",
        entitaId: userId,
        motivo: "password=non-deve-finire-nell-audit",
        changes: auditFields(
          {
            stato: "completato",
            password: "segreta",
            passwordHash: "hash-segreto",
            token: "token-segreto",
            cookie: "cookie-segreto",
            authorization: "Bearer segreto",
            smtpPassword: "smtp-segreta",
            resetLink: "https://example.test/reset/segreto",
            campoNonConsentito: "escluso",
          },
          [
            "stato",
            "password",
            "passwordHash",
            "token",
            "cookie",
            "authorization",
            "smtpPassword",
            "resetLink",
          ],
        ),
        metadata: auditFields(
          {
            contesto: {
              esito: "ok",
              accessToken: "non-deve-finire-nell-audit",
              payloadSensibili: [
                "passwordHash=non-deve-finire-nell-audit",
                "token=non-deve-finire-nell-audit",
                "cookie=non-deve-finire-nell-audit",
                "authorization=non-deve-finire-nell-audit",
                "smtpPassword=non-deve-finire-nell-audit",
                "resetLink=non-deve-finire-nell-audit",
                "api_key=non-deve-finire-nell-audit",
              ],
            },
          },
          ["contesto"],
        ),
      }),
    );

    const [event] = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.id, eventId));
    const serialized = JSON.stringify({
      motivo: event.motivo,
      changes: event.changes,
      metadata: event.metadata,
    });
    expect(serialized).not.toMatch(
      /password|token|secret|authorization|cookie|session|credential|api[-_]?key|reset[-_]?link/i,
    );
    expect(event.changes).toEqual({ stato: "completato" });
    expect(event.metadata).toEqual({
      contesto: {
        esito: "ok",
        payloadSensibili: Array(7).fill("[redacted]"),
      },
    });
    expect(event.motivo).toBe("[redacted]");
    expect(event.initiatedByUserId).toBe(userId);
    expect(event.initiatedByCodeSnapshot).toBe(`AUD-${suffix}`.slice(0, 20));
  });

  it("conserva lo snapshot iniziatore se la FK utente viene azzerata", async () => {
    const [{ id: initiatorId }] = await db
      .insert(utentiTable)
      .values({
        username: `audit_init_${suffix}`.slice(0, 60),
        passwordHash: "x",
        nome: "Audit",
        cognome: "Initiator",
        matricola: `INI-${suffix}`.slice(0, 20),
      })
      .returning({ id: utentiTable.id });
    const initiatorCode = `INI-${suffix}`.slice(0, 20);
    const eventId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "M1C_TEST_SYSTEM",
          initiatedByUserId: initiatorId,
          initiatedByCodeSnapshot: initiatorCode,
          operationKey: `initiator-delete-${suffix}`,
        }),
        azione: "M1C_INITIATOR_SNAPSHOT_TEST",
        entitaTipo: "test",
        entitaId: initiatorId,
      }),
    );

    await db.delete(utentiTable).where(eq(utentiTable.id, initiatorId));

    const [event] = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.id, eventId));
    expect(event.initiatedByUserId).toBeNull();
    expect(event.initiatedByCodeSnapshot).toBe(initiatorCode);
  });

  it("applica al DB le combinazioni valide dell'iniziatore di sistema", async () => {
    const initiatorCode = `DBI-${suffix}`.slice(0, 20);
    const [{ id: initiatorId }] = await db
      .insert(utentiTable)
      .values({
        username: `audit_db_init_${suffix}`.slice(0, 60),
        passwordHash: "x",
        nome: "Audit",
        cognome: "DB Initiator",
        matricola: initiatorCode,
      })
      .returning({ id: utentiTable.id });

    const pureSystem = await pool.query<{ id: number }>(
      `INSERT INTO audit_eventi
         (correlation_id, azione, entita_tipo, entita_id, actor_type,
          actor_code_snapshot)
       VALUES ($1, 'M1C_DB_PURE_SYSTEM', 'test', $2, 'system', 'M1C_TEST_SYSTEM')
       RETURNING id`,
      [randomUUID(), userId],
    );
    const activeInitiator = await pool.query<{ id: number }>(
      `INSERT INTO audit_eventi
         (correlation_id, azione, entita_tipo, entita_id, actor_type,
          actor_code_snapshot, initiated_by_user_id,
          initiated_by_code_snapshot)
       VALUES ($1, 'M1C_DB_ACTIVE_INITIATOR', 'test', $2, 'system',
          'M1C_TEST_SYSTEM', $3, $4)
       RETURNING id`,
      [randomUUID(), userId, initiatorId, initiatorCode],
    );

    await expect(
      pool.query(
        `INSERT INTO audit_eventi
           (correlation_id, azione, entita_tipo, entita_id, actor_type,
            actor_code_snapshot, initiated_by_user_id)
         VALUES ($1, 'M1C_DB_INVALID_INITIATOR', 'test', $2, 'system',
            'M1C_TEST_SYSTEM', $3)`,
        [randomUUID(), userId, initiatorId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await db.delete(utentiTable).where(eq(utentiTable.id, initiatorId));

    const result = await pool.query<{
      id: number;
      initiated_by_user_id: number | null;
      initiated_by_code_snapshot: string | null;
    }>(
      `SELECT id, initiated_by_user_id, initiated_by_code_snapshot
       FROM audit_eventi
       WHERE id = ANY($1::integer[])
       ORDER BY id`,
      [[pureSystem.rows[0]!.id, activeInitiator.rows[0]!.id]],
    );
    expect(result.rows).toEqual([
      {
        id: pureSystem.rows[0]!.id,
        initiated_by_user_id: null,
        initiated_by_code_snapshot: null,
      },
      {
        id: activeInitiator.rows[0]!.id,
        initiated_by_user_id: null,
        initiated_by_code_snapshot: initiatorCode,
      },
    ]);
  });

  it("conserva lo snapshot attore se la FK utente viene azzerata", async () => {
    const actorCode = `ACT-${suffix}`.slice(0, 20);
    const [{ id: actorId }] = await db
      .insert(utentiTable)
      .values({
        username: `audit_actor_${suffix}`.slice(0, 60),
        passwordHash: "x",
        nome: "Audit",
        cognome: "Actor",
        matricola: actorCode,
      })
      .returning({ id: utentiTable.id });
    const eventId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: {
          actor: {
            actorType: "user",
            actorUserId: actorId,
            actorCodeSnapshot: actorCode,
            initiatedByUserId: null,
            initiatedByCodeSnapshot: null,
          },
          correlationId: randomUUID(),
          operationKey: `actor-delete-${suffix}`,
        },
        azione: "M1C_ACTOR_SNAPSHOT_TEST",
        entitaTipo: "test",
        entitaId: actorId,
      }),
    );

    await db.delete(utentiTable).where(eq(utentiTable.id, actorId));

    const [event] = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.id, eventId));
    expect(event.actorUserId).toBeNull();
    expect(event.actorCodeSnapshot).toBe(actorCode);
  });

  it("impedisce update e delete applicativi del registro append-only", async () => {
    const eventId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "M1C_TEST_SYSTEM",
          operationKey: `append-only-${suffix}`,
        }),
        azione: "M1C_APPEND_ONLY_TEST",
        entitaTipo: "test",
        entitaId: userId,
      }),
    );

    await expect(
      pool.query("UPDATE audit_eventi SET motivo = 'alterato' WHERE id = $1", [
        eventId,
      ]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query("DELETE FROM audit_eventi WHERE id = $1", [eventId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("normalizza e limita il motivo senza copiare testo non necessario", async () => {
    const eventId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "M1C_TEST_SYSTEM",
          operationKey: `reason-${suffix}`,
        }),
        azione: "M1C_REASON_POLICY_TEST",
        entitaTipo: "test",
        entitaId: userId,
        motivo: `  ${"m".repeat(1_200)}  `,
      }),
    );

    const [event] = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.id, eventId));
    expect(event.motivo).toBe("m".repeat(1_000));
  });

  it("rende operationKey idempotente per azione senza conflitti fra domini", async () => {
    const operationKey = `shared-key-${suffix}`;
    const firstId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "M1C_TEST_SYSTEM",
          operationKey,
        }),
        azione: "M1C_DOMAIN_A",
        entitaTipo: "test-a",
        entitaId: userId,
      }),
    );
    const replayId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "M1C_TEST_SYSTEM",
          operationKey,
        }),
        azione: "M1C_DOMAIN_A",
        entitaTipo: "test-a",
        entitaId: userId,
      }),
    );
    const otherDomainId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "M1C_TEST_SYSTEM",
          operationKey,
        }),
        azione: "M1C_DOMAIN_B",
        entitaTipo: "test-b",
        entitaId: userId,
      }),
    );

    expect(replayId).toBe(firstId);
    expect(otherDomainId).not.toBe(firstId);
  });

  it("serializza replay concorrenti della stessa operazione ed entità", async () => {
    const operationKey = `concurrent-key-${suffix}`;
    const ids = await Promise.all(
      ["A", "B"].map(() =>
        db.transaction((tx) =>
          recordAuditEvent(tx, {
            command: systemAuditContext({
              actorCode: "M1C_TEST_SYSTEM",
              operationKey,
            }),
            azione: "M1C_CONCURRENT_IDEMPOTENT",
            entitaTipo: "concurrent-idempotency-test",
            entitaId: userId,
          }),
        ),
      ),
    );

    expect(ids[1]).toBe(ids[0]);
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_eventi
       WHERE azione = 'M1C_CONCURRENT_IDEMPOTENT'
         AND operation_key = $1`,
      [operationKey],
    );
    expect(result.rows[0]?.count).toBe("1");
  });

  it("rifiuta il riuso della stessa operationKey per entità diverse", async () => {
    const operationKey = `entity-conflict-${suffix}`;
    const firstId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "M1C_TEST_SYSTEM",
          operationKey,
        }),
        azione: "M1C_ENTITY_CONFLICT",
        entitaTipo: "entity-conflict-test",
        entitaId: userId,
      }),
    );
    const rollbackUsername = `audit_rollback_${suffix}`.slice(0, 60);

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(utentiTable).values({
          username: rollbackUsername,
          passwordHash: "x",
          nome: "Audit",
          cognome: "Rollback",
        });
        await recordAuditEvent(tx, {
          command: systemAuditContext({
            actorCode: "M1C_TEST_SYSTEM",
            operationKey,
          }),
          azione: "M1C_ENTITY_CONFLICT",
          entitaTipo: "entity-conflict-test",
          entitaId: userId + 1,
        });
      }),
    ).rejects.toBeInstanceOf(AuditOperationKeyConflictError);

    await expect(
      db.transaction((tx) =>
        recordAuditEvent(tx, {
          command: systemAuditContext({
            actorCode: "M1C_TEST_SYSTEM",
            operationKey,
          }),
          azione: "M1C_ENTITY_CONFLICT",
          entitaTipo: "other-entity-conflict-test",
          entitaId: userId,
        }),
      ),
    ).rejects.toMatchObject({ code: "AUDIT_OPERATION_KEY_CONFLICT" });

    const events = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.operationKey, operationKey));
    const rollbackUsers = await db
      .select({ id: utentiTable.id })
      .from(utentiTable)
      .where(eq(utentiTable.username, rollbackUsername));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: firstId,
      entitaTipo: "entity-conflict-test",
      entitaId: userId,
    });
    expect(rollbackUsers).toHaveLength(0);
  });

  it("collega previousEventId soltanto alla stessa entità e usa UUID distinti", async () => {
    const entityId = userId + 10_000_000;
    const firstId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({ actorCode: "M1C_TEST_SYSTEM" }),
        azione: "M1C_CHAIN_FIRST",
        entitaTipo: "chain-test",
        entitaId: entityId,
      }),
    );
    await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({ actorCode: "M1C_TEST_SYSTEM" }),
        azione: "M1C_CHAIN_FOREIGN",
        entitaTipo: "other-chain-test",
        entitaId: entityId,
      }),
    );
    const secondId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({ actorCode: "M1C_TEST_SYSTEM" }),
        azione: "M1C_CHAIN_SECOND",
        entitaTipo: "chain-test",
        entitaId: entityId,
      }),
    );

    const events = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.entitaId, entityId));
    const first = events.find((event) => event.id === firstId)!;
    const second = events.find((event) => event.id === secondId)!;
    expect(first.previousEventId).toBeNull();
    expect(second.previousEventId).toBe(first.id);
    expect(first.correlationId).not.toBe(second.correlationId);
    for (const event of [first, second]) {
      expect(event.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(event.correlationId).toHaveLength(36);
    }
  });

  it("mantiene predecessori validi anche per eventi concorrenti", async () => {
    const entityId = userId + 20_000_000;
    const seedId = await db.transaction((tx) =>
      recordAuditEvent(tx, {
        command: systemAuditContext({ actorCode: "M1C_TEST_SYSTEM" }),
        azione: "M1C_CONCURRENT_SEED",
        entitaTipo: "concurrent-chain-test",
        entitaId: entityId,
      }),
    );
    const ids = await Promise.all(
      ["A", "B"].map((label) =>
        db.transaction((tx) =>
          recordAuditEvent(tx, {
            command: systemAuditContext({ actorCode: "M1C_TEST_SYSTEM" }),
            azione: `M1C_CONCURRENT_${label}`,
            entitaTipo: "concurrent-chain-test",
            entitaId: entityId,
          }),
        ),
      ),
    );
    const events = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.entitaId, entityId));
    const byId = new Map(events.map((event) => [event.id, event]));

    for (const id of ids) {
      const event = byId.get(id)!;
      expect(event.previousEventId).not.toBe(id);
      expect(event.previousEventId).not.toBeNull();
      const previous = byId.get(event.previousEventId!)!;
      expect(previous).toMatchObject({
        entitaTipo: "concurrent-chain-test",
        entitaId: entityId,
      });
    }
    expect(byId.has(seedId)).toBe(true);
  });
});
