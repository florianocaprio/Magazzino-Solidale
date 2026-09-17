/* @vitest-environment node */

import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  areeOperativeTable,
  auditEventiTable,
  bollaRigheTable,
  bolleTable,
  caricoIntegrazioneRigheTable,
  caricoIntegrazioniTable,
  caricoPraticaRettificheTable,
  caricoPraticaRigheTable,
  caricoPraticheTable,
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  db,
  lottiLogiciTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  pool,
  prodottiTable,
  prenotazioniMagazzinoTable,
  utentiTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import caricoPraticheRouter from "../src/routes/carico-pratiche";
import {
  ensureAmbienteModuli,
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";

const suffix = `${process.pid}${Date.now().toString(36)}`;
let areaAId: number;
let areaBId: number;
let magazzinoAId: number;
let magazzinoBId: number;
let magazzinoInattivoId: number;
let magazzinoLegacyId: number;
let generaleAId: number;
let generaleBId: number;
let lottoOperativoAId: number;
let prodottoPzId: number;
let prodottoKgId: number;
let operatorAId: number;
let operatorBId: number;
let originalLottiAttivo = true;
const practiceIds: number[] = [];

function appFor(
  userId: number,
  options: {
    areaOperativaId?: number | null;
    matricola?: string;
    adjust?: boolean;
  } = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: userId,
      username: `m3a_${userId}_${suffix}`,
      matricola: options.matricola ?? `M3A-${userId}`,
      isAdmin: false,
      isSuperAdmin: false,
      aree: ["magazzino"],
      permessi: [
        "magazzino.view",
        "magazzino.stock.receive",
        ...(options.adjust === false ? [] : ["magazzino.stock.adjust"]),
      ],
      centroAscoltoId: null,
      areaOperativaId: options.areaOperativaId ?? null,
      zonaUdsId: null,
    };
    next();
  });
  app.use(caricoPraticheRouter);
  return app;
}

function header(overrides: Record<string, unknown> = {}) {
  return {
    areaOperativaId: areaAId,
    magazzinoId: magazzinoAId,
    lottoLogicoId: generaleAId,
    origineCarico: "DONAZIONE",
    dataCarico: "2026-09-17",
    descrizione: "Pratica M3A test",
    ...overrides,
  };
}

function row(quantita: string | null, overrides: Record<string, unknown> = {}) {
  return {
    prodottoId: prodottoPzId,
    fondoOrigine: "NESSUN_FONDO",
    quantita,
    ...overrides,
  };
}

async function createPractice(
  app: Express,
  rows: Record<string, unknown>[] = [],
  overrides: Record<string, unknown> = {},
) {
  const response = await request(app)
    .post("/carico-pratiche")
    .send({ ...header(overrides), righe: rows });
  if (response.status === 201) practiceIds.push(response.body.id);
  return response;
}

async function residualForProduct() {
  const [result] = await db
    .select({
      total: sql<string>`coalesce(sum(${lottiTable.quantitaResidua}), 0)`,
    })
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.magazzinoId, magazzinoAId),
        eq(lottiTable.prodottoId, prodottoPzId),
      ),
    );
  return Number(result.total);
}

