import express, { type Express, type Router } from "express";
import {
  db,
  centriAscoltoTable,
  magazziniTable,
  beneficiariTable,
  prodottiTable,
  fornitoriTable,
  volontariTable,
  mezziTable,
  ruoliTable,
  utentiTable,
  lottiTable,
  scarichiTable,
  scaricoRigheTable,
  approvvigionamentiTable,
  approvvigionamentoRigheTable,
  consegneTable,
  bolleTable,
  bollaRigheTable,
  interventiTable,
  trasferimentiTable,
  trasferimentoRigheTable,
  movimentiTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

/**
 * Shared fixtures + app builder for the per-Centro-di-Ascolto scoping tests.
 *
 * Every test mounts a single bare router behind a stub middleware that injects
 * `req.user = { id, centroAscoltoId }` — this bypasses sessions/RBAC (covered by
 * the auth suite) so the tests focus purely on the centro scoping boundary
 * enforced inside the route handlers via `centroScope.ts`.
 */

/** Mounts `router` behind a stub auth middleware injecting the given caller. */
export function makeScopedApp(
  router: Router,
  user: { id: number; centroAscoltoId: number | null },
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: number; centroAscoltoId: number | null } }).user = {
      id: user.id,
      centroAscoltoId: user.centroAscoltoId,
    };
    next();
  });
  app.use(router);
  return app;
}

/**
 * Like {@link makeScopedApp} but injects `req.session.userId` instead of
 * `req.user`. Needed for routers that bake in their own `requireAuth`
 * (e.g. `utenti`), which loads the real user from the DB via the session — so
 * the caller must be a real `utenti` row (its centro + admin flag are honored).
 */
export function makeSessionApp(router: Router, userId: number): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = { userId };
    next();
  });
  app.use(router);
  return app;
}

/** Tracks every row created under a test so cleanup wipes exactly that. */
export interface SeedScope {
  centroIds: number[];
  magazzinoIds: number[];
  beneficiarioIds: number[];
  prodottoIds: number[];
  fornitoreIds: number[];
  volontarioIds: number[];
  mezzoIds: number[];
  ruoloIds: number[];
  utenteIds: number[];
  lottoIds: number[];
  scaricoIds: number[];
  approvvigionamentoIds: number[];
  consegnaIds: number[];
  bollaIds: number[];
  interventoIds: number[];
  trasferimentoIds: number[];
}

export function newScope(): SeedScope {
  return {
    centroIds: [],
    magazzinoIds: [],
    beneficiarioIds: [],
    prodottoIds: [],
    fornitoreIds: [],
    volontarioIds: [],
    mezzoIds: [],
    ruoloIds: [],
    utenteIds: [],
    lottoIds: [],
    scaricoIds: [],
    approvvigionamentoIds: [],
    consegnaIds: [],
    bollaIds: [],
    interventoIds: [],
    trasferimentoIds: [],
  };
}

const rnd = () => Math.random().toString(36).slice(2, 8);

export async function createCentro(scope: SeedScope, nome = `Centro ${rnd()}`): Promise<number> {
  const [c] = await db
    .insert(centriAscoltoTable)
    .values({ nome })
    .returning({ id: centriAscoltoTable.id });
  scope.centroIds.push(c.id);
  return c.id;
}

export async function createMagazzino(
  scope: SeedScope,
  centroId: number | null,
): Promise<number> {
  const [m] = await db
    .insert(magazziniTable)
    .values({ codice: `MAG-${rnd()}`, nome: `Mag ${rnd()}`, centroAscoltoId: centroId })
    .returning({ id: magazziniTable.id });
  scope.magazzinoIds.push(m.id);
  return m.id;
}

/** Like {@link createMagazzino} but also returns the generated unique nome. */
export async function createMagazzinoRec(
  scope: SeedScope,
  centroId: number | null,
): Promise<{ id: number; nome: string }> {
  const nome = `Mag ${rnd()}`;
  const [m] = await db
    .insert(magazziniTable)
    .values({ codice: `MAG-${rnd()}`, nome, centroAscoltoId: centroId })
    .returning({ id: magazziniTable.id });
  scope.magazzinoIds.push(m.id);
  return { id: m.id, nome };
}

