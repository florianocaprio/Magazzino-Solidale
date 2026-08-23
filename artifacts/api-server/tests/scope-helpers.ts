import express, { type Express, type RequestHandler, type Router } from "express";
import { db, centriAscoltoTable, magazziniTable, beneficiariTable, prodottiTable, fornitoriTable, volontariTable, mezziTable, ruoliTable, utentiTable, lottiTable, scarichiTable, scaricoRigheTable, approvvigionamentiTable, approvvigionamentoRigheTable, consegneTable, bolleTable, bollaRigheTable, prenotazioniMagazzinoTable, interventiTable, trasferimentiTable, trasferimentoRigheTable, movimentiTable, turniTable, turniConsegneTable, turniVolontariTable, areeOperativeTable, zoneUdsTable, auditConfigurazioniTable, ruoliVolontariTable, carichiMagazzinoRigheTable, carichiMagazzinoTable, operazioniDistribuzioneMagazzinoTable } from "@workspace/db";
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
  user: {
    id: number;
    centroAscoltoId: number | null;
    areaOperativaId?: number | null;
    zonaUdsId?: number | null;
    aree?: string[];
    permessi?: string[];
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
  },
  middlewares: RequestHandler[] = [],
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          centroAscoltoId: number | null;
          areaOperativaId: number | null;
          zonaUdsId: number | null;
          aree: string[];
          permessi: string[];
          isAdmin: boolean;
          isSuperAdmin: boolean;
        };
      }
    ).user = {
      id: user.id,
      centroAscoltoId: user.centroAscoltoId,
      areaOperativaId: user.areaOperativaId ?? null,
      zonaUdsId: user.zonaUdsId ?? null,
      aree: user.aree ?? ["sociale", "uds", "magazzino"],
      // Questi test isolano lo scoping territoriale, non l'RBAC.
      permessi: user.permessi ?? ["beneficiari.view", "beneficiari.manage", "beneficiari.sensitive.view", "beneficiari.deactivate", "sociale.interventi.view", "sociale.interventi.create", "sociale.interventi.update", "sociale.interventi.complete", "sociale.interventi.cancel", "uds.directory.view", "uds.interventi.view", "uds.interventi.create", "uds.interventi.update", "uds.interventi.note", "uds.bisogni.manage", "uds.reports.view", "magazzino.view", "magazzino.fse.view", "magazzino.products.manage", "magazzino.stock.receive", "magazzino.stock.issue", "magazzino.stock.adjust", "magazzino.transfers.create", "magazzino.transfers.dispatch", "magazzino.transfers.receive", "bolle.view", "bolle.manage", "bolle.deliver", "bolle.cancel", "approvvigionamenti.view", "approvvigionamenti.manage", "approvvigionamenti.receive", "logistica.volontari.view", "logistica.volontari.manage", "logistica.volontari.export", "logistica.mezzi.view", "logistica.mezzi.manage", "logistica.mezzi.export", "logistica.turni.view", "logistica.turni.manage", "logistica.approvazioni.view", "logistica.approvazioni.manage"],
      isAdmin: user.isAdmin ?? false,
      isSuperAdmin: user.isSuperAdmin ?? false,
    };
    next();
  });
  for (const middleware of middlewares) app.use(middleware);
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
  ruoloVolontarioIds: number[];
  utenteIds: number[];
  lottoIds: number[];
  scaricoIds: number[];
  approvvigionamentoIds: number[];
  consegnaIds: number[];
  bollaIds: number[];
  prenotazioneIds: number[];
  interventoIds: number[];
  trasferimentoIds: number[];
  turnoIds: number[];
  zonaIds: number[];
  areaOperativaIds: number[];
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
    ruoloVolontarioIds: [],
    utenteIds: [],
    lottoIds: [],
    scaricoIds: [],
    approvvigionamentoIds: [],
    consegnaIds: [],
    bollaIds: [],
    prenotazioneIds: [],
    interventoIds: [],
    trasferimentoIds: [],
    turnoIds: [],
    zonaIds: [],
    areaOperativaIds: [],
  };
}

const rnd = () => Math.random().toString(36).slice(2, 8);

export async function createCentro(scope: SeedScope, nome = `Centro ${rnd()}`): Promise<number> {
  const [c] = await db.insert(centriAscoltoTable).values({ nome }).returning({ id: centriAscoltoTable.id });
  scope.centroIds.push(c.id);
  return c.id;
}

