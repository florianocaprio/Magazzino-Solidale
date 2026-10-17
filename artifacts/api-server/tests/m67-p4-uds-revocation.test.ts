import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import { httpListeners } from "./helpers/http-listeners";
import {
  createBeneficiario,
  createZona,
  insertIntervento,
  newScope,
} from "./scope-helpers";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

const listeners = httpListeners({ diagnostics: "m67-p4-uds-revocation" });
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

async function fixture(areas = ["uds", "analisi"]) {
  const f = await m67aMensaFixture(),
    scope = newScope();
  await updateModuloAmbiente("UDS", true, null);
  const zone = await createZona(scope, f.area);
  const person = await createBeneficiario(scope, null, {
    uds: true,
    areaOperativaId: f.area,
    zonaUdsId: zone.id,
  });
  const intervention = await insertIntervento(scope, {
    beneficiarioId: person,
    ambito: "uds",
    areaOperativaIdSnapshot: f.area,
    zonaUdsIdSnapshot: zone.id,
    tipoIntervento: "Synthetic revocation",
    dataIntervento: "2026-10-17",
  });
  const user = f.users.requester;
  await pool.query("update ruoli set aree=$1,permessi=$2 where id=$3", [
    JSON.stringify(areas),
    JSON.stringify([
      "beneficiari.view",
      "beneficiari.edit",
      "beneficiari.export",
      "uds.directory.view",
      "uds.interventi.view",
      "uds.interventi.create",
      "uds.reports.view",
    ]),
    user.roleId,
  ]);
  await pool.query("update utenti set zona_uds_id=$1 where id=$2", [
    zone.id,
    user.id,
  ]);
  const { default: app } = await import("../src/app");
  const server = await listeners.open("app", () => app);
  const agent = request.agent(server);
  expect((await agent.post("/api/auth/login").send(user)).status).toBe(200);
  return { f, user, agent, server, person, intervention, zone };
}

it.each([false, true])(
  "F02 same real session, ordinary mixed=%s: revoke Area, deny dossier/list/intervention/export/report and no mutation",
  async (mixed) => {
    const { f, user, agent, person, intervention } = await fixture(
      mixed ? ["uds", "sociale", "analisi"] : undefined,
    );
    const endpoints = [
      "/api/uds/directory",
      "/api/beneficiari?uds=true",
      `/api/beneficiari/${person}`,
      `/api/interventi?ambito=uds&beneficiarioId=${person}`,
      `/api/interventi/${intervention}`,
      "/api/report/uds?da=2026-01-01&a=2026-12-31",
    ];
    for (const path of endpoints) {
      const r = await agent.get(path);
      expect(r.status, path + ": " + r.text).toBe(200);
    }
    // Il vincolo DB impedisce una Zona senza Area: la revoca valida è atomica.
    await expect(
      pool.query("update utenti set area_operativa_id=null where id=$1", [
        user.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await pool.query(
      "update utenti set area_operativa_id=null,zona_uds_id=null,centro_ascolto_id=null where id=$1",
      [user.id],
    );
    for (const path of endpoints) {
      const r = await agent.get(path);
      expect(r.status, path + ": " + r.text).toBe(403);
      expect(r.text).not.toContain("Synthetic revocation");
    }
    expect(
      (
        await agent
          .post("/api/uds/directory/export")
          .send({ areaOperativaId: f.area })
      ).status,
    ).toBe(403);
    const before = (
      await pool.query(
        "select count(*)::int n from interventi where beneficiario_id=$1",
        [person],
      )
    ).rows;
    expect(
      (
        await agent.post("/api/interventi").send({
          beneficiarioId: person,
          ambito: "uds",
          tipoIntervento: "Denied synthetic",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await pool.query(
          "select count(*)::int n from interventi where beneficiario_id=$1",
          [person],
        )
      ).rows,
    ).toEqual(before);
    await pool.query(
      "update utenti set centro_ascolto_id=null,zona_uds_id=null where id=$1",
      [user.id],
    );
    expect((await agent.get(`/api/beneficiari/${person}`)).status).toBe(403);
    await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
      f.area,
      user.id,
    ]);
    expect((await agent.get(`/api/beneficiari/${person}`)).status).toBe(200);
    await pool.query("update ruoli set permessi=$1 where id=$2", [
      JSON.stringify(["uds.directory.view"]),
      user.roleId,
    ]);
    expect((await agent.get(`/api/beneficiari/${person}`)).status).toBe(403);
  },
);

it("F02 inactive Area denies ordinary UDS, while explicit administrative global access and scoped denial remain", async () => {
  const { f, agent, person, server } = await fixture();
  await pool.query("update aree_operative set attivo=false where id=$1", [
    f.area,
  ]);
  expect((await agent.get(`/api/beneficiari/${person}`)).status).toBe(403);
  await pool.query("update aree_operative set attivo=true where id=$1", [
    f.area,
  ]);
  expect((await agent.get(`/api/beneficiari/${person}`)).status).toBe(200);
  const other = await m67aMensaFixture();
  for (const superAdmin of [false, true]) {
    await pool.query(
      "update utenti set area_operativa_id=null,zona_uds_id=null,centro_ascolto_id=null,is_super_admin=$1 where id=$2",
      [superAdmin, f.users.admin.id],
    );
    await pool.query(
      "update ruoli set is_admin=$1,aree=$2,permessi=$3 where id=$4",
      [
        !superAdmin,
        JSON.stringify(["uds"]),
        JSON.stringify(["beneficiari.view"]),
        f.users.admin.roleId,
      ],
    );
    const admin = request.agent(server);
    expect(
      (await admin.post("/api/auth/login").send(f.users.admin)).status,
    ).toBe(200);
    expect((await admin.get(`/api/beneficiari/${person}`)).status).toBe(200);
    await pool.query("update utenti set area_operativa_id=$1 where id=$2", [
      other.area,
      f.users.admin.id,
    ]);
    expect((await admin.get(`/api/beneficiari/${person}`)).status).toBe(403);
  }
});