export async function createBeneficiario(
  scope: SeedScope,
  centroId: number | null,
): Promise<number> {
  const [b] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      cognome: "Test",
      nome: `Ben ${rnd()}`,
      centroAscoltoId: centroId,
    })
    .returning({ id: beneficiariTable.id });
  scope.beneficiarioIds.push(b.id);
  return b.id;
}

export async function createProdotto(scope: SeedScope): Promise<number> {
  const [p] = await db
    .insert(prodottiTable)
    .values({
      codice: `PRD-${rnd()}`,
      nome: `Prodotto ${rnd()}`,
      tipoProdotto: "alimentare",
      unitaMisura: "kg",
      fsePlus: false,
    })
    .returning({ id: prodottiTable.id });
  scope.prodottoIds.push(p.id);
  return p.id;
}

export async function createFornitore(
  scope: SeedScope,
  centroId: number | null,
): Promise<number> {
  const [f] = await db
    .insert(fornitoriTable)
    .values({ nome: `Fornitore ${rnd()}`, tipo: "azienda", centroAscoltoId: centroId })
    .returning({ id: fornitoriTable.id });
  scope.fornitoreIds.push(f.id);
  return f.id;
}

export async function createVolontario(
  scope: SeedScope,
  centroId: number | null,
): Promise<number> {
  const [v] = await db
    .insert(volontariTable)
    .values({ nome: "Vol", cognome: rnd(), ruolo: "autista", centroAscoltoId: centroId })
    .returning({ id: volontariTable.id });
  scope.volontarioIds.push(v.id);
  return v.id;
}

export async function createMezzo(
  scope: SeedScope,
  opts: { centroId?: number | null; volontarioId?: number | null } = {},
): Promise<number> {
  const [m] = await db
    .insert(mezziTable)
    .values({
      codice: `MZ-${rnd()}`,
      tipo: "furgone",
      proprieta: "centro",
      centroAscoltoId: opts.centroId ?? null,
      volontarioId: opts.volontarioId ?? null,
    })
    .returning({ id: mezziTable.id });
  scope.mezzoIds.push(m.id);
  return m.id;
}

export async function createRuolo(
  scope: SeedScope,
  opts: { isAdmin?: boolean } = {},
): Promise<number> {
  const [r] = await db
    .insert(ruoliTable)
    .values({ nome: `Ruolo ${rnd()}`, aree: [], isAdmin: opts.isAdmin ?? false })
    .returning({ id: ruoliTable.id });
  scope.ruoloIds.push(r.id);
  return r.id;
}

export async function createUtente(
  scope: SeedScope,
  opts: { centroId?: number | null; ruoloId?: number | null } = {},
): Promise<number> {
  const [u] = await db
    .insert(utentiTable)
    .values({
      username: `usr_${rnd()}`,
      passwordHash: "x",
      nome: "Test",
      cognome: "Utente",
      centroAscoltoId: opts.centroId ?? null,
      ruoloId: opts.ruoloId ?? null,
    })
    .returning({ id: utentiTable.id });
  scope.utenteIds.push(u.id);
  return u.id;
}

export async function createLotto(
  scope: SeedScope,
  opts: {
    prodottoId: number;
    magazzinoId: number;
    quantita: number;
    fornitoreId?: number | null;
    dataScadenza?: string | null;
    fsePlus?: boolean;
  },
): Promise<number> {
  const [l] = await db
    .insert(lottiTable)
    .values({
      prodottoId: opts.prodottoId,
      magazzinoId: opts.magazzinoId,
      dataCarico: "2026-01-01",
      dataScadenza: opts.dataScadenza ?? null,
      quantitaCaricata: opts.quantita.toFixed(2),
      quantitaResidua: opts.quantita.toFixed(2),
      fornitoreId: opts.fsePlus ? null : opts.fornitoreId ?? null,
      fsePlus: opts.fsePlus ?? false,
    })
    .returning({ id: lottiTable.id });
  scope.lottoIds.push(l.id);
  return l.id;
}