/** Like {@link createCentro} but accepts a area operativa and returns id + nome. */
export async function createCentroRec(scope: SeedScope, opts: { areaOperativaId?: number | null; nome?: string } = {}): Promise<{ id: number; nome: string }> {
  const nome = opts.nome ?? `Centro ${rnd()}`;
  const [c] = await db
    .insert(centriAscoltoTable)
    .values({ nome, areaOperativaId: opts.areaOperativaId ?? null })
    .returning({ id: centriAscoltoTable.id });
  scope.centroIds.push(c.id);
  return { id: c.id, nome };
}

export async function createMagazzino(scope: SeedScope, centroId: number | null, opts: { areaOperativaId?: number | null } = {}): Promise<number> {
  const [m] = await db
    .insert(magazziniTable)
    .values({
      codice: `MAG-${rnd()}`,
      nome: `Mag ${rnd()}`,
      centroAscoltoId: centroId,
      areaOperativaId: opts.areaOperativaId ?? null,
    })
    .returning({ id: magazziniTable.id });
  scope.magazzinoIds.push(m.id);
  return m.id;
}

/** Like {@link createMagazzino} but also returns the generated unique nome. */
export async function createMagazzinoRec(scope: SeedScope, centroId: number | null, opts: { areaOperativaId?: number | null } = {}): Promise<{ id: number; nome: string }> {
  const nome = `Mag ${rnd()}`;
  const [m] = await db
    .insert(magazziniTable)
    .values({
      codice: `MAG-${rnd()}`,
      nome,
      centroAscoltoId: centroId,
      areaOperativaId: opts.areaOperativaId ?? null,
    })
    .returning({ id: magazziniTable.id });
  scope.magazzinoIds.push(m.id);
  return { id: m.id, nome };
}

export async function createBeneficiario(
  scope: SeedScope,
  centroId: number | null,
  opts: {
    uds?: boolean;
    areaOperativaId?: number | null;
    zonaUdsId?: number | null;
    sesso?: string;
  } = {},
): Promise<number> {
  const [b] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      cognome: "Test",
      nome: `Ben ${rnd()}`,
      sesso: opts.sesso ?? "M",
      centroAscoltoId: centroId,
      uds: opts.uds ?? false,
      areaOperativaId: opts.areaOperativaId ?? null,
      zonaUdsId: opts.zonaUdsId ?? null,
    })
    .returning({ id: beneficiariTable.id });
  scope.beneficiarioIds.push(b.id);
  return b.id;
}

export async function createAreaOperativa(scope: SeedScope): Promise<number> {
  const [c] = await db
    .insert(areeOperativeTable)
    .values({ nome: `AreaOperativa ${rnd()}` })
    .returning({ id: areeOperativeTable.id });
  scope.areaOperativaIds.push(c.id);
  return c.id;
}

