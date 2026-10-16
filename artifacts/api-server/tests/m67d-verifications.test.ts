import { afterAll, beforeAll, expect, it } from "vitest";
import request from "supertest";
import { db, pool, mapsGeocodeCacheTable } from "@workspace/db";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import { httpListeners } from "./helpers/http-listeners";
import {
  createBeneficiario,
  createCentroRec,
  createProdotto,
  insertConsegna,
  newScope,
} from "./scope-helpers";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import { normalizeMapsAddress } from "../src/lib/maps-geocoding";
import { createWarehouseLoad } from "../src/lib/inventoryLedger";
import { loadAllPages } from "../../magazzino-solidale/src/lib/paged-export";
import {
  calendarioCredito,
  eseguiRicaricaMensile,
  preparaRicaricaMensile,
} from "../src/lib/creditoMensile";

const listeners = httpListeners({ diagnostics: "m67d" });
let f: Awaited<ReturnType<typeof m67aMensaFixture>>;
let actor: ReturnType<typeof request.agent>;
const scope = newScope();
beforeAll(async () => {
  f = await m67aMensaFixture();
  for (const module of [
    "CENTRO_ASCOLTO",
    "CONSEGNE",
    "CREDITO_SOLIDALE",
    "EMPORIO_SOLIDALE",
  ])
    await updateModuloAmbiente(module, true, null);
  await pool.query("update ruoli set aree=$1, permessi=$2 where id=$3", [
    JSON.stringify(["sociale", "magazzino"]),
    JSON.stringify([
      "maps.operational",
      "maps.route",
      "consegne.view",
      "magazzino.view",
    ]),
    f.users.requester.roleId,
  ]);
  const { default: app } = await import("../src/app");
  actor = request.agent(await listeners.open("app", () => app));
  expect(
    (await actor.post("/api/auth/login").send(f.users.requester)).status,
  ).toBe(200);
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

it("V67-02 characterizes independent Maps grant after same-session Consegne revocation (not policy approval)", async () => {
  const centre = await createCentroRec(scope, { areaOperativaId: f.area });
  const person = await createBeneficiario(scope, centre.id, {
    areaOperativaId: f.area,
  });
  const id = await insertConsegna(scope, {
    beneficiarioId: person,
    magazzinoId: f.origin,
  });
  const origin = `Via Sintetica Origine ${id}`,
    destination = `Via Sintetica Arrivo ${id}`;
  await pool.query(
    "update magazzini set indirizzo=$1, comune=null where id=$2",
    [origin, f.origin],
  );
  await pool.query(
    "update consegne set data_prevista='2026-10-16',tipo_consegna='domicilio',indirizzo_consegna=$1 where id=$2",
    [destination, id],
  );
  for (const address of [origin, destination])
    await db.insert(mapsGeocodeCacheTable).values({
      normalizedAddress: normalizeMapsAddress(address),
      originalAddress: address,
      latitude: "41.9000000",
      longitude: "12.5000000",
      status: "resolved",
      provider: "fixture",
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    });
  async function observe() {
    const capability = await actor.get("/api/maps/capabilities");
    const layer = await actor.get(
      "/api/maps/layers/pacchi/consegne?da=2026-10-16&a=2026-10-16",
    );
    const route = await actor.get(`/api/maps/routes/consegne/${id}`);
    const detail = await actor.get(`/api/consegne/${id}`);
    expect(capability.status).toBe(200);
    expect(
      capability.body.layers.some(
        (l: { code: string }) => l.code === "pacchi.consegne",
      ),
    ).toBe(true);
    expect(layer.status, layer.text).toBe(200);
    expect(JSON.stringify(layer.body)).toContain(String(id));
    expect(route.status, route.text).toBe(200);
    return detail.status;
  }
  expect(await observe()).toBe(200);
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(["maps.operational", "maps.route", "magazzino.view"]),
    f.users.requester.roleId,
  ]);
  expect(await observe()).toBe(403);
});