beforeAll(async () => {
  const required = await pool.query(`
    SELECT count(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'carico_pratiche',
        'carico_pratica_righe',
        'carico_integrazioni',
        'carico_integrazione_righe',
        'carico_pratica_rettifiche'
      )
  `);
  if (required.rows[0].count !== 5)
    throw new Error("Applicare la migrazione M3A al database di test");

  await ensureAmbienteModuli();
  originalLottiAttivo =
    (await listModuliFunzionali()).find((item) => item.codice === "LOTTI")
      ?.attivo ?? true;
  await updateModuloAmbiente("LOTTI", true, null);

  [{ id: operatorAId }] = await db
    .insert(utentiTable)
    .values({
      username: `m3a_a_${suffix}`,
      passwordHash: "x",
      nome: "Operatore",
      cognome: "A",
    })
    .returning({ id: utentiTable.id });
  [{ id: operatorBId }] = await db
    .insert(utentiTable)
    .values({
      username: `m3a_b_${suffix}`,
      passwordHash: "x",
      nome: "Operatore",
      cognome: "B",
    })
    .returning({ id: utentiTable.id });
  [{ id: areaAId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `M3A Area A ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: areaBId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `M3A Area B ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: generaleAId }] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: areaAId,
      codice: "GENERALE",
      descrizione: "Generale",
      isGenerale: true,
    })
    .returning({ id: lottiLogiciTable.id });
  [{ id: generaleBId }] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: areaBId,
      codice: "GENERALE",
      descrizione: "Generale",
      isGenerale: true,
    })
    .returning({ id: lottiLogiciTable.id });
  [{ id: lottoOperativoAId }] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: areaAId,
      codice: `M3A-${suffix}`.slice(0, 50),
      descrizione: "Lotto operativo M3A",
      isGenerale: false,
    })
    .returning({ id: lottiLogiciTable.id });
  [{ id: magazzinoAId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M3AA-${suffix}`.slice(0, 20),
      nome: "M3A Deposito A",
      areaOperativaId: areaAId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: magazzinoBId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M3AB-${suffix}`.slice(0, 20),
      nome: "M3A Deposito B",
      areaOperativaId: areaBId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: magazzinoInattivoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M3AI-${suffix}`.slice(0, 20),
      nome: "M3A Deposito inattivo",
      areaOperativaId: areaAId,
      stato: "inattivo",
    })
    .returning({ id: magazziniTable.id });
  [{ id: magazzinoLegacyId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M3AL-${suffix}`.slice(0, 20),
      nome: "M3A Deposito legacy",
      areaOperativaId: null,
    })
    .returning({ id: magazziniTable.id });
  [{ id: prodottoPzId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `M3APZ-${suffix}`.slice(0, 30),
      nome: "M3A Prodotto pezzi",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      quantitaFrazionabile: false,
      lottoFisicoObbligatorio: false,
      gestioneScadenza: false,
    })
    .returning({ id: prodottiTable.id });
  [{ id: prodottoKgId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `M3AKG-${suffix}`.slice(0, 30),
      nome: "M3A Prodotto kg",
      tipoProdotto: "alimentare",
      unitaMisura: "kg",
      quantitaFrazionabile: true,
      lottoFisicoObbligatorio: true,
      gestioneScadenza: true,
    })
    .returning({ id: prodottiTable.id });
});

afterAll(async () => {
  const integrations = await db
    .select({
      id: caricoIntegrazioniTable.id,
      caricoMagazzinoId: caricoIntegrazioniTable.caricoMagazzinoId,
    })
    .from(caricoIntegrazioniTable)
    .where(inArray(caricoIntegrazioniTable.caricoPraticaId, practiceIds));
  const integrationIds = integrations.map((item) => item.id);
  const loadIds = integrations.map((item) => item.caricoMagazzinoId);
  if (practiceIds.length)
    await db
      .delete(caricoPraticaRettificheTable)
      .where(
        inArray(
          caricoPraticaRettificheTable.caricoPraticaRigaId,
          db
            .select({ id: caricoPraticaRigheTable.id })
            .from(caricoPraticaRigheTable)
            .where(
              inArray(caricoPraticaRigheTable.caricoPraticaId, practiceIds),
            ),
        ),
      );
  if (integrationIds.length)
    await db
      .delete(caricoIntegrazioneRigheTable)
      .where(
        inArray(
          caricoIntegrazioneRigheTable.caricoIntegrazioneId,
          integrationIds,
        ),
      );
  if (integrationIds.length)
    await db
      .delete(caricoIntegrazioniTable)
      .where(inArray(caricoIntegrazioniTable.id, integrationIds));
  await db
    .delete(movimentiTable)
    .where(inArray(movimentiTable.magazzinoId, [magazzinoAId, magazzinoBId]));
  if (loadIds.length)
    await db
      .delete(carichiMagazzinoRigheTable)
      .where(inArray(carichiMagazzinoRigheTable.caricoMagazzinoId, loadIds));
  if (loadIds.length)
    await db
      .delete(carichiMagazzinoTable)
      .where(inArray(carichiMagazzinoTable.id, loadIds));
  if (practiceIds.length)
    await db
      .delete(caricoPraticheTable)
      .where(inArray(caricoPraticheTable.id, practiceIds));
  await db
    .delete(lottiTable)
    .where(inArray(lottiTable.magazzinoId, [magazzinoAId, magazzinoBId]));
  await db
    .delete(prodottiTable)
    .where(inArray(prodottiTable.id, [prodottoPzId, prodottoKgId]));
  await db
    .delete(magazziniTable)
    .where(
      inArray(magazziniTable.id, [
        magazzinoAId,
        magazzinoBId,
        magazzinoInattivoId,
        magazzinoLegacyId,
      ]),
    );
  await db
    .delete(lottiLogiciTable)
    .where(
      inArray(lottiLogiciTable.id, [
        generaleAId,
        generaleBId,
        lottoOperativoAId,
      ]),
    );
  await db
    .delete(areeOperativeTable)
    .where(inArray(areeOperativeTable.id, [areaAId, areaBId]));
  await db
    .delete(utentiTable)
    .where(inArray(utentiTable.id, [operatorAId, operatorBId]));
  await updateModuloAmbiente("LOTTI", originalLottiAttivo, null);
  await pool.end();
});

