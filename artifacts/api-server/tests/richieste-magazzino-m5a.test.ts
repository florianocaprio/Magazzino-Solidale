/* @vitest-environment node */
// Eseguire solo nel successivo ##test, su PostgreSQL temporaneo identificato
// con la migration M5A già applicata tramite ledger.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  auditEventiTable,
  beneficiariTable,
  comandiOperativiTable,
  db,
  entiDestinatariTable,
  interventiTable,
  lottiTable,
  pool,
  richiesteMagazzinoTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import richiesteRouter from "../src/routes/richieste-magazzino";
import {
  areaGuard,
  loadSessionUser,
  requireAuth,
} from "../src/middlewares/auth";
import { recordAuditEvent, systemAuditContext } from "../src/lib/auditEvent";
import {
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  createZona,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let scope: SeedScope;
let areaA: number, areaB: number, centreA: number, centreB: number;
let benA: number,
  benB: number,
  socialA: number,
  socialB: number,
  warehouseA: number,
  readOnlyA: number;

async function role(areas: string[], permissions: string[]) {
  const [row] = await db
    .insert(ruoliTable)
    .values({
      nome: `M5A ${randomUUID().slice(0, 8)}`,
      aree: areas,
      permessi: permissions,
    })
    .returning({ id: ruoliTable.id });
  scope.ruoloIds.push(row.id);
  return row.id;
}
async function user(
  areaOperativaId: number,
  centroId: number | null,
  areas: string[],
  permissions: string[],
) {
  const ruoloId = await role(areas, permissions);
  const id = await createUtente(scope, { centroId, ruoloId });
  await db
    .update(utentiTable)
    .set({ areaOperativaId })
    .where(eq(utentiTable.id, id));
  return id;
}
function app(id: number | null) {
  const result = express();
  result.use(express.json());
  result.use(async (req, _res, next) => {
    if (id != null) req.user = (await loadSessionUser(id)) ?? undefined;
    next();
  });
  result.use(requireAuth, areaGuard, richiesteRouter);
  return result;
}
const key = () => randomUUID();
const createBody = (beneficiarioId = benA, idempotencyKey: string = key()) => ({
  idempotencyKey,
  tipoDestinatario: "beneficiario",
  sorgente: "beneficiario",
  beneficiarioId,
  bisogno: "Pacco alimentare necessario",
  priorita: "normale",
});
async function createSocial(
  payload: Record<string, unknown> = createBody(),
  id = socialA,
) {
  const response = await request(app(id))
    .post("/richieste-magazzino")
    .send(payload);
  return response;
}
async function legacyCounts() {
  const result = await db.execute(sql`SELECT
    (SELECT count(*)::integer FROM lotti) AS lotti,
    (SELECT count(*)::integer FROM movimenti) AS movimenti,
    (SELECT count(*)::integer FROM prenotazioni_magazzino) AS prenotazioni,
    (SELECT count(*)::integer FROM bolle) AS bolle,
    (SELECT count(*)::integer FROM bolla_righe) AS bolla_righe,
    (SELECT count(*)::integer FROM consegne) AS consegne,
    (SELECT count(*)::integer FROM trasferimenti) AS trasferimenti,
    (SELECT count(*)::integer FROM trasferimento_righe) AS trasferimento_righe,
    (SELECT count(*)::integer FROM operazioni_distribuzione_magazzino) AS distribuzioni,
    (SELECT count(*)::integer FROM interventi) AS interventi,
    (SELECT count(*)::integer FROM interventi_materiali) AS interventi_materiali`);
  return result.rows[0];
}

async function legacyDigests() {
  const tables = [
    "lotti",
    "movimenti",
    "prenotazioni_magazzino",
    "bolle",
    "bolla_righe",
    "consegne",
    "trasferimenti",
    "trasferimento_righe",
    "operazioni_distribuzione_magazzino",
    "interventi",
    "interventi_materiali",
  ] as const;
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => {
        // I nomi provengono esclusivamente dalla costante sopra, mai dal client.
        const result = await db.execute(
          sql.raw(
            `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]')) AS digest FROM ${table} t`,
          ),
        );
        return [table, result.rows[0]?.digest];
      }),
    ),
  );
}

