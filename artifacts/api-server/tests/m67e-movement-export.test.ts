import { afterAll, beforeAll, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool } from "@workspace/db";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import { httpListeners } from "./helpers/http-listeners";
import { createProdotto, newScope } from "./scope-helpers";
import { createWarehouseLoad } from "../src/lib/inventoryLedger";

const listeners = httpListeners({ diagnostics: "m67e-export" });
let f: Awaited<ReturnType<typeof m67aMensaFixture>>;
let actor: ReturnType<typeof request.agent>;
let product: number;
beforeAll(async () => {
  f = await m67aMensaFixture();
  const { default: app } = await import("../src/app");
  actor = request.agent(await listeners.open("app", () => app));
  expect(
    (await actor.post("/api/auth/login").send(f.users.warehouse)).status,
  ).toBe(200);
  product = await createProdotto(newScope(), {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
  });
  for (let n = 0; n < 5; n++) await load();
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});
const load = () =>
  db.transaction((tx) =>
    createWarehouseLoad(tx, {
      magazzinoId: f.origin,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-10-16",
      creatoDa: f.users.admin.id,
      righe: [
        {
          prodottoId: product,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1.000001",
        },
      ],
    }),
  );
const ids = async () =>
  (
    await pool.query(
      "select id from movimenti where prodotto_id=$1 order by data_creazione desc,id desc",
      [product],
    )
  ).rows.map((r) => r.id);

it("E-FIX-01 exports one complete stable filtered set rather than concatenating offset pages", async () => {
  const expected = await ids();
  const response = await actor
    .get("/api/movimenti/export")
    .query({ prodottoId: product });
  expect(response.status, response.text).toBe(200);
  expect(response.body.map((r: { id: number }) => r.id)).toEqual(expected);
  expect(response.headers["x-total-count"]).toBe(String(expected.length));
  expect(response.headers["x-page-size"]).toBe(String(expected.length));
  expect(response.headers["set-cookie"]).toBeUndefined();
  expect(new Set(response.body.map((r: { id: number }) => r.id)).size).toBe(
    expected.length,
  );
  expect(
    response.body.every(
      (r: { quantitaPrecisa: string }) => r.quantitaPrecisa === "1.000001",
    ),
  ).toBe(true);
});

it("E-FIX-01 same session cannot export after grant revocation", async () => {
  await pool.query("update ruoli set permessi='[]'::jsonb where id=$1", [
    f.users.warehouse.roleId,
  ]);
  const response = await actor
    .get("/api/movimenti/export")
    .query({ prodottoId: product });
  expect(response.status).toBe(403);
});

// Test-only barrier AFTER the real SQL snapshot is read, BEFORE the HTTP
// response. No mocked rows, sleeps, business hooks or fabricated ledger data.
function snapshotBarrier() {
  let reached!: () => void, release!: () => void;
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, "transaction");
  spy.mockImplementationOnce((callback, options) =>
    transaction(async (tx) => {
      const result = await callback(tx);
      reached();
      await resume;
      return result;
    }, options),
  );
  return { arrived, release, restore: () => spy.mockRestore() };
}

it("E-FIX-01 concurrent canonical writer leaves the captured set complete, unique and stable", async () => {
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(["magazzino.view"]),
    f.users.warehouse.roleId,
  ]);
  const before = await ids();
  const gate = snapshotBarrier();
  const pending = actor
    .get("/api/movimenti/export")
    .query({ prodottoId: product })
    .then((r) => r);
  try {
    await gate.arrived;
    await load();
    expect(await ids()).toHaveLength(before.length + 1);
    gate.release();
    const response = await pending;
    expect(response.status, response.text).toBe(200);
    expect(response.body.map((r: { id: number }) => r.id)).toEqual(before);
    expect(new Set(response.body.map((r: { id: number }) => r.id)).size).toBe(
      before.length,
    );
    expect(response.headers["x-total-count"]).toBe(String(before.length));
    const next = await actor
      .get("/api/movimenti/export")
      .query({ prodottoId: product });
    expect(next.body.map((r: { id: number }) => r.id)).toEqual(await ids());
  } finally {
    gate.release();
    await pending;
    gate.restore();
  }
});

