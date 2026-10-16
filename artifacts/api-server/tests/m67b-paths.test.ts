import { afterAll, beforeAll, expect, it } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  utentiTable,
  ruoliTable,
  beneficiariTable,
  consegneTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { m67aMensaFixture } from "./helpers/m67a-mensa-fixture";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createMagazzino,
  createProdotto,
  insertConsegna,
  insertBolla,
  insertBollaRiga,
  newScope,
} from "./scope-helpers";
import { httpListeners } from "./helpers/http-listeners";
import {
  createWarehouseLoad,
  rettificaInventarialeConEsito,
} from "../src/lib/inventoryLedger";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import { randomUUID } from "node:crypto";
import {
  creaScaricoInventariale,
  stornaScaricoInventariale,
} from "../src/lib/scaricoInventory";

const scope = newScope(),
  listeners = httpListeners({ diagnostics: "m67b" });
let f: Awaited<ReturnType<typeof m67aMensaFixture>>;
let admin: ReturnType<typeof request.agent>,
  scoped: ReturnType<typeof request.agent>;
let areaB: number,
  centroA: number,
  personA: number,
  personB: number,
  historical: number;
let codes: string[];
beforeAll(async () => {
  f = await m67aMensaFixture();
  for (const module of ["CONSEGNE", "CENTRO_ASCOLTO", "BOLLE"])
    await updateModuloAmbiente(module, true, null);
  areaB = await createAreaOperativa(scope);
  centroA = (await createCentroRec(scope, { areaOperativaId: f.area })).id;
  const centroB = (await createCentroRec(scope, { areaOperativaId: areaB })).id;
  const warehouseB = await createMagazzino(scope, centroB, {
    areaOperativaId: areaB,
  });
  personA = await createBeneficiario(scope, centroA, {
    areaOperativaId: f.area,
  });
  personB = await createBeneficiario(scope, centroB, {
    areaOperativaId: areaB,
  });
  await insertConsegna(scope, {
    beneficiarioId: personA,
    magazzinoId: f.origin,
  });
  await insertConsegna(scope, {
    beneficiarioId: personB,
    magazzinoId: warehouseB,
  });
  historical = await insertConsegna(scope, {
    beneficiarioId: personB,
    magazzinoId: f.origin,
    stato: "effettuata",
  });
  await db
    .update(consegneTable)
    .set({ areaOperativaIdSnapshot: f.area, centroAscoltoIdSnapshot: centroA })
    .where(eq(consegneTable.id, historical));
  codes = [];
  for (let n = 0; n < 101; n++) {
    const id = await createBeneficiario(scope, centroA, {
      areaOperativaId: f.area,
    });
    const code = `M67B-${f.area}-${String(n).padStart(3, "0")}`;
    await db
      .update(beneficiariTable)
      .set({ codice: code, cognome: `Persona ${String(n).padStart(3, "0")}` })
      .where(eq(beneficiariTable.id, id));
    codes.push(code);
  }
  await db
    .update(utentiTable)
    .set({ areaOperativaId: null })
    .where(eq(utentiTable.id, f.users.admin.id));
  await db
    .update(ruoliTable)
    .set({
      aree: ["sociale", "magazzino"],
      permessi: [
        "beneficiari.view",
        "consegne.view",
        "consegne.manage",
        "consegne.export",
        "magazzino.view",
      ],
    })
    .where(eq(ruoliTable.id, f.users.requester.roleId));
  const { default: app } = await import("../src/app");
  const server = await listeners.open("app", () => app);
  admin = request.agent(server);
  scoped = request.agent(server);
  expect((await admin.post("/api/auth/login").send(f.users.admin)).status).toBe(
    200,
  );
  expect(
    (await scoped.post("/api/auth/login").send(f.users.requester)).status,
  ).toBe(200);
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

it("M67-04/05 Area selection intersects scope and historical snapshots, including count/export", async () => {
  const result = await admin
    .get("/api/consegne")
    .query({ areaOperativaId: f.area, pageSize: 1 });
  expect(result.status, result.text).toBe(200);
  expect(result.body.total).toBe(2);
  const exported = await admin
    .get("/api/consegne/export")
    .query({ areaOperativaId: f.area });
  expect(exported.status, exported.text).toBe(200);
  expect(exported.body.items.map((x: { id: number }) => x.id)).toContain(
    historical,
  );
  expect(exported.body.total).toBe(2);
  const forbidden = await scoped
    .get("/api/consegne")
    .query({ areaOperativaId: areaB });
  expect(forbidden.status).toBe(200);
  expect(forbidden.body.total).toBe(0);
  expect((await admin.get("/api/consegne?areaOperativaId=NaN")).status).toBe(
    400,
  );
});

it("M67-06/07 exact legacy resolver beyond 50/100, scoped and inactive negatives; MS is not legacy", async () => {
  const before = (
    await pool.query(
      "select (select count(*) from consegne)::int c,(select count(*) from movimenti)::int m,(select count(*) from beneficiari)::int b",
    )
  ).rows[0];
  const first = await scoped
    .get("/api/beneficiari")
    .query({ attivo: true, pageSize: 50, centroAscoltoId: centroA });
  expect(first.status).toBe(200);
  for (const code of [codes[50], codes[0]]) {
    expect(first.body.map((x: { codice: string }) => x.codice)).not.toContain(
      code,
    );
    const result = await scoped
      .get("/api/consegne/beneficiario-da-codice")
      .query({ codice: code, areaOperativaId: f.area });
    expect(result.status, result.text).toBe(200);
    expect(result.body.codice).toBe(code);
    expect(Object.keys(result.body).sort()).toEqual(
      ["id", "codice", "nome", "cognome", "centroAscoltoId"].sort(),
    );
  }
  const other = (
    await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, personB))
  )[0];
  for (const code of ["SCONOSCIUTO", "MS-token-opaco", other.codice])
    expect(
      (
        await scoped
          .get("/api/consegne/beneficiario-da-codice")
          .query({ codice: code })
      ).status,
    ).toBe(404);
  await db
    .update(beneficiariTable)
    .set({ attivo: false })
    .where(eq(beneficiariTable.codice, codes[100]));
  expect(
    (
      await scoped
        .get("/api/consegne/beneficiario-da-codice")
        .query({ codice: codes[100] })
    ).status,
  ).toBe(404);
  const after = (
    await pool.query(
      "select (select count(*) from consegne)::int c,(select count(*) from movimenti)::int m,(select count(*) from beneficiari)::int b",
    )
  ).rows[0];
  expect(after).toEqual(before);
});

