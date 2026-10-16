import { afterAll, beforeAll, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import { httpListeners } from "./helpers/http-listeners";
import {
  createProdotto,
  newScope,
  createBeneficiario,
  insertConsegna,
  createAreaOperativa,
  createMagazzino,
} from "./scope-helpers";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

vi.mock("../src/lib/orderEmail.js", () => ({
  sendApprovvigionamentoEmail: vi.fn(async () => undefined),
}));
const listeners = httpListeners({ diagnostics: "m67-review" });
let f: Awaited<ReturnType<typeof m67aMensaFixture>>;
let actor: ReturnType<typeof request.agent>;
let supplier: number;
beforeAll(async () => {
  f = await m67aMensaFixture();
  for (const mod of ["APPROVVIGIONAMENTI", "CONSEGNE", "CENTRO_ASCOLTO"])
    await updateModuloAmbiente(mod, true, null);
  await pool.query("update ruoli set aree=$1,permessi=$2 where id=$3", [
    JSON.stringify(["logistica", "sociale"]),
    JSON.stringify([
      "approvvigionamenti.view",
      "approvvigionamenti.manage",
      "approvvigionamenti.receive",
      "consegne.view",
      "consegne.export",
    ]),
    f.users.warehouse.roleId,
  ]);
  supplier = (
    await pool.query(
      "insert into fornitori(nome,tipo,area_operativa_id) values('Synthetic EXT67 supplier','azienda',$1) returning id",
      [f.area],
    )
  ).rows[0].id;
  const { default: app } = await import("../src/app");
  actor = request.agent(await listeners.open("app", () => app));
  expect(
    (await actor.post("/api/auth/login").send(f.users.warehouse)).status,
  ).toBe(200);
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});
const body = (product: number, quantity: number | string, unit = "kg") => ({
  areaOperativaId: f.area,
  magazzinoId: f.origin,
  fornitoreId: supplier,
  dataRichiesta: "2026-10-16",
  righe: [
    { prodottoId: product, quantitaRichiesta: quantity, unitaMisura: unit },
  ],
});
const product = () =>
  createProdotto(newScope(), { unitaMisura: "kg", quantitaFrazionabile: true });
async function order(p: number, q: number | string = 1.25) {
  const c = await actor.post("/api/approvvigionamenti").send(body(p, q));
  expect(c.status, c.text).toBe(201);
  const s = await actor
    .post(`/api/approvvigionamenti/${c.body.id}/sottometti`)
    .send({ versione: c.body.versione });
  expect(s.status, s.text).toBe(200);
  return s.body;
}
const stock = async (p: number) =>
  (
    await pool.query(
      "select coalesce(sum(quantita),0)::text quantity,count(*)::int count from movimenti where prodotto_id=$1",
      [p],
    )
  ).rows[0];

it("EXT67-02 same-session territory revocation denies delivery list/export, not just its linked Bolla", async () => {
  const p = await createBeneficiario(newScope(), null, {
    areaOperativaId: f.area,
  });
  const delivery = await insertConsegna(newScope(), {
    beneficiarioId: p,
    magazzinoId: f.origin,
  });
  expect((await actor.get("/api/consegne")).status).toBe(200);
  await pool.query(
    "update utenti set area_operativa_id=null,centro_ascolto_id=null,zona_uds_id=null where id=$1",
    [f.users.warehouse.id],
  );
  try {
    for (const path of [
      "/api/consegne",
      "/api/consegne/export",
      `/api/consegne/${delivery}`,
    ]) {
      const r = await actor.get(path);
      expect(r.status, path).toBe(403);
    }
  } finally {
    await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
      f.area,
      f.users.warehouse.id,
    ]);
  }
});
it("EXT67-03 same-session territory revocation denies create and completion with zero stock", async () => {
  const p = await product(),
    o = await order(p);
  const draft = await actor.post("/api/approvvigionamenti").send(body(p, 1));
  expect(draft.status).toBe(201);
  await pool.query("update utenti set area_operativa_id=null where id=$1", [
    f.users.warehouse.id,
  ]);
  try {
    expect(
      (await actor.post("/api/approvvigionamenti").send(body(p, 1))).status,
    ).toBe(403);
    expect(
      (
        await actor
          .patch(`/api/approvvigionamenti/${o.id}`)
          .send({ stato: "completato", versione: o.versione })
      ).status,
    ).toBe(403);
    expect(await stock(p)).toEqual({ quantity: "0", count: 0 });
    expect(
      (
        await actor
          .post(`/api/approvvigionamenti/${draft.body.id}/sottometti`)
          .send({ versione: draft.body.versione })
      ).status,
    ).toBe(403);
    expect(
      (
        await actor
          .patch(`/api/approvvigionamenti/${draft.body.id}`)
          .send({ versione: draft.body.versione, note: "denied" })
      ).status,
    ).toBe(403);
  } finally {
    await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
      f.area,
      f.users.warehouse.id,
    ]);
  }
});
it("EXT67-05 rejects a different declared UOM before creating an order", async () => {
  const p = await product();
  const r = await actor.post("/api/approvvigionamenti").send(body(p, 1, "pz"));
  expect(r.status, r.text).toBe(400);
});
it.each([1.000001, 1.234])(
  "EXT67-01 preserves %s through order, reception and ledger",
  async (q) => {
    const p = await product(),
      o = await order(p, q);
    expect(o.righe[0].quantitaRichiesta).toBe(q);
    expect(await stock(p)).toEqual({ quantity: "0", count: 0 });
    const r = await actor
      .patch(`/api/approvvigionamenti/${o.id}`)
      .send({ stato: "completato", versione: o.versione });
    expect(r.status, r.text).toBe(200);
    expect(await stock(p)).toEqual({ quantity: q.toFixed(6), count: 1 });
    expect(r.body.righe[0].quantitaRicevutaEsatta).toBe(q.toFixed(6));
    const link = (
      await pool.query(
        `select m.quantita::text quantity,l.quantita_residua::text remaining,m.documento_riferimento document,m.audit_evento_id audit
      from movimenti m join lotti l on l.id=m.lotto_id where m.prodotto_id=$1`,
        [p],
      )
    ).rows;
    expect(link).toHaveLength(1);
    expect(link[0]).toMatchObject({
      quantity: q.toFixed(6),
      remaining: q.toFixed(6),
      document: o.codice,
    });
    expect(link[0].audit).toBeGreaterThan(0);
  },
);
it.each([
  [true, false],
  [false, true],
  [true, true],
])(
  "EXT67-04 receives real physical parties (lot=%s expiry=%s)",
  async (lot, expiry) => {
    const p = await product();
    await pool.query(
      "update prodotti set lotto_fisico_obbligatorio=$1,gestione_scadenza=$2 where id=$3",
      [lot, expiry, p],
    );
    const o = await order(p, 2);
    const missing = await actor
      .patch(`/api/approvvigionamenti/${o.id}`)
      .send({ stato: "completato", versione: o.versione });
    expect(missing.status).toBe(400);
    expect(await stock(p)).toEqual({ quantity: "0", count: 0 });
    const partite = [
      {
        rigaId: o.righe[0].id,
        quantita: 1,
        codiceLotto: "SYNTH-A",
        dataScadenza: "2027-06-01",
      },
      {
        rigaId: o.righe[0].id,
        quantita: 1,
        codiceLotto: "SYNTH-B",
        dataScadenza: "2027-07-01",
      },
    ];
    const r = await actor
      .patch(`/api/approvvigionamenti/${o.id}`)
      .send({ stato: "completato", versione: o.versione, partite });
    expect(r.status, r.text).toBe(200);
    expect(await stock(p)).toEqual({ quantity: "2.000000", count: 2 });
    expect(
      (
        await actor
          .patch(`/api/approvvigionamenti/${o.id}`)
          .send({ stato: "completato", versione: o.versione, partite })
      ).status,
    ).toBe(409);
  },
);