export async function insertScarico(
  scope: SeedScope,
  opts: { magazzinoId: number; centroId: number | null },
): Promise<number> {
  const [s] = await db
    .insert(scarichiTable)
    .values({
      codice: `SCAR-${rnd()}`,
      magazzinoId: opts.magazzinoId,
      centroAscoltoId: opts.centroId,
      dataScarico: "2026-06-01",
      causale: "scaduta",
    })
    .returning({ id: scarichiTable.id });
  scope.scaricoIds.push(s.id);
  return s.id;
}

export async function insertApprovvigionamento(
  scope: SeedScope,
  opts: { magazzinoId: number; centroId: number | null },
): Promise<number> {
  const [a] = await db
    .insert(approvvigionamentiTable)
    .values({
      codice: `ORD-${rnd()}`,
      magazzinoId: opts.magazzinoId,
      centroAscoltoId: opts.centroId,
      dataRichiesta: "2026-06-01",
    })
    .returning({ id: approvvigionamentiTable.id });
  scope.approvvigionamentoIds.push(a.id);
  return a.id;
}

export async function insertConsegna(
  scope: SeedScope,
  opts: { beneficiarioId: number; magazzinoId: number; stato?: string },
): Promise<number> {
  const [c] = await db
    .insert(consegneTable)
    .values({
      codice: `CON-${rnd()}`,
      beneficiarioId: opts.beneficiarioId,
      tipoConsegna: "domicilio",
      dataPrevista: "2026-06-01",
      magazzinoId: opts.magazzinoId,
      ...(opts.stato ? { stato: opts.stato } : {}),
    })
    .returning({ id: consegneTable.id });
  scope.consegnaIds.push(c.id);
  return c.id;
}

export async function insertBolla(
  scope: SeedScope,
  opts: { beneficiarioId: number; magazzinoId: number; stato?: string; dataBolla?: string },
): Promise<number> {
  const [b] = await db
    .insert(bolleTable)
    .values({
      numeroBolla: `BOLLA-${rnd()}`,
      dataBolla: opts.dataBolla ?? "2026-06-01",
      beneficiarioId: opts.beneficiarioId,
      magazzinoId: opts.magazzinoId,
      ...(opts.stato ? { stato: opts.stato } : {}),
    })
    .returning({ id: bolleTable.id });
  scope.bollaIds.push(b.id);
  return b.id;
}

/** Inserts a bolla riga (cleaned up with its bolla in {@link cleanup}). */
export async function insertBollaRiga(
  scope: SeedScope,
  opts: { bollaId: number; prodottoId: number; lottoId: number; quantita: number; unitaMisura?: string },
): Promise<number> {
  void scope;
  const [r] = await db
    .insert(bollaRigheTable)
    .values({
      bollaId: opts.bollaId,
      prodottoId: opts.prodottoId,
      lottoId: opts.lottoId,
      quantita: opts.quantita.toFixed(2),
      unitaMisura: opts.unitaMisura ?? "kg",
    })
    .returning({ id: bollaRigheTable.id });
  return r.id;
}

export async function insertIntervento(
  scope: SeedScope,
  opts: { beneficiarioId: number },
): Promise<number> {
  const [i] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId: opts.beneficiarioId,
      dataIntervento: "2026-06-01",
      tipoIntervento: "pacco_alimentare",
    })
    .returning({ id: interventiTable.id });
  scope.interventoIds.push(i.id);
  return i.id;
}

export async function insertTrasferimento(
  scope: SeedScope,
  opts: { origineId: number; destinoId: number },
): Promise<number> {
  const [t] = await db
    .insert(trasferimentiTable)
    .values({
      codice: `TRF-${rnd()}`,
      magazzinoOrigineId: opts.origineId,
      magazzinoDestinoId: opts.destinoId,
      dataRichiesta: "2026-06-01",
    })
    .returning({ id: trasferimentiTable.id });
  scope.trasferimentoIds.push(t.id);
  return t.id;
}

