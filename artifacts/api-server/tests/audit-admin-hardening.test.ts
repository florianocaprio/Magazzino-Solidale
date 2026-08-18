import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { type Express, type Router } from "express";
import request from "supertest";
import { eq, inArray, or } from "drizzle-orm";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  db,
  magazziniTable,
  politicheCreditoSolidaleTable,
  pool,
  ruoliTable,
  ruoliVolontariTable,
  systemLogsTable,
  tipiInterventoTable,
  tipologieFornitoreTable,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import cittaRouter from "../src/routes/citta";
import zoneRouter from "../src/routes/zone-uds";
import centriRouter from "../src/routes/centri-ascolto";
import magazziniRouter from "../src/routes/magazzini";
import politicheRouter from "../src/routes/politiche-credito-solidale";
import ruoliVolontariRouter from "../src/routes/ruoli-volontari";
import tipiInterventoRouter from "../src/routes/tipi-intervento";
import tipologieFornitoreRouter from "../src/routes/tipologie-fornitore";
import utentiRouter from "../src/routes/utenti";
import stampaRouter from "../src/routes/impostazioni-stampa";
import emailRouter from "../src/routes/impostazioni-email";

type Actor = {
  id: number;
  cittaId: number | null;
  isAdmin: boolean;
  isSuperAdmin?: boolean;
};

const ids = {
  aree: [] as number[],
  centri: [] as number[],
  zone: [] as number[],
  magazzini: [] as number[],
  politiche: [] as number[],
  ruoli: [] as number[],
  utenti: [] as number[],
  beneficiari: [] as number[],
  ruoliVolontari: [] as number[],
  tipiIntervento: [] as number[],
  tipologieFornitore: [] as number[],
};

let areaA: number;
let areaB: number;
let centroA: number;
let centroB: number;
let zonaA: number;
let zonaB: number;
let adminRoleId: number;
let operatorRoleId: number;
let superAdmin: Actor;
let globalAdmin: Actor;
let adminA: Actor;
let adminB: Actor;
let operator: Actor;

const suffix = () => Math.random().toString(36).slice(2, 10);

function appAs(actor: Actor, ...routers: Router[]): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: actor.id,
      username: `audit-${actor.id}`,
      email: null,
      emailDaAggiornare: false,
      nome: "Audit",
      cognome: "Admin",
      matricola: null,
      ruoloId: actor.isAdmin ? adminRoleId : operatorRoleId,
      ruoloNome: actor.isAdmin ? "Audit Admin" : "Audit Operator",
      centroAscoltoId: null,
      centroAscoltoNome: null,
      cittaId: actor.cittaId,
      cittaNome: null,
      zonaUdsId: null,
      zonaUdsNome: null,
      isSuperAdmin: actor.isSuperAdmin ?? false,
      isAdmin: actor.isAdmin,
      aree: ["amministrazione", "sociale", "uds", "logistica"],
      permessi: [],
      mustChangePassword: false,
    };
    next();
  });
  routers.forEach((router) => app.use(router));
  return app;
}

async function createUser(
  actor: Omit<Actor, "id">,
  roleId: number,
): Promise<Actor> {
  const token = suffix();
  const [row] = await db
    .insert(utentiTable)
    .values({
      username: `audit_${token}`,
      email: `audit_${token}@example.org`,
      emailDaAggiornare: false,
      passwordHash: "test-only",
      nome: "Audit",
      cognome: "User",
      matricola: `AUD-${token}`,
      ruoloId: roleId,
      cittaId: actor.cittaId,
      isSuperAdmin: actor.isSuperAdmin ?? false,
    })
    .returning({ id: utentiTable.id });
  ids.utenti.push(row.id);
  return { ...actor, id: row.id };
}