export async function createZona(scope: SeedScope, areaOperativaId: number): Promise<{ id: number; nome: string }> {
  const nome = `Zona ${rnd()}`;
  const [z] = await db.insert(zoneUdsTable).values({ areaOperativaId, nome }).returning({ id: zoneUdsTable.id });
  scope.zonaIds.push(z.id);
  return { id: z.id, nome };
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

export async function createFornitore(scope: SeedScope, areaOperativaId: number | null): Promise<number> {
  const [f] = await db
    .insert(fornitoriTable)
    .values({ nome: `Fornitore ${rnd()}`, tipo: "azienda", areaOperativaId })
    .returning({ id: fornitoriTable.id });
  scope.fornitoreIds.push(f.id);
  return f.id;
}

export async function createVolontario(scope: SeedScope, centroId: number | null): Promise<number> {
  const [v] = await db
    .insert(volontariTable)
    .values({
      nome: "Vol",
      cognome: rnd(),
      ruolo: "autista",
      centroAscoltoId: centroId,
      attivo: true,
      statoApprovazione: "approvato",
    })
    .returning({ id: volontariTable.id });
  scope.volontarioIds.push(v.id);
  return v.id;
}

export async function createRuoloVolontario(scope: SeedScope, opts: { nome?: string; attivo?: boolean } = {}): Promise<number> {
  const [ruolo] = await db
    .insert(ruoliVolontariTable)
    .values({
      nome: opts.nome ?? `Ruolo volontario ${rnd()}`,
      attivo: opts.attivo ?? true,
    })
    .returning({ id: ruoliVolontariTable.id });
  scope.ruoloVolontarioIds.push(ruolo.id);
  return ruolo.id;
}

export async function createMezzo(scope: SeedScope, opts: { centroId?: number | null; volontarioId?: number | null } = {}): Promise<number> {
  const [m] = await db
    .insert(mezziTable)
    .values({
      codice: `MZ-${rnd()}`,
      tipo: "furgone",
      proprieta: "centro",
      centroAscoltoId: opts.centroId ?? null,
      volontarioId: opts.volontarioId ?? null,
      stato: "disponibile",
      statoApprovazione: "approvato",
    })
    .returning({ id: mezziTable.id });
  scope.mezzoIds.push(m.id);
  return m.id;
}

export async function createRuolo(scope: SeedScope, opts: { isAdmin?: boolean } = {}): Promise<number> {
  const [r] = await db
    .insert(ruoliTable)
    .values({
      nome: `Ruolo ${rnd()}`,
      aree: [],
      isAdmin: opts.isAdmin ?? false,
    })
    .returning({ id: ruoliTable.id });
  scope.ruoloIds.push(r.id);
  return r.id;
}

export async function createUtente(scope: SeedScope, opts: { centroId?: number | null; ruoloId?: number | null } = {}): Promise<number> {
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
      quantitaCaricata: opts.quantita.toFixed(6),
      quantitaResidua: opts.quantita.toFixed(6),
      fornitoreId: opts.fsePlus ? null : (opts.fornitoreId ?? null),
      fsePlus: opts.fsePlus ?? false,
      fondoOrigine: opts.fsePlus ? "FSE_PLUS" : "NESSUN_FONDO",
    })
    .returning({ id: lottiTable.id });
  scope.lottoIds.push(l.id);
  return l.id;
}

