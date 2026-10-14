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
  menseTable,
  utentiMenseTable,
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
  createBeneficiario,
  createUtente,
  insertBolla,
  newScope,
} from "./scope-helpers";

const listeners = httpListeners({ diagnostics: "m66-residual-security" });
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

const period = { da: "2026-01-01", a: "2026-01-31" };
const otherGrants = ["mensa.view", "mensa.reports.view"];
const metric = (
  body: { kpi?: Array<{ key: string; exactValue?: string | null }> },
  key: string,
) => body.kpi?.find((kpi) => kpi.key === key)?.exactValue;

async function fixture(
  permissions = ["bolle.view", ...otherGrants],
  isAdmin = false,
) {
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
  for (const code of ["REPORT", "BOLLE", "MAGAZZINO_SOLIDALE", "MENSA"])
    await updateModuloAmbiente(code, true, null);

  const scope = newScope();
  const area = await createAreaOperativa(scope);
  const warehouse = await createMagazzino(scope, null, {
    areaOperativaId: area,
  });
  const beneficiary = await createBeneficiario(scope, null, {
    areaOperativaId: area,
  });
  // SQL fixture isolates read authorization, not a certification of M4 writers.
  const bolla = await insertBolla(scope, {
    beneficiarioId: beneficiary,
    magazzinoId: warehouse,
    stato: "consegnato",
    dataBolla: "2026-01-15",
  });
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `CERT-MIXED-${randomUUID()}`,
      aree: ["analisi", "sociale", "mensa"],
      permessi: permissions,
      isAdmin,
    })
    .returning();
  const userId = await createUtente(scope, { ruoloId: role.id });
  const password = `Ephemeral-${randomUUID()}-1!`;
  const [user] = await db
    .update(utentiTable)
    .set({
      areaOperativaId: area,
      passwordHash: await bcrypt.hash(password, 4),
    })
    .where(eq(utentiTable.id, userId))
    .returning();
  const [mensa] = await db
    .insert(menseTable)
    .values({
      codice: `SEC-${randomUUID().slice(0, 8)}`,
      nome: "Mensa sintetica autorizzata",
      areaOperativaId: area,
      magazzinoId: warehouse,
    })
    .returning();
  await db.insert(utentiMenseTable).values({
    utenteId: userId,
    mensaId: mensa.id,
    assegnataDa: userId,
  });

  const { default: app } = await import("../src/app");
  const server = await listeners.open("m66-residual", () => app);
  const agent = request.agent(server);
  const login = await agent
    .post("/api/auth/login")
    .send({ username: user.username, password });
  expect(login.status).toBe(200);
  const query = { ...period, magazzinoId: warehouse };
  return {
    scope,
    area,
    warehouse,
    bolla,
    role,
    user,
    mensa,
    agent,
    query,
    password,
  };
}

it("SEC-01/02/07 a mixed Social/Mensa role loses Pacchi data after bolle.view revocation, preserving authorized Mensa", async () => {
  const { agent, bolla, role, mensa, query } = await fixture();
  expect((await agent.get(`/api/bolle/${bolla}`)).status).toBe(200);
  const before = await agent.get("/api/report/pacchi").query(query);
  expect(before.status).toBe(200);
  expect(metric(before.body, "pacchiDistribuiti")).toBe("1");
  const beforeGeneral = await agent.get("/api/report/dashboard").query(period);
  expect(beforeGeneral.status).toBe(200);
  expect(metric(beforeGeneral.body, "pacchiDistribuiti")).toBe("1");
  expect(
    (
      await agent
        .get("/api/report/mensa")
        .query({ ...period, mensaId: mensa.id })
    ).status,
  ).toBe(200);

  await db
    .update(ruoliTable)
    .set({ permessi: otherGrants })
    .where(eq(ruoliTable.id, role.id));

  // Collect all surfaces of this one scenario before evaluating the oracles.
  // No re-login, retry, mocked session or mutation of the business fixture.
  const source = await agent.get(`/api/bolle/${bolla}`);
  const section = await agent.get("/api/report/pacchi").query(query);
  const general = await agent.get("/api/report/dashboard").query(period);
  const detail = await agent.get("/api/report/drilldown").query({
    ...query,
    section: "pacchi",
    metric: "pacchiDistribuiti",
  });
  const options = await agent
    .get("/api/report/filter-options")
    .query({ ...period, section: "pacchi" });
  const prepared = await agent
    .post("/api/report/prepare")
    .query({ ...query, section: "pacchi" });
  const preparedGeneral = await agent
    .post("/api/report/prepare")
    .query({ ...period, section: "generale" });
  const retainedMensa = await agent
    .get("/api/report/mensa")
    .query({ ...period, mensaId: mensa.id });
  console.info("M66_RESIDUAL_SECURITY", {
    source: source.status,
    section: {
      status: section.status,
      count: metric(section.body, "pacchiDistribuiti"),
    },
    general: {
      status: general.status,
      count: metric(general.body, "pacchiDistribuiti"),
    },
    detail: {
      status: detail.status,
      total: detail.body.total,
      rows: detail.body.rows,
    },
    options: {
      status: options.status,
      warehouses: options.body.warehouses?.length,
    },
    prepared: {
      status: prepared.status,
      count: metric(prepared.body.report ?? {}, "pacchiDistribuiti"),
    },
    preparedGeneral: {
      status: preparedGeneral.status,
      count: metric(preparedGeneral.body.report ?? {}, "pacchiDistribuiti"),
    },
    retainedMensa: retainedMensa.status,
  });
  expect.soft(source.status).toBe(403);
  expect.soft(retainedMensa.status).toBe(200);
  // A composited report may stay readable, but never return the revoked fact.
  expect.soft([200, 403].includes(section.status)).toBe(true);
  expect.soft(metric(section.body, "pacchiDistribuiti") ?? null).toBeNull();
  expect.soft(general.status).toBe(200);
  expect.soft(metric(general.body, "pacchiDistribuiti") ?? null).toBeNull();
  expect
    .soft(
      [403, 404].includes(detail.status) ||
        (detail.status === 200 &&
          detail.body.total === 0 &&
          detail.body.rows?.length === 0),
    )
    .toBe(true);
  expect
    .soft(
      [403, 404].includes(options.status) ||
        (options.status === 200 && options.body.warehouses?.length === 0),
    )
    .toBe(true);
  expect.soft([200, 403].includes(prepared.status)).toBe(true);
  expect
    .soft(metric(prepared.body.report ?? {}, "pacchiDistribuiti") ?? null)
    .toBeNull();
  expect.soft(preparedGeneral.status).toBe(200);
  expect
    .soft(
      metric(preparedGeneral.body.report ?? {}, "pacchiDistribuiti") ?? null,
    )
    .toBeNull();
}, 30000);

