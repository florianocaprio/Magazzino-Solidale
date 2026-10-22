import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "@workspace/db";
import app from "../src/app";
import { STANDARD_ROLE_PROFILES } from "../src/lib/seedRoles";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import { m67aMensaFixture, m67aNeed } from "./helpers/m67a-mensa-fixture";
import { createBeneficiario, createCentroRec, newScope } from "./scope-helpers";

type Fixture = Awaited<ReturnType<typeof m67aMensaFixture>>;
const today = new Date().toISOString().slice(0, 10);

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL!);
  expect(process.env.M67A_DISPOSABLE_DB).toBe("verified");
  expect([url.hostname, url.port, url.pathname]).toEqual([
    "127.0.0.1",
    "59671",
    "/m67a_dev",
  ]);
  expect(process.env.QUALITY_TEST_IDENTITY).toBeTruthy();
});
afterAll(async () => {
  await pool.end();
});

async function fixture() {
  const f = await m67aMensaFixture();
  for (const code of [
    "CENTRO_ASCOLTO",
    "INTERVENTI",
    "CONSEGNE",
    "UDS",
    "CARICHI",
    "LOTTI",
    "BOLLE",
    "LOGISTICA",
    "FORNITORI",
    "APPROVVIGIONAMENTI",
    "EMPORIO_SOLIDALE",
    "CREDITO_SOLIDALE",
  ])
    await updateModuloAmbiente(code, true, null);
  return f;
}
function body(response: request.Response, status = 200) {
  expect(response.status, response.text).toBe(status);
  return response.body;
}
async function actor(
  f: Fixture,
  name: string,
  kind: "requester" | "warehouse" = "requester",
) {
  const profile = STANDARD_ROLE_PROFILES.find((role) => role.nome === name)!;
  expect(profile.isAdmin).toBe(false);
  const user = f.users[kind];
  // Only synthetic fixture accounts: exact standard configuration, no extra
  // grants, administrative bypass, area Analisi or injected req.user.
  await pool.query(
    "update ruoli set aree=$1,permessi=$2,is_admin=false where id=$3",
    [
      JSON.stringify(profile.aree),
      JSON.stringify(profile.permessi),
      user.roleId,
    ],
  );
  const agent = request.agent(app);
  body(
    await agent
      .post("/api/auth/login")
      .send({ username: user.username, password: user.password }),
  );
  expect(body(await agent.get("/api/auth/me"))).toMatchObject({
    isAdmin: false,
    isSuperAdmin: false,
    areaOperativaId: f.area,
    aree: [...profile.aree],
    permessi: [...profile.permessi],
  });
  return agent;
}
async function person(f: Fixture, uds = false) {
  const scope = newScope();
  const centre = await createCentroRec(scope, { areaOperativaId: f.area });
  return createBeneficiario(scope, centre.id, { areaOperativaId: f.area, uds });
}
async function stock(f: Fixture, warehouse = f.origin) {
  return Number(
    (
      await pool.query(
        "select coalesce(sum(quantita_residua),0)::text qty from lotti where prodotto_id=$1 and magazzino_id=$2",
        [f.product, warehouse],
      )
    ).rows[0].qty,
  );
}

