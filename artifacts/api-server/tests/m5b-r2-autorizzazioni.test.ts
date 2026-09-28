/* @vitest-environment node */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import {
  areeOperativeTable,
  centriAscoltoTable,
  db,
  entiDestinatariTable,
  pool,
  richiesteMagazzinoTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createMagazzino,
  createLotto,
  createProdotto,
  createUtente,
  newScope,
} from "./scope-helpers";

const scope = newScope();
const suffix = randomUUID().slice(0, 8);
const password = `R2-${randomUUID()}-only`;
const grants = [
  "richieste_magazzino.view",
  "richieste_magazzino.create",
  "richieste_magazzino.take",
  "richieste_magazzino.prepare",
  "richieste_magazzino.cancel",
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "bolle.cancel",
  "magazzino.view",
  "magazzino.transfers.create",
  "magazzino.transfers.prepare",
  "magazzino.transfers.cancel",
];
let app: (typeof import("../src/app"))["default"];
let areaA: number;
let areaB: number;
let centreA1: number;
let centreA2: number;
let centreB: number;
let beneficiaryA1: number;
let beneficiaryA2: number;
let beneficiaryB: number;
let originA1: number;
let originA2: number;
let originB: number;
let destinationA: number;
let productId: number;
let operatorId: number;
let roleId: number;

async function login(userId = operatorId) {
  const [user] = await db
    .select({ username: utentiTable.username })
    .from(utentiTable)
    .where(eq(utentiTable.id, userId));
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/login")
    .send({ username: user.username, password });
  expect(response.status, response.text).toBe(200);
  return agent;
}

async function fixture(
  kind: "beneficiario" | "magazzino" | "ente" = "beneficiario",
  location: "A1" | "A2" | "B" = "A1",
) {
  const area = location === "B" ? areaB : areaA;
  const centre =
    location === "B" ? centreB : location === "A2" ? centreA2 : centreA1;
  const beneficiary =
    location === "B"
      ? beneficiaryB
      : location === "A2"
        ? beneficiaryA2
        : beneficiaryA1;
  const [entity] =
    kind === "ente"
      ? await db
          .insert(entiDestinatariTable)
          .values({
            denominazione: `Ente R2 ${randomUUID().slice(0, 8)}`,
            indirizzo: "Via sintetica 1",
            areaOperativaId: area,
          })
          .returning()
      : [null];
  const [row] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `RM-R2-${randomUUID().slice(0, 8)}`,
      tipoDestinatario: kind,
      beneficiarioId: kind === "beneficiario" ? beneficiary : null,
      enteDestinatarioId: entity?.id ?? null,
      magazzinoDestinatarioId: kind === "magazzino" ? destinationA : null,
      areaOperativaId: area,
      centroAscoltoId: kind === "beneficiario" ? centre : null,
      sorgente: kind === "beneficiario" ? "beneficiario" : "operativa",
      destinatarioNomeSnapshot: "Destinatario sintetico R2",
      areaNomeSnapshot: "Area A sintetica",
      centroNomeSnapshot:
        kind === "beneficiario" ? "Centro A1 sintetico" : null,
      bisogno: "R2 prova revoca",
      stato: "presa_in_carico",
      inviatoDa: operatorId,
      presoInCaricoDa: operatorId,
      presoInCaricoCodiceSnapshot: `r2-${suffix}`,
      presoInCaricoAt: new Date(),
    })
    .returning();
  return row;
}