it("SEC Pacchi re-grant restores reads and prepared data on the same session", async () => {
  const { agent, role, query } = await fixture(otherGrants);
  expect((await agent.get("/api/report/pacchi").query(query)).status).toBe(403);
  await db
    .update(ruoliTable)
    .set({ permessi: ["bolle.view", ...otherGrants] })
    .where(eq(ruoliTable.id, role.id));
  const result = await agent
    .post("/api/report/prepare")
    .query({ ...query, section: "pacchi" });
  expect(result.status).toBe(200);
  expect(metric(result.body.report, "pacchiDistribuiti")).toBe("1");
  expect(
    result.body.options.warehouses.map((w: { id: number }) => w.id),
  ).toContain(query.magazzinoId);
});

it("SEC Pacchi grant alone never bypasses the source area or an absent territorial scope", async () => {
  const { agent, role, user, query } = await fixture();
  await db
    .update(ruoliTable)
    .set({ aree: ["analisi", "mensa"] })
    .where(eq(ruoliTable.id, role.id));
  expect((await agent.get("/api/report/pacchi").query(query)).status).toBe(403);
  const general = await agent
    .post("/api/report/prepare")
    .query({ ...period, section: "generale" });
  expect(general.status).toBe(200);
  expect(metric(general.body.report, "pacchiDistribuiti")).toBeUndefined();
  await db
    .update(ruoliTable)
    .set({ aree: ["analisi", "sociale", "mensa"] })
    .where(eq(ruoliTable.id, role.id));
  await db
    .update(utentiTable)
    .set({ areaOperativaId: null })
    .where(eq(utentiTable.id, user.id));
  for (const section of ["pacchi", "generale"]) {
    expect(
      (await agent.post("/api/report/prepare").query({ ...period, section }))
        .status,
    ).toBe(403);
  }
});

it.each([false, true])(
  "SEC Pacchi territorial scope remains enforced for admin=%s",
  async (isAdmin) => {
    const { agent, scope, query } = await fixture(
      isAdmin ? [] : ["bolle.view"],
      isAdmin,
    );
    const own = await agent
      .post("/api/report/prepare")
      .query({ ...query, section: "pacchi" });
    expect(own.status).toBe(200);
    expect(metric(own.body.report, "pacchiDistribuiti")).toBe("1");
    const otherArea = await createAreaOperativa(scope);
    const foreign = await createMagazzino(scope, null, {
      areaOperativaId: otherArea,
    });
    for (const section of ["pacchi", "generale"]) {
      expect(
        (
          await agent
            .post("/api/report/prepare")
            .query({ ...query, section, magazzinoId: foreign })
        ).status,
      ).toBe(403);
    }
  },
);

it("SEC explicit global admin keeps Pacchi without synthetic grants", async () => {
  const { agent, user, query } = await fixture([], true);
  await db
    .update(utentiTable)
    .set({ areaOperativaId: null })
    .where(eq(utentiTable.id, user.id));
  const result = await agent
    .post("/api/report/prepare")
    .query({ ...query, section: "pacchi" });
  expect(result.status).toBe(200);
  expect(metric(result.body.report, "pacchiDistribuiti")).toBe("1");
});