beforeEach(async () => {
  if (process.env.M5A_TEST_DISPOSABLE_DB !== "verified") {
    throw new Error(
      "M5A API test requires a verified disposable PostgreSQL database",
    );
  }
  scope = newScope();
  areaA = await createAreaOperativa(scope);
  areaB = await createAreaOperativa(scope);
  centreA = (await createCentroRec(scope, { areaOperativaId: areaA })).id;
  centreB = (await createCentroRec(scope, { areaOperativaId: areaB })).id;
  benA = await createBeneficiario(scope, centreA, { areaOperativaId: areaA });
  benB = await createBeneficiario(scope, centreB, { areaOperativaId: areaB });
  socialA = await user(
    areaA,
    centreA,
    ["sociale"],
    [
      "richieste_magazzino.view",
      "richieste_magazzino.create",
      "richieste_magazzino.update",
      "richieste_magazzino.cancel",
      "beneficiari.view",
      "sociale.interventi.view",
    ],
  );
  socialB = await user(
    areaB,
    centreB,
    ["sociale"],
    [
      "richieste_magazzino.view",
      "richieste_magazzino.create",
      "richieste_magazzino.update",
      "richieste_magazzino.cancel",
      "beneficiari.view",
      "sociale.interventi.view",
    ],
  );
  warehouseA = await user(
    areaA,
    null,
    ["magazzino"],
    [
      "richieste_magazzino.view",
      "richieste_magazzino.take",
      "richieste_magazzino.cancel",
      "magazzino.view",
      "enti-destinatari.view",
    ],
  );
  readOnlyA = await user(
    areaA,
    null,
    ["magazzino"],
    ["richieste_magazzino.view"],
  );
});

// Le ricevute sono append-only: i dati sintetici restano nel DB disposable
// e vengono rimossi con l'intera istanza temporanea al termine del collaudo.
afterAll(async () => {
  await pool.end();
});