it("V67-03 characterizes offset export drift under an actual intervening writer, then same-session revocation", async () => {
  const product = await createProdotto(scope, {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
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
  for (let n = 0; n < 5; n++) await load();
  async function page(n: number, limit: number) {
    const response = await actor
      .get("/api/movimenti")
      .query({ prodottoId: product, page: n, limit });
    expect(response.status, response.text).toBe(200);
    return response.body as { id: number }[];
  }
  const stable = await loadAllPages(page, 2);
  expect(new Set(stable.map((x) => x.id)).size).toBe(5);
  const exported = await loadAllPages(async (n, limit) => {
    const rows = await page(n, limit);
    if (n === 1) await load(); // deterministic inter-page barrier, no timer
    return rows;
  }, 2);
  const actual = (
    await pool.query("select id from movimenti where prodotto_id=$1", [product])
  ).rows.map((x) => x.id);
  expect(actual).toHaveLength(6);
  // Characterization of a defect, deliberately NOT an acceptance PASS.
  expect(exported).toHaveLength(6);
  expect(new Set(exported.map((x) => x.id)).size).toBe(5);
  expect(
    actual.filter((id) => !exported.some((row) => row.id === id)),
  ).toHaveLength(1);
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(["maps.operational", "maps.route"]),
    f.users.requester.roleId,
  ]);
  expect(
    (
      await actor
        .get("/api/movimenti")
        .query({ prodottoId: product, page: 2, limit: 2 })
    ).status,
  ).toBe(403);
});

it("D67-01 controlled Rome day 1/day 2: no new late run, existing run resumes idempotently", async () => {
  const year = 2100 + f.area;
  const period = `${year}-02`;
  const first = new Date(`${year}-01-31T23:05:00Z`),
    second = new Date(`${year}-02-01T23:05:00Z`);
  expect(calendarioCredito(first)).toEqual({
    periodo: period,
    primoDelMese: true,
  });
  expect(calendarioCredito(second)).toEqual({
    periodo: period,
    primoDelMese: false,
  });
  await eseguiRicaricaMensile(second);
  expect(
    (
      await pool.query(
        "select * from credito_ricariche_mensili where periodo=$1",
        [period],
      )
    ).rows,
  ).toHaveLength(0);
  await preparaRicaricaMensile(first);
  await eseguiRicaricaMensile(second);
  const before = (
    await pool.query(
      "select * from credito_ricariche_mensili where periodo=$1",
      [period],
    )
  ).rows;
  expect(before).toHaveLength(1);
  await eseguiRicaricaMensile(second);
  expect(
    (
      await pool.query(
        "select * from credito_ricariche_mensili where periodo=$1",
        [period],
      )
    ).rows,
  ).toEqual(before);
});

it("M67-38 synthetic branding is public, private operational exports require a live authorized session", async () => {
  const { default: app } = await import("../src/app");
  const server = await listeners.open("files", () => app);
  const admin = request.agent(server);
  expect((await admin.post("/api/auth/login").send(f.users.admin)).status).toBe(
    200,
  );
  const centre = await createCentroRec(scope, { areaOperativaId: f.area });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await admin
    .post(`/api/centri-ascolto/${centre.id}/logo`)
    .set("Content-Type", "image/png")
    .send(png);
  expect(uploaded.status, uploaded.text).toBe(200);
  expect(uploaded.body.logoUrl).toMatch(
    new RegExp(`^/uploads/centri/${centre.id}/`),
  );
  const publicFile = await request(server).get(uploaded.body.logoUrl);
  expect(publicFile.status).toBe(200);
  expect(publicFile.headers["content-type"]).toMatch(/^image\/png/);
  expect(publicFile.body).toEqual(png);
  expect(
    (await request(server).get("/api/documenti-operativi/export.xlsx")).status,
  ).toBe(401);
  expect((await actor.get("/api/documenti-operativi/export.xlsx")).status).toBe(
    403,
  );
  expect(
    (
      await actor
        .post(`/api/centri-ascolto/${centre.id}/logo`)
        .set("Content-Type", "image/png")
        .send(png)
    ).status,
  ).toBe(403);
  expect(
    (await request(server).get("/uploads/%2e%2e/package.json")).status,
  ).toBe(404);
});
