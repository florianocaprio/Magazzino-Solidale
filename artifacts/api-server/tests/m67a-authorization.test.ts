import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  ruoliTable,
  utentiTable,
  movimentiTable,
} from "@workspace/db";
import { initDbExtensions } from "../src/lib/dbInit";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { httpListeners } from "./helpers/http-listeners";
import {
  createAreaOperativa,
  createCentroRec,
  createMagazzino,
  createProdotto,
  createUtente,
  newScope,
} from "./scope-helpers";

const listeners = httpListeners({ diagnostics: "m67a" });
const scope = newScope();
let areaA: number, areaB: number, centroA: number;
let own: number, shared: number, otherCentre: number, otherArea: number;
let product: number;
const grant = ["magazzino.view"];
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.M67A_DISPOSABLE_DB !== "verified" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "59671" ||
    url.pathname !== "/m67a_dev"
  )
    throw new Error("Dedicated disposable M67A DB required");
  await initDbExtensions();
  await ensureAmbienteModuli();
  await updateModuloAmbiente("MAGAZZINO_SOLIDALE", true, null);
  areaA = await createAreaOperativa(scope);
  areaB = await createAreaOperativa(scope);
  centroA = (await createCentroRec(scope, { areaOperativaId: areaA })).id;
  const centroOther = (await createCentroRec(scope, { areaOperativaId: areaA }))
    .id;
  own = await createMagazzino(scope, centroA, { areaOperativaId: areaA });
  shared = await createMagazzino(scope, null, { areaOperativaId: areaA });
  otherCentre = await createMagazzino(scope, centroOther, {
    areaOperativaId: areaA,
  });
  otherArea = await createMagazzino(scope, null, { areaOperativaId: areaB });
  product = await createProdotto(scope);
  // Read-boundary fixture only: not a certification of inventory writers.
  await db.insert(movimentiTable).values(
    [own, shared, otherCentre, otherArea].map((magazzinoId) => ({
      magazzinoId,
      prodottoId: product,
      tipoMovimento: "carico",
      tipoDettaglio: "donazione",
      quantita: "1.000000",
      unitaMisura: "pz",
      dataMovimento: "2026-10-15",
    })),
  );
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

async function actor(
  area: number | null,
  centro: number | null,
  isAdmin = false,
) {
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `M67A-${randomUUID()}`,
      aree: ["magazzino"],
      permessi: grant,
      isAdmin,
    })
    .returning();
  const id = await createUtente(scope, { ruoloId: role.id, centroId: centro });
  const password = `Synthetic-${randomUUID()}-1!`;
  const [user] = await db
    .update(utentiTable)
    .set({
      areaOperativaId: area,
      passwordHash: await bcrypt.hash(password, 4),
    })
    .where(eq(utentiTable.id, id))
    .returning();
  const { default: app } = await import("../src/app");
  const agent = request.agent(await listeners.open("app", () => app));
  expect(
    (
      await agent
        .post("/api/auth/login")
        .send({ username: user.username, password })
    ).status,
  ).toBe(200);
  return { agent, user, role };
}
async function visible(agent: Awaited<ReturnType<typeof actor>>["agent"]) {
  const result = await agent
    .get("/api/movimenti")
    .query({ limit: 100, prodottoId: product });
  expect(result.status).toBe(200);
  expect(Array.isArray(result.body)).toBe(true);
  return { items: result.body, total: Number(result.headers["x-total-count"]) };
}
it("M67-01 ordinary actor without Area/Centro is denied, not global", async () => {
  const { agent } = await actor(null, null);
  const result = await agent.get("/api/movimenti");
  console.info("M67-01 observed", {
    status: result.status,
    total: result.headers["x-total-count"],
    warehouseIds: Array.isArray(result.body)
      ? result.body.map((row) => row.magazzinoId)
      : undefined,
    error: result.body.error,
  });
  expect(result.status).toBe(403);
  expect(result.body).not.toHaveProperty("data");
});
it("M67-02 explicit administrative global role retains cross-Area reads", async () => {
  const { agent } = await actor(null, null, true);
  const body = await visible(agent);
  expect(
    body.items.map((row: { magazzinoId: number }) => row.magazzinoId),
  ).toEqual(expect.arrayContaining([own, shared, otherCentre, otherArea]));
});
it("M67-02 scoped Admin stays in Area A", async () => {
  const { agent } = await actor(areaA, null, true);
  const body = await visible(agent);
  expect(
    body.items.map((row: { magazzinoId: number }) => row.magazzinoId).sort(),
  ).toEqual([own, shared, otherCentre].sort());
  expect(body.total).toBe(3);
  expect((await agent.get(`/api/magazzini/${shared}`)).status).toBe(200);
  expect((await agent.get(`/api/magazzini/${otherArea}`)).status).toBe(403);
});
it("Area: old Centre assignment does not exclude other Centres in Area A", async () => {
  const { agent } = await actor(areaA, centroA);
  const body = await visible(agent);
  expect(
    body.items.map((row: { magazzinoId: number }) => row.magazzinoId).sort(),
  ).toEqual([own, shared, otherCentre].sort());
  expect(body.total).toBe(3);
  expect((await agent.get(`/api/magazzini/${own}`)).status).toBe(200);
  expect((await agent.get(`/api/magazzini/${shared}`)).status).toBe(200);
  expect((await agent.get(`/api/magazzini/${otherCentre}`)).status).toBe(200);
  expect((await agent.get(`/api/magazzini/${otherArea}`)).status).toBe(403);
});
it("M67-03 removing territory in the same HTTP session must not become global", async () => {
  const { agent, user } = await actor(areaA, centroA);
  await visible(agent);
  await db
    .update(utentiTable)
    .set({ areaOperativaId: null, centroAscoltoId: null })
    .where(eq(utentiTable.id, user.id));
  expect((await agent.get("/api/movimenti")).status).toBe(403);
});
it("M67-03 current role grants are reloaded in the same HTTP session", async () => {
  const { agent, role } = await actor(areaA, centroA);
  await visible(agent);
  await db
    .update(ruoliTable)
    .set({ permessi: [] })
    .where(eq(ruoliTable.id, role.id));
  expect((await agent.get("/api/movimenti")).status).toBe(403);
});

