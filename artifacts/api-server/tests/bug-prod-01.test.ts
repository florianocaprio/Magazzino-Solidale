import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  db,
  pool,
  ruoliTable,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import app from "../src/app";
import { runEnvironmentDataCli } from "../src/cli/environment-data";
import { initializeBaseData } from "../src/lib/baseData";
import {
  DEMO_BENEFICIARY_CODE,
  DEMO_USER_USERNAME,
  previewDemoReset,
  resetAllDemoData,
} from "../src/lib/demoEnvironment";
import { updateImpostazioniModuli } from "../src/lib/impostazioniModuli";
import { EMPORIO_AREA_KEY } from "../src/lib/areas";
import { SUPER_ADMIN_ROLE_NAME } from "../src/lib/seedRoles";
import { errorMessage } from "../../magazzino-solidale/src/lib/api-error";

const suffix = Math.random().toString(36).slice(2, 9);
const superUsername = `sadmin_bugprod_${suffix}`;
const limitedUsername = `limited_bugprod_${suffix}`;
const password = "Bug-Prod-01-Test!";
const testOrigin =
  process.env.APP_ORIGINS?.split(",")[0] ?? "http://localhost:8083";

let superUserId: number;
let limitedUserId: number;
let limitedRoleId: number;
let roleWithEmporioId: number;
let secondRoleId: number;
let createdCittaId: number;
let createdZoneId: number;
let createdCentroId: number;
let sentinelCittaId: number;
let superAgent: ReturnType<typeof request.agent>;
let limitedAgent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  process.env.DEMO_USER_INITIAL_PASSWORD = "Demo-Bug-Prod-01!";
  await initializeBaseData();

  const [superRole] = await db
    .select({ id: ruoliTable.id })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, SUPER_ADMIN_ROLE_NAME));
  if (!superRole) throw new Error("Ruolo SuperAdmin non inizializzato");

  const [limitedRole] = await db
    .insert(ruoliTable)
    .values({
      nome: `BUG-PROD-01 Limitato ${suffix}`,
      aree: ["generale"],
      isAdmin: false,
    })
    .returning({ id: ruoliTable.id });
  limitedRoleId = limitedRole.id;

  const passwordHash = await bcrypt.hash(password, 4);
  const users = await db
    .insert(utentiTable)
    .values([
      {
        username: superUsername,
        passwordHash,
        nome: "Super Admin",
        cognome: "BUG PROD 01",
        ruoloId: superRole.id,
        attivo: true,
        isSuperAdmin: true,
      },
      {
        username: limitedUsername,
        passwordHash,
        nome: "Utente Limitato",
        cognome: "BUG PROD 01",
        ruoloId: limitedRoleId,
        attivo: true,
        isSuperAdmin: false,
      },
    ])
    .returning({ id: utentiTable.id, username: utentiTable.username });
  superUserId = users.find((row) => row.username === superUsername)!.id;
  limitedUserId = users.find((row) => row.username === limitedUsername)!.id;

  await updateImpostazioniModuli(
    { emporioAbilitato: true, unitaStradaAbilitata: true },
    superUserId,
  );

  superAgent = request.agent(app);
  const superLogin = await superAgent
    .post("/api/auth/login")
    .set("Origin", testOrigin)
    .send({ username: superUsername, password });
  expect(superLogin.status).toBe(200);

  limitedAgent = request.agent(app);
  const limitedLogin = await limitedAgent
    .post("/api/auth/login")
    .set("Origin", testOrigin)
    .send({ username: limitedUsername, password });
  expect(limitedLogin.status).toBe(200);
});

afterAll(async () => {
  try {
    await resetAllDemoData(superUserId);
  } catch {
    // Le asserzioni espongono il problema originale; il cleanup resta best effort.
  }

  await superAgent?.post("/api/auth/logout").set("Origin", testOrigin);
  await limitedAgent?.post("/api/auth/logout").set("Origin", testOrigin);
  if (createdCentroId) {
    await db
      .delete(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, createdCentroId));
  }
  if (createdZoneId) {
    await db.delete(zoneUdsTable).where(eq(zoneUdsTable.id, createdZoneId));
  }
  if (createdCittaId) {
    await db.delete(cittaTable).where(eq(cittaTable.id, createdCittaId));
  }
  if (sentinelCittaId) {
    await db.delete(cittaTable).where(eq(cittaTable.id, sentinelCittaId));
  }
  await db
    .delete(auditConfigurazioniTable)
    .where(
      inArray(auditConfigurazioniTable.utenteId, [superUserId, limitedUserId]),
    );
  await db
    .delete(utentiTable)
    .where(inArray(utentiTable.id, [superUserId, limitedUserId]));
  const roleIds = [limitedRoleId, roleWithEmporioId, secondRoleId].filter(
    (id): id is number => Boolean(id),
  );
  if (roleIds.length > 0) {
    await db.delete(ruoliTable).where(inArray(ruoliTable.id, roleIds));
  }
  delete process.env.DEMO_USER_INITIAL_PASSWORD;
  await pool.end();
});