export async function insertScarico(scope: SeedScope, opts: { magazzinoId: number; centroId: number | null }): Promise<number> {
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

export async function insertApprovvigionamento(scope: SeedScope, opts: { magazzinoId: number; centroId: number | null }): Promise<number> {
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
  opts: {
    beneficiarioId: number;
    magazzinoId: number;
    stato?: string;
    dataPrevista?: string;
    mezzoId?: number | null;
    mezzoAltro?: boolean;
  },
): Promise<number> {
  const [c] = await db
    .insert(consegneTable)
    .values({
      codice: `CON-${rnd()}`,
      beneficiarioId: opts.beneficiarioId,
      tipoConsegna: "domicilio",
      dataPrevista: opts.dataPrevista ?? "2026-06-01",
      magazzinoId: opts.magazzinoId,
      ...(opts.stato ? { stato: opts.stato } : {}),
      ...(opts.mezzoId != null ? { mezzoId: opts.mezzoId } : {}),
      ...(opts.mezzoAltro ? { mezzoAltro: true } : {}),
    })
    .returning({ id: consegneTable.id });
  scope.consegnaIds.push(c.id);
  return c.id;
}

export async function insertBolla(
  scope: SeedScope,
  opts: {
    beneficiarioId: number;
    magazzinoId: number;
    stato?: string;
    dataBolla?: string;
    consegnaId?: number | null;
    mezzoId?: number | null;
    mezzoAltro?: boolean;
  },
): Promise<number> {
  const [b] = await db
    .insert(bolleTable)
    .values({
      numeroBolla: `BOLLA-${rnd()}`,
      dataBolla: opts.dataBolla ?? "2026-06-01",
      beneficiarioId: opts.beneficiarioId,
      magazzinoId: opts.magazzinoId,
      consegnaId: opts.consegnaId ?? null,
      ...(opts.stato ? { stato: opts.stato } : {}),
      ...(opts.mezzoId != null ? { mezzoId: opts.mezzoId } : {}),
      ...(opts.mezzoAltro ? { mezzoAltro: true } : {}),
    })
    .returning({ id: bolleTable.id });
  scope.bollaIds.push(b.id);
  return b.id;
}

export async function insertTurno(
  scope: SeedScope,
  opts: {
    centroAscoltoId: number;
    data?: string;
    fascia?: string;
    mezzoId?: number | null;
    stato?: "pianificato" | "confermato" | "completato" | "annullato";
  },
): Promise<number> {
  const [t] = await db
    .insert(turniTable)
    .values({
      centroAscoltoId: opts.centroAscoltoId,
      data: opts.data ?? "2026-06-01",
      fascia: opts.fascia ?? "09-13",
      mezzoId: opts.mezzoId ?? null,
      ...(opts.stato ? { stato: opts.stato } : {}),
    })
    .returning({ id: turniTable.id });
  scope.turnoIds.push(t.id);
  return t.id;
}

/** Inserts a bolla riga (cleaned up with its bolla in {@link cleanup}). */
export async function insertBollaRiga(
  scope: SeedScope,
  opts: {
    bollaId: number;
    prodottoId: number;
    lottoId?: number | null;
    quantita: number;
    unitaMisura?: string;
  },
): Promise<number> {
  void scope;
  const [r] = await db
    .insert(bollaRigheTable)
    .values({
      bollaId: opts.bollaId,
      prodottoId: opts.prodottoId,
      lottoId: opts.lottoId ?? null,
      quantita: opts.quantita.toFixed(6),
      unitaMisura: opts.unitaMisura ?? "kg",
    })
    .returning({ id: bollaRigheTable.id });
  return r.id;
}

export async function insertPrenotazioneMagazzino(
  scope: SeedScope,
  opts: {
    bollaId: number;
    rigaBollaId: number;
    prodottoId: number;
    lottoId: number;
    magazzinoId: number;
    quantita: number;
    stato?: string;
  },
): Promise<number> {
  const [p] = await db
    .insert(prenotazioniMagazzinoTable)
    .values({
      bollaId: opts.bollaId,
      rigaBollaId: opts.rigaBollaId,
      prodottoId: opts.prodottoId,
      lottoId: opts.lottoId,
      magazzinoId: opts.magazzinoId,
      quantita: opts.quantita.toFixed(6),
      stato: opts.stato ?? "attiva",
    })
    .returning({ id: prenotazioniMagazzinoTable.id });
  scope.prenotazioneIds.push(p.id);
  return p.id;
}

export async function insertIntervento(
  scope: SeedScope,
  opts: {
    beneficiarioId: number;
    dataIntervento?: string;
    tipoIntervento?: string;
    ambito?: "sociale" | "uds" | null;
    areaOperativaIdSnapshot?: number | null;
    zonaUdsIdSnapshot?: number | null;
  },
): Promise<number> {
  const [i] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId: opts.beneficiarioId,
      dataIntervento: opts.dataIntervento ?? "2026-06-01",
      tipoIntervento: opts.tipoIntervento ?? "pacco_alimentare",
      ambito: opts.ambito,
      areaOperativaIdSnapshot: opts.areaOperativaIdSnapshot,
      zonaUdsIdSnapshot: opts.zonaUdsIdSnapshot,
    })
    .returning({ id: interventiTable.id });
  scope.interventoIds.push(i.id);
  return i.id;
}

export async function insertTrasferimento(scope: SeedScope, opts: { origineId: number; destinoId: number }): Promise<number> {
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
  opts: {
    magazzinoId: number;
    prodottoId: number;
    lottoId?: number | null;
    bollaRigaId?: number | null;
    tipoMovimento?: typeof movimentiTable.$inferInsert.tipoMovimento;
    naturaContabile?: typeof movimentiTable.$inferInsert.naturaContabile;
    fondoOrigine?: typeof movimentiTable.$inferInsert.fondoOrigine;
  },
): Promise<number> {
  void scope;
  const [m] = await db
    .insert(movimentiTable)
    .values({
      tipoMovimento: opts.tipoMovimento ?? "carico",
      tipoDettaglio: "donazione",
      dataMovimento: "2026-06-01",
      magazzinoId: opts.magazzinoId,
      prodottoId: opts.prodottoId,
      lottoId: opts.lottoId ?? null,
      bollaRigaId: opts.bollaRigaId ?? null,
      quantita: "1.00",
      unitaMisura: "kg",
      naturaContabile: opts.naturaContabile,
      fondoOrigine: opts.fondoOrigine,
    })
    .returning({ id: movimentiTable.id });
  return m.id;
}