it("M67-08 writer-backed transfer receipt/return/outcome, unload and reversal have the canonical effect", async () => {
  const product = await createProdotto(scope, {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
  });
  await db.transaction((tx) =>
    createWarehouseLoad(tx, {
      magazzinoId: f.origin,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-03-29",
      creatoDa: f.users.admin.id,
      righe: [
        {
          prodottoId: product,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "20",
        },
      ],
    }),
  );
  const destination = await createMagazzino(scope, null, {
    areaOperativaId: f.area,
  });
  async function command(
    id: number,
    suffix: string,
    versione: number,
    fields = {},
  ) {
    const result = await admin
      .post(`/api/trasferimenti/${id}/${suffix}`)
      .send({ versione, idempotencyKey: randomUUID(), ...fields });
    expect(result.status, result.text).toBe(200);
    return result.body;
  }
  for (const receive of [true, false]) {
    const created = await admin.post("/api/trasferimenti").send({
      idempotencyKey: randomUUID(),
      magazzinoOrigineId: f.origin,
      magazzinoDestinoId: destination,
      dataRichiesta: "2026-03-29",
      trasportatoreNome: "Fixture M67B",
      righe: [{ prodottoId: product, quantita: "2", unitaMisura: "kg" }],
    });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id;
    const prepared = await command(id, "prepara", created.body.versione);
    const started = await command(id, "avvia", prepared.versione);
    if (receive) await command(id, "conferma", started.versione);
    else {
      const missing = await command(id, "mancato-arrivo", started.versione, {
        motivo: "Fixture destinazione assente",
      });
      const preview = await admin.get(`/api/trasferimenti/${id}/rientro`);
      expect(preview.status, preview.text).toBe(200);
      await command(id, "rientro", missing.versione, {
        righe: [
          {
            movimentoUscitaId: preview.body.partite[0].movimentoUscitaId,
            idonea: "1",
            mancante: "1",
          },
        ],
      });
    }
  }
  const ref = `M67B-${randomUUID().slice(0, 20)}`;
  await db.transaction((tx) =>
    creaScaricoInventariale(tx, {
      codice: ref,
      documentoRiferimento: ref,
      magazzinoId: f.origin,
      centroAscoltoId: null,
      dataScarico: "2026-03-29",
      causale: "smaltimento",
      operatoreId: f.users.admin.id,
      righe: [{ prodottoId: product, quantita: "1", unitaMisura: "kg" }],
    }),
  );
  await db.transaction((tx) =>
    stornaScaricoInventariale(tx, {
      documentoRiferimento: ref,
      dataMovimento: "2026-03-29",
      operatoreId: f.users.admin.id,
      tipoDettaglio: "storno_scarico",
      note: "Fixture M67B",
    }),
  );
  const bollaId = await insertBolla(scope, {
    beneficiarioId: personA,
    magazzinoId: f.origin,
  });
  const rowId = await insertBollaRiga(scope, {
    bollaId,
    prodottoId: product,
    quantita: 1,
    unitaMisura: "kg",
  });
  for (const [action, extra] of [
    ["conferma", {}],
    ["consegna", { confermaRicezione: true }],
    [
      "storno-amministrativo",
      { motivo: "Fixture storno uscita M67B", rigaIds: [rowId] },
    ],
  ] as const) {
    const version = (
      await pool.query("select versione from bolle where id=$1", [bollaId])
    ).rows[0].versione;
    const result = await admin
      .post(`/api/bolle/${bollaId}/${action}`)
      .send({ versione: version, idempotencyKey: randomUUID(), ...extra });
    expect(result.status, result.text).toBe(200);
  }
  const snapshot = async () =>
    (
      await pool.query(
        "select (select jsonb_agg(m order by id) from movimenti m where prodotto_id=$1) movements,(select jsonb_agg(l order by id) from lotti l where prodotto_id=$1) lots",
        [product],
      )
    ).rows[0];
  const before = await snapshot();
  const response = await admin
    .get("/api/movimenti")
    .query({ prodottoId: product });
  expect(response.status, response.text).toBe(200);
  for (const [type, detail, effect] of [
    ["carico", null, 1],
    ["trasferimento", "uscita", -1],
    ["trasferimento", "entrata", 1],
    ["rientro", null, 1],
    ["esito", null, 0],
    ["scarico", null, -1],
    ["storno", null, 1],
  ] as const) {
    const rows = response.body.filter(
      (m: { tipoMovimento: string; tipoDettaglio: string }) =>
        m.tipoMovimento === type &&
        (detail == null || m.tipoDettaglio === detail),
    );
    expect(rows.length, `${type}/${detail}`).toBeGreaterThan(0);
    for (const row of rows) expect(row.effettoFisico).toBe(effect);
  }
  expect(await snapshot()).toEqual(before);
});