it("BUG6 UDS standard: salva e rettifica l'incontro, report/prepare senza Analisi, altre sorgenti negate", async () => {
  const f = await fixture(),
    agent = await actor(f, "Operatore UDS");
  const created = body(
    await agent.post("/api/uds/interventi").send({
      beneficiarioId: await person(f, true),
      tipoIntervento: "Incontro sintetico BUG6",
      descrizione: "Prima annotazione",
      dataIntervento: today,
    }),
    201,
  );
  const changed = body(
    await agent.patch(`/api/uds/interventi/${created.id}/rettifica`).send({
      versione: created.dataAggiornamento,
      motivo: "Rettifica sintetica BUG6",
      descrizione: "Annotazione verificata",
    }),
  );
  expect(changed.descrizione).toBe("Annotazione verificata");
  expect(
    body(await agent.get(`/api/uds/interventi/${created.id}`)).descrizione,
  ).toBe(changed.descrizione);
  const period = { da: created.dataIntervento, a: created.dataIntervento };
  const report = body(await agent.get("/api/report/uds").query(period));
  expect(
    report.kpi.find((kpi: { key: string }) => kpi.key === "interventi").value,
  ).toBe(1);
  body(
    await agent
      .post("/api/report/prepare")
      .query({ section: "uds", ...period }),
  );
  expect((await agent.get("/api/report/emporio")).status).toBe(403);
  expect((await agent.post("/api/bolle").send({})).status).toBe(403);
});

it("BUG6 Sociale standard: crea, avvia e conclude l'intervento con storico, senza uscita merce", async () => {
  const f = await fixture(),
    agent = await actor(f, "Operatore");
  const created = body(
    await agent.post("/api/interventi").send({
      beneficiarioId: await person(f),
      tipoIntervento: "Supporto sintetico BUG6",
      ambito: "sociale",
      stato: "da_pianificare",
    }),
    201,
  );
  const started = body(
    await agent.post(`/api/interventi/${created.id}/avvia`).send({
      versione: created.dataAggiornamento,
    }),
  );
  expect(started.stato).toBe("in_corso");
  const completed = body(
    await agent.post(`/api/interventi/${created.id}/concludi`).send({
      versione: started.dataAggiornamento,
      conferma: true,
      risultato: "Esito sintetico positivo",
    }),
  );
  expect(completed.intervento.stato).toBe("concluso");
  const history = body(
    await agent.get(`/api/interventi/${created.id}/storico-stati`),
  );
  expect(history.map((row: { statoNuovo: string }) => row.statoNuovo)).toEqual(
    expect.arrayContaining(["da_pianificare", "in_corso", "concluso"]),
  );
  expect((await agent.post("/api/bolle").send({})).status).toBe(403);
});

it("BUG6 Magazzino standard: pratica, registrazione e chiusura producono stock, gestione fornitori negata", async () => {
  const f = await fixture(),
    agent = await actor(f, "Operatore Magazzino");
  const logical = (
    await pool.query(
      "select id from lotti_logici where area_operativa_id=$1 and is_generale=true",
      [f.area],
    )
  ).rows[0].id;
  const before = await stock(f);
  const practice = body(
    await agent.post("/api/carico-pratiche").send({
      areaOperativaId: f.area,
      magazzinoId: f.origin,
      lottoLogicoId: logical,
      origineCarico: "DONAZIONE",
      dataCarico: today,
      descrizione: "Carico standard BUG6",
      righe: [
        { prodottoId: f.product, quantita: "3", fondoOrigine: "NESSUN_FONDO" },
      ],
    }),
    201,
  );
  const recorded = body(
    await agent.post(`/api/carico-pratiche/${practice.id}/registra`).send({
      versione: practice.versione,
      idempotencyKey: randomUUID(),
      rigaIds: practice.righe.map((row: { id: number }) => row.id),
    }),
    201,
  );
  const closed = body(
    await agent
      .post(`/api/carico-pratiche/${practice.id}/chiudi`)
      .send({ versione: recorded.versione }),
  );
  expect(closed.stato).toBe("chiusa");
  expect(await stock(f)).toBe(before + 3);
  expect(
    (await agent.post("/api/fornitori").send({ nome: "Vietato" })).status,
  ).toBe(403);
});

