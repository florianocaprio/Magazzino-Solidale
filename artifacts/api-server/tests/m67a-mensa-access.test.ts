import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, afterAll, expect, it } from "vitest";
import { db, pool, ruoliTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { httpListeners } from "./helpers/http-listeners";
import { m67aMensaFixture, m67aNeed } from "./helpers/m67a-mensa-fixture";

const listeners = httpListeners({ diagnostics: "m67a-mensa" });
let f: Awaited<ReturnType<typeof m67aMensaFixture>>;
const agents: Record<string, ReturnType<typeof request.agent>> = {};
let requestId: number, otherId: number, code: string;
beforeAll(async () => {
  f = await m67aMensaFixture();
  const { default: app } = await import("../src/app");
  const server = await listeners.open("app", () => app);
  for (const [key, user] of Object.entries(f.users)) {
    agents[key] = request.agent(server);
    const login = await agents[key]
      .post("/api/auth/login")
      .send({ username: user.username, password: user.password });
    expect(login.status, login.text).toBe(200);
  }
  const created = await agents.requester
    .post("/api/richieste-magazzino")
    .send(m67aNeed(f));
  expect(created.status, created.text).toBe(201);
  requestId = created.body.id;
  code = created.body.codice;
  const other = await agents.admin
    .post("/api/richieste-magazzino")
    .send(m67aNeed(f, f.canteens[1].id));
  expect(other.status, other.text).toBe(201);
  otherId = other.body.id;
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

it.each(["receiver", "requester", "manager", "mixed", "admin"])(
  "M67-10/11 %s can read its request and supplies",
  async (name) => {
    const context = await agents[name].get("/api/mensa/mense");
    expect(context.status, context.text).toBe(200);
    expect(
      context.body
        .map((m: { id: number }) => m.id)
        .sort((a: number, b: number) => a - b),
    ).toEqual(
      name === "admin"
        ? expect.arrayContaining(f.canteens.map((m) => m.id))
        : f.canteens.map((m) => m.id).sort((a, b) => a - b),
    );
    const detail = await agents[name].get(
      `/api/richieste-magazzino/${requestId}`,
    );
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.id).toBe(requestId);
    expect(detail.body.codice).toBe(code);
    expect(
      (await agents[name].get(`/api/richieste-magazzino/${requestId}/storico`))
        .status,
    ).toBe(200);
    const list = await agents[name]
      .get("/api/mensa/trasferimenti")
      .query({ mensaId: f.canteens[0].id });
    expect(list.status, list.text).toBe(200);
  },
);
it.each(["receiver", "requester", "manager"])(
  "M67-11 %s can read M2 in the same Area without assignment",
  async (name) => {
    expect(
      (await agents[name].get(`/api/richieste-magazzino/${otherId}`)).status,
    ).toBe(200);
    expect(
      (await agents[name].get(`/api/richieste-magazzino/${otherId}/storico`))
        .status,
    ).toBe(200);
    const list = await agents[name].get("/api/richieste-magazzino");
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((r: { id: number }) => r.id)).toEqual(
      expect.arrayContaining([requestId, otherId]),
    );
    expect(
      (
        await agents[name]
          .get("/api/mensa/trasferimenti")
          .query({ mensaId: f.canteens[1].id })
      ).status,
    ).toBe(200);
  },
);
it("M67-11 reports-only does not acquire request or supply access", async () => {
  expect(
    (await agents.reporter.get(`/api/richieste-magazzino/${requestId}`)).status,
  ).toBe(403);
  expect((await agents.reporter.get("/api/richieste-magazzino")).status).toBe(
    403,
  );
  expect((await agents.reporter.get("/api/mensa/trasferimenti")).status).toBe(
    403,
  );
  const report = await agents.reporter
    .get("/api/report/mensa")
    .query({ da: "2026-01-01", a: "2026-12-31", mensaId: f.canteens[0].id });
  expect(report.status, report.text).toBe(200);
  expect(
    report.body.tables.some(
      (table: { key: string }) => table.key === "richiesteTop200",
    ),
  ).toBe(false);
});
it.each(["mixed", "admin"])(
  "M67-11 %s retains separately authorized Warehouse/Admin visibility",
  async (name) => {
    expect(
      (await agents[name].get(`/api/richieste-magazzino/${otherId}`)).status,
    ).toBe(200);
  },
);
it("M67-12 reporting exposes the exact authorized request and no other Mensa", async () => {
  const result = await agents.receiver
    .get("/api/report/mensa")
    .query({ da: "2026-01-01", a: "2026-12-31", mensaId: f.canteens[0].id });
  expect(result.status, result.text).toBe(200);
  const rows = result.body.tables.find(
    (t: { key: string }) => t.key === "richiesteTop200",
  ).rows;
  expect(rows.map((r: { id: number }) => r.id)).toEqual([requestId]);
  expect(rows[0].codice).toBe(code);
});
it("M67-10 receive-only receives the real M4 supply exactly once, without request/dispatch rights", async () => {
  const warehouse = agents.warehouse,
    receiver = agents.receiver;
  expect(
    (await receiver.post("/api/richieste-magazzino").send(m67aNeed(f))).status,
  ).toBe(403);
  const taken = await warehouse
    .post(`/api/richieste-magazzino/${requestId}/presa-in-carico`)
    .send({ versione: 1, idempotencyKey: randomUUID() });
  expect(taken.status, taken.text).toBe(200);
  const created = await warehouse
    .post(`/api/richieste-magazzino/${requestId}/documento`)
    .send({
      versione: taken.body.versione,
      idempotencyKey: randomUUID(),
      magazzinoId: f.origin,
      righe: [{ prodottoId: f.product, quantita: "12", unitaMisura: "kg" }],
    });
  expect(created.status, created.text).toBe(201);
  const transfer = (
    await pool.query(
      "select id,versione from trasferimenti where magazzino_origine_id=$1",
      [f.origin],
    )
  ).rows[0];
  const path = `/api/trasferimenti/${transfer.id}`;
  const edited = await warehouse.patch(path).send({
    versione: transfer.versione,
    idempotencyKey: randomUUID(),
    trasportatoreNome: "Trasporto sintetico",
    righe: [{ prodottoId: f.product, quantita: "12", unitaMisura: "kg" }],
  });
  expect(edited.status, edited.text).toBe(200);
  for (const command of ["prepara", "avvia"])
    expect(
      (
        await receiver.post(`${path}/${command}`).send({
          versione: edited.body.versione,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
  const prepared = await warehouse
    .post(`${path}/prepara`)
    .send({ versione: edited.body.versione, idempotencyKey: randomUUID() });
  expect(prepared.status, prepared.text).toBe(200);
  const shipped = await warehouse
    .post(`${path}/avvia`)
    .send({ versione: prepared.body.versione, idempotencyKey: randomUUID() });
  expect(shipped.status, shipped.text).toBe(200);
  const receipt = {
    versione: shipped.body.versione,
    idempotencyKey: randomUUID(),
  };
  expect(
    (await agents.requester.post(`${path}/conferma`).send(receipt)).status,
  ).toBe(403);
  expect((await receiver.get(path)).status).toBe(200);
  const received = await receiver.post(`${path}/conferma`).send(receipt);
  expect(received.status, received.text).toBe(200);
  expect((await receiver.post(`${path}/conferma`).send(receipt)).status).toBe(
    200,
  );
  const stock = (
    await pool.query(
      "select sum(quantita_residua)::text qty from lotti where prodotto_id=$1 and magazzino_id=$2",
      [f.product, f.canteens[0].magazzinoId],
    )
  ).rows[0];
  expect(stock.qty).toBe("12.000000");
  expect(
    (
      await pool.query(
        "select count(*)::int n from movimenti where trasferimento_id=$1 and tipo_dettaglio='entrata'",
        [transfer.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("Area: vecchia API di assegnazione non modifica gli accessi; revoca ruolo efficace nella stessa sessione", async () => {
  const revoked = await agents.admin
    .put(`/api/utenti/${f.users.receiver.id}/mense/${f.canteens[0].id}`)
    .send({ attiva: false, motivo: "Vecchia interfaccia" });
  expect(revoked.status, revoked.text).toBe(410);
  expect(
    (await agents.receiver.get(`/api/richieste-magazzino/${requestId}`)).status,
  ).toBe(200);
  await db
    .update(ruoliTable)
    .set({ permessi: ["mensa.reports.view"] })
    .where(eq(ruoliTable.id, f.users.manager.roleId));
  expect(
    (await agents.manager.get(`/api/richieste-magazzino/${requestId}`)).status,
  ).toBe(403);
});
