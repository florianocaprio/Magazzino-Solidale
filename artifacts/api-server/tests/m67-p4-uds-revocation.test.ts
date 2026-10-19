import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import { httpListeners } from "./helpers/http-listeners";
import {
  createAreaOperativa,
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

it("BUG21: stati UDS minimi e prima tessera concorrente, senza concessione di gestione Mensa/tessere", async () => {
  const { f, user, agent, person } = await fixture();
  await pool.query("update ruoli set permessi=$1 where id=$2", [JSON.stringify(["beneficiari.view", "beneficiari.manage", "uds.directory.view"]), user.roleId]);
  await pool.query("update beneficiari set stato_anagrafica='provvisoria',centro_ascolto_id=null where id=$1", [person]);
  await updateModuloAmbiente("EMPORIO_SOLIDALE", true, null);
  const foreignScope = newScope();
  const foreignArea = await createAreaOperativa(foreignScope);
  const foreignPerson = await createBeneficiario(foreignScope, null, { uds: true, areaOperativaId: foreignArea });
  expect((await agent.get(`/api/beneficiari/${foreignPerson}/stati-servizi-uds`)).status).toBe(403);
  expect((await agent.post(`/api/beneficiari/${foreignPerson}/tessera-documento`).send({})).status).toBe(403);
  const before = (await pool.query("select (select count(*) from tessere_beneficiari where beneficiario_id=$1)::int cards,(select count(*) from movimenti)::int movements,(select count(*) from consegne)::int deliveries,(select count(*) from mensa_abilitazioni where beneficiario_id=$1)::int mensa,(select count(*) from emporio_abilitazioni where beneficiario_id=$1)::int emporio", [person])).rows[0];
  expect((await agent.get(`/api/beneficiari/${person}`)).status).toBe(200);
  const states = await agent.get(`/api/beneficiari/${person}/stati-servizi-uds`);
  expect(states.status, states.text).toBe(200);
  expect(states.body).toEqual({ emporio: { disponibile: true, stato: "non_abilitato" }, mensa: { disponibile: true, stato: "non_abilitato" } });
  expect((await agent.get(`/api/beneficiari/${person}/tessere`)).status).toBe(403);
  expect((await agent.get("/api/mensa/abilitazioni")).status).toBe(403);
  expect((await pool.query("select count(*)::int n from tessere_beneficiari where beneficiario_id=$1", [person])).rows[0].n).toBe(0);
  const cards = await Promise.all(Array.from({ length: 4 }, () => agent.post(`/api/beneficiari/${person}/tessera-documento`).send({})));
  for (const response of cards) { expect(response.status, response.text).toBe(200); expect(response.body).toEqual(cards[0].body); }
  expect(cards[0].body.codice).toMatch(/^MS-[A-Za-z0-9_-]+$/);
  const again = await agent.post(`/api/beneficiari/${person}/tessera-documento`).send({});
  expect(again.body).toEqual(cards[0].body);
  const after = (await pool.query("select (select count(*) from tessere_beneficiari where beneficiario_id=$1)::int cards,(select count(*) from movimenti)::int movements,(select count(*) from consegne)::int deliveries,(select count(*) from mensa_abilitazioni where beneficiario_id=$1)::int mensa,(select count(*) from emporio_abilitazioni where beneficiario_id=$1)::int emporio", [person])).rows[0];
  expect(after).toEqual({ ...before, cards: 1 });
  for (const state of ["sospesa", "revocata"]) {
    await pool.query("update tessere_beneficiari set stato=$1 where id=$2", [state, cards[0].body.id]);
    const recovered = await agent.post(`/api/beneficiari/${person}/tessera-documento`).send({});
    expect(recovered.body).toMatchObject({ id: cards[0].body.id, codice: cards[0].body.codice, dataEmissione: cards[0].body.dataEmissione, stato: state });
  }
  expect((await agent.post(`/api/beneficiari/${person}/tessera-documento`).send({ motivoSostituzione: "Non consentita" })).status).toBe(400);
  expect((await agent.post(`/api/beneficiari/${person}/tessere`).send({ motivoSostituzione: "Non consentita" })).status).toBe(403);
  await updateModuloAmbiente("MENSA", false, null);
  const disabled = await agent.get(`/api/beneficiari/${person}/stati-servizi-uds`);
  expect(disabled.body.mensa).toEqual({ disponibile: false, stato: null });
  await updateModuloAmbiente("MENSA", true, null);
  await pool.query("update ruoli set permessi=$1 where id=$2", [JSON.stringify(["uds.directory.view"]), user.roleId]);
  expect((await agent.get(`/api/beneficiari/${person}/stati-servizi-uds`)).status).toBe(403);
  expect((await agent.post(`/api/beneficiari/${person}/tessera-documento`).send({})).status).toBe(403);
  expect((await pool.query("select count(*)::int n from tessere_beneficiari where beneficiario_id=$1", [person])).rows[0].n).toBe(1);
});

it("BUG21: PATCH minime Centro/Zona, conflitto di versione e snapshot interventi invariati", async () => {
  const { f, user, agent, person, zone, intervention } = await fixture();
  await pool.query("update ruoli set permessi=$1 where id=$2", [JSON.stringify(["beneficiari.view", "beneficiari.manage", "uds.directory.view"]), user.roleId]);
  await pool.query("update beneficiari set stato_anagrafica='provvisoria' where id=$1", [person]);
  const secondZone = await createZona(newScope(), f.area);
  const centre = (await pool.query("insert into centri_di_ascolto(nome,area_operativa_id) values('Centro sintetico BUG21',$1) returning id", [f.area])).rows[0].id;
  let detail = (await agent.get(`/api/beneficiari/${person}`)).body;
  const version = detail.versione;
  const assigned = await agent.patch(`/api/beneficiari/${person}`).send({ centroAscoltoId: centre, versione: version });
  expect(assigned.status, assigned.text).toBe(200);
  expect(assigned.body).toMatchObject({ centroAscoltoId: centre, statoAnagrafica: "provvisoria" });
  expect((await agent.patch(`/api/beneficiari/${person}`).send({ zonaUdsId: secondZone.id, versione: version })).status).toBe(409);
  detail = (await agent.get(`/api/beneficiari/${person}`)).body;
  const changed = await agent.patch(`/api/beneficiari/${person}`).send({ zonaUdsId: secondZone.id, versione: detail.versione });
  expect(changed.status, changed.text).toBe(200);
  const directory = await agent.get("/api/uds/directory").query({ zonaUdsId: secondZone.id });
  expect(directory.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: person, zonaUdsId: secondZone.id, canale: "uds_centro" })]));
  const snapshot = (await pool.query("select area_operativa_id_snapshot,zona_uds_id_snapshot from interventi where id=$1", [intervention])).rows[0];
  expect(snapshot).toEqual({ area_operativa_id_snapshot: f.area, zona_uds_id_snapshot: zone.id });
  const cleared = await agent.patch(`/api/beneficiari/${person}`).send({ zonaUdsId: null, versione: changed.body.versione });
  expect(cleared.status, cleared.text).toBe(200);
  expect(cleared.body.zonaUdsId).toBeNull();
});

