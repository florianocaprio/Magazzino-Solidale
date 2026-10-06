/* @vitest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRequestClosure } from "../src/lib/m5RequestClosure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import {
  auditEventiTable,
  bolleTable,
  bollaRigheTable,
  consegneTable,
  db,
  interventiTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  pool,
  prenotazioniMagazzinoTable,
  prodottiTable,
  richiesteMagazzinoDocumentiTable,
  richiesteMagazzinoTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import bolleRouter from "../src/routes/bolle";
import consegneRouter from "../src/routes/consegne";
import documentiOperativiRouter from "../src/routes/documenti-operativi";
import interventiRouter from "../src/routes/interventi";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  insertBolla,
  insertBollaRiga,
  makeScopedApp,
  newScope,
} from "./scope-helpers";

const scope = newScope();
const grants = [
  "richieste_magazzino.view",
  "richieste_magazzino.prepare",
  "consegne.view",
  "consegne.manage",
  "consegne.complete",
  "consegne.cancel",
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "sociale.interventi.view",
  "magazzino.view",
];
let areaId: number;
let centroId: number;
let beneficiarioId: number;
let magazzinoId: number;
let prodottoId: number;
let lottoId: number;
let actorId: number;
let app: ReturnType<typeof makeScopedApp>;

async function linkedBolla(stato: "bozza" | "confermato" = "bozza") {
  const [intervento] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId,
      tipoIntervento: "Pacco alimentare M5C2A",
      ambito: "sociale",
      stato: "da_pianificare",
      operatoreId: actorId,
      areaOperativaIdSnapshot: areaId,
      centroAscoltoIdSnapshot: centroId,
    })
    .returning();
  const [richiesta] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `RM-C2-${randomUUID().slice(0, 8)}`,
      tipoDestinatario: "beneficiario",
      beneficiarioId,
      areaOperativaId: areaId,
      centroAscoltoId: centroId,
      sorgente: "intervento_sociale",
      interventoId: intervento.id,
      destinatarioNomeSnapshot: "Beneficiario M5C2A",
      areaNomeSnapshot: "Area M5C2A",
      centroNomeSnapshot: "Centro M5C2A",
      bisogno: "Pacco alimentare",
      stato: "presa_in_carico",
      inviatoDa: actorId,
      presoInCaricoDa: actorId,
      presoInCaricoCodiceSnapshot: "M5C2A",
      presoInCaricoAt: new Date(),
    })
    .returning();
  const bollaId = await insertBolla(scope, {
    beneficiarioId,
    magazzinoId,
  });
  await db.insert(richiesteMagazzinoDocumentiTable).values({
    richiestaId: richiesta.id,
    tipoDocumento: "bolla",
    bollaId,
    creatoDa: actorId,
  });
  await insertBollaRiga(scope, {
    bollaId,
    prodottoId,
    lottoId,
    quantita: 3,
    unitaMisura: "pz",
  });
  if (stato === "confermato") {
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    const confirmed = await request(app)
      .post(`/bolle/${bollaId}/conferma`)
      .send({
        versione: bolla.versione,
        idempotencyKey: randomUUID(),
      });
    expect(confirmed.status, confirmed.text).toBe(200);
  }
  const [bolla] = await db
    .select()
    .from(bolleTable)
    .where(eq(bolleTable.id, bollaId));
  return {
    interventoId: intervento.id,
    richiestaId: richiesta.id,
    bollaId,
    versione: bolla.versione,
  };
}

async function deliveredLegacyRequest() {
  const ready = await linkedBolla("confermato");
  const planned = await request(app)
    .post(`/consegne/da-bolla/${ready.bollaId}`)
    .send({
      versione: ready.versione,
      idempotencyKey: randomUUID(),
      tipoConsegna: "domicilio",
      dataPrevista: "2026-10-15",
      fasciaOraria: "Mattina",
      indirizzoConsegna: "Via Test 1",
    });
  expect(planned.status, planned.text).toBe(201);
  const [bolla] = await db
    .select()
    .from(bolleTable)
    .where(eq(bolleTable.id, ready.bollaId));
  const completed = await request(app)
    .post(`/consegne/${planned.body.id}/completa`)
    .send({ versione: bolla.versione, idempotencyKey: randomUUID() });
  expect(completed.status, completed.text).toBe(200);
  await db
    .update(richiesteMagazzinoTable)
    .set({ stato: "presa_in_carico" })
    .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
  return { ...ready, consegnaId: planned.body.id };
}

const inspectClosure = (richiestaId: number) =>
  db.transaction((tx) => inspectRequestClosure(tx, richiestaId));

const closureAudit = (richiestaId: number) =>
  db
    .select({ id: auditEventiTable.id })
    .from(auditEventiTable)
    .where(
      and(
        eq(auditEventiTable.entitaTipo, "richiesta_magazzino"),
        eq(auditEventiTable.entitaId, richiestaId),
        eq(auditEventiTable.azione, "richiesta_magazzino.chiusa_da_consegna"),
      ),
    );

beforeAll(async () => {
  if (process.env.M5C2A_TEST_DISPOSABLE_DB !== "verified")
    throw new Error("M5C2A requires verified disposable PostgreSQL");
  areaId = await createAreaOperativa(scope);
  centroId = (await createCentroRec(scope, { areaOperativaId: areaId })).id;
  beneficiarioId = await createBeneficiario(scope, centroId, {
    areaOperativaId: areaId,
  });
  magazzinoId = await createMagazzino(scope, centroId, {
    areaOperativaId: areaId,
  });
  prodottoId = await createProdotto(scope, {
    unitaMisura: "pz",
    quantitaFrazionabile: false,
  });
  lottoId = await createLotto(scope, {
    prodottoId,
    magazzinoId,
    quantita: 150,
    dataScadenza: "2098-01-01",
  });
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `M5C2A-${randomUUID().slice(0, 8)}`,
      aree: ["sociale", "magazzino"],
      permessi: grants,
    })
    .returning({ id: ruoliTable.id });
  actorId = await createUtente(scope, { centroId, ruoloId: role.id });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: areaId })
    .where(eq(utentiTable.id, actorId));
  const router = express.Router();
  router.use(
    bolleRouter,
    consegneRouter,
    documentiOperativiRouter,
    interventiRouter,
  );
  app = makeScopedApp(router, {
    id: actorId,
    centroAscoltoId: centroId,
    areaOperativaId: areaId,
    aree: ["sociale", "magazzino"],
    permessi: grants,
  });
});

afterAll(async () => {
  await pool.end();
});

describe("M5C2-A — handoff Bolla pronta", () => {
  it("Latte usa l'unità l e il lotto Automatico FEFO; il lotto obbligatorio resta vincolante", async () => {
    const latteId = await createProdotto(scope, { unitaMisura: "l" });
    await db
      .update(prodottiTable)
      .set({ nome: "Latte UHT" })
      .where(eq(prodottiTable.id, latteId));
    const latteLotId = await createLotto(scope, {
      prodottoId: latteId,
      magazzinoId,
      quantita: 44,
    });
    const bollaId = await insertBolla(scope, { beneficiarioId, magazzinoId });
    const [initial] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    const wrongUnit = await request(app).post(`/bolle/${bollaId}/righe`).send({
      prodottoId: latteId,
      quantita: "3",
      unitaMisura: "lt",
      versione: initial.versione,
      idempotencyKey: randomUUID(),
    });
    expect(wrongUnit.status).toBe(400);
    expect(wrongUnit.body.error).toContain("Catalogo");
    const added = await request(app).post(`/bolle/${bollaId}/righe`).send({
      prodottoId: latteId,
      quantita: "3",
      unitaMisura: "l",
      versione: initial.versione,
      idempotencyKey: randomUUID(),
    });
    expect(added.status, added.text).toBe(201);
    expect(added.body).toMatchObject({
      quantita: 3,
      unitaMisura: "l",
      lottoId: null,
    });
    const [savedRow] = await db
      .select()
      .from(bollaRigheTable)
      .where(eq(bollaRigheTable.id, added.body.id));
    expect(savedRow.unitaMisura).toBe("l");
    expect(Number(savedRow.quantita)).toBe(3);
    const confirmed = await request(app)
      .post(`/bolle/${bollaId}/conferma`)
      .send({
        versione: added.body.versioneBolla,
        idempotencyKey: randomUUID(),
      });
    expect(confirmed.status, confirmed.text).toBe(200);
    const reservations = await db
      .select()
      .from(prenotazioniMagazzinoTable)
      .where(eq(prenotazioniMagazzinoTable.bollaId, bollaId));
    expect(reservations).toHaveLength(1);
    expect(reservations[0].lottoId).toBe(latteLotId);

    const requiredId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    await db
      .update(prodottiTable)
      .set({ lottoFisicoObbligatorio: true })
      .where(eq(prodottiTable.id, requiredId));
    const requiredLotId = await createLotto(scope, {
      prodottoId: requiredId,
      magazzinoId,
      quantita: 10,
    });
    const requiredBollaId = await insertBolla(scope, {
      beneficiarioId,
      magazzinoId,
    });
    const [requiredBolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, requiredBollaId));
    const missingLot = await request(app)
      .post(`/bolle/${requiredBollaId}/righe`)
      .send({
        prodottoId: requiredId,
        quantita: "2",
        unitaMisura: "pz",
        versione: requiredBolla.versione,
        idempotencyKey: randomUUID(),
      });
    expect(missingLot.status).toBe(400);
    const withLot = await request(app)
      .post(`/bolle/${requiredBollaId}/righe`)
      .send({
        prodottoId: requiredId,
        lottoId: requiredLotId,
        quantita: "2",
        unitaMisura: "pz",
        versione: requiredBolla.versione,
        idempotencyKey: randomUUID(),
      });
    expect(withLot.status, withLot.text).toBe(201);
  });

  it("mostra solo la Bolla confermata e non associata; la lista Interventi espone lo stesso raccordo", async () => {
    const bozza = await linkedBolla();
    const pronta = await linkedBolla("confermato");
    const direttaId = await insertBolla(scope, { beneficiarioId, magazzinoId });
    const queue = await request(app).get("/consegne/da-pianificare");
    expect(queue.status, queue.text).toBe(200);
    expect(
      queue.body.some(
        (row: { bollaId: number }) => row.bollaId === bozza.bollaId,
      ),
    ).toBe(false);
    expect(
      queue.body.some(
        (row: { bollaId: number }) => row.bollaId === pronta.bollaId,
      ),
    ).toBe(true);
    const interventi = await request(app).get("/interventi?ambito=sociale");
    expect(interventi.status, interventi.text).toBe(200);
    expect(
      interventi.body.find(
        (row: { id: number }) => row.id === pronta.interventoId,
      )?.raccordoMagazzino?.bollaId,
    ).toBe(pronta.bollaId);
    const documenti = await request(app).get(
      "/documenti-operativi?tipoAggregato=bolla",
    );
    expect(documenti.status, documenti.text).toBe(200);
    expect(
      documenti.body.items.find(
        (row: { id: number }) => row.id === pronta.bollaId,
      )?.centroHandoff,
    ).toBe(true);
    expect(
      documenti.body.items.find((row: { id: number }) => row.id === direttaId)
        ?.centroHandoff,
    ).toBe(false);
  });

  it("la conversione logistica diretta M4 non bypassa l'handoff del Centro", async () => {
    const ready = await linkedBolla("confermato");
    await db
      .update(bolleTable)
      .set({ ritiroNonEffettuatoAt: new Date() })
      .where(eq(bolleTable.id, ready.bollaId));
    const denied = await request(app)
      .post(`/bolle/${ready.bollaId}/converti-consegna`)
      .send({
        indirizzoConsegna: "Via Test 2",
        dataPrevista: "2026-10-18",
        fasciaOraria: "Mattina",
      });
    expect(denied.status).toBe(409);
    expect(denied.body.error).toContain("Centro");
  });

  it("pianifica atomicamente una volta, serializza due operatori e il replay; completa stock/Richiesta senza Intervento duplicato", async () => {
    const ready = await linkedBolla("confermato");
    const payload = {
      versione: ready.versione,
      idempotencyKey: randomUUID(),
      tipoConsegna: "domicilio",
      dataPrevista: "2026-10-15",
      fasciaOraria: "Mattina",
      indirizzoConsegna: "Via Test 1",
    };
    const direct = await request(app)
      .post(`/bolle/${ready.bollaId}/consegna`)
      .send({
        versione: ready.versione,
        idempotencyKey: randomUUID(),
      });
    expect(direct.status).toBe(409);
    const competitorKey = randomUUID();
    const [first, competing] = await Promise.all([
      request(app).post(`/consegne/da-bolla/${ready.bollaId}`).send(payload),
      request(app)
        .post(`/consegne/da-bolla/${ready.bollaId}`)
        .send({
          ...payload,
          idempotencyKey: competitorKey,
        }),
    ]);
    expect([first.status, competing.status].sort()).toEqual([201, 409]);
    const created = first.status === 201 ? first : competing;
    expect(created.body.bollaId).toBe(ready.bollaId);
    const replay = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send({
        ...payload,
        idempotencyKey:
          created === first ? payload.idempotencyKey : competitorKey,
      });
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body.id).toBe(created.body.id);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, ready.bollaId));
    const queue = await request(app).get("/consegne/da-pianificare");
    expect(
      queue.body.some(
        (row: { bollaId: number }) => row.bollaId === ready.bollaId,
      ),
    ).toBe(false);
    const [before] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    const completeBody = {
      versione: bolla.versione,
      idempotencyKey: randomUUID(),
    };
    const completed = await request(app)
      .post(`/consegne/${created.body.id}/completa`)
      .send(completeBody);
    expect(completed.status, completed.text).toBe(200);
    expect(completed.body.stato).toBe("effettuata");
    const completedReplay = await request(app)
      .post(`/consegne/${created.body.id}/completa`)
      .send(completeBody);
    expect(completedReplay.status, completedReplay.text).toBe(200);
    const [after] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    expect(Number(before.quantitaResidua) - Number(after.quantitaResidua)).toBe(
      3,
    );
    const [closed] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
    expect(closed.stato).toBe("chiusa");
    const [deliveredBolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, ready.bollaId));
    expect(deliveredBolla.stato).toBe("consegnato");
    const [original] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, ready.interventoId));
    expect(original.stato).toBe("da_pianificare");
    expect(
      (
        await db
          .select()
          .from(interventiTable)
          .where(eq(interventiTable.bollaId, ready.bollaId))
      ).length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(movimentiTable)
          .where(
            and(
              eq(movimentiTable.bollaId, ready.bollaId),
              eq(movimentiTable.tipoMovimento, "scarico"),
              eq(movimentiTable.tipoDettaglio, "consegna_beneficiario"),
            ),
          )
      ).length,
    ).toBe(1);
    expect(
      (
        await db
          .select()
          .from(prenotazioniMagazzinoTable)
          .where(eq(prenotazioniMagazzinoTable.bollaId, ready.bollaId))
      ).every((row) => row.stato !== "attiva"),
    ).toBe(true);
    expect(
      (
        await db
          .select()
          .from(consegneTable)
          .where(eq(consegneTable.id, created.body.id))
      )[0].stato,
    ).toBe("effettuata");
  }, 60_000);

  it("R2: dry-run senza scritture, apply esplicito request-only, conflitto e replay senza doppio stock", async () => {
    const ready = await linkedBolla("confermato");
    const planned = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send({
        versione: ready.versione,
        idempotencyKey: randomUUID(),
        tipoConsegna: "domicilio",
        dataPrevista: "2026-10-15",
        fasciaOraria: "Mattina",
        indirizzoConsegna: "Via Test 1",
      });
    expect(planned.status, planned.text).toBe(201);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, ready.bollaId));
    const body = { versione: bolla.versione, idempotencyKey: randomUUID() };
    const complete = () =>
      request(app).post(`/consegne/${planned.body.id}/completa`).send(body);
    expect((await complete()).status).toBe(200);
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const name of [
        "lotti",
        "movimenti",
        "prenotazioni_magazzino",
        "operazioni_distribuzione_magazzino",
        "bolle",
        "consegne",
        "interventi",
      ]) {
        result[name] = (
          await db.execute(
            sql.raw(
              `select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'[]')) as hash from ${name} t`,
            ),
          )
        ).rows;
      }
      return result;
    };
    const stockBefore = await snapshot();
    // Represent an old terminal document whose request closure was not persisted.
    await db
      .update(richiesteMagazzinoTable)
      .set({ stato: "presa_in_carico" })
      .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
    const candidate = await db.transaction((tx) =>
      inspectRequestClosure(tx, ready.richiestaId),
    );
    expect(candidate.esito).toBe("candidata");
    const directory = await mkdtemp(join(tmpdir(), "m5c2a-r2-plan-"));
    const cli = promisify(execFile);
    const target = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    const args = [
      "./src/cli/reconcile-delivered-requests.ts",
      `--target=${target}`,
      `--ids=${ready.richiestaId}`,
    ];
    const env = { ...process.env, M5C2A_R2_DISPOSABLE_DB: "verified" };
    const run = (extra: string[] = []) =>
      cli("./node_modules/.bin/tsx", [...args, ...extra], { env });
    try {
      const before = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
      const plan = JSON.parse((await run()).stdout);
      expect(JSON.parse((await run()).stdout)).toEqual(plan);
      expect(
        await db
          .select()
          .from(richiesteMagazzinoTable)
          .where(eq(richiesteMagazzinoTable.id, ready.richiestaId)),
      ).toEqual(before);
      expect(await snapshot()).toEqual(stockBefore);
      const file = join(directory, "plan.json");
      await writeFile(file, JSON.stringify(plan), { mode: 0o600 });
      const apply = ["--apply", `--actor=${actorId}`, `--plan=${file}`];
      await db
        .update(richiesteMagazzinoTable)
        .set({ versione: before[0].versione + 1 })
        .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
      await expect(run(apply)).rejects.toThrow();
      await writeFile(file, (await run()).stdout, { mode: 0o600 });
      expect(JSON.parse((await run(apply)).stdout).cases[0].esito).toBe(
        "coerente",
      );
      expect(await closureAudit(ready.richiestaId)).toHaveLength(2);
      const closed = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
      await run(apply);
      expect(await closureAudit(ready.richiestaId)).toHaveLength(2);
      expect(
        await db
          .select()
          .from(richiesteMagazzinoTable)
          .where(eq(richiesteMagazzinoTable.id, ready.richiestaId)),
      ).toEqual(closed);
      expect(await snapshot()).toEqual(stockBefore);
      // Replay receipt must also repair a missing closure without rerunning M4.
      await db
        .update(richiesteMagazzinoTable)
        .set({ stato: "presa_in_carico" })
        .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
      expect((await complete()).status).toBe(200);
      const afterReplay = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
      expect(afterReplay[0].stato).toBe("chiusa");
      expect(await closureAudit(ready.richiestaId)).toHaveLength(2);
      expect((await complete()).status).toBe(200);
      expect(await closureAudit(ready.richiestaId)).toHaveLength(2);
      expect(
        await db
          .select()
          .from(richiesteMagazzinoTable)
          .where(eq(richiesteMagazzinoTable.id, ready.richiestaId)),
      ).toEqual(afterReplay);
      expect(await snapshot()).toEqual(stockBefore);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("R2: non propone una riconciliazione se l'Area della Richiesta non coincide con quella della Bolla", async () => {
    const ready = await linkedBolla("confermato");
    const planned = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send({
        versione: ready.versione,
        idempotencyKey: randomUUID(),
        tipoConsegna: "domicilio",
        dataPrevista: "2026-10-15",
        fasciaOraria: "Mattina",
        indirizzoConsegna: "Via Test 1",
      });
    expect(planned.status, planned.text).toBe(201);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, ready.bollaId));
    const completed = await request(app)
      .post(`/consegne/${planned.body.id}/completa`)
      .send({ versione: bolla.versione, idempotencyKey: randomUUID() });
    expect(completed.status, completed.text).toBe(200);
    await db
      .update(richiesteMagazzinoTable)
      .set({ stato: "presa_in_carico" })
      .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
    expect(
      (
        await db.transaction((tx) =>
          inspectRequestClosure(tx, ready.richiestaId),
        )
      ).esito,
    ).toBe("candidata");

    const unrelatedAreaId = await createAreaOperativa(scope);
    await db
      .update(richiesteMagazzinoTable)
      .set({ areaOperativaId: unrelatedAreaId })
      .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
    const mismatched = await db.transaction((tx) =>
      inspectRequestClosure(tx, ready.richiestaId),
    );
    expect(mismatched.esito).toBe("esclusa");
    expect(mismatched.motivo).toBe("area_incoerente");
    const [unchanged] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
    expect(unchanged.stato).toBe("presa_in_carico");
  });

  it("F1-T01: esclude una Bolla il cui Magazzino origine è passato a un'altra Area", async () => {
    const ready = await deliveredLegacyRequest();
    const unrelatedAreaId = await createAreaOperativa(scope);
    await db
      .update(magazziniTable)
      .set({ areaOperativaId: unrelatedAreaId })
      .where(eq(magazziniTable.id, magazzinoId));
    try {
      expect(await inspectClosure(ready.richiestaId)).toMatchObject({
        esito: "esclusa",
        motivo: "area_incoerente",
      });
      const [unchanged] = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
      expect(unchanged.stato).toBe("presa_in_carico");
    } finally {
      await db
        .update(magazziniTable)
        .set({ areaOperativaId: areaId })
        .where(eq(magazziniTable.id, magazzinoId));
    }
  });

  it("F1-T03: esclude un Centro diverso da quello del Beneficiario e della Bolla", async () => {
    const ready = await deliveredLegacyRequest();
    const otherCentreId = (
      await createCentroRec(scope, { areaOperativaId: areaId })
    ).id;
    await db
      .update(richiesteMagazzinoTable)
      .set({ centroAscoltoId: otherCentreId })
      .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
    expect(await inspectClosure(ready.richiestaId)).toMatchObject({
      esito: "esclusa",
      motivo: "centro_incoerente",
    });
  });

  it("F1-T04/T05: esclude destinatario differente e link non corrente", async () => {
    const ready = await deliveredLegacyRequest();
    const otherBeneficiaryId = await createBeneficiario(scope, centroId, {
      areaOperativaId: areaId,
    });
    await db
      .update(bolleTable)
      .set({ beneficiarioId: otherBeneficiaryId })
      .where(eq(bolleTable.id, ready.bollaId));
    expect(await inspectClosure(ready.richiestaId)).toMatchObject({
      esito: "esclusa",
      motivo: "destinatario_incoerente",
    });
    await db
      .update(bolleTable)
      .set({ beneficiarioId })
      .where(eq(bolleTable.id, ready.bollaId));
    await db
      .update(richiesteMagazzinoDocumentiTable)
      .set({
        corrente: false,
        cessatoDa: actorId,
        cessatoAt: new Date(),
        eventoCessazione: "annullamento_m4",
        motivoCessazione: "Fixture storica F1",
      })
      .where(
        eq(richiesteMagazzinoDocumentiTable.richiestaId, ready.richiestaId),
      );
    expect(await inspectClosure(ready.richiestaId)).toMatchObject({
      esito: "esclusa",
      motivo: "documento_corrente_assente_o_ambiguo",
    });
  });

  it("F1-T06/T07: non promuove stati M4 non terminali né una Richiesta già chiusa", async () => {
    const ready = await deliveredLegacyRequest();
    for (const stato of [
      "bozza",
      "confermato",
      "annullato",
      "in_trasporto",
      "rientro_atteso",
      "rientrato",
    ]) {
      await db
        .update(bolleTable)
        .set({ stato })
        .where(eq(bolleTable.id, ready.bollaId));
      expect(await inspectClosure(ready.richiestaId)).toMatchObject({
        esito: "esclusa",
        motivo: "documento_non_consegnato",
      });
    }
    await db
      .update(bolleTable)
      .set({ stato: "consegnato" })
      .where(eq(bolleTable.id, ready.bollaId));
    await db
      .update(richiesteMagazzinoTable)
      .set({ stato: "chiusa" })
      .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
    expect(await inspectClosure(ready.richiestaId)).toMatchObject({
      esito: "coerente",
      motivo: "consegna_documentata",
    });
  });

  it("F1-T08: apply rifiuta un piano divenuto territorialmente incoerente anche per un admin globale", async () => {
    const ready = await deliveredLegacyRequest();
    const target = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    const args = [
      "./src/cli/reconcile-delivered-requests.ts",
      `--target=${target}`,
      `--ids=${ready.richiestaId}`,
    ];
    const env = { ...process.env, M5C2A_R2_DISPOSABLE_DB: "verified" };
    const cli = promisify(execFile);
    const run = (extra: string[] = []) =>
      cli("./node_modules/.bin/tsx", [...args, ...extra], { env });
    const plan = JSON.parse((await run()).stdout);
    expect(plan.cases[0].esito).toBe("candidata");
    const adminId = await createUtente(scope);
    const unrelatedAreaId = await createAreaOperativa(scope);
    const directory = await mkdtemp(join(tmpdir(), "m5c2a-r2-f1-plan-"));
    try {
      const planFile = join(directory, "plan.json");
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 });
      await db
        .update(richiesteMagazzinoTable)
        .set({ areaOperativaId: unrelatedAreaId })
        .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
      await expect(
        run(["--apply", `--actor=${adminId}`, `--plan=${planFile}`]),
      ).rejects.toThrow();
      const [after] = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, ready.richiestaId));
      expect(after.stato).toBe("presa_in_carico");
      expect(await closureAudit(ready.richiestaId)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("annullando la Consegna, la Bolla ritorna pianificabile ma il vecchio replay non restituisce una Consegna eliminata", async () => {
    const ready = await linkedBolla("confermato");
    const payload = {
      versione: ready.versione,
      idempotencyKey: randomUUID(),
      tipoConsegna: "in_sede",
      dataPrevista: "2026-10-16",
      fasciaOraria: "Pomeriggio",
    };
    const planned = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send(payload);
    expect(planned.status, planned.text).toBe(201);
    const visibleFromBolla = await request(app).get(`/bolle/${ready.bollaId}`);
    expect(visibleFromBolla.status, visibleFromBolla.text).toBe(200);
    expect(visibleFromBolla.body).toMatchObject({
      consegnaDataPrevista: "2026-10-16",
      consegnaFasciaOraria: "Pomeriggio",
    });
    const cancelled = await request(app).delete(`/consegne/${planned.body.id}`);
    expect(cancelled.status, cancelled.text).toBe(204);
    const queue = await request(app).get("/consegne/da-pianificare");
    expect(
      queue.body.some(
        (row: { bollaId: number }) => row.bollaId === ready.bollaId,
      ),
    ).toBe(true);
    const oldReplay = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send(payload);
    expect(oldReplay.status).toBe(409);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, ready.bollaId));
    const replanned = await request(app)
      .post(`/consegne/da-bolla/${ready.bollaId}`)
      .send({
        ...payload,
        versione: bolla.versione,
        idempotencyKey: randomUUID(),
      });
    expect(replanned.status, replanned.text).toBe(201);
    expect(replanned.body.id).not.toBe(planned.body.id);
  });

  it("revoca Centro/Area: la coda e la pianificazione non ampliano il perimetro della sessione esistente", async () => {
    const ready = await linkedBolla("confermato");
    const payload = {
      versione: ready.versione,
      idempotencyKey: randomUUID(),
      tipoConsegna: "in_sede",
      dataPrevista: "2026-10-17",
      fasciaOraria: "Mattina",
    };
    await db
      .update(utentiTable)
      .set({ centroAscoltoId: null, areaOperativaId: null })
      .where(eq(utentiTable.id, actorId));
    try {
      const queue = await request(app).get("/consegne/da-pianificare");
      expect(queue.status, queue.text).toBe(200);
      expect(
        queue.body.some(
          (row: { bollaId: number }) => row.bollaId === ready.bollaId,
        ),
      ).toBe(false);
      const denied = await request(app)
        .post(`/consegne/da-bolla/${ready.bollaId}`)
        .send(payload);
      expect(denied.status).toBe(404);
    } finally {
      await db
        .update(utentiTable)
        .set({ centroAscoltoId: centroId, areaOperativaId: areaId })
        .where(eq(utentiTable.id, actorId));
    }
  });
});