it.each(["1.0000001", "100000000", "0", "-1"])(
  "EXT67-01 rejects invalid quantity %s before any order insert",
  async (q) => {
    const p = await product();
    const r = await actor.post("/api/approvvigionamenti").send(body(p, q));
    expect(r.status, r.text).toBe(400);
    expect(
      (
        await pool.query(
          "select count(*)::int n from approvvigionamento_righe where prodotto_id=$1",
          [p],
        )
      ).rows[0].n,
    ).toBe(0);
  },
);
it("EXT67-01 rejects fractional pieces and preserves maximum as exact strings", async () => {
  const p = await createProdotto(newScope(), {
    unitaMisura: "pz",
    quantitaFrazionabile: false,
  });
  expect(
    (await actor.post("/api/approvvigionamenti").send(body(p, "1.25", "pz")))
      .status,
  ).toBe(400);
  const kg = await product(),
    o = await order(kg, "99999999.999999");
  expect(o.righe[0].quantitaRichiestaEsatta).toBe("99999999.999999");
  const r = await actor
    .patch(`/api/approvvigionamenti/${o.id}`)
    .send({ stato: "completato", versione: o.versione });
  expect(r.status, r.text).toBe(200);
  expect(r.body.righe[0].quantitaRicevutaEsatta).toBe("99999999.999999");
  expect(await stock(kg)).toEqual({ quantity: "99999999.999999", count: 1 });
});
it("EXT67-05 detects a changed Catalogue unit at receipt and rolls back state, stock and audit", async () => {
  const p = await product(),
    o = await order(p);
  await pool.query("update prodotti set unita_misura='pz' where id=$1", [p]);
  const r = await actor
    .patch(`/api/approvvigionamenti/${o.id}`)
    .send({ stato: "completato", versione: o.versione });
  expect(r.status, r.text).toBe(400);
  expect(await stock(p)).toEqual({ quantity: "0", count: 0 });
  expect((await actor.get(`/api/approvvigionamenti/${o.id}`)).body.stato).toBe(
    "sottomesso",
  );
});
it("EXT67-04 rejects foreign/missing/overfull parties atomically", async () => {
  const p = await product(),
    o = await order(p, 2);
  for (const partite of [
    [],
    [{ rigaId: -1, quantita: 2 }],
    [{ rigaId: o.righe[0].id, quantita: 1 }],
    [{ rigaId: o.righe[0].id, quantita: 3 }],
  ]) {
    const r = await actor
      .patch(`/api/approvvigionamenti/${o.id}`)
      .send({ stato: "completato", versione: o.versione, partite });
    expect(r.status, r.text).toBe(400);
    expect(await stock(p)).toEqual({ quantity: "0", count: 0 });
    expect(
      (await actor.get(`/api/approvvigionamenti/${o.id}`)).body.versione,
    ).toBe(o.versione);
  }
});