it("BUG6 Logistica standard: fornitore, ordine, invio e ricezione reali senza area Magazzino", async () => {
  const f = await fixture(),
    agent = await actor(f, "Operatore Logistica");
  const supplier = body(
    await agent.post("/api/fornitori").send({
      nome: `Fornitore sintetico BUG6 ${randomUUID()}`,
      tipo: "azienda",
      areaOperativaId: f.area,
    }),
    201,
  );
  const before = await stock(f);
  const order = body(
    await agent.post("/api/approvvigionamenti").send({
      areaOperativaId: f.area,
      fornitoreId: supplier.id,
      magazzinoId: f.origin,
      dataRichiesta: today,
      righe: [
        { prodottoId: f.product, quantitaRichiesta: "3", unitaMisura: "kg" },
      ],
    }),
    201,
  );
  const submitted = body(
    await agent
      .post(`/api/approvvigionamenti/${order.id}/sottometti`)
      .send({ versione: order.versione }),
  );
  const received = body(
    await agent
      .patch(`/api/approvvigionamenti/${order.id}`)
      .send({ versione: submitted.versione, stato: "completato" }),
  );
  expect(received.stato).toBe("completato");
  expect(await stock(f)).toBe(before + 3);
  expect((await agent.get("/api/giacenze")).status).toBe(403);
  expect((await agent.post("/api/carico-pratiche").send({})).status).toBe(403);
});

it("BUG6 Mensa e Magazzino standard: richiesta, documento, preparazione, spedizione e ricezione con stock", async () => {
  const f = await fixture(),
    canteen = await actor(f, "Operatore Mensa"),
    warehouse = await actor(f, "Operatore Magazzino", "warehouse");
  const need = body(
    await canteen.post("/api/richieste-magazzino").send(m67aNeed(f)),
    201,
  );
  const taken = body(
    await warehouse
      .post(`/api/richieste-magazzino/${need.id}/presa-in-carico`)
      .send({
        versione: need.versione,
        idempotencyKey: randomUUID(),
      }),
  );
  body(
    await warehouse.post(`/api/richieste-magazzino/${need.id}/documento`).send({
      versione: taken.versione,
      idempotencyKey: randomUUID(),
      magazzinoId: f.origin,
      righe: [{ prodottoId: f.product, quantita: "3", unitaMisura: "kg" }],
    }),
    201,
  );
  const transfer = (
    await pool.query(
      "select id,versione from trasferimenti where magazzino_origine_id=$1",
      [f.origin],
    )
  ).rows[0];
  const path = `/api/trasferimenti/${transfer.id}`;
  const edited = body(
    await warehouse.patch(path).send({
      versione: transfer.versione,
      idempotencyKey: randomUUID(),
      trasportatoreNome: "Trasporto sintetico BUG6",
      righe: [{ prodottoId: f.product, quantita: "3", unitaMisura: "kg" }],
    }),
  );
  expect(
    (
      await canteen
        .post(`${path}/prepara`)
        .send({ versione: edited.versione, idempotencyKey: randomUUID() })
    ).status,
  ).toBe(403);
  const prepared = body(
    await warehouse
      .post(`${path}/prepara`)
      .send({ versione: edited.versione, idempotencyKey: randomUUID() }),
  );
  const dispatched = body(
    await warehouse
      .post(`${path}/avvia`)
      .send({ versione: prepared.versione, idempotencyKey: randomUUID() }),
  );
  const received = body(
    await canteen
      .post(`${path}/conferma`)
      .send({ versione: dispatched.versione, idempotencyKey: randomUUID() }),
  );
  expect(received.stato).toBe("completato");
  expect(await stock(f)).toBe(9);
  expect(await stock(f, f.canteens[0].magazzinoId)).toBe(3);
  const beneficiary = await person(f);
  body(
    await canteen.post("/api/mensa/abilitazioni").send({
      beneficiarioId: beneficiary,
      mensaId: f.canteens[0].id,
      dataInizio: today,
      motivo: "Abilitazione sintetica BUG6",
    }),
    201,
  );
  const card = body(
    await canteen
      .post("/api/mensa/tessere")
      .send({ beneficiarioId: beneficiary }),
    201,
  );
  const access = body(
    await canteen.post("/api/mensa/accessi/verifica").send({
      mensaId: f.canteens[0].id,
      codiceTessera: card.codice,
      tipoServizio: "pranzo",
      idempotencyKey: randomUUID(),
    }),
    201,
  );
  const meal = body(
    await canteen.post("/api/mensa/pasti").send({
      accessoMensaId: access.id,
      tipoServizio: "pranzo",
      idempotencyKey: randomUUID(),
    }),
    201,
  );
  expect(
    body(
      await canteen
        .get("/api/mensa/pasti")
        .query({ mensaId: f.canteens[0].id }),
    ),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ id: meal.id })]));
  expect(
    (
      await canteen.post("/api/mensa/pasti").send({
        accessoMensaId: access.id,
        tipoServizio: "pranzo",
        idempotencyKey: randomUUID(),
        override: true,
        motivoOverride: "Deroga vietata al profilo standard",
      })
    ).status,
  ).toBe(403);
});

