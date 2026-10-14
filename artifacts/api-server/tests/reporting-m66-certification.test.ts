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
  trasferimentiTable,
} from "@workspace/db";
import { initDbExtensions } from "../src/lib/dbInit";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { canAccessMagazzino } from "../src/lib/centroScope";
import { httpListeners } from "./helpers/http-listeners";
import {
  createAreaOperativa,
  createCentroRec,
  createMagazzino,
  createUtente,
  newScope,
  insertTrasferimento,
} from "./scope-helpers";

const scope = newScope();
const listeners = httpListeners({ diagnostics: "m66-certification" });
const period = { da: "2026-01-01", a: "2026-01-31" };
const section = "magazzino-logistica";
type Agent = ReturnType<typeof request.agent>;
let ordinary: Agent, scopedAdmin: Agent, globalAdmin: Agent, unassigned: Agent;
let area: number,
  centre: number,
  local: number,
  sharedCentre: number,
  foreign: number;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.REPORTING_TEST_DISPOSABLE_DB !== "verified" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "59666" ||
    url.pathname !== "/m66_dev"
  ) {
    throw new Error("Dedicated disposable reporting DB required");
  }
  await initDbExtensions();
  await ensureAmbienteModuli();
  for (const code of ["REPORT", "MAGAZZINO_SOLIDALE", "LOTTI", "TRASFERIMENTI"])
    await updateModuloAmbiente(code, true, null);
  area = await createAreaOperativa(scope);
  const otherArea = await createAreaOperativa(scope);
  centre = (await createCentroRec(scope, { areaOperativaId: area })).id;
  local = await createMagazzino(scope, centre, { areaOperativaId: area });
  sharedCentre = await createMagazzino(scope, null, { areaOperativaId: area });
  foreign = await createMagazzino(scope, null, { areaOperativaId: otherArea });
  const { default: app } = await import("../src/app");
  const server = await listeners.open("m66-certification", () => app);
  async function login(
    isAdmin: boolean,
    areaId: number | null,
    centreId: number | null,
  ) {
    const [role] = await db
      .insert(ruoliTable)
      .values({
        nome: `CERT-${randomUUID()}`,
        aree: ["analisi", "magazzino", "logistica"],
        permessi: ["magazzino.view", "trasferimenti.view"],
        isAdmin,
      })
      .returning();
    const id = await createUtente(scope, {
      ruoloId: role.id,
      centroId: centreId,
    });
    const password = `Temporary-${randomUUID()}-1!`;
    const [user] = await db
      .update(utentiTable)
      .set({
        areaOperativaId: areaId,
        passwordHash: await bcrypt.hash(password, 4),
      })
      .where(eq(utentiTable.id, id))
      .returning();
    const agent = request.agent(server);
    expect(
      (
        await agent
          .post("/api/auth/login")
          .send({ username: user.username, password })
      ).status,
    ).toBe(200);
    return agent;
  }
  ordinary = await login(false, area, centre);
  scopedAdmin = await login(true, area, centre);
  globalAdmin = await login(true, null, null);
  unassigned = await login(false, null, null);
});

afterAll(async () => {
  await listeners.close();
  await pool.end();
});

it("CERT-SEC-01 ordinary NULL territory is denied on section, general, options, drilldown and prepare", async () => {
  for (const [path, query] of [
    ["/api/report/magazzino-logistica", period],
    ["/api/report/dashboard", period],
    ["/api/report/filter-options", { section }],
    [
      "/api/report/drilldown",
      { ...period, section, metric: "movimentiCarico" },
    ],
  ] as const)
    expect((await unassigned.get(path).query(query)).status).toBe(403);
  expect(
    (await unassigned.post("/api/report/prepare").query({ ...period, section }))
      .status,
  ).toBe(403);
});

it("CERT-SEC-01 explicit global admin can select a warehouse in another Area", async () => {
  const result = await globalAdmin
    .get("/api/report/magazzino-logistica")
    .query({ ...period, magazzinoId: foreign });
  expect(result.status).toBe(200);
  expect(result.body.filters.magazzinoId).toBe(foreign);
});