it("EXT67-02 scoped, Area-admin and explicit global admin keep the correct delivery boundary", async () => {
  const { default: app } = await import("../src/app");
  const scope = newScope(),
    otherArea = await createAreaOperativa(scope);
  const otherWarehouse = await createMagazzino(scope, null, {
    areaOperativaId: otherArea,
  });
  const own = await createBeneficiario(scope, null, {
    areaOperativaId: f.area,
  });
  const other = await createBeneficiario(scope, null, {
    areaOperativaId: otherArea,
  });
  const a = await insertConsegna(scope, {
    beneficiarioId: own,
    magazzinoId: f.origin,
  });
  const b = await insertConsegna(scope, {
    beneficiarioId: other,
    magazzinoId: otherWarehouse,
  });
  for (const account of [f.users.warehouse, f.users.admin]) {
    const agent = request.agent(
      await listeners.open(`area-${account.id}`, () => app),
    );
    expect((await agent.post("/api/auth/login").send(account)).status).toBe(
      200,
    );
    for (const path of ["/api/consegne", "/api/consegne/export"]) {
      const r = await agent.get(path);
      expect(r.status, r.text).toBe(200);
      expect(r.body.items.map((x: { id: number }) => x.id)).toContain(a);
      expect(r.body.items.map((x: { id: number }) => x.id)).not.toContain(b);
    }
    expect((await agent.get(`/api/consegne/${b}`)).status).toBe(403);
  }
  await pool.query("update utenti set area_operativa_id=null where id=$1", [
    f.users.admin.id,
  ]);
  try {
    const agent = request.agent(await listeners.open("global", () => app));
    expect(
      (await agent.post("/api/auth/login").send(f.users.admin)).status,
    ).toBe(200);
    expect(
      (await agent.get("/api/consegne/export")).body.items.map(
        (x: { id: number }) => x.id,
      ),
    ).toEqual(expect.arrayContaining([a, b]));
    expect((await agent.get(`/api/consegne/${b}`)).status).toBe(200);
  } finally {
    await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
      f.area,
      f.users.admin.id,
    ]);
  }
});