async function requestDigest(id: number) {
  const result = await pool.query<{ digest: string }>(
    `SELECT md5(jsonb_build_object(
      'richiesta', (SELECT to_jsonb(r) FROM richieste_magazzino r WHERE r.id=$1),
      'relazioni', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb)
        FROM richieste_magazzino_documenti l WHERE l.richiesta_id=$1),
      'bolle', (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]'::jsonb)
        FROM bolle b JOIN richieste_magazzino_documenti l ON l.bolla_id=b.id WHERE l.richiesta_id=$1),
      'righe', (SELECT coalesce(jsonb_agg(to_jsonb(br) ORDER BY br.id),'[]'::jsonb)
        FROM bolla_righe br JOIN richieste_magazzino_documenti l ON l.bolla_id=br.bolla_id WHERE l.richiesta_id=$1),
      'trasferimenti', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb)
        FROM trasferimenti t JOIN richieste_magazzino_documenti l ON l.trasferimento_id=t.id WHERE l.richiesta_id=$1),
      'prenotazioni', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)
        FROM prenotazioni_magazzino p JOIN richieste_magazzino_documenti l ON l.bolla_id=p.bolla_id WHERE l.richiesta_id=$1),
      'delega', (SELECT coalesce(jsonb_agg(to_jsonb(im) ORDER BY im.id),'[]'::jsonb)
        FROM interventi_materiali im WHERE im.intervento_id=(SELECT intervento_id FROM richieste_magazzino WHERE id=$1)),
      'movimenti', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb)
        FROM movimenti m WHERE m.bolla_id IN (SELECT bolla_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1)
          OR m.trasferimento_id IN (SELECT trasferimento_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1)),
      'stock', (SELECT coalesce(jsonb_agg(to_jsonb(lo) ORDER BY lo.id),'[]'::jsonb)
        FROM lotti lo WHERE lo.magazzino_id IN (
          SELECT b.magazzino_id FROM bolle b JOIN richieste_magazzino_documenti d ON d.bolla_id=b.id WHERE d.richiesta_id=$1
          UNION SELECT t.magazzino_origine_id FROM trasferimenti t JOIN richieste_magazzino_documenti d ON d.trasferimento_id=t.id WHERE d.richiesta_id=$1
          UNION SELECT t.magazzino_destino_id FROM trasferimenti t JOIN richieste_magazzino_documenti d ON d.trasferimento_id=t.id WHERE d.richiesta_id=$1)),
      'audit', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)
        FROM audit_eventi a WHERE a.entita_tipo='richiesta_magazzino' AND a.entita_id=$1),
      'audit_m4', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)
        FROM audit_eventi a WHERE
          (a.entita_tipo='bolla' AND a.entita_id IN (SELECT bolla_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1))
          OR (a.entita_tipo='trasferimento' AND a.entita_id IN (SELECT trasferimento_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1))),
      'ricevute', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb)
        FROM comandi_operativi c WHERE c.aggregato_tipo='richiesta_magazzino' AND c.aggregato_id=$1),
      'ricevute_m4', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb)
        FROM comandi_operativi c WHERE
          (c.aggregato_tipo='bolla' AND c.aggregato_id IN (SELECT bolla_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1))
          OR (c.aggregato_tipo='trasferimento' AND c.aggregato_id IN (SELECT trasferimento_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1)))
    )::text) AS digest`,
    [id],
  );
  return result.rows[0].digest;
}

async function waitForLock(queryPart: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM pg_stat_activity
       WHERE datname=current_database() AND wait_event_type='Lock'
         AND query ILIKE $1`,
      [`%${queryPart}%`],
    );
    if (result.rows[0].count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Barriera PostgreSQL non osservata: ${queryPart}`);
}

beforeAll(async () => {
  if (process.env.M5B_TEST_DISPOSABLE_DB !== "verified")
    throw new Error("R2 requires verified disposable PostgreSQL");
  app = (await import("../src/app")).default;
  areaA = await createAreaOperativa(scope);
  areaB = await createAreaOperativa(scope);
  centreA1 = (await createCentroRec(scope, { areaOperativaId: areaA })).id;
  centreA2 = (await createCentroRec(scope, { areaOperativaId: areaA })).id;
  centreB = (await createCentroRec(scope, { areaOperativaId: areaB })).id;
  beneficiaryA1 = await createBeneficiario(scope, centreA1, {
    areaOperativaId: areaA,
  });
  beneficiaryA2 = await createBeneficiario(scope, centreA2, {
    areaOperativaId: areaA,
  });
  beneficiaryB = await createBeneficiario(scope, centreB, {
    areaOperativaId: areaB,
  });
  originA1 = await createMagazzino(scope, centreA1, {
    areaOperativaId: areaA,
  });
  originA2 = await createMagazzino(scope, centreA2, {
    areaOperativaId: areaA,
  });
  originB = await createMagazzino(scope, centreB, {
    areaOperativaId: areaB,
  });
  destinationA = await createMagazzino(scope, null, {
    areaOperativaId: areaA,
  });
  productId = await createProdotto(scope, {
    unitaMisura: "pz",
    quantitaFrazionabile: false,
  });
  const [role] = await db
    .insert(ruoliTable)
    .values({ nome: `M5B-R2 ${suffix}`, aree: ["magazzino"], permessi: grants })
    .returning({ id: ruoliTable.id });
  roleId = role.id;
  operatorId = await createUtente(scope, {
    ruoloId: roleId,
    centroId: centreA1,
  });
  await db
    .update(utentiTable)
    .set({
      areaOperativaId: areaA,
      passwordHash: await bcrypt.hash(password, 4),
      mustChangePassword: false,
    })
    .where(eq(utentiTable.id, operatorId));
});