beforeEach(async () => {
  const token = suffix();
  const [a, b] = await db
    .insert(cittaTable)
    .values([{ nome: `Area A ${token}` }, { nome: `Area B ${token}` }])
    .returning({ id: cittaTable.id });
  areaA = a.id;
  areaB = b.id;
  ids.aree.push(areaA, areaB);

  const [ca, cb] = await db
    .insert(centriAscoltoTable)
    .values([
      { nome: `Centro A ${token}`, cittaId: areaA },
      { nome: `Centro B ${token}`, cittaId: areaB },
    ])
    .returning({ id: centriAscoltoTable.id });
  centroA = ca.id;
  centroB = cb.id;
  ids.centri.push(centroA, centroB);

  const [za, zb] = await db
    .insert(zoneUdsTable)
    .values([
      { nome: `Zona A ${token}`, cittaId: areaA },
      { nome: `Zona B ${token}`, cittaId: areaB },
    ])
    .returning({ id: zoneUdsTable.id });
  zonaA = za.id;
  zonaB = zb.id;
  ids.zone.push(zonaA, zonaB);

  const [adminRole, operatorRole] = await db
    .insert(ruoliTable)
    .values([
      {
        nome: `Audit Admin ${token}`,
        isAdmin: true,
        aree: ["amministrazione", "sociale", "uds", "logistica"],
      },
      {
        nome: `Audit Operator ${token}`,
        isAdmin: false,
        aree: ["sociale", "uds", "logistica"],
      },
    ])
    .returning({ id: ruoliTable.id });
  adminRoleId = adminRole.id;
  operatorRoleId = operatorRole.id;
  ids.ruoli.push(adminRoleId, operatorRoleId);

  superAdmin = await createUser(
    { cittaId: null, isAdmin: true, isSuperAdmin: true },
    adminRoleId,
  );
  globalAdmin = await createUser({ cittaId: null, isAdmin: true }, adminRoleId);
  adminA = await createUser({ cittaId: areaA, isAdmin: true }, adminRoleId);
  adminB = await createUser({ cittaId: areaB, isAdmin: true }, adminRoleId);
  operator = await createUser(
    { cittaId: areaA, isAdmin: false },
    operatorRoleId,
  );
});

afterEach(async () => {
  if (ids.utenti.length) {
    await db
      .delete(systemLogsTable)
      .where(
        or(
          inArray(systemLogsTable.actorUserId, ids.utenti),
          inArray(systemLogsTable.targetUserId, ids.utenti),
        ),
      );
  }
  if (ids.beneficiari.length)
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, ids.beneficiari.splice(0)));
  if (ids.utenti.length)
    await db
      .delete(utentiTable)
      .where(inArray(utentiTable.id, ids.utenti.splice(0)));
  if (ids.politiche.length)
    await db
      .delete(politicheCreditoSolidaleTable)
      .where(
        inArray(politicheCreditoSolidaleTable.id, ids.politiche.splice(0)),
      );
  if (ids.magazzini.length)
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, ids.magazzini.splice(0)));
  if (ids.zone.length)
    await db
      .delete(zoneUdsTable)
      .where(inArray(zoneUdsTable.id, ids.zone.splice(0)));
  if (ids.centri.length)
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, ids.centri.splice(0)));
  if (ids.aree.length)
    await db
      .delete(cittaTable)
      .where(inArray(cittaTable.id, ids.aree.splice(0)));
  if (ids.ruoliVolontari.length)
    await db
      .delete(ruoliVolontariTable)
      .where(inArray(ruoliVolontariTable.id, ids.ruoliVolontari.splice(0)));
  if (ids.tipiIntervento.length)
    await db
      .delete(tipiInterventoTable)
      .where(inArray(tipiInterventoTable.id, ids.tipiIntervento.splice(0)));
  if (ids.tipologieFornitore.length)
    await db
      .delete(tipologieFornitoreTable)
      .where(
        inArray(tipologieFornitoreTable.id, ids.tipologieFornitore.splice(0)),
      );
  if (ids.ruoli.length)
    await db
      .delete(ruoliTable)
      .where(inArray(ruoliTable.id, ids.ruoli.splice(0)));
});