it("BUG6 Emporio standard: accesso, carrello, sospensione/ripresa e chiusura con saldo, senza forzatura o storno", async () => {
  const f = await fixture(),
    agent = await actor(f, "Emporio");
  const beneficiary = await person(f);
  await pool.query(
    "update magazzini set tipo_magazzino='emporio' where id=$1",
    [f.origin],
  );
  await pool.query(
    "update prodotti set abilitato_emporio=true,credito_solidale_valore=2 where id=$1",
    [f.product],
  );
  await pool.query(
    "update beneficiari set credito_solidale_abilitato=true,credito_solidale_stato='attivo',credito_solidale_saldo=100,credito_solidale_mensile_assegnato=100,magazzino_emporio_preferito_id=$1 where id=$2",
    [f.origin, beneficiary],
  );
  await pool.query(
    "insert into emporio_abilitazioni(beneficiario_id,area_operativa_id,stato,operatore_id,motivo) values($1,$2,'attivo',$3,'Prerequisito sintetico BUG6')",
    [beneficiary, f.area, f.users.requester.id],
  );
  const access = body(
    await agent.post("/api/accessi-emporio").send({
      beneficiarioId: beneficiary,
      magazzinoEmporioId: f.origin,
      dataOraInizio: new Date().toISOString(),
    }),
    201,
  );
  const session = body(
    await agent
      .post(`/api/cassa-emporio/accessi/${access.id}/apri-sessione`)
      .send({}),
    201,
  );
  const path = `/api/cassa-emporio/sessioni/${session.id}`;
  body(
    await agent
      .post(`${path}/righe`)
      .send({ versione: session.versione, prodottoId: f.product, quantita: 1 }),
    201,
  );
  for (const [action, expected] of [
    ["sospendi", "sospesa"],
    ["riprendi", "aperta"],
    ["pronta-per-chiusura", "pronta_per_chiusura"],
  ]) {
    const current = body(await agent.get(path));
    expect(
      body(
        await agent
          .post(`${path}/${action}`)
          .send({ versione: current.versione }),
      ).statoSessione,
    ).toBe(expected);
  }
  const current = body(await agent.get(path));
  const closed = body(
    await agent.post(`${path}/chiudi`).send({ versione: current.versione }),
  );
  expect(closed.sessione.statoSessione).toBe("chiusa");
  expect(await stock(f)).toBe(11);
  expect(
    Number(
      (
        await pool.query(
          "select credito_solidale_saldo saldo from beneficiari where id=$1",
          [beneficiary],
        )
      ).rows[0].saldo,
    ),
  ).toBe(98);
  expect(
    (await agent.post("/api/cassa-emporio/accessi/forza").send({})).status,
  ).toBe(403);
  expect(
    (
      await agent
        .post(`/api/spese-emporio/${closed.spesa.id}/storna`)
        .send({ motivo: "Vietato" })
    ).status,
  ).toBe(403);
});
