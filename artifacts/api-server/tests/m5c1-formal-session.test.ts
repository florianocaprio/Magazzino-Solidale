/* @vitest-environment node */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import {
  areeOperativeTable,
  beneficiariTable,
  bolleTable,
  centriAscoltoTable,
  db,
  interventiMaterialiTable,
  lottiTable,
  magazziniTable,
  pool,
  prodottiTable,
  richiesteMagazzinoTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import app from "../src/app";
import {
  ADMIN_ROLE_NAME,
  MAGAZZINO_ROLE_NAME,
  OPERATOR_ROLE_NAME,
  seedRoles,
} from "../src/lib/seedRoles";

const suffix = randomUUID().slice(0, 8);
const password = `M5C1-test-only-${randomUUID()}`;
const legacyBollaGrants = [
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "bolle.cancel",
];
const socialGrants = [
  "beneficiari.view",
  "sociale.interventi.view",
  "sociale.interventi.create",
  "sociale.interventi.update",
  "sociale.interventi.complete",
  "richieste_magazzino.view",
  "richieste_magazzino.create",
  "consegne.view",
  "consegne.manage",
];

let areaA: number;
let areaB: number;
let centreA: number;
let centreB: number;
let beneficiaryA: number;
let beneficiaryB: number;
let warehouseA: number;
let warehouseB: number;
let productId: number;
let lotId: number;
let canonicalId: number;
let legacyId: number;
let mixedId: number;
let warehouseId: number;
let scopedAdminId: number;
let globalAdminId: number;
let mixedRoleId: number;

async function createUser(
  label: string,
  roleId: number,
  areaOperativaId: number | null,
  centroAscoltoId: number | null,
) {
  const [row] = await db
    .insert(utentiTable)
    .values({
      username: `m5c1-${label}-${suffix}`,
      passwordHash: await bcrypt.hash(password, 4),
      nome: `M5C1 ${label}`,
      ruoloId: roleId,
      areaOperativaId,
      centroAscoltoId,
      mustChangePassword: false,
    })
    .returning({ id: utentiTable.id });
  return row.id;
}

async function login(userId: number) {
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

async function counts() {
  const result = await db.execute(sql`SELECT
    (SELECT count(*)::integer FROM bolle) AS bolle,
    (SELECT count(*)::integer FROM bolla_righe) AS righe,
    (SELECT count(*)::integer FROM richieste_magazzino) AS richieste,
    (SELECT count(*)::integer FROM movimenti) AS movimenti,
    (SELECT count(*)::integer FROM prenotazioni_magazzino) AS prenotazioni,
    (SELECT count(*)::integer FROM audit_eventi WHERE azione LIKE 'BOLLA_%') AS audit_bolle,
    (SELECT count(*)::integer FROM comandi_operativi WHERE tipo_comando LIKE 'BOLLA_%') AS ricevute_bolle`);
  return result.rows[0];
}

const directBolla = () => ({
  idempotencyKey: randomUUID(),
  beneficiarioId: beneficiaryA,
  magazzinoId: warehouseA,
});

beforeAll(async () => {
  if (process.env.M5C1_TEST_DISPOSABLE_DB !== "verified") {
    throw new Error("M5C1 richiede PostgreSQL effimero verificato");
  }
  await seedRoles();
  const [a, b] = await db
    .insert(areeOperativeTable)
    .values([
      { nome: `M5C1 Area A ${suffix}` },
      { nome: `M5C1 Area B ${suffix}` },
    ])
    .returning({ id: areeOperativeTable.id });
  areaA = a.id;
  areaB = b.id;
  const [ca, cb] = await db
    .insert(centriAscoltoTable)
    .values([
      { nome: `M5C1 Centro A ${suffix}`, areaOperativaId: areaA },
      { nome: `M5C1 Centro B ${suffix}`, areaOperativaId: areaB },
    ])
    .returning({ id: centriAscoltoTable.id });
  centreA = ca.id;
  centreB = cb.id;
  const [ba, bb] = await db
    .insert(beneficiariTable)
    .values([
      {
        codice: `M5C1-A-${suffix}`,
        nome: "Ada",
        cognome: "Sintetica",
        centroAscoltoId: centreA,
        areaOperativaId: areaA,
      },
      {
        codice: `M5C1-B-${suffix}`,
        nome: "Bea",
        cognome: "Sintetica",
        centroAscoltoId: centreB,
        areaOperativaId: areaB,
      },
    ])
    .returning({ id: beneficiariTable.id });
  beneficiaryA = ba.id;
  beneficiaryB = bb.id;
  const [wa, wb] = await db
    .insert(magazziniTable)
    .values([
      {
        codice: `M5C1-MA-${suffix}`,
        nome: "M5C1 Deposito A",
        areaOperativaId: areaA,
        centroAscoltoId: centreA,
      },
      {
        codice: `M5C1-MB-${suffix}`,
        nome: "M5C1 Deposito B",
        areaOperativaId: areaB,
        centroAscoltoId: centreB,
      },
    ])
    .returning({ id: magazziniTable.id });
  warehouseA = wa.id;
  warehouseB = wb.id;
  const [product] = await db
    .insert(prodottiTable)
    .values({
      codice: `M5C1-P-${suffix}`,
      nome: "Prodotto sintetico M5C1",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
    })
    .returning({ id: prodottiTable.id });
  productId = product.id;
  const [lot] = await db
    .insert(lottiTable)
    .values({
      prodottoId: productId,
      magazzinoId: warehouseA,
      dataCarico: "2026-09-29",
      dataScadenza: "2099-12-31",
      quantitaCaricata: "10",
      quantitaResidua: "10",
      codiceLotto: `M5C1-LOT-${suffix}`,
    })
    .returning({ id: lottiTable.id });
  lotId = lot.id;

  const standard = await db
    .select({ id: ruoliTable.id, nome: ruoliTable.nome })
    .from(ruoliTable);
  const roleId = (name: string) => {
    const role = standard.find((row) => row.nome === name);
    if (!role) throw new Error(`Ruolo mancante: ${name}`);
    return role.id;
  };
  const [legacyRole, mixedRole] = await db
    .insert(ruoliTable)
    .values([
      {
        nome: `M5C1 Sociale legacy ${suffix}`,
        aree: ["sociale"],
        permessi: [...socialGrants, ...legacyBollaGrants],
      },
      {
        nome: `M5C1 Misto ${suffix}`,
        aree: ["sociale", "magazzino"],
        permessi: [
          ...socialGrants,
          ...legacyBollaGrants,
          "magazzino.view",
          "richieste_magazzino.take",
          "richieste_magazzino.prepare",
        ],
      },
    ])
    .returning({ id: ruoliTable.id });
  mixedRoleId = mixedRole.id;
  canonicalId = await createUser(
    "canonical",
    roleId(OPERATOR_ROLE_NAME),
    areaA,
    centreA,
  );
  legacyId = await createUser("legacy", legacyRole.id, areaA, centreA);
  mixedId = await createUser("mixed", mixedRole.id, areaA, centreA);
  warehouseId = await createUser(
    "warehouse",
    roleId(MAGAZZINO_ROLE_NAME),
    areaA,
    null,
  );
  scopedAdminId = await createUser(
    "admin-scoped",
    roleId(ADMIN_ROLE_NAME),
    areaA,
    centreA,
  );
  globalAdminId = await createUser(
    "admin-global",
    roleId(ADMIN_ROLE_NAME),
    null,
    null,
  );
});

afterAll(async () => {
  await pool.end();
});

describe("M5C1 formale — sessione reale e confine Centro/Magazzino", () => {
  it("pianifica senza creare richiesta o stock; invia solo il bisogno esplicito e impedisce duplicati", async () => {
    const social = await login(canonicalId);
    const before = await counts();
    const created = await social.post("/api/interventi").send({
      beneficiarioId: beneficiaryA,
      ambito: "sociale",
      stato: "pianificato",
      tipoIntervento: `M5C1 Piano ${suffix}`,
      priorita: "alta",
      dataOraPianificata: "2026-09-30T22:30:00Z",
      sede: "Centro sintetico",
    });
    expect(created.status, created.text).toBe(201);
    const interventionId = created.body.id as number;
    expect((await counts()).richieste).toBe(before.richieste);
    expect((await counts()).bolle).toBe(before.bolle);
    expect((await counts()).movimenti).toBe(before.movimenti);
    expect((await counts()).prenotazioni).toBe(before.prenotazioni);

    const detail = await social.get(`/api/interventi/${interventionId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      beneficiarioId: beneficiaryA,
      priorita: "alta",
      dataOraPianificata: "2026-09-30T22:30:00.000Z",
    });
    const sent = await social.post("/api/richieste-magazzino").send({
      idempotencyKey: randomUUID(),
      tipoDestinatario: "beneficiario",
      sorgente: "intervento_sociale",
      interventoId: interventionId,
      beneficiarioId: beneficiaryA,
      bisogno: "Necessario pacco per visita",
      priorita: "alta",
      dataDesiderata: "2026-10-01",
      modalitaPreferita: "da_definire",
    });
    expect(sent.status, sent.text).toBe(201);
    expect(sent.body).toMatchObject({ stato: "inviata" });
    const sentDetail = await social.get(
      `/api/richieste-magazzino/${sent.body.id}`,
    );
    expect(sentDetail.status, sentDetail.text).toBe(200);
    expect(sentDetail.body).toMatchObject({
      stato: "inviata",
      sorgente: "intervento_sociale",
      interventoId: interventionId,
      beneficiarioId: beneficiaryA,
      priorita: "alta",
      dataDesiderata: "2026-10-01",
    });
    const [stored] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, sent.body.id));
    expect(stored.bisogno).toBe("Necessario pacco per visita");
    expect(JSON.stringify(stored)).not.toMatch(
      /prodottoId|quantita|magazzinoId|lottoId|sede/,
    );
    const warehouse = await login(warehouseId);
    const warehouseView = await warehouse.get(
      `/api/richieste-magazzino/${sent.body.id}`,
    );
    expect(warehouseView.status, warehouseView.text).toBe(200);
    expect(warehouseView.body.interventoId).toBeNull();
    expect(
      (await warehouse.get(`/api/interventi/${interventionId}`)).status,
    ).toBe(403);
    const duplicate = await social.post("/api/richieste-magazzino").send({
      idempotencyKey: randomUUID(),
      tipoDestinatario: "beneficiario",
      sorgente: "intervento_sociale",
      interventoId: interventionId,
      beneficiarioId: beneficiaryA,
      bisogno: "Secondo invio vietato",
    });
    expect(duplicate.status).toBe(409);
    expect((await counts()).richieste).toBe(Number(before.richieste) + 1);

    const independent = await social.post("/api/richieste-magazzino").send({
      idempotencyKey: randomUUID(),
      tipoDestinatario: "beneficiario",
      sorgente: "beneficiario",
      beneficiarioId: beneficiaryA,
      bisogno: "Richiesta autonoma sintetica",
    });
    expect(independent.status, independent.text).toBe(201);
    const independentDetail = await social.get(
      `/api/richieste-magazzino/${independent.body.id}`,
    );
    expect(independentDetail.status, independentDetail.text).toBe(200);
    expect(independentDetail.body.interventoId).toBeNull();
  });

  it("nega ogni mutazione Bolla al solo Sociale con grant legacy, preservando lettura e contabilità", async () => {
    const social = await login(legacyId);
    const warehouse = await login(warehouseId);
    const bolla = await warehouse.post("/api/bolle").send(directBolla());
    expect(bolla.status, bolla.text).toBe(201);
    const bollaId = bolla.body.id as number;
    expect((await social.get(`/api/bolle/${bollaId}`)).status).toBe(200);
    const before = await counts();
    const commands: Array<[string, string]> = [
      ["post", "/api/bolle"],
      ["patch", `/api/bolle/${bollaId}`],
      ["post", `/api/bolle/${bollaId}/righe`],
      ["post", `/api/bolle/${bollaId}/conferma`],
      ["post", `/api/bolle/${bollaId}/affida`],
      ["post", `/api/bolle/${bollaId}/consegna`],
      ["post", `/api/bolle/${bollaId}/annulla`],
    ];
    for (const [method, path] of commands) {
      const result = await social[method](path).send(directBolla());
      expect(result.status, `${method} ${path}: ${result.text}`).toBe(403);
    }
    expect(await counts()).toEqual(before);
  });

  it("nega Bolla quando i grant legacy sono aggiunti al solo Sociale a sessione già aperta", async () => {
    const social = await login(canonicalId);
    const [user] = await db
      .select({ ruoloId: utentiTable.ruoloId })
      .from(utentiTable)
      .where(eq(utentiTable.id, canonicalId));
    const [role] = await db
      .select({ permessi: ruoliTable.permessi })
      .from(ruoliTable)
      .where(eq(ruoliTable.id, user.ruoloId));
    const before = await counts();
    await db
      .update(ruoliTable)
      .set({
        permessi: [
          ...role.permessi,
          ...legacyBollaGrants.filter(
            (grant) => !role.permessi.includes(grant),
          ),
        ],
      })
      .where(eq(ruoliTable.id, user.ruoloId));
    try {
      const current = await social.get("/api/auth/me");
      expect(current.status, current.text).toBe(200);
      expect(current.body.permessi).toEqual(
        expect.arrayContaining(legacyBollaGrants),
      );
      const sameSession = await social.post("/api/bolle").send(directBolla());
      expect(sameSession.status, sameSession.text).toBe(403);
      const freshSession = await login(canonicalId);
      const freshAttempt = await freshSession
        .post("/api/bolle")
        .send(directBolla());
      expect(freshAttempt.status, freshAttempt.text).toBe(403);
      expect(await counts()).toEqual(before);
    } finally {
      await db
        .update(ruoliTable)
        .set({ permessi: role.permessi })
        .where(eq(ruoliTable.id, user.ruoloId));
    }
  });

  it("ruolo misto, Magazzino e admin mantengono i percorsi autorizzati; la revoca vale nella stessa sessione", async () => {
    const mixed = await login(mixedId);
    const warehouse = await login(warehouseId);
    const scopedAdmin = await login(scopedAdminId);
    const globalAdmin = await login(globalAdminId);
    const mixedCreated = await mixed.post("/api/bolle").send(directBolla());
    expect(mixedCreated.status, mixedCreated.text).toBe(201);
    const warehouseCreated = await warehouse
      .post("/api/bolle")
      .send(directBolla());
    expect(warehouseCreated.status, warehouseCreated.text).toBe(201);
    const adminCreated = await scopedAdmin
      .post("/api/bolle")
      .send(directBolla());
    expect(adminCreated.status, adminCreated.text).toBe(201);
    const deniedOtherArea = await scopedAdmin.post("/api/bolle").send({
      idempotencyKey: randomUUID(),
      beneficiarioId: beneficiaryB,
      magazzinoId: warehouseB,
    });
    expect(deniedOtherArea.status).toBe(403);
    const globalCreated = await globalAdmin.post("/api/bolle").send({
      idempotencyKey: randomUUID(),
      beneficiarioId: beneficiaryB,
      magazzinoId: warehouseB,
    });
    expect(globalCreated.status, globalCreated.text).toBe(201);

    await db
      .update(ruoliTable)
      .set({ aree: ["sociale"] })
      .where(eq(ruoliTable.id, mixedRoleId));
    const before = await counts();
    try {
      expect((await mixed.post("/api/bolle").send(directBolla())).status).toBe(
        403,
      );
      const newLogin = await login(mixedId);
      expect(
        (await newLogin.post("/api/bolle").send(directBolla())).status,
      ).toBe(403);
      expect(await counts()).toEqual(before);
    } finally {
      await db
        .update(ruoliTable)
        .set({ aree: ["sociale", "magazzino"] })
        .where(eq(ruoliTable.id, mixedRoleId));
    }
    await db
      .update(utentiTable)
      .set({ attivo: false })
      .where(eq(utentiTable.id, mixedId));
    try {
      const deniedInactive = await mixed.post("/api/bolle").send(directBolla());
      expect([401, 403]).toContain(deniedInactive.status);
    } finally {
      await db
        .update(utentiTable)
        .set({ attivo: true })
        .where(eq(utentiTable.id, mixedId));
    }
  });

  it("lo storico materiale resta leggibile, ma i comandi sociali inventariali non producono effetti", async () => {
    const social = await login(legacyId);
    const created = await social.post("/api/interventi").send({
      beneficiarioId: beneficiaryA,
      ambito: "sociale",
      stato: "in_corso",
      tipoIntervento: `M5C1 Legacy ${suffix}`,
    });
    expect(created.status, created.text).toBe(201);
    const interventionId = created.body.id as number;
    const [material] = await db
      .insert(interventiMaterialiTable)
      .values({
        interventoId: interventionId,
        prodottoId: productId,
        magazzinoId: warehouseA,
        descrizioneSnapshot: "Prodotto sintetico precedente",
        unitaMisuraSnapshot: "pz",
        quantitaPrevista: "2",
        quantitaConsegnata: "0",
        statoPreparazione: "da_preparare",
      })
      .returning();
    const detail = await social.get(
      `/api/interventi/${interventionId}/operativita`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.materiali).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: material.id })]),
    );
    const before = await counts();
    const patch = await social
      .patch(`/api/interventi/${interventionId}/materiali/${material.id}`)
      .send({ statoPreparazione: "pronto", versione: detail.body.versione });
    expect(patch.status).toBe(403);
    const saved = await social
      .post(`/api/interventi/${interventionId}/salva-operativita`)
      .send({
        versione: detail.body.versione,
        materiali: [
          {
            prodottoId: productId,
            magazzinoId: warehouseA,
            quantitaPrevista: 2,
            quantitaConsegnata: 1,
          },
        ],
      });
    expect(saved.status).toBe(403);
    const completed = await social
      .post(`/api/interventi/${interventionId}/concludi`)
      .send({
        versione: detail.body.versione,
        conferma: true,
        risultato: "Tentativo inventariale negato",
        materiali: [
          {
            prodottoId: productId,
            magazzinoId: warehouseA,
            quantitaPrevista: 2,
            quantitaConsegnata: 1,
          },
        ],
      });
    expect(completed.status).toBe(403);
    expect(await counts()).toEqual(before);
    const [still] = await db
      .select()
      .from(interventiMaterialiTable)
      .where(eq(interventiMaterialiTable.id, material.id));
    expect(still.statoPreparazione).toBe("da_preparare");
    expect(Number(still.quantitaConsegnata)).toBe(0);
  });
});
