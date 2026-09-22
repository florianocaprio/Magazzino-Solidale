import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { comandiOperativiTable } from "@workspace/db";
import type { InventoryTransaction } from "./scaricoInventory";

export class DocumentCommandError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DocumentCommandError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) normalized[key] = canonicalize(record[key]);
  }
  return normalized;
}

export function commandRequestHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new DocumentCommandError(
      400,
      "idempotencyKey è obbligatoria per il comando",
    );
  }
  const key = value.trim();
  if (!key || key.length > 120) {
    throw new DocumentCommandError(
      400,
      "idempotencyKey deve contenere da 1 a 120 caratteri",
    );
  }
  return key;
}

export function requireExpectedVersion(value: unknown): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new DocumentCommandError(
      400,
      "versione deve essere un intero positivo",
    );
  }
  return version;
}

export type DocumentCommandReceipt = typeof comandiOperativiTable.$inferSelect;

export type DocumentCommandIdentity = {
  tipoComando: string;
  idempotencyKey: string;
};

export type DocumentCommandValidation = DocumentCommandIdentity & {
  requestHash: string;
  actorUserId: number;
  aggregatoTipo: string;
  aggregatoId?: number;
};

/** Serializza due retry concorrenti prima di consultare la ricevuta. */
export async function lockDocumentCommand(
  tx: InventoryTransaction,
  tipoComando: string,
  idempotencyKey: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`document-command:${tipoComando}:${idempotencyKey}`}, 0))`,
  );
}

/**
 * Serializza tutte le mutazioni della relazione Consegna-Bolla prima dei row
 * lock. La guardia e' necessaria anche alla creazione, quando la nuova Bolla
 * non ha ancora un identificativo da bloccare.
 */
export async function lockConsegnaBollaRelation(
  tx: InventoryTransaction,
  consegnaId: number,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`consegna-bolla:${consegnaId}`}, 0))`,
  );
}

/**
 * Restituisce la ricevuta solo se chiave, contenuto e attore coincidono.
 * Una chiave riutilizzata con intenzione diversa è sempre un conflitto 409.
 */
export async function findDocumentCommand(
  tx: InventoryTransaction,
  input: DocumentCommandValidation,
): Promise<DocumentCommandReceipt | null> {
  const existing = await loadDocumentCommand(tx, input);
  if (!existing) return null;
  return validateDocumentCommand(existing, input);
}

/**
 * Carica la ricevuta senza ancora validarne contenuto e attore. Serve ai
 * replay che devono prima rivalidare lo scope corrente dell'aggregato sotto
 * lo stesso lock transazionale, senza rivelare mismatch fuori scope.
 */
export async function loadDocumentCommand(
  tx: InventoryTransaction,
  input: DocumentCommandIdentity,
): Promise<DocumentCommandReceipt | null> {
  const [existing] = await tx
    .select()
    .from(comandiOperativiTable)
    .where(
      and(
        eq(comandiOperativiTable.tipoComando, input.tipoComando),
        eq(comandiOperativiTable.idempotencyKey, input.idempotencyKey),
      ),
    );
  return existing ?? null;
}

export function validateDocumentCommand(
  existing: DocumentCommandReceipt,
  input: DocumentCommandValidation,
): DocumentCommandReceipt {
  if (
    existing.requestHash !== input.requestHash ||
    existing.actorUserId !== input.actorUserId ||
    existing.aggregatoTipo !== input.aggregatoTipo ||
    (input.aggregatoId != null && existing.aggregatoId !== input.aggregatoId)
  ) {
    throw new DocumentCommandError(
      409,
      "La chiave di idempotenza è già associata a un comando differente",
    );
  }
  return existing;
}

export async function storeDocumentCommand(
  tx: InventoryTransaction,
  input: {
    tipoComando: string;
    idempotencyKey: string;
    requestHash: string;
    aggregatoTipo: string;
    aggregatoId: number;
    versioneRichiesta?: number | null;
    versioneRisultante?: number | null;
    resultSnapshot: Record<string, unknown>;
    actorUserId: number;
  },
): Promise<void> {
  await tx.insert(comandiOperativiTable).values({
    ...input,
    versioneRichiesta: input.versioneRichiesta ?? null,
    versioneRisultante: input.versioneRisultante ?? null,
  });
}

export function isDocumentCommandError(
  error: unknown,
): error is DocumentCommandError {
  return error instanceof DocumentCommandError;
}