it("EXT67-04 a later invalid party rolls back earlier writes and their audit", async () => {
  const p = await product();
  await pool.query(
    "update prodotti set lotto_fisico_obbligatorio=true where id=$1",
    [p],
  );
  const o = await order(p, 2);
  const snapshot = async () =>
    (
      await pool.query(
        "select (select count(*) from audit_eventi)::int a,(select count(*) from carichi_magazzino)::int c",
      )
    ).rows[0];
  const before = await snapshot();
  const r = await actor.patch(`/api/approvvigionamenti/${o.id}`).send({
    stato: "completato",
    versione: o.versione,
    partite: [
      { rigaId: o.righe[0].id, quantita: "1", codiceLotto: "VALID" },
      { rigaId: o.righe[0].id, quantita: "1" },
    ],
  });
  expect(r.status, r.text).toBe(400);
  expect(await stock(p)).toEqual({ quantity: "0", count: 0 });
  expect(await snapshot()).toEqual(before);
  expect(
    (await actor.get(`/api/approvvigionamenti/${o.id}`)).body.versione,
  ).toBe(o.versione);
});
it("EXT67-V01 legitimate legacy remaining 0.30 - 0.10 receives exactly 0.200000", async () => {
  const p = await product(),
    o = await order(p, 0.3);
  // A synthetic legacy receipt is represented in both the order and canonical ledger.
  const { db } = await import("@workspace/db");
  const { creaCaricoInventariale } = await import("../src/lib/inventoryLedger");
  await db.transaction((tx) =>
    creaCaricoInventariale(tx, {
      prodottoId: p,
      quantita: "0.10",
      magazzinoId: f.origin,
      fornitoreId: supplier,
      dataCarico: "2026-10-16",
      causale: "acquisto",
      fsePlus: false,
      documentoCarico: o.codice,
      operatoreId: f.users.warehouse.id,
    }),
  );
  await pool.query(
    "update approvvigionamento_righe set quantita_ricevuta='0.10' where id=$1",
    [o.righe[0].id],
  );
  const r = await actor
    .patch(`/api/approvvigionamenti/${o.id}`)
    .send({ stato: "completato", versione: o.versione });
  expect(r.status, r.text).toBe(200);
  expect(await stock(p)).toEqual({ quantity: "0.300000", count: 2 });
  expect(
    (
      await pool.query(
        "select quantita::text from movimenti where prodotto_id=$1 order by id",
        [p],
      )
    ).rows.map((r) => r.quantita),
  ).toEqual(["0.100000", "0.200000"]);
});
it.each(["territory", "grant"])(
  "EXT67-03 revocation of %s while completion waits on PostgreSQL lock is effective",
  async (kind) => {
    const p = await product(),
      o = await order(p),
      blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query(
        "select id from approvvigionamenti where id=$1 for update",
        [o.id],
      );
      pending = actor
        .patch(`/api/approvvigionamenti/${o.id}`)
        .send({ stato: "completato", versione: o.versione })
        .then((r) => r);
      const until = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < until) {
        const r = await pool.query(
          "select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%update%approvvigionamenti%'",
        );
        if (r.rows[0].n > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting, "observable PostgreSQL row-lock barrier").toBe(true);
      if (kind === "territory")
        await pool.query(
          "update utenti set area_operativa_id=null where id=$1",
          [f.users.warehouse.id],
        );
      else
        await pool.query(
          "update ruoli set permessi=permessi-'approvvigionamenti.receive' where id=$1",
          [f.users.warehouse.roleId],
        );
      await blocker.query("commit");
      const r = await pending;
      expect(r.status, r.text).toBe(403);
      expect(await stock(p)).toEqual({ quantity: "0", count: 0 });
    } finally {
      await blocker.query("rollback");
      blocker.release();
      if (pending) await pending;
      await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
        f.area,
        f.users.warehouse.id,
      ]);
      await pool.query("update ruoli set permessi=$1 where id=$2", [
        JSON.stringify([
          "approvvigionamenti.view",
          "approvvigionamenti.manage",
          "approvvigionamenti.receive",
          "consegne.view",
          "consegne.export",
        ]),
        f.users.warehouse.roleId,
      ]);
    }
  },
);