it("SEC removing BOLLE excludes only Pacchi from the mixed report and its warehouse options", async () => {
  const { agent, query, mensa } = await fixture();
  await updateModuloAmbiente("BOLLE", false, null);
  try {
    expect(
      (
        await agent
          .post("/api/report/prepare")
          .query({ ...query, section: "pacchi" })
      ).status,
    ).toBe(403);
    const result = await agent
      .post("/api/report/prepare")
      .query({ ...period, section: "generale" });
    expect(result.status).toBe(200);
    expect(metric(result.body.report, "pacchiDistribuiti")).toBeUndefined();
    expect(result.body.options.warehouses).toEqual([]);
    expect(
      (
        await agent
          .get("/api/report/mensa")
          .query({ ...period, mensaId: mensa.id })
      ).status,
    ).toBe(200);
  } finally {
    await updateModuloAmbiente("BOLLE", true, null);
  }
});

it.each(["grant", "logout", "switch-user", "relogin-same-user"] as const)(
  "SEC/PDF-08 Pacchi preparation blocked in PostgreSQL rejects concurrent %s",
  async (change) => {
    const original = await fixture();
    const { agent, role, query } = original;
    const replacement =
      change === "switch-user"
        ? await fixture(otherGrants)
        : change === "relogin-same-user"
          ? original
          : undefined;
    const lock = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let replacementCookies: string[] = [];
    try {
      await lock.query("BEGIN");
      await lock.query("LOCK TABLE bolle IN ACCESS EXCLUSIVE MODE");
      pending = agent
        .post("/api/report/prepare")
        .query({ ...query, section: "pacchi" })
        .then((result) => result);
      const deadline = Date.now() + 10000;
      let observed = false;
      while (Date.now() < deadline) {
        const waiting = await pool.query(
          "SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND NOT l.granted AND l.relation='bolle'::regclass AND a.pid<>pg_backend_pid()",
        );
        if (waiting.rowCount) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(
        observed,
        "PostgreSQL lock wait must precede authorization change",
      ).toBe(true);
      if (change === "grant") {
        await db
          .update(ruoliTable)
          .set({ permessi: otherGrants })
          .where(eq(ruoliTable.id, role.id));
      } else {
        expect((await agent.post("/api/auth/logout")).status).toBe(204);
        if (replacement) {
          const login = await agent.post("/api/auth/login").send({
            username: replacement.user.username,
            password: replacement.password,
          });
          expect(login.status).toBe(200);
          replacementCookies = ([] as string[])
            .concat(login.headers["set-cookie"] ?? [])
            .map((value) => value.split(";")[0]);
          const beforeLateResponse = await agent.get("/api/auth/me");
          expect(beforeLateResponse.status).toBe(200);
          expect(beforeLateResponse.body.id).toBe(replacement.user.id);
        }
      }
      await lock.query("ROLLBACK");
      const result = await pending;
      expect(result.status).toBe(change === "grant" ? 403 : 401);
      expect(result.body).not.toHaveProperty("report");
      expect(result.body).not.toHaveProperty("detail");
      if (change !== "grant")
        expect(result.headers["set-cookie"]).toBeUndefined();
      if (replacement) {
        const lateCookies = ([] as string[])
          .concat(result.headers["set-cookie"] ?? [])
          .map((value) => value.split(";")[0]);
        const current = await agent.get("/api/auth/me");
        console.info("M66_SESSION_SWITCH", {
          replacementAuthenticatedBeforeLateResponse: true,
          replacementCookieCount: replacementCookies.length,
          lateResponseCookieCount: lateCookies.length,
          lateResponseReplacesCookie: lateCookies.some((cookie) =>
            replacementCookies.some(
              (value) =>
                value.split("=")[0] === cookie.split("=")[0] &&
                value !== cookie,
            ),
          ),
          authStatusAfterLateResponse: current.status,
          currentUserIsReplacement: current.body.id === replacement.user.id,
        });
        expect(lateCookies).toEqual([]);
        expect(current.status).toBe(200);
        expect(current.body.id).toBe(replacement.user.id);
        expect(
          (await agent.get("/api/report/pacchi").query(query)).status,
        ).toBe(change === "relogin-same-user" ? 200 : 403);
      }
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
      if (pending) await pending;
    }
  },
  30000,
);

it("SEC successful prepare keeps the authenticated session and normal rolling cookie", async () => {
  const { agent, user, query } = await fixture();
  const result = await agent
    .post("/api/report/prepare")
    .query({ ...query, section: "pacchi" });
  expect(result.status).toBe(200);
  expect(metric(result.body.report, "pacchiDistribuiti")).toBe("1");
  const cookies = ([] as string[]).concat(result.headers["set-cookie"] ?? []);
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatch(/^magazzino\.sid=/);
  expect(cookies[0]).toContain("HttpOnly");
  expect(cookies[0]).toContain("SameSite=Lax");
  const current = await agent.get("/api/auth/me");
  expect(current.status).toBe(200);
  expect(current.body.id).toBe(user.id);
});