/** Inserts a movimento row (cleaned up via its magazzino in {@link cleanup}). */
export async function insertMovimento(
  scope: SeedScope,
  opts: { magazzinoId: number; prodottoId: number },
): Promise<number> {
  void scope;
  const [m] = await db
    .insert(movimentiTable)
    .values({
      tipoMovimento: "carico",
      tipoDettaglio: "donazione",
      dataMovimento: "2026-06-01",
      magazzinoId: opts.magazzinoId,
      prodottoId: opts.prodottoId,
      quantita: "1.00",
      unitaMisura: "kg",
    })
    .returning({ id: movimentiTable.id });
  return m.id;
}

/** Deletes every row created under this scope, in FK-safe (child→parent) order. */
export async function cleanup(scope: SeedScope): Promise<void> {
  if (scope.magazzinoIds.length > 0) {
    await db.delete(movimentiTable).where(inArray(movimentiTable.magazzinoId, scope.magazzinoIds));
  }
  if (scope.trasferimentoIds.length > 0) {
    await db
      .delete(trasferimentoRigheTable)
      .where(inArray(trasferimentoRigheTable.trasferimentoId, scope.trasferimentoIds));
    await db
      .delete(trasferimentiTable)
      .where(inArray(trasferimentiTable.id, scope.trasferimentoIds));
  }
  if (scope.interventoIds.length > 0) {
    await db.delete(interventiTable).where(inArray(interventiTable.id, scope.interventoIds));
  }
  if (scope.bollaIds.length > 0) {
    await db.delete(bollaRigheTable).where(inArray(bollaRigheTable.bollaId, scope.bollaIds));
    await db.delete(bolleTable).where(inArray(bolleTable.id, scope.bollaIds));
  }
  if (scope.consegnaIds.length > 0) {
    await db.delete(consegneTable).where(inArray(consegneTable.id, scope.consegnaIds));
  }
  if (scope.scaricoIds.length > 0) {
    await db.delete(scaricoRigheTable).where(inArray(scaricoRigheTable.scaricoId, scope.scaricoIds));
    await db.delete(scarichiTable).where(inArray(scarichiTable.id, scope.scaricoIds));
  }
  if (scope.approvvigionamentoIds.length > 0) {
    await db
      .delete(approvvigionamentoRigheTable)
      .where(
        inArray(approvvigionamentoRigheTable.approvvigionamentoId, scope.approvvigionamentoIds),
      );
    await db
      .delete(approvvigionamentiTable)
      .where(inArray(approvvigionamentiTable.id, scope.approvvigionamentoIds));
  }
  if (scope.lottoIds.length > 0) {
    await db.delete(lottiTable).where(inArray(lottiTable.id, scope.lottoIds));
  }
  if (scope.mezzoIds.length > 0) {
    await db.delete(mezziTable).where(inArray(mezziTable.id, scope.mezzoIds));
  }
  if (scope.prodottoIds.length > 0) {
    await db.delete(prodottiTable).where(inArray(prodottiTable.id, scope.prodottoIds));
  }
  if (scope.fornitoreIds.length > 0) {
    await db.delete(fornitoriTable).where(inArray(fornitoriTable.id, scope.fornitoreIds));
  }
  if (scope.volontarioIds.length > 0) {
    await db.delete(volontariTable).where(inArray(volontariTable.id, scope.volontarioIds));
  }
  if (scope.beneficiarioIds.length > 0) {
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, scope.beneficiarioIds));
  }
  if (scope.magazzinoIds.length > 0) {
    await db.delete(magazziniTable).where(inArray(magazziniTable.id, scope.magazzinoIds));
  }
  if (scope.utenteIds.length > 0) {
    await db.delete(utentiTable).where(inArray(utentiTable.id, scope.utenteIds));
  }
  if (scope.ruoloIds.length > 0) {
    await db.delete(ruoliTable).where(inArray(ruoliTable.id, scope.ruoloIds));
  }
  if (scope.centroIds.length > 0) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, scope.centroIds));
  }
}
