/* @vitest-environment node */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  pool,
  areeOperativeTable,
  centriAscoltoTable,
  beneficiariTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import app from "../src/app";

const suffix = randomUUID().slice(0, 8);
const password = "M5A-test-only-Password-2026!";
let beneficiaryId: number;
let social: ReturnType<typeof request.agent>;
let warehouse: ReturnType<typeof request.agent>;
let readonly: ReturnType<typeof request.agent>;
let otherCenter: ReturnType<typeof request.agent>;
let requestId: number;

async function createUser(
  name: string,
  areaId: number,
  centerId: number | null,
  areas: string[],
  permissions: string[],
) {
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `M5A-session-${name}-${suffix}`,
      aree: areas,
      permessi: permissions,
    })
    .returning({ id: ruoliTable.id });
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `m5a-session-${name}-${suffix}`,
      passwordHash: await bcrypt.hash(password, 10),
      nome: `M5A ${name}`,
      ruoloId: role.id,
      centroAscoltoId: centerId,
      areaOperativaId: areaId,
    })
    .returning({ username: utentiTable.username });
  const agent = request.agent(app);
  const login = await agent
    .post("/api/auth/login")
    .send({ username: user.username, password });
  expect(login.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  if (process.env.M5A_TEST_DISPOSABLE_DB !== "verified") {
    throw new Error(
      "M5A session test requires a verified disposable PostgreSQL database",
    );
  }
  const [area] = await db
    .insert(areeOperativeTable)
    .values({ nome: `M5A session area ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  const [center] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `M5A session center ${suffix}`, areaOperativaId: area.id })
    .returning({ id: centriAscoltoTable.id });
  const [secondCenter] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `M5A session other ${suffix}`, areaOperativaId: area.id })
    .returning({ id: centriAscoltoTable.id });
  const [beneficiary] = await db
    .insert(beneficiariTable)
    .values({
      codice: `M5A-S-${suffix}`,
      nome: "Ada",
      cognome: "Sintetica",
      areaOperativaId: area.id,
      centroAscoltoId: center.id,
    })
    .returning({ id: beneficiariTable.id });
  beneficiaryId = beneficiary.id;
  social = await createUser(
    "social",
    area.id,
    center.id,
    ["sociale"],
    [
      "richieste_magazzino.view",
      "richieste_magazzino.create",
      "richieste_magazzino.update",
      "richieste_magazzino.cancel",
      "beneficiari.view",
    ],
  );
  warehouse = await createUser(
    "warehouse",
    area.id,
    null,
    ["magazzino"],
    [
      "richieste_magazzino.view",
      "richieste_magazzino.take",
      "richieste_magazzino.cancel",
    ],
  );
  readonly = await createUser(
    "readonly",
    area.id,
    null,
    ["magazzino"],
    ["richieste_magazzino.view"],
  );
  otherCenter = await createUser(
    "other",
    area.id,
    secondCenter.id,
    ["sociale"],
    ["richieste_magazzino.view", "beneficiari.view"],
  );
});

afterAll(async () => {
  // Le ricevute e l'audit restano append-only nel DB disposable della sessione.
  await pool.end();
});

describe("M5A full-app auth/session/areaGuard", () => {
  it("rifiuta la coda senza sessione", async () => {
    expect((await request(app).get("/api/richieste-magazzino")).status).toBe(
      401,
    );
  });

  it("consente l'invio Centro e la sola lettura minimizzata al Magazzino", async () => {
    const created = await social.post("/api/richieste-magazzino").send({
      idempotencyKey: randomUUID(),
      tipoDestinatario: "beneficiario",
      sorgente: "beneficiario",
      beneficiarioId: beneficiaryId,
      bisogno: "Pacco sintetico",
      priorita: "normale",
    });
    expect(created.status).toBe(201);
    requestId = created.body.id;
    const listed = await warehouse.get("/api/richieste-magazzino");
    expect(listed.status).toBe(200);
    expect(
      listed.body.items.some((item: { id: number }) => item.id === requestId),
    ).toBe(true);
    const detail = await warehouse.get(`/api/richieste-magazzino/${requestId}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toMatch(
      /noteInterne|restrizioniAlimentari|allergie|codiceFiscale/,
    );
    expect(
      (await warehouse.get(`/api/beneficiari/${beneficiaryId}`)).status,
    ).toBe(403);
  });

  it("nega scrittura Magazzino e presa in carico sola lettura", async () => {
    expect(
      (
        await warehouse
          .post("/api/richieste-magazzino")
          .send({ idempotencyKey: randomUUID() })
      ).status,
    ).toBe(403);
    expect(
      (
        await readonly
          .post(`/api/richieste-magazzino/${requestId}/presa-in-carico`)
          .send({ idempotencyKey: randomUUID(), versione: 1 })
      ).status,
    ).toBe(403);
  });

  it("nega liste, conteggi e dettaglio a un altro Centro nella stessa Area", async () => {
    const list = await otherCenter.get("/api/richieste-magazzino");
    expect(list.status).toBe(200);
    expect(
      list.body.items.some((item: { id: number }) => item.id === requestId),
    ).toBe(false);
    expect(
      (await otherCenter.get(`/api/richieste-magazzino/${requestId}`)).status,
    ).toBe(404);
  });
});
