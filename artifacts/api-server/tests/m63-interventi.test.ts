import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  areeOperativeTable,
  centriAscoltoTable,
  beneficiariTable,
  utentiTable,
  ruoliTable,
  interventiTable,
  bolleTable,
  bollaRigheTable,
  prodottiTable,
  magazziniTable,
  richiesteMagazzinoTable,
  richiesteMagazzinoDocumentiTable,
  consegneTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../src/app";
import { selectInterventoRaccordo } from "../src/lib/interventiLogistics";
import {
  syncInterventoBolla,
  annullaInterventoDaBollaTx,
} from "../src/lib/bollaDelivery";
import { systemAuditContext } from "../src/lib/auditEvent";

const suffix = randomUUID().slice(0, 8),
  password = randomUUID();
const grants = [
  "sociale.interventi.view",
  "sociale.interventi.create",
  "sociale.interventi.update",
  "sociale.interventi.complete",
  "sociale.interventi.cancel",
];
let area: number,
  otherArea: number,
  centre: number,
  otherCentre: number,
  subject: number;
let actor: Awaited<ReturnType<typeof user>>,
  globalAdmin: typeof actor,
  boundAdmin: typeof actor;
async function user(
  label: string,
  scope: { areaOperativaId: number | null; centroAscoltoId: number | null },
  isAdmin = false,
  permissions = grants,
) {
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `m63-${label}-${randomUUID()}`,
      aree: ["sociale"],
      permessi: permissions,
      isAdmin,
    })
    .returning();
  const [row] = await db
    .insert(utentiTable)
    .values({
      username: `m63-${label}-${randomUUID()}`,
      nome: "Sintetico",
      passwordHash: await bcrypt.hash(password, 4),
      ruoloId: role.id,
      mustChangePassword: false,
      ...scope,
    })
    .returning();
  const session = request.agent(app);
  const login = await session
    .post("/api/auth/login")
    .send({ username: row.username, password });
  expect(login.status, login.text).toBe(200);
  return { session, row, role };
}
async function intervention(beneficiarioId = subject) {
  const [row] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId,
      tipoIntervento: `m63-${randomUUID()}`,
      ambito: "sociale",
      stato: "da_pianificare",
      operatoreId: actor.row.id,
      dataAggiornamento: new Date(),
    })
    .returning();
  return row;
}
beforeAll(async () => {
  expect(process.env.M63_DISPOSABLE_DB).toBe("verified");
  expect(new URL(process.env.DATABASE_URL!).port).toBe("58631");
  const areas = await db
    .insert(areeOperativeTable)
    .values([{ nome: `M63 A ${suffix}` }, { nome: `M63 B ${suffix}` }])
    .returning();
  [area, otherArea] = areas.map((row) => row.id);
  const centres = await db
    .insert(centriAscoltoTable)
    .values([
      { nome: `M63 A ${suffix}`, areaOperativaId: area },
      { nome: `M63 B ${suffix}`, areaOperativaId: otherArea },
    ])
    .returning();
  [centre, otherCentre] = centres.map((row) => row.id);
  const [beneficiary] = await db
    .insert(beneficiariTable)
    .values({
      codice: `M63-${suffix}`,
      nome: "Persona",
      cognome: "Sintetica",
      areaOperativaId: area,
      centroAscoltoId: centre,
    })
    .returning();
  subject = beneficiary.id;
  actor = await user("ordinary", {
    areaOperativaId: area,
    centroAscoltoId: centre,
  });
  globalAdmin = await user(
    "global",
    { areaOperativaId: null, centroAscoltoId: null },
    true,
  );
  boundAdmin = await user(
    "bound",
    { areaOperativaId: otherArea, centroAscoltoId: otherCentre },
    true,
  );
});
afterAll(async () => {
  await pool.end();
});

