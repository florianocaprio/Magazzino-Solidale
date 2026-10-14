import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  ruoliTable,
  utentiTable,
  movimentiTable,
  trasferimentiTable,
} from "@workspace/db";
import { initDbExtensions } from "../src/lib/dbInit";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { httpListeners } from "./helpers/http-listeners";
import {
  createAreaOperativa,
  createMagazzino,
  createProdotto,
  createUtente,
  newScope,
  insertTrasferimento,
} from "./scope-helpers";

const listeners = httpListeners({ diagnostics: "m66-grant-revocation" });
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

it("SEC source area revocation also removes stock while preserving an authorized logistics source", async () => {
  const { agent, query, role } = await fixture([
    "magazzino.view",
    "logistica.mezzi.view",
  ]);
  await db
    .update(ruoliTable)
    .set({ aree: ["analisi", "logistica"] })
    .where(eq(ruoliTable.id, role.id));
  expect((await agent.get("/api/movimenti").query(query)).status).toBe(403);
  expect(
    (await agent.get("/api/report/giacenze-per-magazzino").query(query)).status,
  ).toBe(403);
  const result = await agent
    .post("/api/report/prepare")
    .query({ ...query, section: "magazzino-logistica" });
  expect(result.status).toBe(200);
  expect(result.body.report.kpi.map((k: { key: string }) => k.key)).toEqual([
    "mezziUtilizzati",
  ]);
  expect(result.body.report.tables).toEqual([]);
  expect(result.body.report.series).toEqual([]);
  expect(
    (
      await agent.get("/api/report/drilldown").query({
        ...query,
        section: "magazzino-logistica",
        metric: "movimentiCarico",
      })
    ).status,
  ).toBe(403);
}, 30000);

async function fixture(permissions = ["magazzino.view"], isAdmin = false) {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.REPORTING_TEST_DISPOSABLE_DB !== "verified" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "59666" ||
    url.pathname !== "/m66_dev"
  )
    throw new Error("Dedicated disposable reporting DB required");
  await initDbExtensions();
  await ensureAmbienteModuli();
  for (const code of [
    "REPORT",
    "MAGAZZINO_SOLIDALE",
    "LOTTI",
    "TRASFERIMENTI",
    "MEZZI",
    "APPROVVIGIONAMENTI",
    "CENTRO_ASCOLTO",
  ])
    await updateModuloAmbiente(code, true, null);
  const scope = newScope();
  const area = await createAreaOperativa(scope);
  const warehouse = await createMagazzino(scope, null, {
    areaOperativaId: area,
  });
  const product = await createProdotto(scope, { unitaMisura: "pz" });
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `CERT-REVOKE-${randomUUID()}`,
      aree: ["analisi", "magazzino", "logistica"],
      permessi: permissions,
      isAdmin,
    })
    .returning();
  const id = await createUtente(scope, { ruoloId: role.id });
  const password = `Ephemeral-${randomUUID()}-1!`;
  const [user] = await db
    .update(utentiTable)
    .set({
      areaOperativaId: area,
      passwordHash: await bcrypt.hash(password, 4),
    })
    .where(eq(utentiTable.id, id))
    .returning();
  await db.insert(movimentiTable).values({
    tipoMovimento: "carico",
    tipoDettaglio: "carico_manuale",
    dataMovimento: "2026-01-15",
    magazzinoId: warehouse,
    prodottoId: product,
    quantita: "3.000000",
    quantitaPezzi: "3.000000",
    unitaMisura: "pz",
    operatoreId: id,
  });
  const { default: app } = await import("../src/app");
  const server = await listeners.open("m66-revoke", () => app);
  const agent = request.agent(server);
  expect(
    (
      await agent
        .post("/api/auth/login")
        .send({ username: user.username, password })
    ).status,
  ).toBe(200);
  const query = { da: "2026-01-01", a: "2026-01-31", magazzinoId: warehouse };
  return { agent, query, role, user, scope, area, warehouse };
}