describe("M5A — Richiesta Magazzino reale su PostgreSQL isolato", () => {
  it("invia Beneficiario senza Intervento/prodotti e non scrive stock o documenti", async () => {
    const lot = await createLotto(scope, {
      prodottoId: await createProdotto(scope),
      magazzinoId: await createMagazzino(scope, null, {
        areaOperativaId: areaA,
      }),
      quantita: 10,
    });
    const [before] = await db
      .select({ quantita: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lot));
    const legacyBefore = await legacyCounts();
    const digestBefore = await legacyDigests();
    const response = await createSocial();
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ stato: "inviata", versione: 1 });
    const [saved] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, response.body.id));
    expect(saved).toMatchObject({
      beneficiarioId: benA,
      interventoId: null,
      areaOperativaId: areaA,
      centroAscoltoId: centreA,
    });
    expect(
      (
        await db
          .select({ quantita: lottiTable.quantitaResidua })
          .from(lottiTable)
          .where(eq(lottiTable.id, lot))
      )[0],
    ).toEqual(before);
    expect(await legacyCounts()).toEqual(legacyBefore);
    expect(await legacyDigests()).toEqual(digestBefore);
  });

  it("usa Intervento sociale concluso, non lo muta e blocca due chiavi attive concorrenti", async () => {
    const [intervention] = await db
      .insert(interventiTable)
      .values({
        beneficiarioId: benA,
        tipoIntervento: "Pacco",
        ambito: "sociale",
        stato: "concluso",
      })
      .returning();
    scope.interventoIds.push(intervention.id);
    const payload = (idempotencyKey: string) => ({
      ...createBody(benA, idempotencyKey),
      sorgente: "intervento_sociale",
      interventoId: intervention.id,
    });
    const [first, second] = await Promise.all([
      createSocial(payload(key())),
      createSocial(payload(key())),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rows = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.interventoId, intervention.id));
    expect(rows).toHaveLength(1);
    const warehouseView = await request(app(warehouseA)).get(
      `/richieste-magazzino/${rows[0].id}`,
    );
    expect(warehouseView.status).toBe(200);
    expect(warehouseView.body.interventoId).toBeNull();
    expect(warehouseView.body).not.toHaveProperty("materiali");
    const socialView = await request(app(socialA)).get(
      `/richieste-magazzino/${rows[0].id}`,
    );
    expect(socialView.body.interventoId).toBe(intervention.id);
    const [after] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, intervention.id));
    expect(after).toEqual(intervention);
    const cancelled = await request(app(socialA))
      .post(`/richieste-magazzino/${rows[0].id}/annulla`)
      .send({
        idempotencyKey: key(),
        versione: 1,
        motivo: "Richiesta sostituita",
      });
    expect(cancelled.status).toBe(200);
    const again = await createSocial(payload(key()));
    expect(again.status).toBe(201);
    expect(
      (
        await db
          .select()
          .from(richiesteMagazzinoTable)
          .where(eq(richiesteMagazzinoTable.interventoId, intervention.id))
      )
        .map((r) => r.stato)
        .sort(),
    ).toEqual(["annullata", "inviata"]);
  });

  it("impone esclusività destinatario e dati sociali completi e coerenti", async () => {
    expect(
      (await createSocial({ ...createBody(), enteDestinatarioId: 1 })).status,
    ).toBe(400);
    expect((await createSocial(createBody(benB))).status).toBe(403);
    const legacy = await createBeneficiario(scope, null, {
      areaOperativaId: null,
    });
    expect((await createSocial(createBody(legacy))).status).toBe(409);
    const [intervention] = await db
      .insert(interventiTable)
      .values({
        beneficiarioId: benA,
        tipoIntervento: "UDS",
        ambito: "uds",
        stato: "concluso",
        areaOperativaIdSnapshot: areaA,
        centroAscoltoIdSnapshot: centreA,
      })
      .returning({ id: interventiTable.id });
    scope.interventoIds.push(intervention.id);
    expect(
      (
        await createSocial({
          ...createBody(benA),
          sorgente: "intervento_sociale",
          interventoId: intervention.id,
        })
      ).status,
    ).toBe(404);
    await expect(
      db.insert(richiesteMagazzinoTable).values({
        codice: `RM-INVALID-${key().slice(0, 8)}`,
        tipoDestinatario: "beneficiario",
        beneficiarioId: benA,
        enteDestinatarioId: 123456789,
        areaOperativaId: areaA,
        centroAscoltoId: centreA,
        sorgente: "beneficiario",
        destinatarioNomeSnapshot: "X",
        areaNomeSnapshot: "A",
        bisogno: "X",
        inviatoDa: socialA,
      }),
    ).rejects.toThrow();
    const valid = await createSocial();
    expect(valid.status).toBe(201);
    await expect(
      db
        .update(richiesteMagazzinoTable)
        .set({ versione: 0 })
        .where(eq(richiesteMagazzinoTable.id, valid.body.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(richiesteMagazzinoTable)
        .set({ stato: "pronta" })
        .where(eq(richiesteMagazzinoTable.id, valid.body.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(beneficiariTable).where(eq(beneficiariTable.id, benA)),
    ).rejects.toThrow();
  });

  it("limita Ente/Magazzino ai profili operativi e non espone il dossier al Magazzino", async () => {
    const [entity] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente test",
        indirizzo: "Sede",
        areaOperativaId: areaA,
      })
      .returning({ id: entiDestinatariTable.id });
    scope.enteDestinatarioIds.push(entity.id);
    const payload = {
      idempotencyKey: key(),
      tipoDestinatario: "ente",
      enteDestinatarioId: entity.id,
      areaOperativaId: areaA,
      sorgente: "operativa",
      bisogno: "Materiale necessario",
    };
    expect(
      (await request(app(socialA)).post("/richieste-magazzino").send(payload))
        .status,
    ).toBe(403);
    // Il ruolo Magazzino standard non ha create implicito; il grant esplicito abilita l'operazione.
    expect(
      (
        await request(app(warehouseA))
          .post("/richieste-magazzino")
          .send(payload)
      ).status,
    ).toBe(403);
    const [actor] = await db
      .select({ ruoloId: utentiTable.ruoloId })
      .from(utentiTable)
      .where(eq(utentiTable.id, warehouseA));
    const [roleRow] = await db
      .select({ permessi: ruoliTable.permessi })
      .from(ruoliTable)
      .where(eq(ruoliTable.id, actor.ruoloId!));
    await db
      .update(ruoliTable)
      .set({ permessi: [...roleRow.permessi, "richieste_magazzino.create"] })
      .where(eq(ruoliTable.id, actor.ruoloId!));
    const created = await request(app(warehouseA))
      .post("/richieste-magazzino")
      .send(payload);
    expect(created.status).toBe(201);
    const detail = await request(app(warehouseA)).get(
      `/richieste-magazzino/${created.body.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body).not.toHaveProperty("codiceFiscale");
    expect(detail.body).not.toHaveProperty("noteInterne");
    expect(detail.body).not.toHaveProperty("materiali");
    const warehouseId = await createMagazzino(scope, null, {
      areaOperativaId: areaA,
    });
    const warehouseRequest = await request(app(warehouseA))
      .post("/richieste-magazzino")
      .send({
        idempotencyKey: key(),
        tipoDestinatario: "magazzino",
        magazzinoDestinatarioId: warehouseId,
        areaOperativaId: areaA,
        sorgente: "operativa",
        bisogno: "Materiale per il deposito",
      });
    expect(warehouseRequest.status).toBe(201);
    const [savedWarehouse] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, warehouseRequest.body.id));
    expect(savedWarehouse).toMatchObject({
      tipoDestinatario: "magazzino",
      magazzinoDestinatarioId: warehouseId,
      enteDestinatarioId: null,
      beneficiarioId: null,
    });
  });

  it("filtra nello scope prima di conteggio e paginazione anche tra Centri della stessa Area", async () => {
    const otherCentre = (
      await createCentroRec(scope, { areaOperativaId: areaA })
    ).id;
    const otherBeneficiary = await createBeneficiario(scope, otherCentre, {
      areaOperativaId: areaA,
    });
    const otherSocial = await user(
      areaA,
      otherCentre,
      ["sociale"],
      [
        "richieste_magazzino.view",
        "richieste_magazzino.create",
        "beneficiari.view",
      ],
    );
    const first = await createSocial();
    const second = await createSocial(
      createBody(otherBeneficiary),
      otherSocial,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const own = await request(app(socialA))
      .get("/richieste-magazzino")
      .query({ page: 1, limit: 1, sorgente: "beneficiario" });
    expect(own.status).toBe(200);
    expect(own.body.total).toBe(1);
    expect(own.body.items.map((item: { id: number }) => item.id)).toEqual([
      first.body.id,
    ]);
    const excluded = await request(app(socialA))
      .get("/richieste-magazzino")
      .query({ centroAscoltoId: otherCentre });
    expect(excluded.body).toMatchObject({ total: 0, items: [] });
    expect(
      (
        await request(app(socialA)).get(
          `/richieste-magazzino/${second.body.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app(socialA)).get(
          `/richieste-magazzino/${second.body.id}/storico`,
        )
      ).status,
    ).toBe(404);
    const warehouse = await request(app(warehouseA))
      .get("/richieste-magazzino")
      .query({ sorgente: "beneficiario", tipoDestinatario: "beneficiario" });
    expect(warehouse.body.total).toBe(2);
    expect(
      (
        await request(app(warehouseA))
          .get("/richieste-magazzino")
          .query({ sorgente: "inventata" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app(socialB))
          .get("/richieste-magazzino")
          .query({ areaOperativaId: areaA })
      ).body.total,
    ).toBe(0);
  });

  it("non allarga la cartella sociale fra Zone UDS dello stesso Centro", async () => {
    const zoneA = (await createZona(scope, areaA)).id;
    const zoneB = (await createZona(scope, areaA)).id;
    await db
      .update(beneficiariTable)
      .set({ zonaUdsId: zoneA, uds: true })
      .where(eq(beneficiariTable.id, benA));
    const zoneUserA = await user(
      areaA,
      centreA,
      ["sociale"],
      [
        "richieste_magazzino.view",
        "richieste_magazzino.create",
        "beneficiari.view",
      ],
    );
    const zoneUserB = await user(
      areaA,
      centreA,
      ["sociale"],
      ["richieste_magazzino.view"],
    );
    await db
      .update(utentiTable)
      .set({ zonaUdsId: zoneA })
      .where(eq(utentiTable.id, zoneUserA));
    await db
      .update(utentiTable)
      .set({ zonaUdsId: zoneB })
      .where(eq(utentiTable.id, zoneUserB));
    const created = await createSocial(createBody(), zoneUserA);
    expect(created.status).toBe(201);
    const deniedList = await request(app(zoneUserB)).get(
      "/richieste-magazzino",
    );
    expect(deniedList.body).toMatchObject({ total: 0, items: [] });
    expect(
      (
        await request(app(zoneUserB)).get(
          `/richieste-magazzino/${created.body.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app(warehouseA)).get(
          `/richieste-magazzino/${created.body.id}`,
        )
      ).status,
    ).toBe(200);
  });

  it("richiede i flag Magazzino/Centro pertinenti ma non BOLLE o CONSEGNE", async () => {
    const codes = [
      "MAGAZZINO_SOLIDALE",
      "CENTRO_ASCOLTO",
      "BOLLE",
      "CONSEGNE",
    ] as const;
    const modules = await listModuliFunzionali();
    const original = new Map(
      codes.map((code) => [
        code,
        modules.find((module) => module.codice === code)?.attivo ?? true,
      ]),
    );
    const set = async (code: (typeof codes)[number], active: boolean) => {
      const result = await updateModuloAmbiente(code, active, null);
      if ("error" in result) throw new Error(result.error);
    };
    try {
      await set("MAGAZZINO_SOLIDALE", true);
      await set("CENTRO_ASCOLTO", true);
      await set("BOLLE", false);
      await set("CONSEGNE", false);
      const created = await createSocial();
      expect(created.status).toBe(201);
      await set("CENTRO_ASCOLTO", false);
      expect(
        (await request(app(socialA)).get("/richieste-magazzino")).status,
      ).toBe(403);
      expect(
        (await request(app(warehouseA)).get("/richieste-magazzino")).status,
      ).toBe(200);
      await set("MAGAZZINO_SOLIDALE", false);
      expect(
        (await request(app(warehouseA)).get("/richieste-magazzino")).status,
      ).toBe(403);
    } finally {
      for (const code of codes) await set(code, original.get(code) ?? true);
    }
  });

  it("verifica 401, permessi, Area e Centro anche per conteggi/storico", async () => {
    const created = await createSocial();
    expect(created.status).toBe(201);
    expect((await request(app(null)).get("/richieste-magazzino")).status).toBe(
      401,
    );
    expect(
      (
        await request(app(socialB))
          .get("/richieste-magazzino")
          .query({ stato: "aperte" })
      ).body.total,
    ).toBe(0);
    expect(
      (
        await request(app(socialB)).get(
          `/richieste-magazzino/${created.body.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app(socialB)).get(
          `/richieste-magazzino/${created.body.id}/storico`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app(readOnlyA))
          .post(`/richieste-magazzino/${created.body.id}/presa-in-carico`)
          .send({ idempotencyKey: key(), versione: 1 })
      ).status,
    ).toBe(403);
    const [userRole] = await db
      .select({ ruoloId: utentiTable.ruoloId })
      .from(utentiTable)
      .where(eq(utentiTable.id, warehouseA));
    await db
      .update(ruoliTable)
      .set({ aree: ["logistica"] })
      .where(eq(ruoliTable.id, userRole.ruoloId!));
    expect(
      (await request(app(warehouseA)).get("/richieste-magazzino")).status,
    ).toBe(403);
  });

  it("rifiuta mass assignment/versioni coercibili, blocca update dopo presa e serializza take", async () => {
    const created = await createSocial();
    expect(created.status).toBe(201);
    const id = created.body.id;
    for (const versione of [true, "1", null, 1.5, 0]) {
      expect(
        (
          await request(app(socialA))
            .patch(`/richieste-magazzino/${id}`)
            .send({ idempotencyKey: key(), versione, bisogno: "Nuovo" })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await request(app(socialA))
          .patch(`/richieste-magazzino/${id}`)
          .send({ idempotencyKey: key(), versione: 1, stato: "chiusa" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app(socialA))
          .post(`/richieste-magazzino/${id}/chiudi`)
          .send({ idempotencyKey: key(), versione: 1 })
      ).status,
    ).toBe(404);
    expect(
      (await request(app(socialA)).delete(`/richieste-magazzino/${id}`)).status,
    ).toBe(404);
    const [a, b] = await Promise.all([
      request(app(warehouseA))
        .post(`/richieste-magazzino/${id}/presa-in-carico`)
        .send({ idempotencyKey: key(), versione: 1 }),
      request(app(warehouseA))
        .post(`/richieste-magazzino/${id}/presa-in-carico`)
        .send({ idempotencyKey: key(), versione: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(
      (
        await request(app(socialA))
          .patch(`/richieste-magazzino/${id}`)
          .send({ idempotencyKey: key(), versione: 2, bisogno: "Troppo tardi" })
      ).status,
    ).toBe(403);
    const cancelled = await request(app(warehouseA))
      .post(`/richieste-magazzino/${id}/annulla`)
      .send({ idempotencyKey: key(), versione: 2, motivo: "Non procedibile" });
    expect(cancelled.status).toBe(200);
    const [row] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, id));
    expect(row).toMatchObject({
      stato: "annullata",
      presoInCaricoDa: warehouseA,
      annullatoDa: warehouseA,
      motivoAnnullamento: "Non procedibile",
      versione: 3,
    });
    expect(row.presoInCaricoCodiceSnapshot).toBeTruthy();
  });

  it("replay non duplica effetti/audit e rivalida scope e ruolo revocati", async () => {
    const idempotencyKey = key();
    const payload = createBody(benA, idempotencyKey);
    const first = await createSocial(payload);
    expect(first.status).toBe(201);
    const repeat = await createSocial(payload);
    expect(repeat.status).toBe(201);
    expect(repeat.body).toEqual(first.body);
    expect(
      await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, first.body.id)),
    ).toHaveLength(1);
    const events = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "richiesta_magazzino"),
          eq(auditEventiTable.entitaId, first.body.id),
        ),
      );
    expect(events).toHaveLength(1);
    expect(
      (await createSocial({ ...payload, bisogno: "Altro bisogno" })).status,
    ).toBe(409);
    const [actor] = await db
      .select({ ruoloId: utentiTable.ruoloId })
      .from(utentiTable)
      .where(eq(utentiTable.id, socialA));
    await db
      .update(ruoliTable)
      .set({ permessi: ["richieste_magazzino.view"] })
      .where(eq(ruoliTable.id, actor.ruoloId!));
    expect((await createSocial(payload)).status).toBe(403);
    await db
      .update(utentiTable)
      .set({ attivo: false })
      .where(eq(utentiTable.id, socialA));
    expect((await createSocial(payload)).status).toBe(401);
  });

  it("due invii con la stessa chiave producono una sola richiesta e un solo audit", async () => {
    const payload = createBody(benA, key());
    const [first, second] = await Promise.all([
      createSocial(payload),
      createSocial(payload),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual(second.body);
    const rows = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.beneficiarioId, benA));
    expect(rows).toHaveLength(1);
    const events = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "richiesta_magazzino"),
          eq(auditEventiTable.entitaId, rows[0].id),
        ),
      );
    expect(events).toHaveLength(1);
  });

  it("dopo spostamento del Beneficiario blocca presa/modifica ma consente annullamento nello scope originario", async () => {
    const created = await createSocial();
    expect(created.status).toBe(201);
    const movedCentre = (
      await createCentroRec(scope, { areaOperativaId: areaA })
    ).id;
    await db
      .update(beneficiariTable)
      .set({ centroAscoltoId: movedCentre })
      .where(eq(beneficiariTable.id, benA));
    const id = created.body.id;
    expect(
      (
        await request(app(warehouseA))
          .post(`/richieste-magazzino/${id}/presa-in-carico`)
          .send({ idempotencyKey: key(), versione: 1 })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app(socialA))
          .patch(`/richieste-magazzino/${id}`)
          .send({ idempotencyKey: key(), versione: 1, bisogno: "Altro" })
      ).status,
    ).toBe(409);
    const detail = await request(app(socialA)).get(
      `/richieste-magazzino/${id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.centroAscoltoId).toBe(centreA);
    expect(
      (
        await request(app(socialA))
          .post(`/richieste-magazzino/${id}/annulla`)
          .send({
            idempotencyKey: key(),
            versione: 1,
            motivo: "Cartella trasferita",
          })
      ).status,
    ).toBe(200);
  });

  it("modifica solo in inviata con versione corrente e non perde aggiornamenti concorrenti", async () => {
    const created = await createSocial();
    expect(created.status).toBe(201);
    const id = created.body.id;
    const command = (bisogno: string) =>
      request(app(socialA))
        .patch(`/richieste-magazzino/${id}`)
        .send({ idempotencyKey: key(), versione: 1, bisogno });
    const [first, second] = await Promise.all([
      command("Pacco A"),
      command("Pacco B"),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(
      (
        await request(app(socialA))
          .patch(`/richieste-magazzino/${id}`)
          .send({ idempotencyKey: key(), versione: 1, bisogno: "Stale" })
      ).status,
    ).toBe(409);
    const [row] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, id));
    expect(row.versione).toBe(2);
    expect(["Pacco A", "Pacco B"]).toContain(row.bisogno);
  });

  it("modifica, presa e annullamento non cambiano documenti, stock o materiali legacy", async () => {
    const before = await legacyCounts();
    const digestBefore = await legacyDigests();
    const created = await createSocial();
    expect(created.status).toBe(201);
    expect(await legacyDigests()).toEqual(digestBefore);
    const id = created.body.id;
    const updated = await request(app(socialA))
      .patch(`/richieste-magazzino/${id}`)
      .send({
        idempotencyKey: key(),
        versione: 1,
        bisogno: "Pacco alimentare aggiornato",
        noteOperative: "",
      });
    expect(updated.status).toBe(200);
    expect(await legacyDigests()).toEqual(digestBefore);
    const taken = await request(app(warehouseA))
      .post(`/richieste-magazzino/${id}/presa-in-carico`)
      .send({ idempotencyKey: key(), versione: 2 });
    expect(taken.status).toBe(200);
    expect(await legacyDigests()).toEqual(digestBefore);
    const cancelKey = key();
    const cancelled = await request(app(warehouseA))
      .post(`/richieste-magazzino/${id}/annulla`)
      .send({
        idempotencyKey: cancelKey,
        versione: 3,
        motivo: "Necessità cessata",
      });
    expect(cancelled.status).toBe(200);
    expect(await legacyCounts()).toEqual(before);
    expect(await legacyDigests()).toEqual(digestBefore);
    const events = await request(app(warehouseA)).get(
      `/richieste-magazzino/${id}/storico`,
    );
    expect(events.status).toBe(200);
    expect(events.body).toHaveLength(4);
    expect(JSON.stringify(events.body)).not.toContain(
      "Pacco alimentare aggiornato",
    );
    const replay = await request(app(warehouseA))
      .post(`/richieste-magazzino/${id}/annulla`)
      .send({
        idempotencyKey: cancelKey,
        versione: 3,
        motivo: "Necessità cessata",
      });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(cancelled.body);
    expect(
      (await request(app(warehouseA)).get(`/richieste-magazzino/${id}/storico`))
        .body,
    ).toHaveLength(4);
    expect(await legacyCounts()).toEqual(before);
  });

  it("annulla il comando intero se l'audit non può registrare l'evento", async () => {
    const idempotencyKey = key();
    await db.transaction(async (tx) => {
      await recordAuditEvent(tx, {
        command: systemAuditContext({
          actorCode: "m5a-test",
          operationKey: `m5a:RICHIESTA_MAGAZZINO_INVIA:${idempotencyKey}`,
        }),
        azione: "richiesta_magazzino.invia",
        entitaTipo: "richiesta_magazzino",
        entitaId: 999999999,
      });
    });
    const before = await db
      .select({ value: sql<number>`count(*)::integer` })
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.beneficiarioId, benA));
    await expect(
      request(app(socialA))
        .post("/richieste-magazzino")
        .send(createBody(benA, idempotencyKey)),
    ).resolves.toMatchObject({ status: 500 });
    const after = await db
      .select({ value: sql<number>`count(*)::integer` })
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.beneficiarioId, benA));
    expect(after).toEqual(before);
    expect(
      await db
        .select()
        .from(comandiOperativiTable)
        .where(
          and(
            eq(comandiOperativiTable.tipoComando, "RICHIESTA_MAGAZZINO_INVIA"),
            eq(comandiOperativiTable.idempotencyKey, idempotencyKey),
          ),
        ),
    ).toHaveLength(0);
  });
});
