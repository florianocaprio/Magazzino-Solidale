import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import { httpListeners } from "./helpers/http-listeners";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  newScope,
} from "./scope-helpers";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
const listeners = httpListeners({ diagnostics: "m67d-social" });
afterAll(async () => {
  await listeners.close();
  await pool.end();
});
it("M67-18/19 actual Social and Warehouse sessions: intervention to delivery, replay, no duplicate stock or intervention", async () => {
  const f = await m67aMensaFixture(),
    scope = newScope();
  for (const m of ["CENTRO_ASCOLTO", "CONSEGNE", "BOLLE"])
    await updateModuloAmbiente(m, true, null);
  const centre = await createCentroRec(scope, { areaOperativaId: f.area });
  // Ordinary Social operators require an explicit Centre, not Area-only scope.
  await pool.query("update utenti set centro_ascolto_id=$1 where id=$2", [
    centre.id,
    f.users.requester.id,
  ]);
  const person = await createBeneficiario(scope, centre.id, {
    areaOperativaId: f.area,
  });
  const otherArea = await createAreaOperativa(scope),
    other = await createBeneficiario(scope, null, {
      areaOperativaId: otherArea,
    });
  const socialGrants = [
    "beneficiari.view",
    "sociale.interventi.create",
    "sociale.interventi.view",
    "richieste_magazzino.create",
    "richieste_magazzino.view",
    "consegne.view",
    "consegne.manage",
    "consegne.complete",
  ];
  await pool.query("update ruoli set aree=$1,permessi=$2 where id=$3", [
    JSON.stringify(["sociale"]),
    JSON.stringify(socialGrants),
    f.users.requester.roleId,
  ]);
  // The canonical Bolla preparation endpoint explicitly requires bolle.deliver.
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify([
      "richieste_magazzino.view",
      "richieste_magazzino.take",
      "richieste_magazzino.prepare",
      "magazzino.view",
      "bolle.view",
      "bolle.manage",
      "bolle.deliver",
    ]),
    f.users.warehouse.roleId,
  ]);
  const { default: app } = await import("../src/app");
  const server = await listeners.open("app", () => app);
  const social = request.agent(server),
    warehouse = request.agent(server);
  for (const [agent, credentials] of [
    [social, f.users.requester],
    [warehouse, f.users.warehouse],
  ] as const)
    expect((await agent.post("/api/auth/login").send(credentials)).status).toBe(
      200,
    );
  async function post(
    agent: typeof social,
    url: string,
    payload: object,
    status: number,
  ) {
    const r = await agent.post("/api" + url).send(payload);
    expect(r.status, r.text).toBe(status);
    return r.body;
  }
  const intervention = await post(
    social,
    "/interventi",
    {
      beneficiarioId: person,
      tipoIntervento: "Supporto sintetico D",
      ambito: "sociale",
      stato: "da_pianificare",
    },
    201,
  );
  const snapshot = async () =>
    (
      await pool.query(
        "select (select sum(quantita_residua)::text from lotti where magazzino_id=$1) stock,(select count(*)::int from movimenti where magazzino_id=$1) movements,(select count(*)::int from prenotazioni_magazzino where magazzino_id=$1) reservations",
        [f.origin],
      )
    ).rows[0];
  const before = await snapshot();
  const need = await post(
    social,
    "/richieste-magazzino",
    {
      idempotencyKey: randomUUID(),
      tipoDestinatario: "beneficiario",
      beneficiarioId: person,
      sorgente: "intervento_sociale",
      interventoId: intervention.id,
      bisogno: "Necessità sintetica 20, non quantità contabile",
      priorita: "normale",
    },
    201,
  );
  expect(await snapshot()).toEqual(before);
  expect((await social.get(`/api/beneficiari/${other}`)).status).toBe(403);
  const taken = await post(
    warehouse,
    `/richieste-magazzino/${need.id}/presa-in-carico`,
    { versione: need.versione, idempotencyKey: randomUUID() },
    200,
  );
  await post(
    warehouse,
    `/richieste-magazzino/${need.id}/documento`,
    {
      versione: taken.versione,
      idempotencyKey: randomUUID(),
      magazzinoId: f.origin,
    },
    201,
  );
  const linked = (
    await pool.query(
      "select b.id,b.versione from bolle b join richieste_magazzino_documenti d on d.bolla_id=b.id where d.richiesta_id=$1 and d.corrente",
      [need.id],
    )
  ).rows[0];
  const version = async () =>
    (await pool.query("select versione from bolle where id=$1", [linked.id]))
      .rows[0].versione;
  await post(
    warehouse,
    `/bolle/${linked.id}/righe`,
    {
      versione: linked.versione,
      idempotencyKey: randomUUID(),
      prodottoId: f.product,
      quantita: 3,
      unitaMisura: "kg",
    },
    201,
  );
  await post(
    warehouse,
    `/bolle/${linked.id}/conferma`,
    { versione: await version(), idempotencyKey: randomUUID() },
    200,
  );
  expect((await snapshot()).stock).toBe(before.stock);
  const queue = await social
    .get("/api/consegne/da-pianificare")
    .query({ areaOperativaId: f.area });
  expect(queue.status, queue.text).toBe(200);
  expect(
    queue.body.some((r: { bollaId: number }) => r.bollaId === linked.id),
  ).toBe(true);
  const planned = await post(
    social,
    `/consegne/da-bolla/${linked.id}`,
    {
      versione: await version(),
      idempotencyKey: randomUUID(),
      tipoConsegna: "domicilio",
      dataPrevista: "2026-10-16",
      fasciaOraria: "Mattina",
      indirizzoConsegna: "Via sintetica D 1",
    },
    201,
  );
  expect((await snapshot()).stock).toBe(before.stock);
  const payload = { versione: await version(), idempotencyKey: randomUUID() };
  await post(social, `/consegne/${planned.id}/completa`, payload, 200);
  const after = await snapshot();
  expect(Number(before.stock) - Number(after.stock)).toBe(3);
  await post(social, `/consegne/${planned.id}/completa`, payload, 200);
  expect(await snapshot()).toEqual(after);
  expect(
    (
      await pool.query("select stato from richieste_magazzino where id=$1", [
        need.id,
      ])
    ).rows[0].stato,
  ).toBe("chiusa");
  expect(
    (await pool.query("select stato from bolle where id=$1", [linked.id]))
      .rows[0].stato,
  ).toBe("consegnato");
  expect(
    (
      await pool.query(
        "select id,stato from interventi where beneficiario_id=$1",
        [person],
      )
    ).rows,
  ).toEqual([{ id: intervention.id, stato: "da_pianificare" }]);
  expect(
    (
      await pool.query(
        "select count(*)::int n from movimenti where bolla_id=$1 and tipo_movimento='scarico'",
        [linked.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