afterAll(async () => {
  await pool.end();
});

describe("M5B-R2 — autorizzazione territoriale con sessione reale", () => {
  it("R2-01..06: revoca committata nega stessa/nuova sessione, liste, storia, replay e M4 diretto senza effetti", async () => {
    const agent = await login();
    const row = await fixture();
    const pending = await fixture();
    const key = randomUUID();
    const payload = { idempotencyKey: key, versione: 1, magazzinoId: originA1 };
    const created = await agent
      .post(`/api/richieste-magazzino/${row.id}/documento`)
      .send(payload);
    expect(created.status, created.text).toBe(201);
    const documentId = created.body.documentoId as number;
    expect((await agent.get(`/api/bolle/${documentId}`)).status).toBe(200);
    const before = await Promise.all([
      requestDigest(row.id),
      requestDigest(pending.id),
    ]);
    const requestCountBefore = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM richieste_magazzino",
    );
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, operatorId));
    try {
      const me = await agent.get("/api/auth/me");
      expect(me.status).toBe(200);
      expect(me.body.user ?? me.body).toMatchObject({
        areaOperativaId: null,
        centroAscoltoId: null,
        isAdmin: false,
      });
      const deniedUrls = [
        `/api/richieste-magazzino/${row.id}`,
        `/api/richieste-magazzino/${row.id}/storico`,
        `/api/richieste-magazzino/${row.id}/documenti`,
        `/api/bolle/${documentId}`,
        `/api/bolle/${documentId}/righe`,
        `/api/documenti-operativi/bolla/${documentId}`,
        `/api/documenti-operativi/bolla/${documentId}/richiesta`,
      ];
      for (const url of deniedUrls) {
        const response = await agent.get(url);
        expect([403, 404], `${url}: ${response.text}`).toContain(
          response.status,
        );
      }
      const requestList = await agent.get("/api/richieste-magazzino");
      expect(requestList.status, requestList.text).toBe(200);
      expect(requestList.body.total).toBe(0);
      const search = await agent
        .get("/api/richieste-magazzino")
        .query({ ricerca: row.codice });
      expect(search.body.total).toBe(0);
      const bollaList = await agent.get("/api/bolle");
      expect(bollaList.status, bollaList.text).toBe(200);
      expect(bollaList.body).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: documentId })]),
      );
      const documentsList = await agent.get("/api/documenti-operativi");
      expect(documentsList.status, documentsList.text).toBe(200);
      expect(documentsList.body.items).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ documentoId: `bolla:${documentId}` }),
        ]),
      );
      const exportResponse = await agent.get(
        "/api/documenti-operativi/export.xlsx",
      );
      expect(exportResponse.status).toBe(200);
      const workbook = XLSX.read(exportResponse.body, { type: "buffer" });
      const cells = XLSX.utils.sheet_to_json<string[]>(
        workbook.Sheets[workbook.SheetNames[0]],
        { header: 1 },
      );
      expect(JSON.stringify(cells)).not.toContain(created.body.codiceDocumento);
      const replay = await agent
        .post(`/api/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect([403, 404], replay.text).toContain(replay.status);
      const fresh = await agent
        .post(`/api/richieste-magazzino/${pending.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione: 1,
          magazzinoId: originA1,
        });
      expect([403, 404], fresh.text).toContain(fresh.status);
      const newRequest = await agent.post("/api/richieste-magazzino").send({
        idempotencyKey: randomUUID(),
        tipoDestinatario: "magazzino",
        sorgente: "operativa",
        magazzinoDestinatarioId: destinationA,
        areaOperativaId: areaA,
        bisogno: "R2 create denied",
      });
      expect(newRequest.status, newRequest.text).toBe(403);
      for (const [method, path, body] of [
        [
          "patch",
          `/api/richieste-magazzino/${pending.id}`,
          { noteOperative: "R2 denied" },
        ],
        ["post", `/api/richieste-magazzino/${pending.id}/presa-in-carico`, {}],
        [
          "post",
          `/api/richieste-magazzino/${pending.id}/annulla`,
          { motivo: "R2 denied" },
        ],
      ] as const) {
        const response = await agent[method](path).send({
          idempotencyKey: randomUUID(),
          versione: 1,
          ...body,
        });
        expect([403, 404], `${path}: ${response.text}`).toContain(
          response.status,
        );
      }
      const direct = await agent.post(`/api/bolle/${documentId}/annulla`).send({
        idempotencyKey: randomUUID(),
        versione: 1,
        motivo: "R2 denied",
      });
      expect([403, 404], direct.text).toContain(direct.status);
      const composition = await agent
        .post(`/api/bolle/${documentId}/righe`)
        .send({
          idempotencyKey: randomUUID(),
          versione: 1,
          prodottoId: productId,
          quantita: "1",
        });
      expect([403, 404], composition.text).toContain(composition.status);
      const preparation = await agent
        .post(`/api/bolle/${documentId}/conferma`)
        .send({
          idempotencyKey: randomUUID(),
          versione: 1,
        });
      expect([403, 404], preparation.text).toContain(preparation.status);
      const newAgent = await login();
      expect(
        (await newAgent.get(`/api/richieste-magazzino/${row.id}`)).status,
      ).toBe(404);
      expect(
        (
          await newAgent
            .post(`/api/richieste-magazzino/${pending.id}/documento`)
            .send({
              idempotencyKey: randomUUID(),
              versione: 1,
              magazzinoId: originA1,
            })
        ).status,
      ).toBe(404);
      expect(
        await Promise.all([requestDigest(row.id), requestDigest(pending.id)]),
      ).toEqual(before);
      expect(
        (
          await pool.query<{ count: number }>(
            "SELECT count(*)::integer AS count FROM richieste_magazzino",
          )
        ).rows[0].count,
      ).toBe(requestCountBefore.rows[0].count);
    } finally {
      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaA, centroAscoltoId: centreA1 })
        .where(eq(utentiTable.id, operatorId));
    }
  }, 30_000);

  it("R2-07/R2-16: Bolla Ente e Trasferimento collegati non aggirano la revoca; Centro NULL è solo della risorsa operativa", async () => {
    const agent = await login();
    const ente = await fixture("ente");
    const transfer = await fixture("magazzino");
    const otherCentre = await fixture("beneficiario", "A2");
    expect(
      (await agent.get(`/api/richieste-magazzino/${otherCentre.id}`)).status,
    ).toBe(404);
    expect(
      (await agent.get(`/api/richieste-magazzino/${transfer.id}`)).status,
    ).toBe(200);
    const enteDocument = await agent
      .post(`/api/richieste-magazzino/${ente.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originA1,
      });
    expect(enteDocument.status, enteDocument.text).toBe(201);
    const transferDocument = await agent
      .post(`/api/richieste-magazzino/${transfer.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originA1,
        righe: [{ prodottoId: productId, quantita: "1", unitaMisura: "pz" }],
      });
    expect(transferDocument.status, transferDocument.text).toBe(201);
    const before = await Promise.all([
      requestDigest(ente.id),
      requestDigest(transfer.id),
    ]);
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, operatorId));
    try {
      for (const url of [
        `/api/richieste-magazzino/${ente.id}`,
        `/api/richieste-magazzino/${transfer.id}`,
        `/api/bolle/${enteDocument.body.documentoId}`,
        `/api/trasferimenti/${transferDocument.body.documentoId}`,
        `/api/trasferimenti/${transferDocument.body.documentoId}/documento`,
        `/api/documenti-operativi/trasferimento/${transferDocument.body.documentoId}`,
      ]) {
        const response = await agent.get(url);
        expect([403, 404], `${url}: ${response.text}`).toContain(
          response.status,
        );
      }
      const transferList = await agent.get("/api/trasferimenti");
      expect(transferList.status, transferList.text).toBe(200);
      expect(transferList.body).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: transferDocument.body.documentoId }),
        ]),
      );
      const direct = await agent
        .post(`/api/trasferimenti/${transferDocument.body.documentoId}/annulla`)
        .send({
          idempotencyKey: randomUUID(),
          versione: 1,
          motivo: "R2 denied",
        });
      expect([403, 404], direct.text).toContain(direct.status);
      const preparation = await agent
        .post(`/api/trasferimenti/${transferDocument.body.documentoId}/prepara`)
        .send({ idempotencyKey: randomUUID(), versione: 1 });
      expect([403, 404], preparation.text).toContain(preparation.status);
      expect(
        await Promise.all([requestDigest(ente.id), requestDigest(transfer.id)]),
      ).toEqual(before);
    } finally {
      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaA, centroAscoltoId: centreA1 })
        .where(eq(utentiTable.id, operatorId));
    }
  }, 30_000);

  it("R2-08..13: Centro, Area, admin scoped, admin globale e Centro senza Area seguono assegnazioni correnti", async () => {
    const rowA1 = await fixture("beneficiario", "A1");
    const rowA2 = await fixture("beneficiario", "A2");
    const rowB = await fixture("beneficiario", "B");
    const centreAgent = await login();
    expect(
      (await centreAgent.get(`/api/richieste-magazzino/${rowA1.id}`)).status,
    ).toBe(200);
    expect(
      (await centreAgent.get(`/api/richieste-magazzino/${rowA2.id}`)).status,
    ).toBe(404);
    expect(
      (await centreAgent.get(`/api/richieste-magazzino/${rowB.id}`)).status,
    ).toBe(404);
    await db
      .update(utentiTable)
      .set({ centroAscoltoId: null })
      .where(eq(utentiTable.id, operatorId));
    try {
      expect(
        (await centreAgent.get(`/api/richieste-magazzino/${rowA2.id}`)).status,
      ).toBe(200);
      expect(
        (await centreAgent.get(`/api/richieste-magazzino/${rowB.id}`)).status,
      ).toBe(404);
      const areaDocument = await centreAgent
        .post(`/api/richieste-magazzino/${rowA2.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione: 1,
          magazzinoId: originA2,
        });
      expect(areaDocument.status, areaDocument.text).toBe(201);
      await db
        .update(utentiTable)
        .set({ areaOperativaId: null, centroAscoltoId: centreA1 })
        .where(eq(utentiTable.id, operatorId));
      expect(
        (await centreAgent.get(`/api/richieste-magazzino/${rowA1.id}`)).status,
      ).toBe(404);
      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaA, centroAscoltoId: centreB })
        .where(eq(utentiTable.id, operatorId));
      expect(
        (await centreAgent.get(`/api/richieste-magazzino/${rowA1.id}`)).status,
      ).toBe(404);
      expect(
        (await centreAgent.get(`/api/richieste-magazzino/${rowB.id}`)).status,
      ).toBe(404);
      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaB, centroAscoltoId: centreB })
        .where(eq(utentiTable.id, operatorId));
      expect(
        (await centreAgent.get(`/api/richieste-magazzino/${rowA1.id}`)).status,
      ).toBe(404);
      expect(
        (await centreAgent.get(`/api/richieste-magazzino/${rowB.id}`)).status,
      ).toBe(200);
    } finally {
      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaA, centroAscoltoId: centreA1 })
        .where(eq(utentiTable.id, operatorId));
    }
    const [adminRole] = await db
      .insert(ruoliTable)
      .values({
        nome: `M5B-R2 admin ${suffix}`,
        aree: ["magazzino"],
        permessi: grants,
        isAdmin: true,
      })
      .returning({ id: ruoliTable.id });
    const adminId = await createUtente(scope, {
      ruoloId: adminRole.id,
      centroId: centreA1,
    });
    await db
      .update(utentiTable)
      .set({
        areaOperativaId: areaA,
        passwordHash: await bcrypt.hash(password, 4),
        mustChangePassword: false,
      })
      .where(eq(utentiTable.id, adminId));
    const admin = await login(adminId);
    expect(
      (await admin.get(`/api/richieste-magazzino/${rowA1.id}`)).status,
    ).toBe(200);
    expect(
      (await admin.get(`/api/richieste-magazzino/${rowA2.id}`)).status,
    ).toBe(404);
    expect(
      (await admin.get(`/api/richieste-magazzino/${rowB.id}`)).status,
    ).toBe(404);
    const scopedDenied = await admin
      .post(`/api/richieste-magazzino/${rowB.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originB,
      });
    expect([403, 404], scopedDenied.text).toContain(scopedDenied.status);
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, adminId));
    expect(
      (await admin.get(`/api/richieste-magazzino/${rowB.id}`)).status,
    ).toBe(200);
    const globalCreated = await admin
      .post(`/api/richieste-magazzino/${rowB.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originB,
      });
    expect(globalCreated.status, globalCreated.text).toBe(201);
  }, 30_000);

  it("R2-14: revoca grant, area applicativa, ruolo e utente inattivo sono controllati alla lettura", async () => {
    const row = await fixture();
    const agent = await login();
    expect((await agent.get(`/api/richieste-magazzino/${row.id}`)).status).toBe(
      200,
    );
    try {
      await db
        .update(ruoliTable)
        .set({
          permessi: grants.filter((g) => g !== "richieste_magazzino.view"),
        })
        .where(eq(ruoliTable.id, roleId));
      expect(
        (await agent.get(`/api/richieste-magazzino/${row.id}`)).status,
      ).toBe(403);
      await db
        .update(ruoliTable)
        .set({ permessi: grants, aree: [] })
        .where(eq(ruoliTable.id, roleId));
      expect([403, 404]).toContain(
        (await agent.get(`/api/richieste-magazzino/${row.id}`)).status,
      );
      await db
        .update(ruoliTable)
        .set({ aree: ["magazzino", "sociale"] })
        .where(eq(ruoliTable.id, roleId));
      await db
        .update(utentiTable)
        .set({ areaOperativaId: null, centroAscoltoId: null })
        .where(eq(utentiTable.id, operatorId));
      expect(
        (await agent.get(`/api/richieste-magazzino/${row.id}`)).status,
      ).toBe(404);
      expect((await agent.get("/api/richieste-magazzino")).body.total).toBe(0);
      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaA, centroAscoltoId: centreA1 })
        .where(eq(utentiTable.id, operatorId));
      await db
        .update(ruoliTable)
        .set({ aree: ["magazzino"] })
        .where(eq(ruoliTable.id, roleId));
      await db
        .update(utentiTable)
        .set({ ruoloId: null })
        .where(eq(utentiTable.id, operatorId));
      expect(
        (await agent.get(`/api/richieste-magazzino/${row.id}`)).status,
      ).toBe(403);
      await db
        .update(utentiTable)
        .set({ ruoloId: roleId, attivo: false })
        .where(eq(utentiTable.id, operatorId));
      expect(
        (await agent.get(`/api/richieste-magazzino/${row.id}`)).status,
      ).toBe(401);
    } finally {
      await db
        .update(ruoliTable)
        .set({ permessi: grants, aree: ["magazzino"] })
        .where(eq(ruoliTable.id, roleId));
      await db
        .update(utentiTable)
        .set({
          ruoloId: roleId,
          attivo: true,
          areaOperativaId: areaA,
          centroAscoltoId: centreA1,
        })
        .where(eq(utentiTable.id, operatorId));
    }
  }, 30_000);

  it("R2-CUSTOM: ruolo custom/misto non eredita prepare o M4 e la stessa sessione vede le revoche", async () => {
    const [customRole] = await db
      .insert(ruoliTable)
      .values({
        nome: `M5B-R2 custom ${randomUUID().slice(0, 8)}`,
        aree: ["magazzino"],
        permessi: grants.filter(
          (grant) => grant !== "richieste_magazzino.prepare",
        ),
        isAdmin: false,
      })
      .returning({ id: ruoliTable.id });
    const customId = await createUtente(scope, {
      ruoloId: customRole.id,
      centroId: centreA1,
    });
    await db
      .update(utentiTable)
      .set({
        areaOperativaId: areaA,
        passwordHash: await bcrypt.hash(password, 4),
        mustChangePassword: false,
      })
      .where(eq(utentiTable.id, customId));
    const custom = await login(customId);
    const first = await fixture();
    expect(
      (await custom.get(`/api/richieste-magazzino/${first.id}`)).status,
    ).toBe(200);
    const beforePrepare = await requestDigest(first.id);
    const prepareDenied = await custom
      .post(`/api/richieste-magazzino/${first.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: first.versione,
        magazzinoId: originA1,
      });
    expect(prepareDenied.status).toBe(403);
    expect(await requestDigest(first.id)).toBe(beforePrepare);

    await db
      .update(ruoliTable)
      .set({ permessi: grants })
      .where(eq(ruoliTable.id, customRole.id));
    const prepared = await custom
      .post(`/api/richieste-magazzino/${first.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: first.versione,
        magazzinoId: originA1,
      });
    expect(prepared.status, prepared.text).toBe(201);

    const second = await fixture();
    const beforeM4Grant = await requestDigest(second.id);
    await db
      .update(ruoliTable)
      .set({ permessi: grants.filter((grant) => grant !== "bolle.manage") })
      .where(eq(ruoliTable.id, customRole.id));
    const m4Denied = await custom
      .post(`/api/richieste-magazzino/${second.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: second.versione,
        magazzinoId: originA1,
      });
    expect(m4Denied.status).toBe(403);
    expect(await requestDigest(second.id)).toBe(beforeM4Grant);

    await db
      .update(ruoliTable)
      .set({ aree: ["magazzino", "sociale"], permessi: grants })
      .where(eq(ruoliTable.id, customRole.id));
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, customId));
    expect(
      (await custom.get(`/api/richieste-magazzino/${first.id}`)).status,
    ).toBe(404);
    expect((await custom.get("/api/richieste-magazzino")).body.total).toBe(0);
  }, 30_000);

  it("R2-12: assegnazioni ad Area o Centro inattivi non riaprono la richiesta", async () => {
    const row = await fixture();
    const agent = await login();
    expect((await agent.get(`/api/richieste-magazzino/${row.id}`)).status).toBe(
      200,
    );
    try {
      await db
        .update(centriAscoltoTable)
        .set({ attivo: false })
        .where(eq(centriAscoltoTable.id, centreA1));
      expect([403, 404]).toContain(
        (await agent.get(`/api/richieste-magazzino/${row.id}`)).status,
      );
      expect((await agent.get("/api/richieste-magazzino")).body.total).toBe(0);
      const deniedCentre = await agent
        .post(`/api/richieste-magazzino/${row.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione: 1,
          magazzinoId: originA1,
        });
      expect([403, 404], deniedCentre.text).toContain(deniedCentre.status);
      await db
        .update(centriAscoltoTable)
        .set({ attivo: true })
        .where(eq(centriAscoltoTable.id, centreA1));
      await db
        .update(areeOperativeTable)
        .set({ attivo: false })
        .where(eq(areeOperativeTable.id, areaA));
      expect([403, 404]).toContain(
        (await agent.get(`/api/richieste-magazzino/${row.id}`)).status,
      );
      const deniedArea = await agent
        .post(`/api/richieste-magazzino/${row.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione: 1,
          magazzinoId: originA1,
        });
      expect([403, 404], deniedArea.text).toContain(deniedArea.status);
    } finally {
      await db
        .update(areeOperativeTable)
        .set({ attivo: true })
        .where(eq(areeOperativeTable.id, areaA));
      await db
        .update(centriAscoltoTable)
        .set({ attivo: true })
        .where(eq(centriAscoltoTable.id, centreA1));
    }
  }, 30_000);

  it("R2-15: comando prima della revoca e revoca rollbackata hanno un ordine PostgreSQL osservabile", async () => {
    const agent = await login();
    const first = await fixture();
    const firstPayload = {
      idempotencyKey: randomUUID(),
      versione: 1,
      magazzinoId: originA1,
    };
    const blocker = await pool.connect();
    const revoker = await pool.connect();
    let blockerOpen = false;
    try {
      await blocker.query("BEGIN");
      blockerOpen = true;
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('m5b.richiesta'), $1)",
        [first.id],
      );
      const command = Promise.resolve(
        agent
          .post(`/api/richieste-magazzino/${first.id}/documento`)
          .send(firstPayload),
      );
      await waitForLock("m5b.richiesta");
      const revoke = revoker.query(
        "UPDATE utenti SET area_operativa_id=NULL, centro_ascolto_id=NULL WHERE id=$1",
        [operatorId],
      );
      await waitForLock("UPDATE utenti SET area_operativa_id");
      await blocker.query("COMMIT");
      blockerOpen = false;
      const created = await command;
      expect(created.status, created.text).toBe(201);
      await revoke;
      const beforeReplay = await requestDigest(first.id);
      const replay = await agent
        .post(`/api/richieste-magazzino/${first.id}/documento`)
        .send(firstPayload);
      expect([403, 404], replay.text).toContain(replay.status);
      expect(await requestDigest(first.id)).toBe(beforeReplay);

      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaA, centroAscoltoId: centreA1 })
        .where(eq(utentiTable.id, operatorId));
      const second = await fixture();
      await revoker.query("BEGIN");
      await revoker.query(
        "UPDATE utenti SET area_operativa_id=NULL, centro_ascolto_id=NULL WHERE id=$1",
        [operatorId],
      );
      const secondCommand = Promise.resolve(
        agent.post(`/api/richieste-magazzino/${second.id}/documento`).send({
          idempotencyKey: randomUUID(),
          versione: 1,
          magazzinoId: originA1,
        }),
      );
      await waitForLock('FROM "utenti"');
      await revoker.query("ROLLBACK");
      const afterRollback = await secondCommand;
      expect(afterRollback.status, afterRollback.text).toBe(201);
      const me = await agent.get("/api/auth/me");
      expect(me.body.user ?? me.body).toMatchObject({
        areaOperativaId: areaA,
        centroAscoltoId: centreA1,
      });
    } finally {
      if (blockerOpen) await blocker.query("ROLLBACK");
      await revoker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      revoker.release();
      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaA, centroAscoltoId: centreA1 })
        .where(eq(utentiTable.id, operatorId));
    }
  }, 30_000);

  it("R2-18: revoca dopo D1 annullata e D2 pronta nega il replay di D1 senza mutare D2", async () => {
    const agent = await login();
    const row = await fixture();
    const lotId = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: originA1,
      quantita: 2,
      dataScadenza: "2098-01-01",
    });
    const create = async (versione: number) =>
      agent.post(`/api/richieste-magazzino/${row.id}/documento`).send({
        idempotencyKey: randomUUID(),
        versione,
        magazzinoId: originA1,
      });
    const first = await create(1);
    expect(first.status, first.text).toBe(201);
    const firstLine = await agent
      .post(`/api/bolle/${first.body.documentoId}/righe`)
      .send({
        idempotencyKey: randomUUID(),
        versione: first.body.versioneDocumento,
        prodottoId: productId,
        lottoId: lotId,
        quantita: "1",
      });
    expect(firstLine.status, firstLine.text).toBe(201);
    const firstDraft = await agent.get(`/api/bolle/${first.body.documentoId}`);
    const firstReady = await agent
      .post(`/api/bolle/${first.body.documentoId}/conferma`)
      .send({
        idempotencyKey: randomUUID(),
        versione: firstDraft.body.versione,
      });
    expect(firstReady.status, firstReady.text).toBe(200);
    const firstConfirmed = await agent.get(
      `/api/bolle/${first.body.documentoId}`,
    );
    const cancelPayload = {
      idempotencyKey: randomUUID(),
      versione: firstConfirmed.body.versione,
      motivo: "R2 D1",
    };
    const cancelled = await agent
      .post(`/api/bolle/${first.body.documentoId}/annulla`)
      .send(cancelPayload);
    expect(cancelled.status, cancelled.text).toBe(200);
    const current = await agent.get(`/api/richieste-magazzino/${row.id}`);
    const second = await create(current.body.versione);
    expect(second.status, second.text).toBe(201);
    const secondLine = await agent
      .post(`/api/bolle/${second.body.documentoId}/righe`)
      .send({
        idempotencyKey: randomUUID(),
        versione: second.body.versioneDocumento,
        prodottoId: productId,
        lottoId: lotId,
        quantita: "1",
      });
    expect(secondLine.status, secondLine.text).toBe(201);
    const secondDraft = await agent.get(
      `/api/bolle/${second.body.documentoId}`,
    );
    const secondReady = await agent
      .post(`/api/bolle/${second.body.documentoId}/conferma`)
      .send({
        idempotencyKey: randomUUID(),
        versione: secondDraft.body.versione,
      });
    expect(secondReady.status, secondReady.text).toBe(200);
    const before = await requestDigest(row.id);
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, operatorId));
    try {
      const denied = await agent
        .post(`/api/bolle/${first.body.documentoId}/annulla`)
        .send(cancelPayload);
      expect([403, 404], denied.text).toContain(denied.status);
      expect(await requestDigest(row.id)).toBe(before);
    } finally {
      await db
        .update(utentiTable)
        .set({ areaOperativaId: areaA, centroAscoltoId: centreA1 })
        .where(eq(utentiTable.id, operatorId));
    }
  }, 30_000);
});
