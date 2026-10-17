import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import {
  createAreaOperativa,
  createCentroRec,
  newScope,
} from "./scope-helpers";
import { httpListeners } from "./helpers/http-listeners";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

const listeners = httpListeners({ diagnostics: "m67-p4-downloads" });
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

it("M67-38 a real persisted register remains scoped after grant and territory revocation on the same cookie", async () => {
  const f = await m67aMensaFixture();
  await updateModuloAmbiente("VOLONTARI", true, null);
  const centre = await createCentroRec(newScope(), { areaOperativaId: f.area });
  const foreignArea = await createAreaOperativa(newScope());
  const foreignCentre = await createCentroRec(newScope(), {
    areaOperativaId: foreignArea,
  });
  const actorRecord = f.users.requester;
  const grant = JSON.stringify(["logistica.volontari.export"]);
  await pool.query("update ruoli set aree=$1,permessi=$2 where id=$3", [
    JSON.stringify(["logistica"]),
    grant,
    actorRecord.roleId,
  ]);
  await pool.query("update utenti set centro_ascolto_id=$1 where id=$2", [
    centre.id,
    actorRecord.id,
  ]);
  const { default: app } = await import("../src/app");
  const server = await listeners.open("real-register", () => app);
  const actor = request.agent(server);
  expect((await actor.post("/api/auth/login").send(actorRecord)).status).toBe(
    200,
  );
  const generated = await actor
    .post("/api/volontari/registro/genera")
    .send({ tipo: "PDF", filtri: { centroAscoltoId: centre.id } });
  expect(generated.status, generated.text).toBe(200);
  expect(generated.headers["content-type"]).toContain("application/pdf");
  const id = Number(generated.headers["x-registro-emissione-id"]);
  expect(id).toBeGreaterThan(0);
  const path = `/api/volontari/registro/emissioni/${id}/file`;
  const download = await actor.get(path);
  expect(download.status).toBe(200);
  expect(download.body.equals(generated.body)).toBe(true);
  for (const kind of ["storico", "esteso"]) {
    expect(
      (
        await actor
          .get(`/api/volontari/export/${kind}.xlsx`)
          .query({ centroAscoltoId: centre.id })
      ).status,
    ).toBe(200);
    expect(
      (
        await actor
          .get(`/api/volontari/export/${kind}.xlsx`)
          .query({ centroAscoltoId: foreignCentre.id })
      ).status,
    ).toBe(403);
  }
  await pool.query("update ruoli set permessi='[]' where id=$1", [
    actorRecord.roleId,
  ]);
  const revoked = await actor.get(path);
  expect(revoked.status).toBe(403);
  expect(revoked.headers["content-disposition"]).toBeUndefined();
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    grant,
    actorRecord.roleId,
  ]);
  expect((await actor.get(path)).status).toBe(200);
  await pool.query(
    "update utenti set area_operativa_id=$1,centro_ascolto_id=$2 where id=$3",
    [foreignArea, foreignCentre.id, actorRecord.id],
  );
  const territoryRevoked = await actor.get(path);
  expect(territoryRevoked.status).toBe(403);
  expect(territoryRevoked.headers["content-disposition"]).toBeUndefined();
  const listed = await actor.get("/api/volontari/registro/emissioni");
  expect(listed.status).toBe(200);
  expect(listed.body.some((row: { id: number }) => row.id === id)).toBe(false);
});

it("M67-38 real authenticated session cannot download protected artifacts without source grants", async () => {
  const f = await m67aMensaFixture();
  for (const module of [
    "CENTRO_ASCOLTO",
    "BOLLE",
    "VOLONTARI",
    "LOTTI",
    "CREDITO_SOLIDALE",
    "EMPORIO_SOLIDALE",
  ])
    await updateModuloAmbiente(module, true, null);
  await pool.query("update ruoli set aree=$1,permessi='[]' where id=$2", [
    JSON.stringify(["sociale", "magazzino", "logistica", "analisi", "emporio"]),
    f.users.requester.roleId,
  ]);
  const { default: app } = await import("../src/app");
  const server = await listeners.open("real-app", () => app);
  const actor = request.agent(server);
  expect(
    (await actor.post("/api/auth/login").send(f.users.requester)).status,
  ).toBe(200);
  const downloads = [
    ["get", "/documenti-operativi/export.xlsx"],
    ["get", "/fse/exportazioni/1/download"],
    ["post", "/fse/exportazioni/1/originale"],
    ["post", "/beneficiari/fse/export"],
    ["get", "/volontari/export/storico.xlsx"],
    ["get", "/volontari/export/esteso.xlsx"],
    ["post", "/volontari/registro/genera"],
    ["get", "/volontari/registro/emissioni/1/file"],
    ["get", "/movimenti/export"],
  ] as const;
  for (const [method, path] of downloads) {
    const anonymous = await request(server)[method]("/api" + path);
    expect(anonymous.status, path).toBe(401);
    const denied = await actor[method]("/api" + path);
    expect(denied.status, path + ": " + denied.text).toBe(403);
    expect(denied.body.error, path).toBe(
      path === "/documenti-operativi/export.xlsx"
        ? "Permesso documenti non consentito"
        : "Permesso non consentito per il ruolo",
    );
    expect(denied.headers["content-disposition"], path).toBeUndefined();
    expect(denied.headers["content-type"], path).toContain("application/json");
  }
});

it("M67-38 real-session logo upload rejects unauthorized actors, invalid MIME, empty and oversized bodies", async () => {
  const f = await m67aMensaFixture();
  const centre = await createCentroRec(newScope(), { areaOperativaId: f.area });
  const { default: app } = await import("../src/app");
  const server = await listeners.open("real-logo", () => app);
  const admin = request.agent(server),
    ordinary = request.agent(server);
  expect((await admin.post("/api/auth/login").send(f.users.admin)).status).toBe(
    200,
  );
  expect(
    (await ordinary.post("/api/auth/login").send(f.users.requester)).status,
  ).toBe(200);
  const path = `/api/centri-ascolto/${centre.id}/logo`;
  expect(
    (
      await ordinary
        .post(path)
        .set("Content-Type", "image/png")
        .send(Buffer.from("synthetic"))
    ).status,
  ).toBe(403);
  expect(
    (
      await admin
        .post(path)
        .set("Content-Type", "application/x-sh")
        .send("synthetic shell text")
    ).status,
  ).toBe(400);
  expect(
    (
      await admin
        .post(path)
        .set("Content-Type", "image/png")
        .send(Buffer.alloc(0))
    ).status,
  ).toBe(400);
  expect(
    (
      await admin
        .post(path)
        .set("Content-Type", "image/png")
        .send(Buffer.alloc(2 * 1024 * 1024 + 1))
    ).status,
  ).toBe(413);
  expect(
    (
      await pool.query("select logo_url from centri_di_ascolto where id=$1", [
        centre.id,
      ])
    ).rows[0].logo_url,
  ).toBeNull();
  expect(
    (await request(server).get("/uploads/%2e%2e/package.json")).status,
  ).toBe(404);
});