it("SEC-01/07 revoking magazzino.view on the same session denies the source and prevents its movement count being exported", async () => {
  const { agent, query, role, scope, area, warehouse, user } = await fixture();
  const destination = await createMagazzino(scope, null, {
    areaOperativaId: area,
  });
  const transfer = await insertTrasferimento(scope, {
    origineId: warehouse,
    destinoId: destination,
  });
  await db
    .update(trasferimentiTable)
    .set({ dataRichiesta: "2026-01-15" })
    .where(eq(trasferimentiTable.id, transfer));
  const detail = await agent.get("/api/report/drilldown").query({
    ...query,
    section: "magazzino-logistica",
    metric: "trasferimentiRichiesti",
  });
  expect(detail.status).toBe(200);
  expect(detail.body.total).toBe(1);
  expect(detail.body.rows.map((row: { id: number }) => row.id)).toEqual([
    transfer,
  ]);
  expect((await agent.get("/api/movimenti").query(query)).status).toBe(200);
  expect(
    (await agent.get("/api/report/giacenze-per-magazzino").query(query)).status,
  ).toBe(200);
  const control = await agent
    .get("/api/report/magazzino-logistica")
    .query(query);
  expect(control.status).toBe(200);
  expect(
    control.body.kpi.find((k: { key: string }) => k.key === "movimentiCarico")
      .exactValue,
  ).toBe("1");

  await db
    .update(ruoliTable)
    .set({ permessi: [] })
    .where(eq(ruoliTable.id, role.id));
  expect((await agent.get("/api/movimenti").query(query)).status).toBe(403);
  for (const path of [
    "/api/report/filter-options",
    "/api/report/drilldown",
    "/api/report/giacenze-per-magazzino",
  ]) {
    expect(
      (
        await agent.get(path).query({
          ...query,
          section: "magazzino-logistica",
          metric: "movimentiCarico",
        })
      ).status,
    ).toBe(403);
  }
  for (const kind of ["section", "prepare"] as const) {
    const response =
      kind === "section"
        ? await agent.get("/api/report/magazzino-logistica").query(query)
        : await agent
            .post("/api/report/prepare")
            .query({ ...query, section: "magazzino-logistica" });
    // A composite report may omit the now unauthorized source instead of
    // rejecting the whole report. It must never expose its old count.
    expect(response.status).toBe(403);
    const report = kind === "prepare" ? response.body.report : response.body;
    const metric = report?.kpi?.find(
      (k: { key: string }) => k.key === "movimentiCarico",
    );
    console.info(
      "M66_CURRENT_GRANT",
      JSON.stringify({
        surface: kind,
        sourceStatus: 403,
        reportStatus: response.status,
        metric,
      }),
    );
    expect
      .soft(
        response.status === 403 ||
          metric == null ||
          (metric.value == null && metric.exactValue == null),
        `${kind}: revoked source must not expose movement counts`,
      )
      .toBe(true);
  }
  await db
    .update(ruoliTable)
    .set({ permessi: ["magazzino.view"] })
    .where(eq(ruoliTable.id, role.id));
  const restored = await agent
    .post("/api/report/prepare")
    .query({ ...query, section: "magazzino-logistica" });
  expect(restored.status).toBe(200);
  expect(
    restored.body.report.kpi.find(
      (k: { key: string }) => k.key === "movimentiCarico",
    ).exactValue,
  ).toBe("1");
}, 30000);