describe("M3A — pratica persistente e registrazioni incrementali", () => {
  it("salva una bozza incompleta, la recupera da un'altra sessione e non muove stock", async () => {
    const appA = appFor(operatorAId);
    const appB = appFor(operatorBId);
    const before = await residualForProduct();
    const created = await createPractice(appA, [row(null)]);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ stato: "bozza", versione: 1 });
    expect(created.body.righe[0]).toMatchObject({
      quantita: null,
      registrata: false,
    });
    const resumed = await request(appB).get(
      `/carico-pratiche/${created.body.id}`,
    );
    expect(resumed.status).toBe(200);
    expect(resumed.body.codice).toBe(created.body.codice);
    expect(await residualForProduct()).toBe(before);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.entitaOrigineTipo, "carico_pratica")),
    ).toHaveLength(0);
  });

  it("rileva il conflitto di versione tra due operatori senza perdita silenziosa", async () => {
    const appA = appFor(operatorAId);
    const appB = appFor(operatorBId);
    const created = await createPractice(appA);
    const first = await request(appA)
      .patch(`/carico-pratiche/${created.body.id}`)
      .send({ versione: 1, descrizione: "Modifica A" });
    expect(first.status).toBe(200);
    const stale = await request(appB)
      .patch(`/carico-pratiche/${created.body.id}`)
      .send({ versione: 1, descrizione: "Modifica B" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/altro operatore/i);
    const persisted = await request(appB).get(
      `/carico-pratiche/${created.body.id}`,
    );
    expect(persisted.body.descrizione).toBe("Modifica A");
    const audit = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "carico_pratica"),
          eq(auditEventiTable.entitaId, created.body.id),
        ),
      );
    expect(audit.map((event) => event.actorUserId)).toContain(operatorAId);
  });

  it("contabilizza 80 più una nuova riga 20 ottenendo 100 senza riscrivere la prima", async () => {
    const app = appFor(operatorAId);
    const before = await residualForProduct();
    const created = await createPractice(app, [row("80")]);
    const firstRow = created.body.righe[0];
    const first = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({
        versione: created.body.versione,
        rigaIds: [firstRow.id],
        idempotencyKey: `m3a-80-${suffix}`,
      });
    expect(first.status).toBe(201);
    expect(await residualForProduct()).toBe(before + 80);

    const added = await request(app)
      .post(`/carico-pratiche/${created.body.id}/righe`)
      .send({
        versione: first.body.versione,
        ...row("20", { clientId: `append-20-${suffix}` }),
      });
    expect(added.status).toBe(201);
    expect(await residualForProduct()).toBe(before + 80);
    const secondRow = added.body.righe.find(
      (item: { registrata: boolean }) => !item.registrata,
    );
    const second = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({
        versione: added.body.versione,
        rigaIds: [secondRow.id],
        idempotencyKey: `m3a-20-${suffix}`,
      });
    expect(second.status).toBe(201);
    expect(await residualForProduct()).toBe(before + 100);
    const persisted = await request(app).get(
      `/carico-pratiche/${created.body.id}`,
    );
    expect(
      persisted.body.righe.map((item: { quantita: string }) => item.quantita),
    ).toEqual(["80.00", "20.00"]);
    expect(persisted.body.integrazioni).toHaveLength(2);
  });

  it("registra solo il gruppo completo e fa rollback atomico se una riga è incompleta", async () => {
    const app = appFor(operatorAId);
    const before = await residualForProduct();
    const created = await createPractice(app, [row("5"), row(null)]);
    const response = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({
        versione: created.body.versione,
        rigaIds: created.body.righe.map((item: { id: number }) => item.id),
        idempotencyKey: `m3a-atomic-${suffix}`,
      });
    expect(response.status).toBe(400);
    expect(await residualForProduct()).toBe(before);
    const persisted = await request(app).get(
      `/carico-pratiche/${created.body.id}`,
    );
    expect(
      persisted.body.righe.every(
        (item: { registrata: boolean }) => !item.registrata,
      ),
    ).toBe(true);
  });

  it("deduplica retry sequenziali e concorrenti e rifiuta key o righe incompatibili", async () => {
    const app = appFor(operatorAId);
    const before = await residualForProduct();
    const created = await createPractice(app, [row("7")]);
    const payload = {
      versione: created.body.versione,
      rigaIds: [created.body.righe[0].id],
      idempotencyKey: `m3a-retry-${suffix}`,
    };
    const [a, b] = await Promise.all([
      request(app)
        .post(`/carico-pratiche/${created.body.id}/registra`)
        .send(payload),
      request(app)
        .post(`/carico-pratiche/${created.body.id}/registra`)
        .send(payload),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.integrazioneId).toBe(b.body.integrazioneId);
    expect(await residualForProduct()).toBe(before + 7);
    const conflictPayload = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({ ...payload, rigaIds: [created.body.righe[0].id + 100000] });
    expect(conflictPayload.status).toBe(409);
    const otherKey = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({ ...payload, idempotencyKey: `m3a-other-${suffix}` });
    expect(otherKey.status).toBe(409);
    expect(await residualForProduct()).toBe(before + 7);
  });

  it("rifiuta PATCH e DELETE manuali su righe già registrate", async () => {
    const app = appFor(operatorAId);
    const created = await createPractice(app, [row("3")]);
    const registered = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({
        versione: 1,
        rigaIds: [created.body.righe[0].id],
        idempotencyKey: `m3a-immutable-${suffix}`,
      });
    const patch = await request(app)
      .patch(
        `/carico-pratiche/${created.body.id}/righe/${created.body.righe[0].id}`,
      )
      .send({ versione: registered.body.versione, ...row("99") });
    expect(patch.status).toBe(409);
    const remove = await request(app)
      .delete(
        `/carico-pratiche/${created.body.id}/righe/${created.body.righe[0].id}`,
      )
      .send({ versione: registered.body.versione });
    expect(remove.status).toBe(409);
  });

  it("collega rettifiche motivate, impedisce eccedenze e impegni e rollbacka se l'audit fallisce", async () => {
    const app = appFor(operatorAId);
    const withoutPermission = appFor(operatorBId, { adjust: false });
    const created = await createPractice(app, [row("10")]);
    const registered = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send({
        versione: created.body.versione,
        rigaIds: [created.body.righe[0].id],
        idempotencyKey: `m3a-rect-load-${suffix}`,
      });
    const detailResponse = await request(app).get(
      `/carico-pratiche/${created.body.id}`,
    );
    const registeredLine = detailResponse.body.righe[0];
    const [accountingLine] = await db
      .select()
      .from(carichiMagazzinoRigheTable)
      .where(
        eq(carichiMagazzinoRigheTable.id, registeredLine.caricoMagazzinoRigaId),
      );
    const payload = {
      versione: registered.body.versione,
      quantita: "3",
      motivo: "Errore di conteggio verificato",
      idempotencyKey: `m3a-rect-${suffix}`,
    };
    const denied = await request(withoutPermission)
      .post(
        `/carico-pratiche/${created.body.id}/righe/${created.body.righe[0].id}/rettifica`,
      )
      .send(payload);
    expect(denied.status).toBe(403);

    const corrected = await request(app)
      .post(
        `/carico-pratiche/${created.body.id}/righe/${created.body.righe[0].id}/rettifica`,
      )
      .send(payload);
    expect(corrected.status).toBe(201);
    expect(corrected.body).toMatchObject({
      praticaId: created.body.id,
      rigaId: created.body.righe[0].id,
      lottoId: accountingLine.lottoId,
      quantita: "3.000000",
      replay: false,
    });
    const replay = await request(app)
      .post(
        `/carico-pratiche/${created.body.id}/righe/${created.body.righe[0].id}/rettifica`,
      )
      .send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.movimentoId).toBe(corrected.body.movimentoId);

    const excessive = await request(app)
      .post(
        `/carico-pratiche/${created.body.id}/righe/${created.body.righe[0].id}/rettifica`,
      )
      .send({
        versione: corrected.body.versione,
        quantita: "8",
        motivo: "Tentativo eccedente",
        idempotencyKey: `m3a-rect-excess-${suffix}`,
      });
    expect(excessive.status).toBe(409);

    const [{ id: bollaId }] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `M3A-${suffix}`.slice(0, 30),
        dataBolla: "2026-09-17",
        beneficiarioId: 999999,
        magazzinoId: magazzinoAId,
        areaOperativaIdSnapshot: areaAId,
      })
      .returning({ id: bolleTable.id });
    const [{ id: bollaRigaId }] = await db
      .insert(bollaRigheTable)
      .values({
        bollaId,
        prodottoId: prodottoPzId,
        lottoId: accountingLine.lottoId,
        quantita: "5",
        unitaMisura: "pz",
      })
      .returning({ id: bollaRigheTable.id });
    const [{ id: reservationId }] = await db
      .insert(prenotazioniMagazzinoTable)
      .values({
        bollaId,
        rigaBollaId: bollaRigaId,
        prodottoId: prodottoPzId,
        lottoId: accountingLine.lottoId,
        magazzinoId: magazzinoAId,
        quantita: "5",
      })
      .returning({ id: prenotazioniMagazzinoTable.id });
    const committed = await request(app)
      .post(
        `/carico-pratiche/${created.body.id}/righe/${created.body.righe[0].id}/rettifica`,
      )
      .send({
        versione: corrected.body.versione,
        quantita: "3",
        motivo: "Tentativo su merce impegnata",
        idempotencyKey: `m3a-rect-reserved-${suffix}`,
      });
    expect(committed.status).toBe(409);
    await db
      .delete(prenotazioniMagazzinoTable)
      .where(eq(prenotazioniMagazzinoTable.id, reservationId));
    await db.delete(bollaRigheTable).where(eq(bollaRigheTable.id, bollaRigaId));
    await db.delete(bolleTable).where(eq(bolleTable.id, bollaId));

    const [beforeAuditFailure] = await db
      .select({ quantita: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, accountingLine.lottoId));
    await pool.query(`CREATE OR REPLACE FUNCTION test_m3a_rect_audit_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.operation_key = '${`m3a-rettifica:m3a-rect-audit-${suffix}`}' THEN
          RAISE EXCEPTION 'synthetic M3A rectification audit failure';
        END IF;
        RETURN NEW;
      END $$`);
    await pool.query(
      "DROP TRIGGER IF EXISTS test_m3a_rect_audit_failure_trigger ON audit_eventi",
    );
    await pool.query(`CREATE TRIGGER test_m3a_rect_audit_failure_trigger
      BEFORE INSERT ON audit_eventi
      FOR EACH ROW EXECUTE FUNCTION test_m3a_rect_audit_failure()`);
    try {
      const failed = await request(app)
        .post(
          `/carico-pratiche/${created.body.id}/righe/${created.body.righe[0].id}/rettifica`,
        )
        .send({
          versione: corrected.body.versione,
          quantita: "1",
          motivo: "Deve fare rollback",
          idempotencyKey: `m3a-rect-audit-${suffix}`,
        });
      expect(failed.status).toBe(500);
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_m3a_rect_audit_failure_trigger ON audit_eventi",
      );
      await pool.query(
        "DROP FUNCTION IF EXISTS test_m3a_rect_audit_failure() ",
      );
    }
    const [afterAuditFailure] = await db
      .select({ quantita: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, accountingLine.lottoId));
    expect(afterAuditFailure.quantita).toBe(beforeAuditFailure.quantita);
    expect(
      await db
        .select()
        .from(caricoPraticaRettificheTable)
        .where(
          eq(
            caricoPraticaRettificheTable.idempotencyKey,
            `m3a-rect-audit-${suffix}`,
          ),
        ),
    ).toHaveLength(0);
  });

  it("gestisce chiusura, replay dopo chiusura e annullamento motivato di una bozza", async () => {
    const app = appFor(operatorAId);
    const created = await createPractice(app, [row("2")], {
      lottoLogicoId: lottoOperativoAId,
    });
    const payload = {
      versione: 1,
      rigaIds: [created.body.righe[0].id],
      idempotencyKey: `m3a-lifecycle-${suffix}`,
    };
    const registered = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send(payload);
    const closed = await request(app)
      .post(`/carico-pratiche/${created.body.id}/chiudi`)
      .send({ versione: registered.body.versione });
    expect(closed.status).toBe(200);
    expect(closed.body.stato).toBe("chiusa");
    await db
      .update(lottiLogiciTable)
      .set({ stato: "chiuso" })
      .where(eq(lottiLogiciTable.id, lottoOperativoAId));
    const replay = await request(app)
      .post(`/carico-pratiche/${created.body.id}/registra`)
      .send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.replay).toBe(true);
    await db
      .update(lottiLogiciTable)
      .set({ stato: "aperto" })
      .where(eq(lottiLogiciTable.id, lottoOperativoAId));

    const draft = await createPractice(app);
    const cancelled = await request(app)
      .post(`/carico-pratiche/${draft.body.id}/annulla`)
      .send({ versione: draft.body.versione, motivo: "Bozza duplicata" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.stato).toBe("annullata");
  });

  it("serializza nuova registrazione contro chiusura e rifiuta righe estranee o lotto chiuso", async () => {
    const app = appFor(operatorAId);
    const firstPractice = await createPractice(app, [row("1")]);
    const firstRegistration = await request(app)
      .post(`/carico-pratiche/${firstPractice.body.id}/registra`)
      .send({
        versione: firstPractice.body.versione,
        rigaIds: [firstPractice.body.righe[0].id],
        idempotencyKey: `m3a-race-first-${suffix}`,
      });
    const added = await request(app)
      .post(`/carico-pratiche/${firstPractice.body.id}/righe`)
      .send({
        versione: firstRegistration.body.versione,
        ...row("2", { clientId: `m3a-race-second-${suffix}` }),
      });
    const pendingLine = added.body.righe.find(
      (item: { registrata: boolean }) => !item.registrata,
    );
    const [register, close] = await Promise.all([
      request(app)
        .post(`/carico-pratiche/${firstPractice.body.id}/registra`)
        .send({
          versione: added.body.versione,
          rigaIds: [pendingLine.id],
          idempotencyKey: `m3a-race-${suffix}`,
        }),
      request(app)
        .post(`/carico-pratiche/${firstPractice.body.id}/chiudi`)
        .send({ versione: added.body.versione }),
    ]);
    expect(register.status).toBe(201);
    expect(close.status).toBe(409);
    const coherent = await request(app).get(
      `/carico-pratiche/${firstPractice.body.id}`,
    );
    expect(coherent.body.stato).toBe("aperta");
    expect(
      coherent.body.righe.every(
        (item: { registrata: boolean }) => item.registrata,
      ),
    ).toBe(true);

    const other = await createPractice(app, [row("1")]);
    const foreign = await request(app)
      .post(`/carico-pratiche/${firstPractice.body.id}/registra`)
      .send({
        versione: coherent.body.versione,
        rigaIds: [other.body.righe[0].id],
        idempotencyKey: `m3a-foreign-${suffix}`,
      });
    expect(foreign.status).toBe(400);

    const closedLotPractice = await createPractice(app, [row("1")], {
      lottoLogicoId: lottoOperativoAId,
    });
    await db
      .update(lottiLogiciTable)
      .set({ stato: "chiuso" })
      .where(eq(lottiLogiciTable.id, lottoOperativoAId));
    const closedLotRegistration = await request(app)
      .post(`/carico-pratiche/${closedLotPractice.body.id}/registra`)
      .send({
        versione: closedLotPractice.body.versione,
        rigaIds: [closedLotPractice.body.righe[0].id],
        idempotencyKey: `m3a-closed-lot-${suffix}`,
      });
    expect(closedLotRegistration.status).toBe(409);
    await db
      .update(lottiLogiciTable)
      .set({ stato: "aperto" })
      .where(eq(lottiLogiciTable.id, lottoOperativoAId));
  });

  it("blocca Area diversa, deposito inattivo, deposito legacy e lotto di altra Area", async () => {
    const scoped = appFor(operatorAId, { areaOperativaId: areaAId });
    const crossArea = await request(scoped)
      .post("/carico-pratiche")
      .send({
        ...header({
          areaOperativaId: areaBId,
          magazzinoId: magazzinoBId,
          lottoLogicoId: generaleBId,
        }),
        righe: [],
      });
    expect(crossArea.status).toBe(403);
    const inactive = await request(scoped)
      .post("/carico-pratiche")
      .send({ ...header({ magazzinoId: magazzinoInattivoId }), righe: [] });
    expect(inactive.status).toBe(400);
    const legacy = await request(appFor(operatorAId))
      .post("/carico-pratiche")
      .send({
        ...header({ areaOperativaId: areaAId, magazzinoId: magazzinoLegacyId }),
        righe: [],
      });
    expect(legacy.status).toBe(400);
    const wrongLot = await request(scoped)
      .post("/carico-pratiche")
      .send({ ...header({ lottoLogicoId: generaleBId }), righe: [] });
    expect(wrongLot.status).toBe(403);
  });

  it("valida quantità indivisibili e tracciabilità fisica solo alla registrazione", async () => {
    const app = appFor(operatorAId);
    const fractional = await createPractice(app, [row("1.5")]);
    expect(fractional.status).toBe(400);
    const incompletePhysical = await createPractice(app, [
      row("1.25", {
        prodottoId: prodottoKgId,
        fondoOrigine: "FSE_PLUS",
      }),
    ]);
    expect(incompletePhysical.status).toBe(201);
    const register = await request(app)
      .post(`/carico-pratiche/${incompletePhysical.body.id}/registra`)
      .send({
        versione: 1,
        rigaIds: [incompletePhysical.body.righe[0].id],
        idempotencyKey: `m3a-physical-${suffix}`,
      });
    expect(register.status).toBe(400);
    expect(register.body.error).toMatch(/lotto obbligatorio/i);

    const physical = await createPractice(app, [
      row("1.25", {
        prodottoId: prodottoKgId,
        fondoOrigine: "FSE_PLUS",
        codiceLottoProduttore: `M3A-PHYS-A-${suffix}`,
        dataScadenza: "2027-01-31",
        fattoreKgLtPezzo: "0.5",
      }),
      row("2.5", {
        prodottoId: prodottoKgId,
        fondoOrigine: "FSE_PLUS",
        codiceLottoProduttore: `M3A-PHYS-B-${suffix}`,
        dataScadenza: "2027-02-28",
        fattoreKgLtPezzo: "1",
      }),
    ]);
    const physicalRegistration = await request(app)
      .post(`/carico-pratiche/${physical.body.id}/registra`)
      .send({
        versione: physical.body.versione,
        rigaIds: physical.body.righe.map((item: { id: number }) => item.id),
        idempotencyKey: `m3a-physical-complete-${suffix}`,
      });
    expect(physicalRegistration.status).toBe(201);
    const physicalLots = await db
      .select()
      .from(lottiTable)
      .where(
        and(
          eq(lottiTable.magazzinoId, magazzinoAId),
          eq(lottiTable.prodottoId, prodottoKgId),
        ),
      );
    expect(physicalLots).toHaveLength(2);
    expect(
      physicalLots.map((item) => [
        item.codiceLotto,
        item.dataScadenza,
        item.fattoreKgLtPezzo,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [`M3A-PHYS-A-${suffix}`, "2027-01-31", "0.50"],
        [`M3A-PHYS-B-${suffix}`, "2027-02-28", "1.00"],
      ]),
    );
  });
});
