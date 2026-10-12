import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeAll, afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  utentiTable,
  ruoliTable,
  menseTable,
  utentiMenseTable,
  magazziniTable,
  lottiTable,
  richiesteMagazzinoTable,
  trasferimentiTable,
} from "@workspace/db";
import {
  createAreaOperativa,
  createMagazzino,
  createProdotto,
  createLotto,
  createUtente,
  createBeneficiario,
  newScope,
} from "./scope-helpers";
import { httpListeners } from "./helpers/http-listeners";
import { initDbExtensions } from "../src/lib/dbInit";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { resolveTransferMensaId } from "../src/lib/mensaTransferDestination";
import { dataServizioMensa } from "../src/lib/mensaWorkflow";

const listeners = httpListeners({ diagnostics: "mensa-magazzino-correttivo" });
const scope = newScope();
let area: number,
  otherArea: number,
  origin: number,
  destination: number,
  otherDestination: number,
  mensaId: number,
  otherMensa: number,
  operatorId: number,
  product: number;
let mensa: ReturnType<typeof request.agent>,
  warehouse: ReturnType<typeof request.agent>;
const grants = [
  "richieste_magazzino.view",
  "richieste_magazzino.create",
  "richieste_magazzino.take",
  "richieste_magazzino.prepare",
  "richieste_magazzino.cancel",
  "magazzino.view",
  "magazzino.transfers.create",
  "magazzino.transfers.prepare",
  "magazzino.transfers.dispatch",
  "magazzino.transfers.receive",
  "magazzino.transfers.cancel",
];
beforeAll(async () => {
  if (process.env.MENSA_FIX_DISPOSABLE_DB !== "verified")
    throw new Error("Disposable database required");
  await initDbExtensions();
  await ensureAmbienteModuli();
  await updateModuloAmbiente("MENSA", true, null);
  await updateModuloAmbiente("TRASFERIMENTI", true, null);
  area = await createAreaOperativa(scope);
  otherArea = await createAreaOperativa(scope);
  origin = await createMagazzino(scope, null, { areaOperativaId: area });
  destination = await createMagazzino(scope, null, { areaOperativaId: area });
  otherDestination = await createMagazzino(scope, null, {
    areaOperativaId: area,
  });
  await db
    .update(magazziniTable)
    .set({ tipoMagazzino: "mensa" })
    .where(sql`${magazziniTable.id} in (${destination}, ${otherDestination})`);
  const canteens = await db
    .insert(menseTable)
    .values(
      [destination, otherDestination].map((id) => ({
        codice: `MEN-MAG-${id}`,
        nome: `Mensa sintetica ${id}`,
        areaOperativaId: area,
        magazzinoId: id,
      })),
    )
    .returning();
  [mensaId, otherMensa] = canteens.map((m) => m.id);
  product = await createProdotto(scope, {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
  });
  await createLotto(scope, {
    prodottoId: product,
    magazzinoId: origin,
    quantita: 12,
  });
  const { default: app } = await import("../src/app");
  const server = await listeners.open("mensa-magazzino", () => app);
  async function login(aree: string[], permessi: string[]) {
    const [role] = await db
      .insert(ruoliTable)
      .values({ nome: `MM-${randomUUID()}`, aree, permessi })
      .returning();
    const id = await createUtente(scope, { ruoloId: role.id });
    const password = `Test-${randomUUID()}-1!`;
    const [user] = await db
      .update(utentiTable)
      .set({
        areaOperativaId: area,
        passwordHash: await bcrypt.hash(password, 4),
      })
      .where(eq(utentiTable.id, id))
      .returning();
    const agent = request.agent(server);
    expect(
      (
        await agent
          .post("/api/auth/login")
          .send({ username: user.username, password })
      ).status,
    ).toBe(200);
    return { agent, id };
  }
  const op = await login(
    ["mensa"],
    [
      "mensa.view",
      "mensa.transfers.request",
      "mensa.transfers.receive",
      "mensa.transfers.manage",
      "mensa.transfers.prepare",
      ...grants.filter((p) => p.startsWith("magazzino.")),
    ],
  );
  mensa = op.agent;
  operatorId = op.id;
  await db
    .insert(utentiMenseTable)
    .values({ utenteId: operatorId, mensaId, assegnataDa: operatorId });
  warehouse = (await login(["magazzino"], grants)).agent;
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

const need = () => ({
  idempotencyKey: randomUUID(),
  mensaId,
  areaOperativaId: area,
  tipoDestinatario: "magazzino",
  sorgente: "operativa",
  bisogno: "20 kg di riso e 10 litri di olio",
  priorita: "normale",
});
async function inventory() {
  const result = await pool.query(`select
    (select count(*) from movimenti) movimenti,
    (select count(*) from prenotazioni_magazzino) prenotazioni,
    (select count(*) from trasferimenti) trasferimenti,
    (select count(*) from mensa_pasti) pasti,
    (select count(*) from mensa_consumi) consumi,
    (select coalesce(sum(quantita_residua),0)::text from lotti) residuo`);
  return result.rows[0];
}

it("RIC-01/02/03 TRA-01/03/05 IDE-01: due operatori, fabbisogno 20 / fornitura 12, M4 una sola volta", async () => {
  const payload = need(),
    before = await inventory();
  const created = await mensa.post("/api/richieste-magazzino").send(payload);
  expect(created.status, created.text).toBe(201);
  const id = created.body.id;
  expect(await inventory()).toEqual(before);
  const replay = await mensa.post("/api/richieste-magazzino").send(payload);
  // Canonical request create replays the original 201 response, not a new insert.
  expect(replay.status, replay.text).toBe(201);
  expect(replay.body.id).toBe(id);
  expect(
    (
      await mensa
        .post("/api/richieste-magazzino")
        .send({ ...payload, bisogno: "diverso" })
    ).status,
  ).toBe(409);
  const list = await warehouse.get("/api/richieste-magazzino");
  expect(list.status, list.text).toBe(200);
  expect(list.body.items.some((r: { id: number }) => r.id === id)).toBe(true);
  const taken = await warehouse
    .post(`/api/richieste-magazzino/${id}/presa-in-carico`)
    .send({ versione: 1, idempotencyKey: randomUUID() });
  expect(taken.status, taken.text).toBe(200);
  expect(await inventory()).toEqual(before);
  const documentInput = {
    versione: taken.body.versione,
    idempotencyKey: randomUUID(),
    magazzinoId: origin,
    righe: [{ prodottoId: product, quantita: "12", unitaMisura: "kg" }],
  };
  const document = await warehouse
    .post(`/api/richieste-magazzino/${id}/documento`)
    .send(documentInput);
  expect(document.status, document.text).toBe(201);
  const [transfer] = await db
    .select()
    .from(trasferimentiTable)
    .where(eq(trasferimentiTable.magazzinoOrigineId, origin));
  expect(transfer.mensaId).toBe(mensaId);
  expect(
    (
      await warehouse.get(
        `/api/documenti-operativi/trasferimento/${transfer.id}`,
      )
    ).status,
  ).toBe(200);
  const documents = await warehouse.get(
    "/api/documenti-operativi?tipoAggregato=trasferimento",
  );
  expect(documents.status, documents.text).toBe(200);
  expect(
    documents.body.items.some((r: { id: number }) => r.id === transfer.id),
  ).toBe(true);
  expect(
    (await mensa.get(`/api/documenti-operativi/trasferimento/${transfer.id}`))
      .status,
  ).toBe(403);
  expect(
    (
      await warehouse
        .post(`/api/richieste-magazzino/${id}/documento`)
        .send(documentInput)
    ).status,
  ).toBe(200);
  const path = `/api/trasferimenti/${transfer.id}`;
  const edited = await warehouse.patch(path).send({
    versione: transfer.versione,
    idempotencyKey: randomUUID(),
    trasportatoreNome: "Trasporto sintetico",
    righe: [{ prodottoId: product, quantita: "12", unitaMisura: "kg" }],
  });
  expect(edited.status, edited.text).toBe(200);
  const prepareInput = {
    versione: edited.body.versione,
    idempotencyKey: randomUUID(),
  };
  const prepared = await warehouse.post(`${path}/prepara`).send(prepareInput);
  expect(prepared.status, prepared.text).toBe(200);
  expect(
    (await warehouse.post(`${path}/prepara`).send(prepareInput)).status,
  ).toBe(200);
  const [req] = await db
    .select()
    .from(richiesteMagazzinoTable)
    .where(eq(richiesteMagazzinoTable.id, id));
  expect(req.bisogno).toBe(payload.bisogno);
  expect(req.stato).toBe("presa_in_carico");
  const shipInput = {
    versione: prepared.body.versione,
    idempotencyKey: randomUUID(),
  };
  const shipped = await warehouse.post(`${path}/avvia`).send(shipInput);
  expect(shipped.status, shipped.text).toBe(200);
  expect((await warehouse.post(`${path}/avvia`).send(shipInput)).status).toBe(
    200,
  );
  const incoming = await mensa.get(
    `/api/mensa/trasferimenti?mensaId=${mensaId}&areaOperativaId=${area}&page=1&pageSize=20`,
  );
  expect(incoming.status, incoming.text).toBe(200);
  expect(
    incoming.body.items.some((r: { id: number }) => r.id === transfer.id),
  ).toBe(true);
  expect((await mensa.get(path)).status).toBe(200);
  const receipt = {
    versione: shipped.body.versione,
    idempotencyKey: randomUUID(),
  };
  const received = await mensa.post(`${path}/conferma`).send(receipt);
  expect(received.status, received.text).toBe(200);
  const after = await inventory();
  expect((await mensa.post(`${path}/conferma`).send(receipt)).status).toBe(200);
  expect(await inventory()).toEqual(after);
  const stock = await pool.query(
    "select magazzino_id, sum(quantita_residua)::text quantity from lotti where prodotto_id=$1 group by magazzino_id",
    [product],
  );
  expect(stock.rows.find((r) => r.magazzino_id === origin)?.quantity).toBe(
    "0.000000",
  );
  expect(stock.rows.find((r) => r.magazzino_id === destination)?.quantity).toBe(
    "12.000000",
  );
  expect(after.pasti).toBe(before.pasti);
  expect(after.consumi).toBe(before.consumi);
});

it("AO-02/03 SEC-01: payload manipolati e scope Mensa non ampliano l'accesso", async () => {
  for (const override of [
    { mensaId: otherMensa },
    { areaOperativaId: otherArea },
    { magazzinoDestinatarioId: origin },
    { tipoDestinatario: "ente" },
  ]) {
    const result = await mensa
      .post("/api/richieste-magazzino")
      .send({ ...need(), ...override });
    expect([400, 403]).toContain(result.status);
  }
  expect(
    (await mensa.get(`/api/mensa/mense?areaOperativaId=${otherArea}`)).status,
  ).toBe(403);
  expect(
    (await mensa.get(`/api/mensa/trasferimenti?mensaId=${otherMensa}`)).status,
  ).toBe(403);
});

it("TRA-03: grant legacy origine non riabilitano creazione/preparazione/spedizione Mensa", async () => {
  expect((await mensa.post("/api/mensa/trasferimenti").send({})).status).toBe(
    410,
  );
  expect((await mensa.post("/api/trasferimenti").send({})).status).toBe(403);
  const [transfer] = await db
    .insert(trasferimentiTable)
    .values({
      codice: `T-${randomUUID().slice(0, 8)}`,
      magazzinoOrigineId: origin,
      magazzinoDestinoId: destination,
      mensaId,
      dataRichiesta: dataServizioMensa(),
    })
    .returning();
  for (const action of ["prepara", "avvia", "annulla"]) {
    const response = await mensa
      .post(`/api/trasferimenti/${transfer.id}/${action}`)
      .send({ versione: 1, idempotencyKey: randomUUID(), motivo: "test" });
    expect(response.status, response.text).toBe(403);
  }
});

it("TRA-01/02: diretto visibile, compatibilità nulla solo provabile, nessun backfill", async () => {
  const base = {
    codice: `D-${randomUUID().slice(0, 8)}`,
    magazzinoOrigineId: origin,
    magazzinoDestinoId: destination,
    dataRichiesta: dataServizioMensa(),
  };
  const [legacy] = await db.insert(trasferimentiTable).values(base).returning();
  expect(await resolveTransferMensaId(legacy.id)).toBe(mensaId);
  expect((await mensa.get(`/api/trasferimenti/${legacy.id}`)).status).toBe(200);
  const [stored] = await db
    .select()
    .from(trasferimentiTable)
    .where(eq(trasferimentiTable.id, legacy.id));
  expect(stored.mensaId).toBeNull();
  await db
    .update(menseTable)
    .set({ updatedAt: new Date() })
    .where(eq(menseTable.id, mensaId));
  expect(await resolveTransferMensaId(legacy.id)).toBeNull();
  expect((await mensa.get(`/api/trasferimenti/${legacy.id}`)).status).toBe(403);
  const direct = await warehouse.post("/api/trasferimenti").send({
    magazzinoOrigineId: origin,
    magazzinoDestinoId: destination,
    dataRichiesta: dataServizioMensa(),
    trasportatoreNome: "Trasporto",
    righe: [{ prodottoId: product, quantita: "1", unitaMisura: "kg" }],
    idempotencyKey: randomUUID(),
  });
  expect(direct.status, direct.text).toBe(201);
  expect(direct.body.mensaId).toBe(mensaId);
  expect((await mensa.get(`/api/trasferimenti/${direct.body.id}`)).status).toBe(
    200,
  );
});

it("ABI-01: beneficiario mai abilitato ricercabile nell'Area, non cross Area", async () => {
  const a = await createBeneficiario(scope, null, { areaOperativaId: area });
  const b = await createBeneficiario(scope, null, {
    areaOperativaId: otherArea,
  });
  const found = await mensa.get(
    `/api/mensa/beneficiari/ricerca?search=Test&areaOperativaId=${area}`,
  );
  expect(found.status, found.text).toBe(200);
  expect(found.body.some((r: { id: number }) => r.id === a)).toBe(true);
  expect(found.body.some((r: { id: number }) => r.id === b)).toBe(false);
});

it("SEC-02: ruolo misto conserva lettura Magazzino ma non estende la scrittura Mensa", async () => {
  const [user] = await db
    .select()
    .from(utentiTable)
    .where(eq(utentiTable.id, operatorId));
  const [role] = await db
    .select()
    .from(ruoliTable)
    .where(eq(ruoliTable.id, user.ruoloId!));
  await db
    .update(ruoliTable)
    .set({ aree: ["mensa", "magazzino"] })
    .where(eq(ruoliTable.id, role.id));
  try {
    const created = await mensa.post("/api/richieste-magazzino").send(need());
    expect(created.status, created.text).toBe(201);
    expect(
      (await mensa.get(`/api/richieste-magazzino/${created.body.id}`)).status,
    ).toBe(200);
    const change = {
      versione: 1,
      idempotencyKey: randomUUID(),
      bisogno: "Fabbisogno aggiornato",
    };
    expect(
      (
        await mensa
          .patch(`/api/richieste-magazzino/${created.body.id}`)
          .send(change)
      ).status,
    ).toBe(200);
    await db
      .update(ruoliTable)
      .set({ permessi: [...role.permessi, "richieste_magazzino.view"] })
      .where(eq(ruoliTable.id, role.id));
    await db
      .update(utentiMenseTable)
      .set({ attiva: false, revocataDa: operatorId, revocataAt: new Date() })
      .where(eq(utentiMenseTable.utenteId, operatorId));
    // Warehouse read is still valid; it must not authorize a Mensa command/replay.
    expect(
      (await mensa.get(`/api/richieste-magazzino/${created.body.id}`)).status,
    ).toBe(200);
    expect(
      (
        await mensa
          .patch(`/api/richieste-magazzino/${created.body.id}`)
          .send(change)
      ).status,
    ).toBe(403);
    expect(
      (
        await mensa
          .patch(`/api/richieste-magazzino/${created.body.id}`)
          .send({ ...change, versione: 2, idempotencyKey: randomUUID() })
      ).status,
    ).toBe(403);
  } finally {
    await db
      .update(ruoliTable)
      .set({ aree: role.aree, permessi: role.permessi })
      .where(eq(ruoliTable.id, role.id));
    await db
      .update(utentiMenseTable)
      .set({ attiva: true, revocataDa: null, revocataAt: null })
      .where(eq(utentiMenseTable.utenteId, operatorId));
  }
});

it("RIC-04: annullamento Mensa pre-uscita rilascia le prenotazioni M4 senza scarico", async () => {
  await createLotto(scope, {
    prodottoId: product,
    magazzinoId: origin,
    quantita: 5,
  });
  const created = await mensa.post("/api/richieste-magazzino").send(need());
  expect(created.status, created.text).toBe(201);
  const taken = await warehouse
    .post(`/api/richieste-magazzino/${created.body.id}/presa-in-carico`)
    .send({ versione: 1, idempotencyKey: randomUUID() });
  expect(taken.status, taken.text).toBe(200);
  const prepared = await warehouse
    .post(`/api/richieste-magazzino/${created.body.id}/documento`)
    .send({
      versione: taken.body.versione,
      idempotencyKey: randomUUID(),
      magazzinoId: origin,
      righe: [{ prodottoId: product, quantita: "5", unitaMisura: "kg" }],
    });
  expect(prepared.status, prepared.text).toBe(201);
  expect(prepared.body.tipoDocumento).toBe("trasferimento");
  const [linked] = await db
    .select()
    .from(trasferimentiTable)
    .where(eq(trasferimentiTable.id, prepared.body.documentoId));
  expect(linked).toBeDefined();
  const edited = await warehouse.patch(`/api/trasferimenti/${linked.id}`).send({
    versione: linked.versione,
    idempotencyKey: randomUUID(),
    trasportatoreNome: "Test",
    righe: [{ prodottoId: product, quantita: "5", unitaMisura: "kg" }],
  });
  expect(edited.status, edited.text).toBe(200);
  const ready = await warehouse
    .post(`/api/trasferimenti/${linked.id}/prepara`)
    .send({ versione: edited.body.versione, idempotencyKey: randomUUID() });
  expect(ready.status, ready.text).toBe(200);
  const before = await inventory();
  const row = await mensa.get(`/api/richieste-magazzino/${created.body.id}`);
  const canceled = await mensa
    .post(`/api/richieste-magazzino/${created.body.id}/annulla`)
    .send({
      versione: row.body.versione,
      idempotencyKey: randomUUID(),
      motivo: "Non più necessario",
    });
  expect(canceled.status, canceled.text).toBe(200);
  expect(
    (await warehouse.get(`/api/trasferimenti/${linked.id}`)).body.stato,
  ).toBe("annullato");
  const after = await inventory();
  expect(after.residuo).toBe(before.residuo);
  expect(after.movimenti).toBe(before.movimenti);
  expect(
    Number(
      (
        await pool.query(
          "select count(*) from prenotazioni_magazzino where trasferimento_id=$1 and stato='attiva'",
          [linked.id],
        )
      ).rows[0].count,
    ),
  ).toBe(0);
});

it("SEC-01: revoca con sessione aperta nega anche replay richiesta senza nuovo effetto", async () => {
  const payload = need();
  const created = await mensa.post("/api/richieste-magazzino").send(payload);
  expect(created.status, created.text).toBe(201);
  await db
    .update(utentiMenseTable)
    .set({ attiva: false, revocataDa: operatorId, revocataAt: new Date() })
    .where(eq(utentiMenseTable.utenteId, operatorId));
  const replay = await mensa.post("/api/richieste-magazzino").send(payload);
  expect([403, 404]).toContain(replay.status);
  expect(
    (await mensa.get(`/api/richieste-magazzino/${created.body.id}`)).status,
  ).toBe(404);
  const list = await mensa.get("/api/richieste-magazzino");
  expect(list.status).toBe(200);
  expect(list.body.items).toEqual([]);
});