it("M67-04/05 ready Bolla queue applies selected Area/Centro to real prepared documents", async () => {
  const ids: number[] = [];
  for (const [area, person] of [
    [f.area, personA],
    [areaB, personB],
  ]) {
    const warehouse = await createMagazzino(scope, null, {
      areaOperativaId: area,
    });
    await db.transaction((tx) =>
      createWarehouseLoad(tx, {
        magazzinoId: warehouse,
        origineCarico: "DONAZIONE",
        dataCarico: "2026-03-29",
        creatoDa: f.users.admin.id,
        righe: [
          {
            prodottoId: f.product,
            fondoOrigine: "NESSUN_FONDO",
            quantitaOperativa: "2",
          },
        ],
      }),
    );
    const created = await admin.post("/api/richieste-magazzino").send({
      idempotencyKey: randomUUID(),
      tipoDestinatario: "beneficiario",
      sorgente: "beneficiario",
      beneficiarioId: person,
      bisogno: "Fixture M67B coda pronta",
      priorita: "normale",
    });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id;
    const taken = await admin
      .post(`/api/richieste-magazzino/${id}/presa-in-carico`)
      .send({ versione: created.body.versione, idempotencyKey: randomUUID() });
    expect(taken.status, taken.text).toBe(200);
    const document = await admin
      .post(`/api/richieste-magazzino/${id}/documento`)
      .send({
        versione: taken.body.versione,
        idempotencyKey: randomUUID(),
        magazzinoId: warehouse,
      });
    expect(document.status, document.text).toBe(201);
    const bolla = (
      await pool.query(
        "select b.id,b.versione from bolle b join richieste_magazzino_documenti d on d.bolla_id=b.id where d.richiesta_id=$1 and d.corrente",
        [id],
      )
    ).rows[0];
    const added = await admin.post(`/api/bolle/${bolla.id}/righe`).send({
      versione: bolla.versione,
      idempotencyKey: randomUUID(),
      prodottoId: f.product,
      quantita: 1,
      unitaMisura: "kg",
    });
    expect(added.status, added.text).toBe(201);
    const version = (
      await pool.query("select versione from bolle where id=$1", [bolla.id])
    ).rows[0].versione;
    const ready = await admin
      .post(`/api/bolle/${bolla.id}/conferma`)
      .send({ versione: version, idempotencyKey: randomUUID() });
    expect(ready.status, ready.text).toBe(200);
    ids.push(bolla.id);
  }
  const queue = await admin
    .get("/api/consegne/da-pianificare")
    .query({ areaOperativaId: f.area, centroAscoltoId: centroA });
  expect(queue.status, queue.text).toBe(200);
  expect(queue.body.map((x: { bollaId: number }) => x.bollaId)).toContain(
    ids[0],
  );
  expect(queue.body.map((x: { bollaId: number }) => x.bollaId)).not.toContain(
    ids[1],
  );
});