it("M67-03 removing only Centre retains Area A, never all Areas", async () => {
  const { agent, user } = await actor(areaA, centroA);
  expect((await visible(agent)).total).toBe(3);
  await db
    .update(utentiTable)
    .set({ centroAscoltoId: null })
    .where(eq(utentiTable.id, user.id));
  const body = await visible(agent);
  expect(
    body.items.map((row: { magazzinoId: number }) => row.magazzinoId).sort(),
  ).toEqual([own, shared, otherCentre].sort());
  expect(body.total).toBe(3);
});

it("M67-01/03 common read boundary covers list, count, detail, export and projections", async () => {
  const { agent, role } = await actor(null, null);
  await db
    .update(ruoliTable)
    .set({ aree: ["magazzino", "sociale", "logistica", "generale"] })
    .where(eq(ruoliTable.id, role.id));
  for (const path of [
    "/movimenti",
    "/movimenti/export",
    `/movimenti?magazzinoId=${otherArea}`,
    "/magazzini",
    `/magazzini/${otherArea}`,
    "/lotti",
    "/lotti/1",
    "/carichi",
    "/carichi/1",
    "/carico-pratiche",
    "/scarichi",
    "/preparazione-consegne",
    "/giacenze",
    "/bolle",
    "/bolle/1",
    "/trasferimenti",
    "/trasferimenti/1",
    "/documenti-operativi",
    "/documenti-operativi/export.xlsx",
    "/documenti-operativi/trasferimento/1",
    "/dashboard/stats",
    "/dashboard/alerts",
    "/dashboard/movimenti-recenti",
    "/approvvigionamenti",
  ]) {
    const result = await agent.get(`/api${path}`);
    expect(result.status, path).toBe(403);
    expect(result.body.error, path).toBe(
      "Assegna un'Area Operativa all'utente prima di utilizzare le funzionalità.",
    );
    expect(result.headers).not.toHaveProperty("x-total-count");
  }
});

it("M67-01 Report endpoints independently reject a no-territory persisted actor with all required grants", async () => {
  const { agent, role } = await actor(null, null);
  await updateModuloAmbiente("REPORT", true, null);
  await db
    .update(ruoliTable)
    .set({
      aree: [
        "analisi",
        "magazzino",
        "sociale",
        "mensa",
        "emporio",
        "uds",
        "logistica",
      ],
      permessi: [
        "magazzino.view",
        "bolle.view",
        "mensa.reports.view",
        "uds.reports.view",
        "magazzino.fse.view",
      ],
    })
    .where(eq(ruoliTable.id, role.id));
  for (const section of [
    "generale",
    "pacchi",
    "centro-ascolto",
    "mensa",
    "emporio",
    "uds",
    "magazzino-logistica",
    "fse-plus",
  ]) {
    const route =
      section === "generale"
        ? "dashboard"
        : section === "fse-plus"
          ? "fse-plus/integrato"
          : section;
    for (const path of [
      `/report/${route}`,
      "/report/filter-options",
      "/report/prepare",
    ]) {
      const call =
        path === "/report/prepare"
          ? agent.post(`/api${path}`)
          : agent.get(`/api${path}`);
      const result = await call.query({
        section,
        da: "2026-01-01",
        a: "2026-12-31",
      });
      expect(result.status, `${path}/${section}: ${result.text}`).toBe(403);
      expect(result.body).not.toHaveProperty("kpi");
    }
  }
});