describe("M63 sviluppo — sessioni reali e transazioni", () => {
  it("T01 nullo non è globale; liste, dettaglio, storico e comando negati", async () => {
    const x = await user("null", {
        areaOperativaId: null,
        centroAscoltoId: null,
      }),
      row = await intervention();
    const list = await x.session
      .get("/api/interventi")
      .query({ ambito: "sociale" });
    expect(list.status, list.text).toBe(200);
    expect(list.body).toEqual([]);
    for (const path of [
      "",
      "/operativita",
      "/storico-stati",
      "/bisogni-pianificati",
    ])
      expect(
        (await x.session.get(`/api/interventi/${row.id}${path}`)).status,
      ).toBe(403);
    expect(
      (
        await x.session
          .post(`/api/interventi/${row.id}/avvia`)
          .send({ versione: row.dataAggiornamento.toISOString() })
      ).status,
    ).toBe(403);
  });
  it("T02 globale esplicito, admin vincolato e scope Area custom", async () => {
    const row = await intervention();
    expect(
      (await globalAdmin.session.get(`/api/interventi/${row.id}`)).status,
    ).toBe(200);
    expect(
      (await boundAdmin.session.get(`/api/interventi/${row.id}`)).status,
    ).toBe(403);
    const custom = await user("area", {
      areaOperativaId: area,
      centroAscoltoId: null,
    });
    expect((await custom.session.get(`/api/interventi/${row.id}`)).status).toBe(
      200,
    );
    const noGrant = await user(
      "nogrant",
      { areaOperativaId: area, centroAscoltoId: centre },
      false,
      [],
    );
    expect(
      (await noGrant.session.get(`/api/interventi/${row.id}`)).status,
    ).toBe(403);
  });
  it("T03 Centro incoerente, Area e Centro inattivi", async () => {
    const row = await intervention(),
      x = await user("wrong", {
        areaOperativaId: area,
        centroAscoltoId: otherCentre,
      });
    expect((await x.session.get(`/api/interventi/${row.id}`)).status).toBe(403);
    for (const table of [areeOperativeTable, centriAscoltoTable]) {
      const id = table === areeOperativeTable ? area : centre;
      await db.update(table).set({ attivo: false }).where(eq(table.id, id));
      try {
        expect(
          (await actor.session.get(`/api/interventi/${row.id}`)).status,
        ).toBe(403);
      } finally {
        await db.update(table).set({ attivo: true }).where(eq(table.id, id));
      }
    }
  });
  it.each(["grant", "role", "territory", "inactive"])(
    "T04 revoca %s mentre il comando attende un lock PostgreSQL osservato",
    async (kind) => {
      const x = await user(`race-${kind}`, {
          areaOperativaId: area,
          centroAscoltoId: centre,
        }),
        row = await intervention();
      const connection = await pool.connect();
      let pending: Promise<request.Response> | undefined;
      try {
        await connection.query("begin");
        const pid = (await connection.query("select pg_backend_pid() as pid"))
          .rows[0].pid;
        if (kind === "grant")
          await connection.query(
            "update ruoli set permessi='[]'::jsonb where id=$1",
            [x.role.id],
          );
        else if (kind === "role")
          await connection.query(
            "update utenti set ruolo_id=null where id=$1",
            [x.row.id],
          );
        else if (kind === "territory")
          await connection.query(
            "update utenti set area_operativa_id=null, centro_ascolto_id=null where id=$1",
            [x.row.id],
          );
        else
          await connection.query("update utenti set attivo=false where id=$1", [
            x.row.id,
          ]);
        pending = x.session
          .post(`/api/interventi/${row.id}/avvia`)
          .send({ versione: row.dataAggiornamento.toISOString() })
          .then((response) => response);
        const deadline = Date.now() + 10000;
        let waiting = false;
        while (Date.now() < deadline) {
          const result = await pool.query(
            "select pid from pg_stat_activity where $1=ANY(pg_blocking_pids(pid))",
            [pid],
          );
          if (result.rowCount) {
            waiting = true;
            break;
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        expect(waiting, "command must really wait on revocation lock").toBe(
          true,
        );
        await connection.query("commit");
        const response = await pending;
        expect(response.status, response.text).toBe(403);
        const [actual] = await db
          .select()
          .from(interventiTable)
          .where(eq(interventiTable.id, row.id));
        expect(actual.stato).toBe("da_pianificare");
        const history = await db.execute(
          sql`select count(*)::int as n from interventi_storico_stati where intervento_id=${row.id}`,
        );
        expect(history.rows[0].n).toBe(0);
      } finally {
        await connection.query("rollback");
        connection.release();
        if (pending) await pending;
      }
    },
  );
  it("T05 tutti gli ingressi negano un collegamento Bolla client, senza effetti", async () => {
    const row = await intervention(),
      payload = {
        beneficiarioId: subject,
        tipoIntervento: "aiuto",
        ambito: "sociale",
        stato: "da_pianificare",
        bollaId: 2147483640,
      };
    expect(
      (await actor.session.post("/api/interventi").send(payload)).status,
    ).toBe(400);
    expect(
      (
        await actor.session.patch(`/api/interventi/${row.id}`).send({
          bollaId: payload.bollaId,
          versione: row.dataAggiornamento.toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await actor.session
          .post(`/api/interventi/${row.id}/successivi`)
          .send(payload)
      ).status,
    ).toBe(400);
    const response = await actor.session
      .patch(`/api/interventi/${row.id}`)
      .send({
        bollaId: null,
        versione: row.dataAggiornamento.toISOString(),
        sede: "Echo invariato",
      });
    expect(response.status, response.text).toBe(200);
  });
  it("T04 comando già serializzato precede la revoca, che non è retroattiva", async () => {
    const x = await user("command-first", {
        areaOperativaId: area,
        centroAscoltoId: centre,
      }),
      row = await intervention();
    const holder = await pool.connect(),
      revoker = await pool.connect();
    let command: Promise<request.Response> | undefined,
      revocation: Promise<unknown> | undefined;
    const blockedBy = async (blockingPid: number, waitingPid?: number) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const result = await pool.query(
          "select pid from pg_stat_activity where $1=ANY(pg_blocking_pids(pid)) and ($2::int is null or pid=$2)",
          [blockingPid, waitingPid ?? null],
        );
        if (result.rows.length) return result.rows[0].pid as number;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("PostgreSQL lock barrier not observed");
    };
    try {
      await holder.query("begin");
      const holderPid = (await holder.query("select pg_backend_pid() as pid"))
        .rows[0].pid;
      await holder.query("select id from interventi where id=$1 for update", [
        row.id,
      ]);
      command = x.session
        .post(`/api/interventi/${row.id}/avvia`)
        .send({ versione: row.dataAggiornamento.toISOString() })
        .then((r) => r);
      const commandPid = await blockedBy(holderPid);
      await revoker.query("begin");
      const revokerPid = (await revoker.query("select pg_backend_pid() as pid"))
        .rows[0].pid;
      revocation = revoker.query("update utenti set attivo=false where id=$1", [
        x.row.id,
      ]);
      expect(await blockedBy(commandPid, revokerPid)).toBe(revokerPid);
      await holder.query("commit");
      const response = await command;
      expect(response.status, response.text).toBe(200);
      await revocation;
      await revoker.query("commit");
      expect(
        (
          await db
            .select()
            .from(interventiTable)
            .where(eq(interventiTable.id, row.id))
        )[0].stato,
      ).toBe("in_corso");
      expect((await x.session.get(`/api/interventi/${row.id}`)).status).toBe(
        401,
      );
    } finally {
      await holder.query("rollback");
      if (command) await command;
      if (revocation) await revocation;
      await revoker.query("rollback");
      holder.release();
      revoker.release();
    }
  });
  it("T10 due ingressi concorrenti: un successivo uguale, successivi distinti leciti", async () => {
    const row = await intervention(),
      payload = {
        beneficiarioId: subject,
        interventoPrecedenteId: row.id,
        tipoIntervento: "colloquio",
        ambito: "sociale",
        stato: "da_pianificare",
      };
    const responses = await Promise.all([
      actor.session.post("/api/interventi").send(payload),
      actor.session.post(`/api/interventi/${row.id}/successivi`).send(payload),
    ]);
    expect(
      responses.map((r) => r.status).sort(),
      responses.map((r) => r.text).join("\n"),
    ).toEqual([201, 409]);
    const different = await actor.session
      .post(`/api/interventi/${row.id}/successivi`)
      .send({ ...payload, tipoIntervento: "aiuto materiale" });
    expect(different.status, different.text).toBe(201);
  });
  it("T05 Bolle reali estranee, M5 ed accesso Emporio; conclusione+successivo, echo e scollegamento", async () => {
    const [foreign] = await db
      .insert(beneficiariTable)
      .values({
        codice: `M63-F-${suffix}`,
        nome: "Altra",
        cognome: "Sintetica",
        areaOperativaId: otherArea,
        centroAscoltoId: otherCentre,
      })
      .returning();
    const [warehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `M63-T05-${suffix}`,
        nome: "Deposito T05",
        areaOperativaId: area,
        centroAscoltoId: centre,
      })
      .returning();
    const docs = await db
      .insert(bolleTable)
      .values(
        [subject, foreign.id, subject, subject].map((id, index) => ({
          numeroBolla: `M63-T05-${suffix}-${index}`,
          dataBolla: "2026-10-11",
          beneficiarioId: id,
          magazzinoId: warehouse.id,
          operatoreId: actor.row.id,
        })),
      )
      .returning();
    const origin = await intervention();
    const [need] = await db
      .insert(richiesteMagazzinoTable)
      .values({
        codice: `M63-T05-${suffix}`,
        tipoDestinatario: "beneficiario",
        beneficiarioId: subject,
        areaOperativaId: area,
        centroAscoltoId: centre,
        sorgente: "intervento_sociale",
        interventoId: origin.id,
        destinatarioNomeSnapshot: "Sintetico",
        areaNomeSnapshot: "Area",
        bisogno: "Bisogno",
        inviatoDa: actor.row.id,
      })
      .returning();
    await db.insert(richiesteMagazzinoDocumentiTable).values({
      richiestaId: need.id,
      tipoDocumento: "bolla",
      bollaId: docs[2].id,
      creatoDa: actor.row.id,
    });
    const [access] = await db
      .insert(consegneTable)
      .values({
        codice: `M63-T05-${suffix}`,
        beneficiarioId: subject,
        tipoPianificazione: "accesso_emporio",
        tipoConsegna: "ritiro",
        dataPrevista: "2026-10-11",
        magazzinoId: warehouse.id,
        magazzinoEmporioId: warehouse.id,
      })
      .returning();
    await db
      .update(bolleTable)
      .set({ consegnaId: access.id })
      .where(eq(bolleTable.id, docs[3].id));
    const row = await intervention();
    const before = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, row.id));
    for (const bollaId of docs.map((d) => d.id)) {
      const payload = {
        beneficiarioId: subject,
        tipoIntervento: "Aiuto",
        ambito: "sociale",
        stato: "da_pianificare",
        bollaId,
      };
      expect(
        (await actor.session.post("/api/interventi").send(payload)).status,
      ).toBe(400);
      expect(
        (
          await actor.session
            .patch(`/api/interventi/${row.id}`)
            .send({ bollaId, versione: row.dataAggiornamento.toISOString() })
        ).status,
      ).toBe(400);
      expect(
        (
          await actor.session
            .post(`/api/interventi/${row.id}/successivi`)
            .send(payload)
        ).status,
      ).toBe(400);
      const nested = await actor.session
        .post(`/api/interventi/${row.id}/concludi`)
        .send({
          versione: row.dataAggiornamento.toISOString(),
          conferma: true,
          risultato: "Esito",
          successivo: payload,
        });
      expect(nested.status, nested.text).toBe(400);
      expect(nested.body.error).toContain("Bolla");
    }
    expect(
      await db
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, row.id)),
    ).toEqual(before);
    await db
      .update(interventiTable)
      .set({ bollaId: docs[0].id })
      .where(eq(interventiTable.id, row.id));
    for (const bollaId of [null, docs[1].id])
      expect(
        (
          await actor.session
            .patch(`/api/interventi/${row.id}`)
            .send({ bollaId, versione: row.dataAggiornamento.toISOString() })
        ).status,
      ).toBe(400);
    const echo = await actor.session.patch(`/api/interventi/${row.id}`).send({
      bollaId: docs[0].id,
      versione: row.dataAggiornamento.toISOString(),
      sede: "Echo lecito",
    });
    expect(echo.status, echo.text).toBe(200);
    expect(echo.body.bollaId).toBe(docs[0].id);
  });
  it("T10 due PATCH non possono creare un ciclo", async () => {
    const a = await intervention(),
      b = await intervention();
    const responses = await Promise.all([
      actor.session.patch(`/api/interventi/${a.id}`).send({
        versione: a.dataAggiornamento.toISOString(),
        interventoPrecedenteId: b.id,
      }),
      actor.session.patch(`/api/interventi/${b.id}`).send({
        versione: b.dataAggiornamento.toISOString(),
        interventoPrecedenteId: a.id,
      }),
    ]);
    expect(
      responses.map((r) => r.status).sort(),
      responses.map((r) => r.text).join("\n"),
    ).toEqual([200, 400]);
  });
  it.each(["concludi", "annulla", "mancata-presentazione"])(
    "T09 %s non modifica richiesta aperta né inventario",
    async (command) => {
      const original = await intervention();
      const [row] = await db
        .update(interventiTable)
        .set({
          stato: command === "concludi" ? "in_corso" : "pianificato",
          dataOraPianificata: new Date("2026-10-11T10:00:00Z"),
          dataOraAvvio:
            command === "concludi" ? new Date("2026-10-11T10:01:00Z") : null,
          dataAggiornamento: new Date(),
        })
        .where(eq(interventiTable.id, original.id))
        .returning();
      const [need] = await db
        .insert(richiesteMagazzinoTable)
        .values({
          codice: `M63-${randomUUID()}`,
          tipoDestinatario: "beneficiario",
          beneficiarioId: subject,
          areaOperativaId: area,
          centroAscoltoId: centre,
          sorgente: "intervento_sociale",
          interventoId: row.id,
          destinatarioNomeSnapshot: "Sintetico",
          areaNomeSnapshot: "Area sintetica",
          bisogno: "Bisogno aperto",
          inviatoDa: actor.row.id,
        })
        .returning();
      const snapshot = () =>
        db.execute(sql`select
      (select count(*)::int from movimenti) as movements,
      (select coalesce(sum(quantita_residua),0)::text from lotti) as stock,
      (select count(*)::int from interventi) as interventions`);
      const before = await snapshot();
      const response = await actor.session
        .post(`/api/interventi/${row.id}/${command}`)
        .send({
          versione: row.dataAggiornamento.toISOString(),
          conferma: true,
          risultato: "Esito sociale",
          motivo: "Solo annullamento sociale",
          nota: "Assenza al colloquio",
        });
      expect(response.status, response.text).toBe(200);
      expect(
        (
          await db
            .select()
            .from(richiesteMagazzinoTable)
            .where(eq(richiesteMagazzinoTable.id, need.id))
        )[0],
      ).toEqual(need);
      expect((await snapshot()).rows).toEqual(before.rows);
    },
  );
  it("T12 201 risultati: totale, tie ID, pagina successiva, array legacy e zero", async () => {
    const tipo = `201-${suffix}`;
    await db.insert(interventiTable).values(
      Array.from({ length: 201 }, () => ({
        beneficiarioId: subject,
        tipoIntervento: tipo,
        ambito: "sociale",
        stato: "da_pianificare",
        operatoreId: actor.row.id,
      })),
    );
    const params = {
      ambito: "sociale",
      tipo,
      vista: "da_pianificare",
      limite: 200,
      ordina: "beneficiario",
    };
    const first = await actor.session
        .get("/api/interventi/pagina")
        .query(params),
      second = await actor.session
        .get("/api/interventi/pagina")
        .query({ ...params, pagina: 2 });
    expect(first.status, first.text).toBe(200);
    expect(first.body.total).toBe(201);
    expect(first.body.items).toHaveLength(200);
    expect(second.body.items).toHaveLength(1);
    expect(
      new Set([...first.body.items, ...second.body.items].map((r) => r.id))
        .size,
    ).toBe(201);
    expect(
      (
        await actor.session
          .get("/api/interventi")
          .query({ ...params, pagina: 2 })
      ).body,
    ).toEqual(second.body.items);
    expect(
      (
        await actor.session
          .get("/api/interventi/pagina")
          .query({ ...params, tipo: "non-esiste" })
      ).body,
    ).toMatchObject({ items: [], total: 0 });
  });
  it("T13 attiva prima di annullata recente e ambiguità esplicita", () => {
    const old = { richiestaId: 1, richiestaStato: "presa_in_carico" },
      cancelled = { richiestaId: 2, richiestaStato: "annullata" };
    expect(selectInterventoRaccordo([cancelled, old])).toEqual({
      ...old,
      ambiguo: false,
    });
    expect(
      selectInterventoRaccordo([old, { ...old, richiestaId: 3 }])?.ambiguo,
    ).toBe(true);
  });
  it("T11 sync/cancel preservano l'originale ambiguo; il nuovo derivato ha prova audit", async () => {
    const [warehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `M63-${suffix}`,
        nome: "Deposito sintetico",
        areaOperativaId: area,
        centroAscoltoId: centre,
      })
      .returning();
    const [product] = await db
      .insert(prodottiTable)
      .values({
        codice: `M63-${suffix}`,
        nome: "Prodotto sintetico",
        unitaMisura: "pz",
        tipoProdotto: "alimentare",
      })
      .returning();
    const makeBolla = async () => {
      const [bolla] = await db
        .insert(bolleTable)
        .values({
          numeroBolla: `M63-${randomUUID().slice(0, 10)}`,
          dataBolla: "2026-10-11",
          magazzinoId: warehouse.id,
          beneficiarioId: subject,
          stato: "consegnato",
          operatoreId: actor.row.id,
        })
        .returning();
      await db.insert(bollaRigheTable).values({
        bollaId: bolla.id,
        prodottoId: product.id,
        quantita: "1",
        unitaMisura: "pz",
      });
      return bolla;
    };
    const original = await intervention(),
      bolla = await makeBolla();
    await db
      .update(interventiTable)
      .set({
        bollaId: bolla.id,
        descrizione: "Contenuto sociale da preservare",
      })
      .where(eq(interventiTable.id, original.id));
    const audit = systemAuditContext({
      actorCode: "m63-development",
      initiatedByUserId: actor.row.id,
      initiatedByCodeSnapshot: actor.row.username,
    });
    await syncInterventoBolla(bolla.id, audit);
    await db.transaction((tx) =>
      annullaInterventoDaBollaTx(
        tx,
        bolla.id,
        actor.row.id,
        "annullamento logistico",
      ),
    );
    const preserved = await actor.session.get(`/api/interventi/${original.id}`);
    expect(preserved.body).toMatchObject({
      stato: "da_pianificare",
      descrizione: "Contenuto sociale da preservare",
      provenienza: "legacy_non_classificato",
    });
    const delivered = await makeBolla();
    await syncInterventoBolla(delivered.id, audit);
    await syncInterventoBolla(delivered.id, audit);
    const records = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, delivered.id));
    expect(records).toHaveLength(1);
    const derived = await actor.session.get(`/api/interventi/${records[0].id}`);
    expect(derived.body.provenienza).toBe("derivato_bolla");
    await db.transaction((tx) =>
      annullaInterventoDaBollaTx(
        tx,
        delivered.id,
        actor.row.id,
        "annullamento logistico",
      ),
    );
    const [cancelled] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, records[0].id));
    expect(cancelled.stato).toBe("annullato");
  });
});