it("M67-07 current grants/territory, shared Centro NULL and same-session revocation", async () => {
  const shared = await createBeneficiario(scope, null, {
    areaOperativaId: f.area,
  });
  const code = (
    await pool.query("select codice from beneficiari where id=$1", [shared])
  ).rows[0].codice;
  await db
    .update(utentiTable)
    .set({ centroAscoltoId: centroA })
    .where(eq(utentiTable.id, f.users.requester.id));
  const read = () =>
    scoped.get("/api/consegne/beneficiario-da-codice").query({ codice: code });
  expect((await read()).status).toBe(200);
  await db
    .update(ruoliTable)
    .set({ permessi: ["consegne.manage"] })
    .where(eq(ruoliTable.id, f.users.requester.roleId));
  expect((await read()).status).toBe(403);
  await db
    .update(ruoliTable)
    .set({ permessi: ["consegne.manage", "beneficiari.view"] })
    .where(eq(ruoliTable.id, f.users.requester.roleId));
  await db
    .update(utentiTable)
    .set({ centroAscoltoId: null, areaOperativaId: null })
    .where(eq(utentiTable.id, f.users.requester.id));
  expect((await read()).status).toBe(403);
});

it("M67-08/09 real load and adjustments expose canonical sign and precise civil date without mutating ledger", async () => {
  const product = await createProdotto(scope, {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
  });
  const load = await db.transaction((tx) =>
    createWarehouseLoad(tx, {
      magazzinoId: f.origin,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-03-29",
      creatoDa: f.users.admin.id,
      righe: [
        {
          prodottoId: product,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "10.123456",
        },
      ],
    }),
  );
  for (const delta of ["1.000001", "-0.000001"])
    await db.transaction((tx) =>
      rettificaInventarialeConEsito(tx, {
        lottoId: load.righe[0].lotto.id,
        delta,
        causale: "inventario_fisico",
        motivazione: "Fixture sintetica M67B",
        dataMovimento: "2026-03-29",
        operatoreId: f.users.admin.id,
      }),
    );
  const before = (
    await pool.query(
      "select * from movimenti where prodotto_id=$1 order by id",
      [product],
    )
  ).rows;
  const result = await admin
    .get("/api/movimenti")
    .query({ prodottoId: product });
  expect(result.status).toBe(200);
  for (const m of result.body) {
    expect(m.effettoFisico).toBe(
      m.tipoMovimento === "rettifica_negativa" ? -1 : 1,
    );
    expect(m.dataMovimento).toBe("2026-03-29");
    expect(m.quantitaPrecisa).toBe(before.find((x) => x.id === m.id).quantita);
  }
  expect(
    (
      await pool.query(
        "select * from movimenti where prodotto_id=$1 order by id",
        [product],
      )
    ).rows,
  ).toEqual(before);
});
