import express, { type Express } from "express";
import {
  db,
  trasferimentiTable,
  trasferimentoRigheTable,
  scarichiTable,
  scaricoRigheTable,
  magazziniTable,
  prodottiTable,
  lottiTable,
  movimentiTable,
  utentiTable,
  fornitoriTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import trasferimentiRouter from "../src/routes/trasferimenti";
import scarichiRouter from "../src/routes/scarichi";

/**
 * Builds a minimal Express app that mounts the trasferimenti router with a stub
 * auth middleware injecting `req.user`. This bypasses sessions/RBAC (covered
 * elsewhere) so the tests can focus on the transfer stock-movement logic.
 */
export function makeApp(userId: number): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Only `id` is read by the trasferimenti handlers (operatore stamping).
    req.user = { id: userId } as NonNullable<typeof req.user>;
    next();
  });
  app.use(trasferimentiRouter);
  return app;
}

/**
 * Same as {@link makeApp} but mounts the scarichi router instead, so the
 * discharge tests can exercise the FEFO/transaction handler in isolation.
 */
export function makeScarichiApp(userId: number): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId } as NonNullable<typeof req.user>;
    next();
  });
  app.use(scarichiRouter);
  return app;
}

/** Tracks created rows so a test can wipe exactly what it inserted. */
export interface SeedScope {
  magazzinoIds: number[];
  prodottoIds: number[];
  fornitoreIds: number[];
  utenteIds: number[];
  trasferimentoIds: number[];
  scaricoIds: number[];
}

export function newScope(): SeedScope {
  return {
    magazzinoIds: [],
    prodottoIds: [],
    fornitoreIds: [],
    utenteIds: [],
    trasferimentoIds: [],
    scaricoIds: [],
  };
}

const rnd = () => Math.random().toString(36).slice(2, 8);

export async function createUtente(scope: SeedScope): Promise<number> {
  const [u] = await db
    .insert(utentiTable)
    .values({
      username: `test_op_${rnd()}`,
      passwordHash: "x",
      nome: "Test",
      cognome: "Operatore",
    })
    .returning();
  scope.utenteIds.push(u.id);
  return u.id;
}

export async function createMagazzino(scope: SeedScope, nome: string): Promise<number> {
  const [m] = await db
    .insert(magazziniTable)
    .values({ codice: `TST-${rnd()}`, nome })
    .returning();
  scope.magazzinoIds.push(m.id);
  return m.id;
}

export async function createFornitore(scope: SeedScope, nome: string): Promise<number> {
  const [f] = await db
    .insert(fornitoriTable)
    .values({ nome, tipo: "azienda" })
    .returning();
  scope.fornitoreIds.push(f.id);
  return f.id;
}

export async function createProdotto(
  scope: SeedScope,
  opts: { unitaMisura?: string; fsePlus?: boolean } = {},
): Promise<number> {
  const [p] = await db
    .insert(prodottiTable)
    .values({
      codice: `TSTP-${rnd()}`,
      nome: `Prodotto ${rnd()}`,
      tipoProdotto: "alimentare",
      unitaMisura: opts.unitaMisura ?? "kg",
      fsePlus: opts.fsePlus ?? false,
    })
    .returning();
  scope.prodottoIds.push(p.id);
  return p.id;
}

export async function createLotto(opts: {
  prodottoId: number;
  magazzinoId: number;
  quantita: number;
  dataScadenza?: string | null;
  dataCarico?: string;
  codiceLotto?: string | null;
  fornitoreId?: number | null;
  fsePlus?: boolean;
}): Promise<number> {
  const [l] = await db
    .insert(lottiTable)
    .values({
      prodottoId: opts.prodottoId,
      magazzinoId: opts.magazzinoId,
      codiceLotto: opts.codiceLotto ?? null,
      dataScadenza: opts.dataScadenza ?? null,
      dataCarico: opts.dataCarico ?? "2026-01-01",
      quantitaCaricata: opts.quantita.toFixed(2),
      quantitaResidua: opts.quantita.toFixed(2),
      fornitoreId: opts.fornitoreId ?? null,
      fsePlus: opts.fsePlus ?? false,
    })
    .returning();
  return l.id;
}

export async function getLotto(id: number) {
  const [l] = await db.select().from(lottiTable).where(eq(lottiTable.id, id));
  return l;
}

export async function getMovimentiForTrasferimento(trasferimentoId: number) {
  return db
    .select()
    .from(movimentiTable)
    .where(eq(movimentiTable.trasferimentoId, trasferimentoId));
}

/**
 * Scarico movimenti carry no scaricoId column, so they are looked up by the
 * warehouse + `tipoMovimento='scarico'` (tests use a dedicated warehouse).
 */
export async function getScaricoMovimentiForMagazzino(magazzinoId: number) {
  return db
    .select()
    .from(movimentiTable)
    .where(
      and(eq(movimentiTable.magazzinoId, magazzinoId), eq(movimentiTable.tipoMovimento, "scarico")),
    );
}

export async function getLottiInMagazzino(magazzinoId: number) {
  return db.select().from(lottiTable).where(eq(lottiTable.magazzinoId, magazzinoId));
}

/** Deletes every row created under this scope, in FK-safe order. */
export async function cleanup(scope: SeedScope): Promise<void> {
  if (scope.magazzinoIds.length > 0) {
    await db.delete(movimentiTable).where(inArray(movimentiTable.magazzinoId, scope.magazzinoIds));
    await db.delete(lottiTable).where(inArray(lottiTable.magazzinoId, scope.magazzinoIds));
  }
  if (scope.trasferimentoIds.length > 0) {
    await db
      .delete(trasferimentoRigheTable)
      .where(inArray(trasferimentoRigheTable.trasferimentoId, scope.trasferimentoIds));
    await db.delete(trasferimentiTable).where(inArray(trasferimentiTable.id, scope.trasferimentoIds));
  }
  if (scope.scaricoIds.length > 0) {
    await db
      .delete(scaricoRigheTable)
      .where(inArray(scaricoRigheTable.scaricoId, scope.scaricoIds));
    await db.delete(scarichiTable).where(inArray(scarichiTable.id, scope.scaricoIds));
  }
  if (scope.prodottoIds.length > 0) {
    await db.delete(prodottiTable).where(inArray(prodottiTable.id, scope.prodottoIds));
  }
  if (scope.fornitoreIds.length > 0) {
    await db.delete(fornitoriTable).where(inArray(fornitoriTable.id, scope.fornitoreIds));
  }
  if (scope.magazzinoIds.length > 0) {
    await db.delete(magazziniTable).where(inArray(magazziniTable.id, scope.magazzinoIds));
  }
  if (scope.utenteIds.length > 0) {
    await db.delete(utentiTable).where(inArray(utentiTable.id, scope.utenteIds));
  }
}