/** Deletes every row created under this scope, in FK-safe (child→parent) order. */
export async function cleanup(scope: SeedScope): Promise<void> {
  if (scope.magazzinoIds.length > 0) {
    await db.delete(movimentiTable).where(inArray(movimentiTable.magazzinoId, scope.magazzinoIds));
    await db.delete(carichiMagazzinoRigheTable).where(inArray(carichiMagazzinoRigheTable.lottoId, db.select({ id: lottiTable.id }).from(lottiTable).where(inArray(lottiTable.magazzinoId, scope.magazzinoIds))));
    await db.delete(carichiMagazzinoTable).where(inArray(carichiMagazzinoTable.magazzinoId, scope.magazzinoIds));
    await db.delete(operazioniDistribuzioneMagazzinoTable).where(inArray(operazioniDistribuzioneMagazzinoTable.magazzinoId, scope.magazzinoIds));
  }
  if (scope.trasferimentoIds.length > 0) {
    await db.delete(trasferimentoRigheTable).where(inArray(trasferimentoRigheTable.trasferimentoId, scope.trasferimentoIds));
    await db.delete(trasferimentiTable).where(inArray(trasferimentiTable.id, scope.trasferimentoIds));
  }
  if (scope.interventoIds.length > 0) {
    await db.delete(interventiTable).where(inArray(interventiTable.id, scope.interventoIds));
  }
  if (scope.turnoIds.length > 0) {
    await db.delete(turniConsegneTable).where(inArray(turniConsegneTable.turnoId, scope.turnoIds));
    await db.delete(turniVolontariTable).where(inArray(turniVolontariTable.turnoId, scope.turnoIds));
    await db.delete(turniTable).where(inArray(turniTable.id, scope.turnoIds));
  }
  if (scope.prenotazioneIds.length > 0) {
    await db.delete(prenotazioniMagazzinoTable).where(inArray(prenotazioniMagazzinoTable.id, scope.prenotazioneIds));
  }
  if (scope.bollaIds.length > 0) {
    await db.delete(interventiTable).where(inArray(interventiTable.bollaId, scope.bollaIds));
    await db.delete(prenotazioniMagazzinoTable).where(inArray(prenotazioniMagazzinoTable.bollaId, scope.bollaIds));
    await db.delete(bollaRigheTable).where(inArray(bollaRigheTable.bollaId, scope.bollaIds));
    await db.delete(bolleTable).where(inArray(bolleTable.id, scope.bollaIds));
  }
  if (scope.consegnaIds.length > 0) {
    await db.delete(turniConsegneTable).where(inArray(turniConsegneTable.consegnaId, scope.consegnaIds));
    await db.delete(consegneTable).where(inArray(consegneTable.id, scope.consegnaIds));
  }
  if (scope.scaricoIds.length > 0) {
    await db.delete(scaricoRigheTable).where(inArray(scaricoRigheTable.scaricoId, scope.scaricoIds));
    await db.delete(scarichiTable).where(inArray(scarichiTable.id, scope.scaricoIds));
  }
  if (scope.approvvigionamentoIds.length > 0) {
    await db.delete(approvvigionamentoRigheTable).where(inArray(approvvigionamentoRigheTable.approvvigionamentoId, scope.approvvigionamentoIds));
    await db.delete(approvvigionamentiTable).where(inArray(approvvigionamentiTable.id, scope.approvvigionamentoIds));
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
  if (scope.ruoloVolontarioIds.length > 0) {
    await db.delete(ruoliVolontariTable).where(inArray(ruoliVolontariTable.id, scope.ruoloVolontarioIds));
  }
  if (scope.beneficiarioIds.length > 0) {
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, scope.beneficiarioIds));
  }
  if (scope.magazzinoIds.length > 0) {
    await db.delete(magazziniTable).where(inArray(magazziniTable.id, scope.magazzinoIds));
  }
  if (scope.utenteIds.length > 0) {
    await db.delete(interventiTable).where(inArray(interventiTable.operatoreId, scope.utenteIds));
    await db.delete(auditConfigurazioniTable).where(inArray(auditConfigurazioniTable.utenteId, scope.utenteIds));
    await db.delete(utentiTable).where(inArray(utentiTable.id, scope.utenteIds));
  }
  if (scope.ruoloIds.length > 0) {
    await db.delete(ruoliTable).where(inArray(ruoliTable.id, scope.ruoloIds));
  }
  if (scope.centroIds.length > 0) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, scope.centroIds));
  }
  if (scope.zonaIds.length > 0) {
    await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, scope.zonaIds));
  }
  if (scope.areaOperativaIds.length > 0) {
    await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, scope.areaOperativaIds));
  }
}