it("SEC-07 a grant revoked while PostgreSQL is preparing export prevents delivering the old dataset", async () => {
  const { agent, query, role } = await fixture();
  const lock = await pool.connect();
  let pending: Promise<request.Response> | undefined;
  try {
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE movimenti IN ACCESS EXCLUSIVE MODE");
    pending = agent
      .post("/api/report/prepare")
      .query({ ...query, section: "magazzino-logistica" })
      .then((response) => response);
    const deadline = Date.now() + 10000;
    let observed = false;
    while (Date.now() < deadline) {
      const waiting = await pool.query(
        "SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND NOT l.granted AND l.relation='movimenti'::regclass AND a.pid<>pg_backend_pid()",
      );
      if (waiting.rowCount) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(
      observed,
      "A real PostgreSQL lock wait must precede the revoke",
    ).toBe(true);
    await db
      .update(ruoliTable)
      .set({ permessi: [] })
      .where(eq(ruoliTable.id, role.id));
    await lock.query("ROLLBACK");
    const result = await pending;
    expect(result.status).toBe(403);
    expect(result.body).not.toHaveProperty("report");
    expect(result.body).not.toHaveProperty("detail");
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
    if (pending) await pending;
  }
}, 30000);

it("SEC an explicit global admin retains source reads without synthetic grants", async () => {
  const { agent, user, query } = await fixture([], true);
  await db
    .update(utentiTable)
    .set({ areaOperativaId: null })
    .where(eq(utentiTable.id, user.id));
  expect((await agent.get("/api/movimenti").query(query)).status).toBe(200);
  const result = await agent
    .post("/api/report/prepare")
    .query({ ...query, section: "magazzino-logistica" });
  expect(result.status).toBe(200);
  expect(
    result.body.report.kpi.find(
      (k: { key: string }) => k.key === "movimentiCarico",
    ).exactValue,
  ).toBe("1");
}, 30000);

it.each([
  ["logistica.mezzi.view", "mezziUtilizzati", "/api/mezzi"],
  [
    "approvvigionamenti.view",
    "approvvigionamentiAperti",
    "/api/approvvigionamenti",
  ],
])(
  "SEC mixed role retains %s after warehouse revocation, without stock/series/quality leakage",
  async (grant, key, source) => {
    const { agent, query, role, warehouse } = await fixture([
      "magazzino.view",
      grant,
    ]);
    await db
      .update(ruoliTable)
      .set({ permessi: [grant] })
      .where(eq(ruoliTable.id, role.id));
    expect((await agent.get(source)).status).toBe(200);
    expect((await agent.get("/api/movimenti").query(query)).status).toBe(403);
    for (const prepare of [false, true]) {
      const response = prepare
        ? await agent
            .post("/api/report/prepare")
            .query({ ...query, section: "magazzino-logistica" })
        : await agent.get("/api/report/magazzino-logistica").query(query);
      expect(response.status).toBe(200);
      const report = prepare ? response.body.report : response.body;
      expect(report.kpi.map((k: { key: string }) => k.key)).toEqual([key]);
      expect(report.kpi[0].exactValue).toBe("0");
      expect(report.tables).toEqual([]);
      expect(report.series).toEqual([]);
      expect(report.quality).toEqual([]);
    }
    for (const metric of [
      "movimentiCarico",
      "movimentiScarico",
      "trasferimenti",
      "trasferimentiRichiesti",
      "trasferimentiInTransito",
      "trasferimentiCompletati",
    ]) {
      expect(
        (
          await agent
            .get("/api/report/drilldown")
            .query({ ...query, section: "magazzino-logistica", metric })
        ).status,
      ).toBe(403);
    }
    const options = await agent
      .get("/api/report/filter-options")
      .query({ section: "magazzino-logistica" });
    expect(options.status).toBe(200);
    expect(options.body.warehouses.map((w: { id: number }) => w.id)).toEqual(
      grant === "approvvigionamenti.view" ? [warehouse] : [],
    );
    await db
      .update(ruoliTable)
      .set({ permessi: [] })
      .where(eq(ruoliTable.id, role.id));
    expect((await agent.get(source)).status).toBe(403);
    expect(
      (
        await agent
          .post("/api/report/prepare")
          .query({ ...query, section: "magazzino-logistica" })
      ).status,
    ).toBe(403);
  },
  30000,
);

it("SEC disabled source modules cannot be bypassed by an unrelated enabled logistics module", async () => {
  const { agent, query } = await fixture([
    "magazzino.view",
    "logistica.mezzi.view",
  ]);
  try {
    for (const code of ["MAGAZZINO_SOLIDALE", "LOTTI", "TRASFERIMENTI"])
      await updateModuloAmbiente(code, false, null);
    const report = await agent
      .post("/api/report/prepare")
      .query({ ...query, section: "magazzino-logistica" });
    expect(report.status).toBe(200);
    expect(report.body.report.kpi.map((k: { key: string }) => k.key)).toEqual([
      "mezziUtilizzati",
    ]);
    expect(report.body.report.tables).toEqual([]);
    expect(report.body.report.series).toEqual([]);
    expect(report.body.options.warehouses).toEqual([]);
    expect(
      (
        await agent.get("/api/report/drilldown").query({
          ...query,
          section: "magazzino-logistica",
          metric: "movimentiCarico",
        })
      ).status,
    ).toBe(403);
  } finally {
    for (const code of ["MAGAZZINO_SOLIDALE", "LOTTI", "TRASFERIMENTI"])
      await updateModuloAmbiente(code, true, null);
  }
}, 30000);

it.each([false, true])(
  "SEC admin=%s does not turn a current territory into global visibility",
  async (isAdmin) => {
    const { agent, query, scope } = await fixture(
      isAdmin ? [] : ["magazzino.view"],
      isAdmin,
    );
    const otherArea = await createAreaOperativa(scope);
    const other = await createMagazzino(scope, null, {
      areaOperativaId: otherArea,
    });
    const own = await agent
      .post("/api/report/prepare")
      .query({ ...query, section: "magazzino-logistica" });
    expect(own.status).toBe(200);
    expect(
      own.body.report.kpi.find(
        (k: { key: string }) => k.key === "movimentiCarico",
      ).exactValue,
    ).toBe("1");
    expect(
      (
        await agent.post("/api/report/prepare").query({
          ...query,
          section: "magazzino-logistica",
          magazzinoId: other,
        })
      ).status,
    ).toBe(403);
  },
  30000,
);