afterAll(async () => {
  await pool.end();
});

describe("audit hardening Amministrazione/Core", () => {
  it("ADM-01 limita l'Admin A alla lettura della propria Area e riserva le mutazioni all'amministrazione globale", async () => {
    const scopedApp = appAs(adminA, cittaRouter);
    const list = await request(scopedApp).get("/citta");
    expect(list.status).toBe(200);
    expect(list.body.map((row: { id: number }) => row.id)).toEqual([areaA]);
    expect(
      (await request(scopedApp).post("/citta").send({ nome: "Non consentita" }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(scopedApp)
          .patch(`/citta/${areaB}`)
          .send({ nome: "Violazione" })
      ).status,
    ).toBe(403);
    expect((await request(scopedApp).delete(`/citta/${areaB}`)).status).toBe(
      403,
    );

    const globalApp = appAs(globalAdmin, cittaRouter);
    const created = await request(globalApp)
      .post("/citta")
      .send({ nome: `Area globale ${suffix()}` });
    expect(created.status).toBe(201);
    ids.aree.push(created.body.id);
  });

  it("ADM-01 disattiva l'Area senza scollegare le dipendenze", async () => {
    const response = await request(appAs(superAdmin, cittaRouter)).delete(
      `/citta/${areaA}`,
    );
    expect(response.status).toBe(204);
    const [area] = await db
      .select()
      .from(cittaTable)
      .where(eq(cittaTable.id, areaA));
    const [centro] = await db
      .select()
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, centroA));
    const [zona] = await db
      .select()
      .from(zoneUdsTable)
      .where(eq(zoneUdsTable.id, zonaA));
    expect(area.attivo).toBe(false);
    expect(centro.cittaId).toBe(areaA);
    expect(zona.cittaId).toBe(areaA);
  });

  it("ADM-02 applica lo scope alle Zone e la rimozione le disattiva senza partial update", async () => {
    const app = appAs(adminA, zoneRouter);
    expect(
      (
        await request(app)
          .post("/zone-uds")
          .send({ cittaId: areaB, nome: "Zona vietata" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/zone-uds/${zonaB}`)
          .send({ nome: "Violazione" })
      ).status,
    ).toBe(403);
    expect((await request(app).delete(`/zone-uds/${zonaB}`)).status).toBe(403);
    expect(
      (await request(app).post("/zone-uds").send({ cittaId: areaA })).status,
    ).toBe(400);

    expect(
      (
        await request(app)
          .patch(`/zone-uds/${zonaA}`)
          .send({ nome: "Zona A aggiornata" })
      ).status,
    ).toBe(200);
    expect((await request(app).delete(`/zone-uds/${zonaA}`)).status).toBe(204);
    const [own, other] = await db
      .select()
      .from(zoneUdsTable)
      .where(inArray(zoneUdsTable.id, [zonaA, zonaB]));
    const byId = new Map([own, other].map((row) => [row.id, row]));
    expect(byId.get(zonaA)?.attivo).toBe(false);
    expect(byId.get(zonaB)?.attivo).toBe(true);
  });

  it("ADM-03/04 non consente mutazioni su Centri di altra Area o shared e preserva i beneficiari", async () => {
    const [shared] = await db
      .insert(centriAscoltoTable)
      .values({ nome: `Shared ${suffix()}` })
      .returning({ id: centriAscoltoTable.id });
    ids.centri.push(shared.id);
    const [beneficiario] = await db
      .insert(beneficiariTable)
      .values({
        codice: `AUD-${suffix()}`,
        nome: "Mario",
        cognome: "Rossi",
        sesso: "M",
        cittaId: areaA,
        centroAscoltoId: centroA,
      })
      .returning({ id: beneficiariTable.id });
    ids.beneficiari.push(beneficiario.id);
    const app = appAs(adminA, centriRouter);

    expect(
      (
        await request(app)
          .patch(`/centri-ascolto/${centroB}`)
          .send({ nome: "Violazione" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/centri-ascolto/${shared.id}`)
          .send({ nome: "Violazione" })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`/centri-ascolto/${shared.id}`)).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`/centri-ascolto/${centroA}`)).status,
    ).toBe(204);

    const [centro] = await db
      .select()
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, centroA));
    const [storedBeneficiario] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, beneficiario.id));
    expect(centro.attivo).toBe(false);
    expect(storedBeneficiario.centroAscoltoId).toBe(centroA);
  });

  it("ADM-06 separa la visibilità shared dallo scope di mutazione dei Magazzini", async () => {
    const token = suffix();
    const [own, other, shared] = await db
      .insert(magazziniTable)
      .values([
        { codice: `MA-${token}`, nome: "Mag A", cittaId: areaA },
        { codice: `MB-${token}`, nome: "Mag B", cittaId: areaB },
        { codice: `MS-${token}`, nome: "Mag shared", cittaId: null },
      ])
      .returning({ id: magazziniTable.id });
    ids.magazzini.push(own.id, other.id, shared.id);
    const app = appAs(adminA, magazziniRouter);

    expect(
      (
        await request(app)
          .patch(`/magazzini/${own.id}`)
          .send({ nome: "Mag A aggiornato" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .patch(`/magazzini/${other.id}`)
          .send({ nome: "Violazione" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/magazzini/${shared.id}`)
          .send({ nome: "Violazione" })
      ).status,
    ).toBe(403);
    expect((await request(app).delete(`/magazzini/${shared.id}`)).status).toBe(
      403,
    );
  });

  it("ADM-05 impedisce all'Admin A di mutare politiche globali o di Area B", async () => {
    const [globalPolicy, otherPolicy] = await db
      .insert(politicheCreditoSolidaleTable)
      .values([
        { nome: `Globale ${suffix()}`, cittaId: null, centroAscoltoId: null },
        {
          nome: `Area B ${suffix()}`,
          cittaId: areaB,
          centroAscoltoId: centroB,
        },
      ])
      .returning({ id: politicheCreditoSolidaleTable.id });
    ids.politiche.push(globalPolicy.id, otherPolicy.id);
    const app = appAs(adminA, politicheRouter);

    expect(
      (
        await request(app)
          .patch(`/politiche-credito-solidale/${globalPolicy.id}`)
          .send({ attiva: false })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app).delete(
          `/politiche-credito-solidale/${globalPolicy.id}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/politiche-credito-solidale/${otherPolicy.id}`)
          .send({ attiva: false })
      ).status,
    ).toBe(403);
  });

  it("ADM-05 mantiene coerenti Centro e Area nelle politiche", async () => {
    const response = await request(appAs(globalAdmin, politicheRouter))
      .post("/politiche-credito-solidale")
      .send({
        nome: `Incoerente ${suffix()}`,
        cittaId: areaA,
        centroAscoltoId: centroB,
      });
    expect(response.status).toBe(400);
  });

  it("ADM-07 lascia leggibili i lookup ma riserva le mutazioni agli Admin globali", async () => {
    const routes = [
      {
        path: "/ruoli-volontari",
        router: ruoliVolontariRouter,
        ids: ids.ruoliVolontari,
      },
      {
        path: "/tipi-intervento",
        router: tipiInterventoRouter,
        ids: ids.tipiIntervento,
      },
      {
        path: "/tipologie-fornitore",
        router: tipologieFornitoreRouter,
        ids: ids.tipologieFornitore,
      },
    ];
    for (const route of routes) {
      expect(
        (await request(appAs(operator, route.router)).get(route.path)).status,
      ).toBe(200);
      expect(
        (
          await request(appAs(adminA, route.router))
            .post(route.path)
            .send({ nome: `Vietato ${suffix()}` })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(appAs(globalAdmin, route.router))
            .post(route.path)
            .send({})
        ).status,
      ).toBe(400);
      const created = await request(appAs(globalAdmin, route.router))
        .post(route.path)
        .send({ nome: `Lookup ${suffix()}` });
      expect(created.status).toBe(201);
      route.ids.push(created.body.id);
    }
  });

  it("ADM-09 rifiuta assegnazioni utente tra Aree e combinazioni Centro/Area incoerenti", async () => {
    const appA = appAs(adminA, utentiRouter);
    const crossArea = await request(appA)
      .post("/utenti")
      .send({
        username: `cross_${suffix()}`,
        email: `cross_${suffix()}@example.org`,
        password: "Password1",
        nome: "Cross",
        cognome: "Area",
        ruoloId: operatorRoleId,
        cittaId: areaB,
      });
    expect(crossArea.status).toBe(403);

    const incoherent = await request(appAs(globalAdmin, utentiRouter))
      .post("/utenti")
      .send({
        username: `incoherent_${suffix()}`,
        email: `incoherent_${suffix()}@example.org`,
        password: "Password1",
        nome: "Centro",
        cognome: "Errato",
        ruoloId: operatorRoleId,
        cittaId: areaA,
        centroAscoltoId: centroB,
      });
    expect(incoherent.status).toBe(400);
  });

  it("ADM-10/11 applica la policy unica e forza il cambio password al primo accesso", async () => {
    const app = appAs(globalAdmin, utentiRouter);
    const base = {
      nome: "Nuovo",
      cognome: "Utente",
      ruoloId: operatorRoleId,
      cittaId: areaA,
    };
    for (const password of ["Abc123", "solotesto", "12345678"]) {
      const token = suffix();
      const response = await request(app)
        .post("/utenti")
        .send({
          ...base,
          username: `weak_${token}`,
          email: `weak_${token}@example.org`,
          password,
        });
      expect(response.status).toBe(400);
    }

    const token = suffix();
    const valid = await request(app)
      .post("/utenti")
      .send({
        ...base,
        username: `valid_${token}`,
        email: `valid_${token}@example.org`,
        password: "Password1",
      });
    expect(valid.status).toBe(201);
    expect(valid.body.mustChangePassword).toBe(true);
    ids.utenti.push(valid.body.id);
  });

  it("ADM-08 il DELETE utenti disattiva l'account e ne conserva l'identità", async () => {
    const target = await createUser(
      { cittaId: areaA, isAdmin: false },
      operatorRoleId,
    );
    const response = await request(appAs(adminA, utentiRouter)).delete(
      `/utenti/${target.id}`,
    );
    expect(response.status).toBe(204);
    const [stored] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, target.id));
    expect(stored).toBeDefined();
    expect(stored.attivo).toBe(false);
  });

  it("ADM-14 impedisce agli Admin territoriali di modificare singleton globali e ADM-13 rifiuta credenziali SMTP nel DB", async () => {
    expect(
      (
        await request(appAs(adminA, stampaRouter))
          .put("/impostazioni-stampa")
          .send({ footerBolla: "Vietato" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(appAs(adminA, emailRouter))
          .put("/impostazioni-email")
          .send({ adminEmail: "vietato@example.org" })
      ).status,
    ).toBe(403);
    const legacyCredentials = await request(appAs(globalAdmin, emailRouter))
      .put("/impostazioni-email")
      .send({ smtpPassword: "non-salvare" });
    expect(legacyCredentials.status).toBe(400);
  });

  it("ADM-15 consente al SuperAdmin di operare globalmente senza indebolire lo scope degli Admin di Area", async () => {
    const created = await request(appAs(superAdmin, cittaRouter))
      .post("/citta")
      .send({ nome: `Area Super ${suffix()}` });
    expect(created.status).toBe(201);
    ids.aree.push(created.body.id);
    expect(
      (
        await request(appAs(adminB, cittaRouter))
          .patch(`/citta/${created.body.id}`)
          .send({ note: "No" })
      ).status,
    ).toBe(403);
  });
});