describe("BUG-PROD-01 - catalogo aree e autenticazione", () => {
  it("1. il catalogo aree accessibili contiene EMPORIO", async () => {
    const response = await superAgent.get("/api/aree");
    expect(response.status).toBe(200);
    expect(response.body).toContainEqual({
      key: EMPORIO_AREA_KEY,
      label: "Emporio",
    });
  });

  it("2. crea un ruolo con area EMPORIO", async () => {
    const response = await superAgent
      .post("/api/ruoli")
      .set("Origin", testOrigin)
      .send({
        nome: `BUG-PROD-01 Emporio ${suffix}`,
        descrizione: "Ruolo sintetico",
        aree: [EMPORIO_AREA_KEY],
        isAdmin: false,
      });
    expect(response.status).toBe(201);
    expect(response.body.aree).toEqual([EMPORIO_AREA_KEY]);
    roleWithEmporioId = response.body.id;
  });

  it("3. modifica un ruolo aggiungendo EMPORIO", async () => {
    const response = await superAgent
      .patch(`/api/ruoli/${roleWithEmporioId}`)
      .set("Origin", testOrigin)
      .send({ aree: ["generale", EMPORIO_AREA_KEY] });
    expect(response.status).toBe(200);
    expect(response.body.aree).toEqual(["generale", EMPORIO_AREA_KEY]);
  });

  it("4. mantiene EMPORIO dopo la rilettura del ruolo", async () => {
    const response = await superAgent.get(`/api/ruoli/${roleWithEmporioId}`);
    expect(response.status).toBe(200);
    expect(response.body.aree).toContain(EMPORIO_AREA_KEY);
  });

  it("5. il login crea una sessione", async () => {
    const agent = request.agent(app);
    const response = await agent
      .post("/api/auth/login")
      .set("Origin", testOrigin)
      .send({ username: superUsername, password });
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeDefined();
    await agent.post("/api/auth/logout").set("Origin", testOrigin);
  });

  it("6. /auth/me riconosce la sessione", async () => {
    const response = await superAgent.get("/api/auth/me");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      username: superUsername,
      isSuperAdmin: true,
    });
  });

  it("7. sadmin crea un ruolo", async () => {
    const response = await superAgent
      .post("/api/ruoli")
      .set("Origin", testOrigin)
      .send({
        nome: `BUG-PROD-01 Secondo ${suffix}`,
        aree: ["generale"],
        isAdmin: false,
      });
    expect(response.status).toBe(201);
    secondRoleId = response.body.id;
  });

  it("8. sadmin crea Area/Citta e Zona UDS", async () => {
    const area = await superAgent
      .post("/api/citta")
      .set("Origin", testOrigin)
      .send({
        nome: `Area BUG-PROD-01 ${suffix}`,
        provincia: "Demo",
        sigla: "bp",
      });
    expect(area.status).toBe(201);
    createdCittaId = area.body.id;

    const zone = await superAgent
      .post("/api/zone-uds")
      .set("Origin", testOrigin)
      .send({
        nome: `Zona BUG-PROD-01 ${suffix}`,
        cittaId: createdCittaId,
      });
    expect(zone.status).toBe(201);
    createdZoneId = zone.body.id;
  });

  it("9. sadmin crea un Centro di Ascolto", async () => {
    const response = await superAgent
      .post("/api/centri-ascolto")
      .set("Origin", testOrigin)
      .send({
        nome: `Centro BUG-PROD-01 ${suffix}`,
        cittaId: createdCittaId,
      });
    expect(response.status).toBe(201);
    expect(response.body.cittaId).toBe(createdCittaId);
    createdCentroId = response.body.id;
  });

  it("10. una richiesta non autenticata riceve 401", async () => {
    const response = await request(app)
      .post("/api/ruoli")
      .set("Origin", testOrigin)
      .send({
        nome: `Ruolo anonimo ${suffix}`,
        aree: [],
      });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Non autenticato");
  });

  it("11. un autenticato senza permesso riceve 403", async () => {
    const response = await limitedAgent.get("/api/aree");
    expect(response.status).toBe(403);
    expect(response.body.error).not.toBe("Non autenticato");
  });

  it("12. un payload non valido riceve 400", async () => {
    const response = await superAgent
      .post("/api/citta")
      .set("Origin", testOrigin)
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Inserimento area non valido");
  });

  it("13. il frontend mostra il messaggio reale anziche un falso 401", () => {
    expect(
      errorMessage(
        { data: { error: "Inserimento area non valido" } },
        "Non autenticato",
      ),
    ).toBe("Inserimento area non valido");
  });
});

