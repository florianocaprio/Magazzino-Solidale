import { randomUUID, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  lottiProduttoreTable,
  lottiTable,
  prodottiTable,
  utentiTable,
} from "@workspace/db";
import type { InventoryTransaction } from "./scaricoInventory";
import { InventoryLedgerError } from "./inventoryLedger";
import {
  recordAuditEvent,
  systemAuditContext,
  auditFields,
  type AuditCommandContext,
} from "./auditEvent";

// Never serialize this brand or accept it from an HTTP body. Only validated FSE writers use the factory.
const fseProof = Symbol("verified-fse-lot-origin");
export type VerifiedFseLotOrigin = {
  readonly [fseProof]: true;
  readonly fonte: string;
};
export function verifiedFseLotOrigin(fonte: string): VerifiedFseLotOrigin {
  return { [fseProof]: true, fonte };
}
export function normalizeProducerLotCode(
  value: string | null | undefined,
): string | null {
  return value?.normalize("NFC").trim().toLocaleUpperCase("it-IT") || null;
}
export async function lockProducerLotRegistry(tx: InventoryTransaction) {
  // Intake writers acquire this before physical-party keys; reentrant across multiple loads in one tx.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('producer-lot-registry-intake', 0))`,
  );
}
export type ProducerLotInput = {
  areaOperativaId: number;
  prodottoId: number;
  codiceLotto?: string | null;
  dataScadenza?: string | null;
  produttore?: string | null;
  lottoProduttoreId?: number | null;
};
function text(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > max)
    throw new InventoryLedgerError(400, "Dati anagrafica lotto non validi");
  return value.trim() || null;
}
export function producerLotValues(input: ProducerLotInput) {
  const codiceOriginale = text(input.codiceLotto, 80);
  const produttore = text(input.produttore, 200);
  const dataScadenza = text(input.dataScadenza, 10);
  if (
    dataScadenza &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(dataScadenza) ||
      Number.isNaN(Date.parse(dataScadenza)) ||
      new Date(dataScadenza).toISOString().slice(0, 10) !== dataScadenza)
  )
    throw new InventoryLedgerError(400, "Scadenza del lotto non valida");
  return {
    codiceOriginale,
    codiceCanonico: normalizeProducerLotCode(codiceOriginale),
    produttore,
    produttoreCanonico: normalizeProducerLotCode(produttore),
    dataScadenza,
  };
}
export async function validateProducerLotSelection(
  tx: InventoryTransaction,
  input: ProducerLotInput,
) {
  if (input.lottoProduttoreId == null) return null;
  if (
    !Number.isSafeInteger(input.lottoProduttoreId) ||
    input.lottoProduttoreId <= 0
  )
    throw new InventoryLedgerError(400, "Anagrafica lotto non valida");
  const [master] = await tx
    .select()
    .from(lottiProduttoreTable)
    .where(
      and(
        eq(lottiProduttoreTable.id, input.lottoProduttoreId),
        eq(lottiProduttoreTable.areaOperativaId, input.areaOperativaId),
        eq(lottiProduttoreTable.prodottoId, input.prodottoId),
      ),
    );
  if (!master)
    throw new InventoryLedgerError(
      404,
      "Anagrafica lotto non disponibile per questo contesto",
    );
  assertCompatible(master, input);
  return master;
}
function assertCompatible(
  master: typeof lottiProduttoreTable.$inferSelect,
  input: ProducerLotInput,
) {
  const v = producerLotValues(input);
  if (
    master.codiceCanonico !== v.codiceCanonico ||
    (master.dataScadenza &&
      v.dataScadenza &&
      master.dataScadenza !== v.dataScadenza) ||
    (master.produttoreCanonico &&
      v.produttoreCanonico &&
      master.produttoreCanonico !== v.produttoreCanonico)
  )
    throw new InventoryLedgerError(
      409,
      "LOTTO_PRODUTTORE_CONFLITTO: codice, scadenza o produttore incompatibili; verificare i dati senza sovrascriverli",
    );
}
export async function resolveProducerLot(
  tx: InventoryTransaction,
  input: ProducerLotInput & {
    actorId: number;
    audit?: AuditCommandContext;
    origin?: "MANUALE";
    trustedImport?: VerifiedFseLotOrigin;
    legacy?: boolean;
    note?: string | null;
    idempotencyKey?: string;
    requestHash?: string;
  },
) {
  await lockProducerLotRegistry(tx);
  const values = producerLotValues(input);
  const [product] = await tx
    .select()
    .from(prodottiTable)
    .where(eq(prodottiTable.id, input.prodottoId));
  if (!product || !product.attivo)
    throw new InventoryLedgerError(400, "Prodotto del lotto non disponibile");
  if (
    !input.legacy &&
    ((product.lottoFisicoObbligatorio && !values.codiceOriginale) ||
      (product.gestioneScadenza && !values.dataScadenza))
  )
    throw new InventoryLedgerError(
      400,
      "Codice lotto o scadenza obbligatori per il prodotto",
    );
  let master = await validateProducerLotSelection(tx, input);
  if (!master && values.codiceCanonico) {
    const candidates = await tx
      .select()
      .from(lottiProduttoreTable)
      .where(
        and(
          eq(lottiProduttoreTable.areaOperativaId, input.areaOperativaId),
          eq(lottiProduttoreTable.prodottoId, input.prodottoId),
          eq(lottiProduttoreTable.codiceCanonico, values.codiceCanonico),
        ),
      );
    if (candidates.length > 1)
      throw new InventoryLedgerError(
        409,
        "Anagrafica lotto ambigua: selezionare esplicitamente un'identità compatibile",
      );
    master = candidates[0] ?? null;
  }
  const [actor] = await tx
    .select({
      username: utentiTable.username,
      matricola: utentiTable.matricola,
    })
    .from(utentiTable)
    .where(eq(utentiTable.id, input.actorId));
  const command =
    input.audit ??
    systemAuditContext({
      actorCode: "warehouse-lot-registry",
      initiatedByUserId: actor ? input.actorId : null,
      initiatedByCodeSnapshot:
        actor?.matricola?.trim() || actor?.username || null,
    });
  if (master) {
    assertCompatible(master, input);
    const enrich = {
      ...(master.produttoreCanonico == null && values.produttoreCanonico
        ? {
            produttore: values.produttore,
            produttoreCanonico: values.produttoreCanonico,
          }
        : {}),
      ...(master.dataScadenza == null && values.dataScadenza
        ? { dataScadenza: values.dataScadenza }
        : {}),
    };
    if (Object.keys(enrich).length) {
      [master] = await tx
        .update(lottiProduttoreTable)
        .set(enrich)
        .where(eq(lottiProduttoreTable.id, master.id))
        .returning();
      await recordAuditEvent(tx, {
        command: scopedCommand(command, `complete:${master.id}`),
        azione: "LOTTO_PRODUTTORE_COMPLETATO",
        entitaTipo: "lotto_produttore",
        entitaId: master.id,
        areaOperativaIdSnapshot: input.areaOperativaId,
      });
    }
    return { master, creato: false };
  }
  const imported = input.trustedImport?.[fseProof] === true;
  const origine = input.legacy
    ? null
    : (input.origin ?? (imported ? "IMPORTATO" : "AUTOMATICO"));
  [master] = await tx
    .insert(lottiProduttoreTable)
    .values({
      areaOperativaId: input.areaOperativaId,
      prodottoId: input.prodottoId,
      ...values,
      riferimentoInterno: `LP-${randomUUID()}`,
      note: text(input.note, 4000),
      origine,
      fonte: origine === "IMPORTATO" ? input.trustedImport!.fonte : null,
      primoAutoreId: origine && actor ? input.actorId : null,
      primaCreazioneAt: origine ? new Date() : null,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    })
    .returning();
  await recordAuditEvent(tx, {
    command: scopedCommand(command, `create:${master.id}`),
    azione: "LOTTO_PRODUTTORE_CREATO",
    entitaTipo: "lotto_produttore",
    entitaId: master.id,
    areaOperativaIdSnapshot: input.areaOperativaId,
    metadata: auditFields({ origine }, ["origine"]),
  });
  return { master, creato: true };
}
export async function linkProducerLot(
  tx: InventoryTransaction,
  lotto: typeof lottiTable.$inferSelect,
  masterId: number,
  audit?: AuditCommandContext,
  actorId?: number,
) {
  if (lotto.lottoProduttoreId != null && lotto.lottoProduttoreId !== masterId)
    throw new InventoryLedgerError(
      409,
      "La partita è già collegata a un'anagrafica diversa: nessuna sostituzione automatica",
    );
  if (lotto.lottoProduttoreId === masterId) return lotto;
  const [linked] = await tx
    .update(lottiTable)
    .set({ lottoProduttoreId: masterId })
    .where(eq(lottiTable.id, lotto.id))
    .returning();
  await recordAuditEvent(tx, {
    command: scopedCommand(
      audit ?? systemAuditContext({ actorCode: "warehouse-lot-link" }),
      `link:${lotto.id}:${masterId}`,
    ),
    azione: "LOTTO_PRODUTTORE_ASSOCIATO",
    entitaTipo: "lotto_produttore",
    entitaId: masterId,
    magazzinoIdSnapshot: lotto.magazzinoId,
    metadata: auditFields({ partitaId: lotto.id, actorId }, [
      "partitaId",
      "actorId",
    ]),
  });
  return linked;
}
function scopedCommand(
  command: AuditCommandContext,
  suffix: string,
): AuditCommandContext {
  return {
    ...command,
    operationKey: command.operationKey
      ? `lp:${createHash("sha256").update(`${command.operationKey}:${suffix}`).digest("hex")}`
      : null,
  };
}
export function producerLotRequestHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
