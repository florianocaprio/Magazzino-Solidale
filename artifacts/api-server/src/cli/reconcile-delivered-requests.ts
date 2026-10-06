/** R2: explicit target + minimized READ ONLY plan by default. No bootstrap/seed. */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  bolleTable,
  consegneTable,
  utentiTable,
} from "@workspace/db";
import {
  inspectRequestClosure,
  closeDeliveredRequestTx,
} from "../lib/m5RequestClosure";
import { guardLinkedM4OperationalAccess } from "../lib/m5bDocumentLink";
import { lockConsegnaBollaRelation } from "../lib/documentCommand";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf("=");
    return index < 0
      ? [arg, "true"]
      : [arg.slice(0, index), arg.slice(index + 1)];
  }),
);
try {
  for (const key of args.keys())
    if (!["--target", "--ids", "--apply", "--plan", "--actor"].includes(key))
      throw new Error(`Opzione non valida: ${key}`);
  const ids = (args.get("--ids") ?? "").split(",").map(Number);
  if (
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Specificare --ids=ID[,ID] (max 100), allowlist esplicita");
  ids.sort((a, b) => a - b);
  const target = args.get("--target");
  if (!target) throw new Error("Confermare il database con --target=NOME_DB");
  const apply = args.has("--apply");
  // Apply is deliberately unavailable for UAT/production in this development phase.
  if (
    apply &&
    (process.env.M5C2A_R2_DISPOSABLE_DB !== "verified" ||
      !/^m5c2a_r2(?:_[a-z0-9]+)?$/.test(target))
  )
    throw new Error(
      "Apply consentito soltanto sul target effimero M5C2A-R2 verificato",
    );
  const plan = apply
    ? (JSON.parse(await readFile(args.get("--plan") ?? "", "utf8")) as {
        target: string;
        cases: Awaited<ReturnType<typeof inspectRequestClosure>>[];
      })
    : null;
  if (apply && (plan?.target !== target || !Array.isArray(plan.cases)))
    throw new Error("Piano/target non valido");
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        apply
          ? "SET LOCAL statement_timeout = '15s'"
          : "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      ),
    );
    await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
    const actual = await tx.execute(sql`SELECT current_database() as name`);
    if (actual.rows[0]?.name !== target)
      throw new Error("Target database non corrispondente");
    const cases = [];
    for (const id of ids) {
      if (!apply) {
        cases.push(await inspectRequestClosure(tx, id));
        continue;
      }
      const approved = plan!.cases.find((item) => item.richiestaId === id);
      const actorId = Number(args.get("--actor"));
      if (
        !approved?.bollaId ||
        approved.esito !== "candidata" ||
        !Number.isSafeInteger(actorId) ||
        actorId <= 0
      )
        throw new Error("Caso non approvato o attore assente");
      const observed = await guardLinkedM4OperationalAccess(
        tx,
        actorId,
        "bolla",
        approved.bollaId,
        "consegne.complete",
      );
      if (observed?.richiesta.id !== id)
        throw new Error("Relazione corrente cambiata");
      if (approved.consegnaId)
        await lockConsegnaBollaRelation(tx, approved.consegnaId);
      await tx
        .select({ id: bolleTable.id })
        .from(bolleTable)
        .where(eq(bolleTable.id, approved.bollaId))
        .for("update");
      if (approved.consegnaId)
        await tx
          .select({ id: consegneTable.id })
          .from(consegneTable)
          .where(eq(consegneTable.id, approved.consegnaId))
          .for("update");
      const current = await inspectRequestClosure(tx, id);
      if (
        current.fingerprint !== approved.fingerprint &&
        !(
          current.esito === "coerente" &&
          current.versione === approved.versione! + 1 &&
          current.evidenceFingerprint === approved.evidenceFingerprint
        )
      )
        throw new Error(
          "Conflitto: versione o prova cambiata; rigenerare il piano",
        );
      const [actor] = await tx
        .select({
          username: utentiTable.username,
          matricola: utentiTable.matricola,
        })
        .from(utentiTable)
        .where(eq(utentiTable.id, actorId));
      await closeDeliveredRequestTx(tx, id, approved.bollaId, {
        actor: {
          actorType: "user",
          actorUserId: actorId,
          actorCodeSnapshot: actor.matricola ?? actor.username,
          initiatedByUserId: null,
          initiatedByCodeSnapshot: null,
        },
        correlationId: randomUUID(),
        operationKey: `m5c2a-r2:${id}:${approved.fingerprint}`,
      });
      cases.push(await inspectRequestClosure(tx, id));
    }
    return { target, mode: apply ? "apply-effimero" : "dry-run", cases };
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  // Never echo driver errors or connection strings (which may contain credentials).
  process.stderr.write(
    `Riconciliazione interrotta: ${error instanceof Error && !("code" in error) ? error.message : "errore database; verificare il target"}\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