describe("BUG-PROD-01 - seed e reset demo", () => {
  it("14. il seed demo e idempotente", async () => {
    const first = await runEnvironmentDataCli([
      "seed-demo",
      `--super-admin=${superUsername}`,
    ]);
    const second = await runEnvironmentDataCli([
      "seed-demo",
      `--super-admin=${superUsername}`,
    ]);
    expect(first).toMatchObject({
      createdUsers: 1,
      createdBeneficiaries: 1,
      createdEmporioAccesses: 1,
      createdProdotti: 8,
    });
    expect(second).toMatchObject({
      createdUsers: 0,
      createdBeneficiaries: 0,
      createdEmporioAccesses: 0,
      createdProdotti: 0,
    });
  });

  it("15. il reset demo elimina solo dati marcati demo", async () => {
    const [sentinel] = await db
      .insert(cittaTable)
      .values({ nome: `Dato non demo ${suffix}` })
      .returning({ id: cittaTable.id });
    sentinelCittaId = sentinel.id;

    const reset = await runEnvironmentDataCli([
      "reset-demo",
      `--super-admin=${superUsername}`,
      "--confirm=RESET DATI DEMO",
    ]);
    expect(reset).toMatchObject({
      deletedUsers: 1,
      deletedBeneficiaries: 1,
      deletedProdotti: 8,
    });
    expect(
      await db
        .select({ id: cittaTable.id })
        .from(cittaTable)
        .where(eq(cittaTable.id, sentinelCittaId)),
    ).toHaveLength(1);
    expect(await previewDemoReset()).toMatchObject({
      demoUsers: 0,
      demoBeneficiaries: 0,
      demoProducts: 0,
    });
  });

  it("16. un non Super Admin non puo eseguire reset", async () => {
    await expect(
      runEnvironmentDataCli([
        "reset-demo",
        `--super-admin=${limitedUsername}`,
        "--confirm=RESET DATI DEMO",
      ]),
    ).rejects.toThrow("non ha privilegi Super Admin");
  });

  it("17. il reset non elimina l'ultimo Super Admin", async () => {
    await runEnvironmentDataCli([
      "seed-demo",
      `--super-admin=${superUsername}`,
    ]);
    await runEnvironmentDataCli([
      "reset-demo",
      `--super-admin=${superUsername}`,
      "--confirm=RESET DATI DEMO",
    ]);
    const [superAdmin] = await db
      .select({ id: utentiTable.id, isSuperAdmin: utentiTable.isSuperAdmin })
      .from(utentiTable)
      .where(eq(utentiTable.id, superUserId));
    expect(superAdmin).toMatchObject({ id: superUserId, isSuperAdmin: true });
  });

  it("18. il reset granulare rispetta le dipendenze FK", async () => {
    await runEnvironmentDataCli([
      "seed-demo",
      `--super-admin=${superUsername}`,
    ]);
    await expect(
      runEnvironmentDataCli([
        "reset-demo-beneficiari",
        `--super-admin=${superUsername}`,
        "--confirm=RESET BENEFICIARI DEMO",
      ]),
    ).rejects.toThrow("rimuovere prima i dati demo Emporio e UDS collegati");
    expect(
      await db
        .select({ id: beneficiariTable.id })
        .from(beneficiariTable)
        .where(eq(beneficiariTable.codice, DEMO_BENEFICIARY_CODE)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: utentiTable.id })
        .from(utentiTable)
        .where(eq(utentiTable.username, DEMO_USER_USERNAME)),
    ).toHaveLength(1);
  });
});