it("BUG06: Magazzino standard ricerca oltre 100 e tessera esatta nel contesto, senza dossier o movimenti", async () => {
  const { f, user, agent } = await fixture();
  await updateModuloAmbiente("BOLLE", true, null);
  await pool.query("update ruoli set aree=$1,permessi=$2 where id=$3", [JSON.stringify(["magazzino"]), JSON.stringify(["bolle.manage", "bolle.view"]), user.roleId]);
  const centre = (await pool.query("insert into centri_di_ascolto(nome,area_operativa_id) values('Centro sintetico BUG06',$1) returning id", [f.area])).rows[0].id;
  const otherCentre = (await pool.query("insert into centri_di_ascolto(nome,area_operativa_id) values('Altro centro sintetico BUG06',$1) returning id", [f.area])).rows[0].id;
  const scope = newScope();
  const ids = [];
  for (let index = 0; index < 106; index++) {
    const id = await createBeneficiario(scope, centre, { areaOperativaId: f.area });
    await pool.query("update beneficiari set nome=$1,cognome='BUG06Ricerca' where id=$2", [`Persona ${String(index).padStart(3, "0")}`, id]);
    ids.push(id);
  }
  const target = ids.at(-1)!;
  const card = `MS-AbCd_${target}-test`;
  await pool.query("insert into tessere_beneficiari(beneficiario_id,codice) values($1,$2)", [target, card]);
  const context = { areaOperativaId: f.area, centroAscoltoId: centre };
  expect((await agent.get(`/api/beneficiari/${target}`)).status).toBe(403);
  const first = await agent.get("/api/bolle/beneficiari-candidati").query({ ...context, limit: 100 });
  expect(first.status, first.text).toBe(200);
  expect(first.body).toHaveLength(100);
  expect(first.body.map((row: {id: number}) => row.id)).not.toContain(target);
  const found = await agent.get("/api/bolle/beneficiari-candidati").query({ ...context, search: "BUG06Ricerca 105", limit: 50 });
  expect(found.status, found.text).toBe(200);
  expect(found.body.map((row: {id: number}) => row.id)).toEqual([target]);
  expect(Object.keys(found.body[0]).sort()).toEqual(["id", "nome", "cognome", "codice", "areaOperativaId", "centroAscoltoId", "consegnaDomicilio"].sort());
  const scan = () => agent.post("/api/bolle/beneficiari-candidati/tessera");
  expect((await scan().send({ ...context, codiceTessera: card })).body.id).toBe(target);
  for (const token of [card.toLowerCase(), " " + card, found.body[0].codice]) expect((await scan().send({ ...context, codiceTessera: token })).status).toBe(404);
  expect((await scan().send({ ...context, centroAscoltoId: otherCentre, codiceTessera: card })).status).toBe(404);
  for (const state of ["sospesa", "revocata"]) {
    await pool.query("update tessere_beneficiari set stato=$1 where beneficiario_id=$2", [state, target]);
    expect((await scan().send({ ...context, codiceTessera: card })).status).toBe(404);
  }
  await pool.query("update tessere_beneficiari set stato='attiva',data_scadenza='2000-01-01' where beneficiario_id=$1", [target]);
  expect((await scan().send({ ...context, codiceTessera: card })).status).toBe(404);
  await pool.query("update tessere_beneficiari set data_scadenza=null,codice=$1 where beneficiario_id=$2", [found.body[0].codice, target]);
  expect((await scan().send({ ...context, codiceTessera: found.body[0].codice })).body.id).toBe(target);
  // Un token registrato legacy è valido; il solo codice anagrafico non lo era.
  expect((await agent.get("/api/bolle/beneficiari-candidati").query({ areaOperativaId: f.area })).status).toBe(400);
  await pool.query("update beneficiari set centro_ascolto_id=$1 where id=$2", [otherCentre, target]);
  const moved = await agent.post("/api/bolle").send({ idempotencyKey: `bug06-${target}`, beneficiarioId: target, magazzinoId: f.origin, tipoDestinatario: "beneficiario", contestoBeneficiarioAtteso: context });
  expect(moved.status, moved.text).toBe(409);
  expect((await pool.query("select count(*)::int n from bolle where beneficiario_id=$1", [target])).rows[0].n).toBe(0);
  await pool.query("update ruoli set permessi='[]'::jsonb where id=$1", [user.roleId]);
  expect((await scan().send({ ...context, codiceTessera: card })).status).toBe(403);
});