it.each(["grant", "territory", "logout"])(
  "E-FIX-01 discards the real snapshot on %s revocation during preparation",
  async (kind) => {
    await pool.query("update ruoli set permessi=$1 where id=$2", [
      JSON.stringify(["magazzino.view"]),
      f.users.warehouse.roleId,
    ]);
    await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
      f.area,
      f.users.warehouse.id,
    ]);
    expect(
      (await actor.post("/api/auth/login").send(f.users.warehouse)).status,
    ).toBe(200);
    const gate = snapshotBarrier();
    const pending = actor
      .get("/api/movimenti/export")
      .query({ prodottoId: product })
      .then((r) => r);
    try {
      await gate.arrived;
      if (kind === "grant")
        await pool.query("update ruoli set permessi='[]'::jsonb where id=$1", [
          f.users.warehouse.roleId,
        ]);
      else if (kind === "territory")
        await pool.query(
          "update utenti set area_operativa_id=null where id=$1",
          [f.users.warehouse.id],
        );
      else expect((await actor.post("/api/auth/logout")).status).toBe(204);
      gate.release();
      const response = await pending;
      expect(response.status).toBe(kind === "logout" ? 401 : 403);
      expect(Array.isArray(response.body)).toBe(false);
      // Delayed read-only export responses must never replace a newer login's
      // cookie, whether authorization was revoked or the session was destroyed.
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      gate.release();
      await pending;
      gate.restore();
    }
  },
);

it("E-FIX-01 bounds a 100k synthetic ledger without silently truncating, and exports an exact filtered 10k", async () => {
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(["magazzino.view"]),
    f.users.warehouse.roleId,
  ]);
  await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
    f.area,
    f.users.warehouse.id,
  ]);
  expect(
    (await actor.post("/api/auth/login").send(f.users.warehouse)).status,
  ).toBe(200);
  const performanceProduct = await createProdotto(newScope(), {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
  });
  // Explicit read/performance fixture, NOT evidence of a stock writer.
  await pool.query(
    `insert into movimenti(tipo_movimento,tipo_dettaglio,data_movimento,magazzino_id,prodotto_id,quantita,unita_misura)
    select 'carico','donazione',case when n<=10000 then '2026-01-01'::date else '2026-01-02'::date end,$1,$2,'0.000001','kg' from generate_series(1,100000) n`,
    [f.origin, performanceProduct],
  );
  const before = process.memoryUsage();
  const start = performance.now();
  const large = await actor
    .get("/api/movimenti/export")
    .query({ prodottoId: performanceProduct });
  expect(large.status, large.text).toBe(413);
  expect(Array.isArray(large.body)).toBe(false);
  const rejectedMs = performance.now() - start;
  const startFiltered = performance.now();
  const filtered = await actor.get("/api/movimenti/export").query({
    prodottoId: performanceProduct,
    da: "2026-01-01",
    a: "2026-01-01",
  });
  expect(filtered.status, filtered.text.slice(0, 200)).toBe(200);
  const expected = (
    await pool.query(
      "select id from movimenti where prodotto_id=$1 and data_movimento='2026-01-01' order by data_creazione desc,id desc",
      [performanceProduct],
    )
  ).rows.map((r) => r.id);
  expect(filtered.body.map((r: { id: number }) => r.id)).toEqual(expected);
  expect(new Set(expected).size).toBe(10000);
  expect(filtered.headers["x-total-count"]).toBe("10000");
  console.info("M67E performance", {
    population: 100000,
    exported: 10000,
    rejectedMs,
    filteredMs: performance.now() - startFiltered,
    responseBytes: Buffer.byteLength(filtered.text),
    rssBefore: before.rss,
    rssAfter: process.memoryUsage().rss,
  });
});