it.each(["ordinary", "scopedAdmin"])(
  "CERT-SEC-05 %s cannot select foreign warehouse on all parameterized surfaces",
  async (kind) => {
    const agent = kind === "ordinary" ? ordinary : scopedAdmin;
    for (const path of [
      "/api/report/magazzino-logistica",
      "/api/report/dashboard",
      "/api/report/drilldown",
    ]) {
      expect(
        (
          await agent.get(path).query({
            ...period,
            section,
            metric: "movimentiCarico",
            magazzinoId: foreign,
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await agent
          .post("/api/report/prepare")
          .query({ ...period, section, magazzinoId: foreign })
      ).status,
    ).toBe(403);
    const options = await agent
      .get("/api/report/filter-options")
      .query({ section });
    expect(options.status).toBe(200);
    expect(
      options.body.warehouses.map((w: { id: number }) => w.id),
    ).not.toContain(foreign);
  },
);

it("CERT-SEC-05 shared Centre stays visible without revealing a foreign Area", async () => {
  expect(await canAccessMagazzino(sharedCentre, centre, area)).toBe(true);
  const options = await ordinary
    .get("/api/report/filter-options")
    .query({ section });
  expect(options.status).toBe(200);
  expect(options.body.warehouses.map((w: { id: number }) => w.id)).toEqual(
    expect.arrayContaining([local, sharedCentre]),
  );
  const report = await ordinary
    .get("/api/report/magazzino-logistica")
    .query({ ...period, magazzinoId: sharedCentre });
  expect(report.status).toBe(200);
});

it("CERT-SEC-05 a shared-Centre warehouse with a valid Area is reconcilable in report options and prepared dataset", async () => {
  // User decision: NULL Area is invalid, not a global/shared warehouse.
  // A NULL Centre remains valid and shared strictly within its own Area.
  expect(await canAccessMagazzino(sharedCentre, centre, area)).toBe(true);
  const report = await ordinary
    .get("/api/report/magazzino-logistica")
    .query({ ...period, magazzinoId: sharedCentre });
  expect(report.status).toBe(200);
  expect(
    report.body.kpi.find((k: { key: string }) => k.key === "magazziniVisibili")
      .value,
  ).toBe(1);
  const prepared = await ordinary
    .post("/api/report/prepare")
    .query({ ...period, section, magazzinoId: sharedCentre });
  expect(prepared.status).toBe(200);
  expect(prepared.body.report.filters.magazzinoId).toBe(sharedCentre);
  const options = await ordinary
    .get("/api/report/filter-options")
    .query({ section });
  expect(options.status).toBe(200);
  expect
    .soft(options.body.warehouses.map((w: { id: number }) => w.id))
    .toContain(sharedCentre);
  expect
    .soft(prepared.body.options.warehouses.map((w: { id: number }) => w.id))
    .toContain(sharedCentre);
});

it("CERT-SEC-05 NULL Area cannot be inserted or persisted by an update, including direct SQL", async () => {
  await expect(
    pool.query(
      "INSERT INTO magazzini(codice,nome) VALUES ('CERT-INVALID','Invalid')",
    ),
  ).rejects.toMatchObject({ code: "23502", column: "area_operativa_id" });
  await expect(
    pool.query("UPDATE magazzini SET area_operativa_id=NULL WHERE id=$1", [
      local,
    ]),
  ).rejects.toMatchObject({ code: "23502", column: "area_operativa_id" });
  const persisted = await pool.query(
    "SELECT area_operativa_id FROM magazzini WHERE id=$1",
    [local],
  );
  expect(persisted.rows).toEqual([{ area_operativa_id: area }]);
  expect(
    (
      await pool.query(
        "SELECT id FROM magazzini WHERE area_operativa_id IS NULL",
      )
    ).rows,
  ).toEqual([]);
});

it("CERT-SEC-05 legitimate cross-Area transfer is visible once without admitting unrelated foreign transfers", async () => {
  const a = await insertTrasferimento(scope, {
    origineId: local,
    destinoId: foreign,
  });
  const b = await insertTrasferimento(scope, {
    origineId: foreign,
    destinoId: sharedCentre,
  });
  const thirdArea = await createAreaOperativa(scope);
  const third = await createMagazzino(scope, null, {
    areaOperativaId: thirdArea,
  });
  const unrelated = await insertTrasferimento(scope, {
    origineId: foreign,
    destinoId: third,
  });
  for (const id of [a, b, unrelated])
    await db
      .update(trasferimentiTable)
      .set({ dataRichiesta: "2026-01-15", stato: "completato" })
      .where(eq(trasferimentiTable.id, id));
  const prepared = await ordinary
    .post("/api/report/prepare")
    .query({ ...period, section });
  expect(prepared.status).toBe(200);
  expect(
    prepared.body.report.kpi.find(
      (k: { key: string }) => k.key === "trasferimentiCompletati",
    ),
  ).toMatchObject({ value: 2 });
  const detail = await ordinary
    .get("/api/report/drilldown")
    .query({ ...period, section, metric: "trasferimentiCompletati" });
  expect(detail.status).toBe(200);
  expect(detail.body.total).toBe(2);
  expect(detail.body.rows.map((r: { id: number }) => r.id).sort()).toEqual(
    [a, b].sort(),
  );
  expect(
    prepared.body.options.warehouses.map((w: { id: number }) => w.id),
  ).not.toContain(foreign);
  expect(
    prepared.body.options.warehouses.map((w: { id: number }) => w.id),
  ).not.toContain(third);
});
