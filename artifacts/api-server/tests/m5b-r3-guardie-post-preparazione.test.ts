/* @vitest-environment node */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  areeOperativeTable,
  bollaRigheTable,
  bolleTable,
  centriAscoltoTable,
  consegneTable,
  entiDestinatariTable,
  db,
  pool,
  richiesteMagazzinoTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  newScope,
} from "./scope-helpers";

const scope = newScope();
const password = `R3-${randomUUID()}-only`;
const grants = [
  "richieste_magazzino.view",
  "richieste_magazzino.prepare",
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "bolle.reverse.admin",
  "magazzino.view",
  "magazzino.stock.receive",
  "magazzino.transfers.create",
  "magazzino.transfers.prepare",
  "magazzino.transfers.dispatch",
  "magazzino.transfers.receive",
  "consegne.view",
  "consegne.manage",
  "consegne.complete",
];
let app: (typeof import("../src/app"))["default"];
let areaId: number;
let centreId: number;
let beneficiaryId: number;
let originId: number;
let destinationId: number;
let productId: number;
let lotId: number;
let operatorId: number;
let roleId: number;

async function login() {
  const [user] = await db
    .select({ username: utentiTable.username })
    .from(utentiTable)
    .where(eq(utentiTable.id, operatorId));
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/login")
    .send({ username: user.username, password });
  expect(response.status, response.text).toBe(200);
  return agent;
}

async function assignment(
  areaOperativaId: number | null,
  centroAscoltoId: number | null,
) {
  await db
    .update(utentiTable)
    .set({ areaOperativaId, centroAscoltoId })
    .where(eq(utentiTable.id, operatorId));
}

async function fixture(kind: "beneficiario" | "magazzino" | "ente") {
  const entity =
    kind === "ente"
      ? (
          await db
            .insert(entiDestinatariTable)
            .values({
              denominazione: `Ente R3 ${randomUUID().slice(0, 8)}`,
              indirizzo: "Via test R3 1",
              areaOperativaId: areaId,
            })
            .returning()
        )[0]
      : null;
  const [row] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `RM-R3-${randomUUID().slice(0, 8)}`,
      tipoDestinatario: kind,
      beneficiarioId: kind === "beneficiario" ? beneficiaryId : null,
      enteDestinatarioId: entity?.id ?? null,
      magazzinoDestinatarioId: kind === "magazzino" ? destinationId : null,
      areaOperativaId: areaId,
      centroAscoltoId: kind === "beneficiario" ? centreId : null,
      sorgente: kind === "beneficiario" ? "beneficiario" : "operativa",
      destinatarioNomeSnapshot: "Destinatario sintetico R3",
      areaNomeSnapshot: "Area sintetica R3",
      centroNomeSnapshot: kind === "beneficiario" ? "Centro R3" : null,
      bisogno: "R3 guardie post-preparazione",
      stato: "presa_in_carico",
      inviatoDa: operatorId,
      presoInCaricoDa: operatorId,
      presoInCaricoCodiceSnapshot: "r3",
      presoInCaricoAt: new Date(),
    })
    .returning();
  return row;
}

async function readyBolla(
  agent: Awaited<ReturnType<typeof login>>,
  kind: "beneficiario" | "ente" = "beneficiario",
) {
  const row = await fixture(kind);
  const created = await agent
    .post(`/api/richieste-magazzino/${row.id}/documento`)
    .send({ idempotencyKey: randomUUID(), versione: 1, magazzinoId: originId });
  expect(created.status, created.text).toBe(201);
  const id = created.body.documentoId as number;
  const line = await agent.post(`/api/bolle/${id}/righe`).send({
    idempotencyKey: randomUUID(),
    versione: created.body.versioneDocumento,
    prodottoId: productId,
    lottoId: lotId,
    quantita: "1",
  });
  expect(line.status, line.text).toBe(201);
  const ready = await agent.post(`/api/bolle/${id}/conferma`).send({
    idempotencyKey: randomUUID(),
    versione: line.body.versioneBolla,
  });
  expect(ready.status, ready.text).toBe(200);
  return { richiestaId: row.id, id, versione: ready.body.versione };
}

async function planBolla(
  agent: Awaited<ReturnType<typeof login>>,
  bolla: { id: number; versione: number },
) {
  const planned = await agent.post(`/api/consegne/da-bolla/${bolla.id}`).send({
    ...command(bolla.versione),
    dataPrevista: "2026-10-08",
    fasciaOraria: "Mattina",
    tipoConsegna: "in_sede",
  });
  expect(planned.status, planned.text).toBe(201);
  const detail = await agent.get(`/api/bolle/${bolla.id}`);
  expect(detail.status, detail.text).toBe(200);
  return {
    id: planned.body.id as number,
    versione: detail.body.versione as number,
  };
}

async function readyTransfer(agent: Awaited<ReturnType<typeof login>>) {
  const row = await fixture("magazzino");
  const created = await agent
    .post(`/api/richieste-magazzino/${row.id}/documento`)
    .send({
      idempotencyKey: randomUUID(),
      versione: 1,
      magazzinoId: originId,
      righe: [
        {
          prodottoId: productId,
          lottoId: lotId,
          quantita: "1",
          unitaMisura: "pz",
        },
      ],
    });
  expect(created.status, created.text).toBe(201);
  const id = created.body.documentoId as number;
  const ready = await agent.post(`/api/trasferimenti/${id}/prepara`).send({
    idempotencyKey: randomUUID(),
    versione: created.body.versioneDocumento,
  });
  expect(ready.status, ready.text).toBe(200);
  return { richiestaId: row.id, id, versione: ready.body.versione };
}

async function digest(richiestaId: number, lottoId: number) {
  const result = await pool.query<{ digest: string }>(
    `SELECT md5(jsonb_build_object(
      'richiesta', (SELECT to_jsonb(r) FROM richieste_magazzino r WHERE r.id=$1),
      'link', (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM richieste_magazzino_documenti d WHERE d.richiesta_id=$1),
      'bolle', (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM bolle b JOIN richieste_magazzino_documenti d ON d.bolla_id=b.id WHERE d.richiesta_id=$1),
      'transfers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM trasferimenti t JOIN richieste_magazzino_documenti d ON d.trasferimento_id=t.id WHERE d.richiesta_id=$1),
      'stock', (SELECT to_jsonb(l) FROM lotti l WHERE l.id=$2),
      'reservations', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM prenotazioni_magazzino p WHERE p.bolla_id IN (SELECT bolla_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1) OR p.trasferimento_id IN (SELECT trasferimento_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1)),
      'movements', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM movimenti m WHERE m.bolla_id IN (SELECT bolla_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1) OR m.trasferimento_id IN (SELECT trasferimento_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1)),
      'audit', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_eventi a WHERE (a.entita_tipo='bolla' AND a.entita_id IN (SELECT bolla_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1)) OR (a.entita_tipo='trasferimento' AND a.entita_id IN (SELECT trasferimento_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1))),
      'receipts', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM comandi_operativi c WHERE (c.aggregato_tipo='bolla' AND c.aggregato_id IN (SELECT bolla_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1)) OR (c.aggregato_tipo='trasferimento' AND c.aggregato_id IN (SELECT trasferimento_id FROM richieste_magazzino_documenti WHERE richiesta_id=$1)))
    )::text) AS digest`,
    [richiestaId, lottoId],
  );
  return result.rows[0].digest;
}

function command(versione: number) {
  return { idempotencyKey: randomUUID(), versione };
}

async function denied(response: request.Response) {
  expect([403, 404], response.text).toContain(response.status);
  expect(response.text).not.toMatch(/RM-R3-|Destinatario sintetico R3/);
  for (const field of [
    "richiestaId",
    "documentoId",
    "bollaId",
    "trasferimentoId",
    "partite",
  ])
    expect(response.body).not.toHaveProperty(field);
}

async function waitForLock(queryPart: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM pg_stat_activity
       WHERE datname=current_database() AND wait_event_type='Lock'
         AND query ILIKE $1`,
      [`%${queryPart}%`],
    );
    if (result.rows[0].count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Barriera PostgreSQL non osservata: ${queryPart}`);
}

beforeAll(async () => {
  if (process.env.M5B_TEST_DISPOSABLE_DB !== "verified")
    throw new Error("R3 requires verified disposable PostgreSQL");
  app = (await import("../src/app")).default;
  areaId = await createAreaOperativa(scope);
  centreId = (await createCentroRec(scope, { areaOperativaId: areaId })).id;
  beneficiaryId = await createBeneficiario(scope, centreId, {
    areaOperativaId: areaId,
  });
  originId = await createMagazzino(scope, centreId, {
    areaOperativaId: areaId,
  });
  destinationId = await createMagazzino(scope, null, {
    areaOperativaId: areaId,
  });
  productId = await createProdotto(scope, {
    unitaMisura: "pz",
    quantitaFrazionabile: false,
  });
  lotId = await createLotto(scope, {
    prodottoId: productId,
    magazzinoId: originId,
    quantita: 100,
    dataScadenza: "2098-01-01",
  });
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `M5B-R3-${randomUUID().slice(0, 8)}`,
      aree: ["magazzino", "sociale"],
      permessi: grants,
    })
    .returning({ id: ruoliTable.id });
  roleId = role.id;
  operatorId = await createUtente(scope, {
    ruoloId: roleId,
    centroId: centreId,
  });
  await db
    .update(utentiTable)
    .set({
      areaOperativaId: areaId,
      passwordHash: await bcrypt.hash(password, 4),
      mustChangePassword: false,
    })
    .where(eq(utentiTable.id, operatorId));
});

afterAll(async () => {
  await pool.end();
});

describe("M5B-R3 — guardie post-preparazione con sessione reale", () => {
  it("R3-SOCIAL-HANDOFF: le guardie territoriali e i grant correnti restano sul nuovo percorso Centro", async () => {
    const agent = await login();
    const bolla = await readyBolla(agent);
    const before = await digest(bolla.richiestaId, lotId);
    for (const path of ["affida", "consegna"]) {
      const response = await agent.post(`/api/bolle/${bolla.id}/${path}`).send({
        ...command(bolla.versione),
        trasportatoreNome: "Non deve uscire",
      });
      expect(response.status, response.text).toBe(409);
      expect(response.body.error).toContain("Centro");
    }
    expect(await digest(bolla.richiestaId, lotId)).toBe(before);
    const planning = {
      ...command(bolla.versione),
      dataPrevista: "2026-10-08",
      fasciaOraria: "Mattina",
      tipoConsegna: "in_sede",
    };
    try {
      for (const assignmentPair of [
        [null, null],
        [null, centreId],
      ] as const) {
        await assignment(assignmentPair[0], assignmentPair[1]);
        // No global promotion: missing Area or an incoherent Centre cannot authorize planning.
        await denied(
          await agent.post(`/api/consegne/da-bolla/${bolla.id}`).send(planning),
        );
      }
      await assignment(areaId, centreId);
      for (const missingGrant of [
        "richieste_magazzino.view",
        "consegne.manage",
      ]) {
        await db
          .update(ruoliTable)
          .set({ permessi: grants.filter((g) => g !== missingGrant) })
          .where(eq(ruoliTable.id, roleId));
        await denied(
          await agent.post(`/api/consegne/da-bolla/${bolla.id}`).send(planning),
        );
      }
      expect(await digest(bolla.richiestaId, lotId)).toBe(before);
    } finally {
      await assignment(areaId, centreId);
      await db
        .update(ruoliTable)
        .set({ permessi: grants })
        .where(eq(ruoliTable.id, roleId));
    }
    const planned = await planBolla(agent, bolla);
    expect(planned.id).toBeGreaterThan(0);
  });

  it("R3-B: revoca territoriale nega Bolla Ente, rientro e storno senza effetti; il ripristino consente Affida", async () => {
    const agent = await login();
    const bolla = await readyBolla(agent, "ente");
    const socialBolla = await readyBolla(agent);
    const socialBefore = await digest(socialBolla.richiestaId, lotId);
    const before = await digest(bolla.richiestaId, lotId);
    await assignment(null, null);
    try {
      const fresh = await login();
      for (const session of [agent, fresh]) {
        await denied(
          await session
            .post(`/api/bolle/${bolla.id}/affida`)
            .send({ ...command(bolla.versione), trasportatoreNome: "R3" }),
        );
        await denied(
          await session
            .post(`/api/bolle/${bolla.id}/consegna`)
            .send(command(bolla.versione)),
        );
        await denied(
          await session
            .post(`/api/bolle/${bolla.id}/mancata-consegna`)
            .send({ ...command(bolla.versione), motivo: "R3" }),
        );
        await denied(await session.get(`/api/bolle/${bolla.id}/rientro`));
        await denied(
          await session
            .post(`/api/bolle/${bolla.id}/rientro`)
            .send({ ...command(bolla.versione), righe: [] }),
        );
        await denied(
          await session
            .post(`/api/bolle/${bolla.id}/ritiro-non-effettuato`)
            .send({ motivo: "R3" }),
        );
        await denied(
          await session
            .post(`/api/bolle/${socialBolla.id}/converti-consegna`)
            .send({
              indirizzoConsegna: "Via sintetica 1",
              dataPrevista: "2026-10-01",
            }),
        );
        await denied(
          await session
            .post(`/api/bolle/${bolla.id}/storno-amministrativo`)
            .send({ ...command(bolla.versione), motivo: "R3", rigaIds: [1] }),
        );
      }
      expect(await digest(bolla.richiestaId, lotId)).toBe(before);
      expect(await digest(socialBolla.richiestaId, lotId)).toBe(socialBefore);
    } finally {
      await assignment(areaId, centreId);
    }
    const entrustCommand = {
      ...command(bolla.versione),
      trasportatoreNome: "R3",
    };
    const entrusted = await agent
      .post(`/api/bolle/${bolla.id}/affida`)
      .send(entrustCommand);
    expect(entrusted.status, entrusted.text).toBe(200);
    expect(entrusted.body.stato).toBe("in_trasporto");
    const afterEntrust = await digest(bolla.richiestaId, lotId);
    await assignment(null, null);
    try {
      await denied(
        await agent.post(`/api/bolle/${bolla.id}/affida`).send(entrustCommand),
      );
      await denied(
        await agent
          .post(`/api/bolle/${bolla.id}/mancata-consegna`)
          .send({ ...command(entrusted.body.versione), motivo: "R3" }),
      );
      await denied(await agent.get(`/api/bolle/${bolla.id}/rientro`));
      expect(await digest(bolla.richiestaId, lotId)).toBe(afterEntrust);
    } finally {
      await assignment(areaId, centreId);
    }
    const entrustReplay = await agent
      .post(`/api/bolle/${bolla.id}/affida`)
      .send(entrustCommand);
    expect(entrustReplay.status, entrustReplay.text).toBe(200);
    expect(await digest(bolla.richiestaId, lotId)).toBe(afterEntrust);
    const missed = await agent
      .post(`/api/bolle/${bolla.id}/mancata-consegna`)
      .send({ ...command(entrusted.body.versione), motivo: "R3 assenza" });
    expect(missed.status, missed.text).toBe(200);
    const preview = await agent.get(`/api/bolle/${bolla.id}/rientro`);
    expect(preview.status, preview.text).toBe(200);
    const returned = await agent.post(`/api/bolle/${bolla.id}/rientro`).send({
      ...command(missed.body.versione),
      righe: [
        {
          movimentoUscitaId: preview.body.partite[0].movimentoUscitaId,
          idonea: "1",
          deteriorata: "0",
          mancante: "0",
        },
      ],
    });
    expect(returned.status, returned.text).toBe(200);
    expect(returned.body.stato).toBe("rientrato");
  }, 60_000);

  it("R3-T: revoca nega Avvia, Ricevi, mancato arrivo e rientro; scope ripristinato permette il workflow", async () => {
    const agent = await login();
    const transfer = await readyTransfer(agent);
    const before = await digest(transfer.richiestaId, lotId);
    await assignment(null, null);
    try {
      for (const session of [agent, await login()]) {
        await denied(
          await session
            .post(`/api/trasferimenti/${transfer.id}/avvia`)
            .send(command(transfer.versione)),
        );
        await denied(
          await session
            .post(`/api/trasferimenti/${transfer.id}/conferma`)
            .send(command(transfer.versione)),
        );
        await denied(
          await session
            .post(`/api/trasferimenti/${transfer.id}/mancato-arrivo`)
            .send({ ...command(transfer.versione), motivo: "R3" }),
        );
        await denied(
          await session.get(`/api/trasferimenti/${transfer.id}/rientro`),
        );
        await denied(
          await session
            .post(`/api/trasferimenti/${transfer.id}/rientro`)
            .send({ ...command(transfer.versione), righe: [] }),
        );
      }
      expect(await digest(transfer.richiestaId, lotId)).toBe(before);
    } finally {
      await assignment(areaId, centreId);
    }
    const dispatched = await agent
      .post(`/api/trasferimenti/${transfer.id}/avvia`)
      .send(command(transfer.versione));
    expect(dispatched.status, dispatched.text).toBe(200);
    const receiveCommand = command(dispatched.body.versione);
    const received = await agent
      .post(`/api/trasferimenti/${transfer.id}/conferma`)
      .send(receiveCommand);
    expect(received.status, received.text).toBe(200);
    expect(received.body.stato).toBe("completato");
    const afterReceive = await digest(transfer.richiestaId, lotId);
    await assignment(null, null);
    try {
      await denied(
        await agent
          .post(`/api/trasferimenti/${transfer.id}/conferma`)
          .send(receiveCommand),
      );
      expect(await digest(transfer.richiestaId, lotId)).toBe(afterReceive);
    } finally {
      await assignment(areaId, centreId);
    }
    const replay = await agent
      .post(`/api/trasferimenti/${transfer.id}/conferma`)
      .send(receiveCommand);
    expect(replay.status, replay.text).toBe(200);
    expect(await digest(transfer.richiestaId, lotId)).toBe(afterReceive);
  }, 60_000);

  it("R3-TR: mancato arrivo e rientro del Trasferimento collegato rispettano scope corrente e replay", async () => {
    const agent = await login();
    const transfer = await readyTransfer(agent);
    const dispatched = await agent
      .post(`/api/trasferimenti/${transfer.id}/avvia`)
      .send(command(transfer.versione));
    expect(dispatched.status, dispatched.text).toBe(200);
    const missed = await agent
      .post(`/api/trasferimenti/${transfer.id}/mancato-arrivo`)
      .send({ ...command(dispatched.body.versione), motivo: "R3 assenza" });
    expect(missed.status, missed.text).toBe(200);
    const before = await digest(transfer.richiestaId, lotId);
    await assignment(null, null);
    try {
      await denied(
        await agent.get(`/api/trasferimenti/${transfer.id}/rientro`),
      );
      await denied(
        await agent
          .post(`/api/trasferimenti/${transfer.id}/rientro`)
          .send({ ...command(missed.body.versione), righe: [] }),
      );
      expect(await digest(transfer.richiestaId, lotId)).toBe(before);
    } finally {
      await assignment(areaId, centreId);
    }
    const preview = await agent.get(
      `/api/trasferimenti/${transfer.id}/rientro`,
    );
    expect(preview.status, preview.text).toBe(200);
    const returnCommand = {
      ...command(missed.body.versione),
      righe: [
        {
          movimentoUscitaId: preview.body.partite[0].movimentoUscitaId,
          idonea: "1",
          deteriorata: "0",
          mancante: "0",
        },
      ],
    };
    const returned = await agent
      .post(`/api/trasferimenti/${transfer.id}/rientro`)
      .send(returnCommand);
    expect(returned.status, returned.text).toBe(200);
    const after = await digest(transfer.richiestaId, lotId);
    await assignment(null, null);
    try {
      await denied(
        await agent
          .post(`/api/trasferimenti/${transfer.id}/rientro`)
          .send(returnCommand),
      );
      expect(await digest(transfer.richiestaId, lotId)).toBe(after);
    } finally {
      await assignment(areaId, centreId);
    }
  }, 60_000);

  it("R3-G: Area e Centro incoerenti/inattivi e revoca view o grant M4 negano; prepare non è richiesto dopo Pronta", async () => {
    const agent = await login();
    const bolla = await readyBolla(agent, "ente");
    const transfer = await readyTransfer(agent);
    const url = `/api/bolle/${bolla.id}/affida`;
    const payload = { ...command(bolla.versione), trasportatoreNome: "R3" };
    const transferUrl = `/api/trasferimenti/${transfer.id}/avvia`;
    const transferPayload = command(transfer.versione);
    const beforeBolla = await digest(bolla.richiestaId, lotId);
    const beforeTransfer = await digest(transfer.richiestaId, lotId);
    const deniedBoth = async () => {
      await denied(await agent.post(url).send(payload));
      await denied(await agent.post(transferUrl).send(transferPayload));
    };
    const [otherArea] = await db
      .insert(areeOperativeTable)
      .values({ nome: `Area R3 ${randomUUID().slice(0, 8)}` })
      .returning({ id: areeOperativeTable.id });
    try {
      await assignment(null, centreId);
      await deniedBoth();
      await assignment(otherArea.id, centreId);
      await deniedBoth();
      await assignment(areaId, centreId);
      await db
        .update(areeOperativeTable)
        .set({ attivo: false })
        .where(eq(areeOperativeTable.id, areaId));
      await deniedBoth();
      await db
        .update(areeOperativeTable)
        .set({ attivo: true })
        .where(eq(areeOperativeTable.id, areaId));
      await db
        .update(centriAscoltoTable)
        .set({ attivo: false })
        .where(eq(centriAscoltoTable.id, centreId));
      await deniedBoth();
      await db
        .update(centriAscoltoTable)
        .set({ attivo: true })
        .where(eq(centriAscoltoTable.id, centreId));
      await db
        .update(ruoliTable)
        .set({
          permessi: grants.filter(
            (grant) => grant !== "richieste_magazzino.view",
          ),
        })
        .where(eq(ruoliTable.id, roleId));
      await deniedBoth();
      await db
        .update(ruoliTable)
        .set({
          permessi: grants.filter(
            (grant) =>
              grant !== "bolle.deliver" &&
              grant !== "magazzino.transfers.dispatch",
          ),
        })
        .where(eq(ruoliTable.id, roleId));
      await deniedBoth();
      await db
        .update(utentiTable)
        .set({ attivo: false })
        .where(eq(utentiTable.id, operatorId));
      const inactive = await agent.post(url).send(payload);
      expect([401, 403, 404], inactive.text).toContain(inactive.status);
      const inactiveTransfer = await agent
        .post(transferUrl)
        .send(transferPayload);
      expect([401, 403, 404], inactiveTransfer.text).toContain(
        inactiveTransfer.status,
      );
      await db
        .update(utentiTable)
        .set({ attivo: true, ruoloId: null })
        .where(eq(utentiTable.id, operatorId));
      const withoutRole = await agent.post(url).send(payload);
      expect([401, 403, 404], withoutRole.text).toContain(withoutRole.status);
      const withoutRoleTransfer = await agent
        .post(transferUrl)
        .send(transferPayload);
      expect([401, 403, 404], withoutRoleTransfer.text).toContain(
        withoutRoleTransfer.status,
      );
      await db
        .update(utentiTable)
        .set({ ruoloId: roleId })
        .where(eq(utentiTable.id, operatorId));
      await db
        .update(ruoliTable)
        .set({
          permessi: grants.filter(
            (grant) => grant !== "richieste_magazzino.prepare",
          ),
        })
        .where(eq(ruoliTable.id, roleId));
      await assignment(areaId, null);
      expect(await digest(bolla.richiestaId, lotId)).toBe(beforeBolla);
      expect(await digest(transfer.richiestaId, lotId)).toBe(beforeTransfer);
      const fresh = await login();
      const delivered = await fresh.post(url).send(payload);
      expect(delivered.status, delivered.text).toBe(200);
      const dispatched = await fresh.post(transferUrl).send(transferPayload);
      expect(dispatched.status, dispatched.text).toBe(200);
    } finally {
      await assignment(areaId, centreId);
      await db
        .update(utentiTable)
        .set({ attivo: true, ruoloId: roleId })
        .where(eq(utentiTable.id, operatorId));
      await db
        .update(areeOperativeTable)
        .set({ attivo: true })
        .where(eq(areeOperativeTable.id, areaId));
      await db
        .update(centriAscoltoTable)
        .set({ attivo: true })
        .where(eq(centriAscoltoTable.id, centreId));
      await db
        .update(ruoliTable)
        .set({ permessi: grants })
        .where(eq(ruoliTable.id, roleId));
    }
  }, 60_000);

  it("R3-ADMIN: admin assegnato resta scoped; solo admin globale esplicito opera senza Area/Centro", async () => {
    const agent = await login();
    const bolla = await readyBolla(agent, "ente");
    const transfer = await readyTransfer(agent);
    const [otherArea] = await db
      .insert(areeOperativeTable)
      .values({ nome: `Area admin R3 ${randomUUID().slice(0, 8)}` })
      .returning({ id: areeOperativeTable.id });
    await db
      .update(ruoliTable)
      .set({ isAdmin: true })
      .where(eq(ruoliTable.id, roleId));
    try {
      await assignment(otherArea.id, null);
      await denied(
        await agent
          .post(`/api/bolle/${bolla.id}/affida`)
          .send({ ...command(bolla.versione), trasportatoreNome: "R3" }),
      );
      await denied(
        await agent
          .post(`/api/trasferimenti/${transfer.id}/avvia`)
          .send(command(transfer.versione)),
      );
      await assignment(null, null);
      const global = await agent
        .post(`/api/bolle/${bolla.id}/affida`)
        .send({ ...command(bolla.versione), trasportatoreNome: "R3" });
      expect(global.status, global.text).toBe(200);
      const globalTransfer = await agent
        .post(`/api/trasferimenti/${transfer.id}/avvia`)
        .send(command(transfer.versione));
      expect(globalTransfer.status, globalTransfer.text).toBe(200);
    } finally {
      await assignment(areaId, centreId);
      await db
        .update(ruoliTable)
        .set({ isAdmin: false })
        .where(eq(ruoliTable.id, roleId));
    }
  }, 60_000);

  it("R3-C: Consegne completa non attraversa il servizio condiviso con una Bolla collegata fuori scope", async () => {
    const agent = await login();
    const bolla = await readyBolla(agent);
    const [consegna] = await db
      .insert(consegneTable)
      .values({
        codice: `CON-R3-${randomUUID().slice(0, 8)}`,
        beneficiarioId: beneficiaryId,
        tipoPianificazione: "consegna_pacco",
        tipoConsegna: "domicilio",
        dataPrevista: "2026-10-01",
        indirizzoConsegna: "Via sintetica 1",
        magazzinoId: originId,
      })
      .returning({ id: consegneTable.id });
    await db
      .update(bolleTable)
      .set({ consegnaId: consegna.id })
      .where(eq(bolleTable.id, bolla.id));
    const before = await digest(bolla.richiestaId, lotId);
    await assignment(null, null);
    try {
      await denied(
        await agent
          .post(`/api/consegne/${consegna.id}/associa-bolla`)
          .send({ ...command(bolla.versione), bollaId: bolla.id }),
      );
      await denied(
        await agent
          .post(`/api/consegne/${consegna.id}/completa`)
          .send(command(bolla.versione)),
      );
      const list = await agent.get("/api/consegne");
      expect(list.status, list.text).toBe(200);
      const item = list.body.items.find(
        (row: { id: number }) => row.id === consegna.id,
      );
      expect(item).toMatchObject({ bollaId: null, bollaNumero: null });
      expect(await digest(bolla.richiestaId, lotId)).toBe(before);
    } finally {
      await assignment(areaId, centreId);
    }
    const completionCommand = command(bolla.versione);
    const completed = await agent
      .post(`/api/consegne/${consegna.id}/completa`)
      .send(completionCommand);
    expect(completed.status, completed.text).toBe(200);
    const after = await digest(bolla.richiestaId, lotId);
    await assignment(null, null);
    try {
      await denied(
        await agent
          .post(`/api/consegne/${consegna.id}/completa`)
          .send(completionCommand),
      );
      expect(await digest(bolla.richiestaId, lotId)).toBe(after);
    } finally {
      await assignment(areaId, centreId);
    }
  }, 60_000);

  it("R3-D: Consegna pianificata dal Centro e storno collegati rivalidano scope anche sul replay", async () => {
    const agent = await login();
    const bolla = await readyBolla(agent);
    const planned = await planBolla(agent, bolla);
    const deliverCommand = command(planned.versione);
    const delivered = await agent
      .post(`/api/consegne/${planned.id}/completa`)
      .send(deliverCommand);
    expect(delivered.status, delivered.text).toBe(200);
    const currentBolla = await agent.get(`/api/bolle/${bolla.id}`);
    expect(currentBolla.status).toBe(200);
    expect(currentBolla.body.stato).toBe("consegnato");
    const [line] = await db
      .select({ id: bollaRigheTable.id })
      .from(bollaRigheTable)
      .where(eq(bollaRigheTable.bollaId, bolla.id));
    const reverseCommand = {
      ...command(currentBolla.body.versione),
      motivo: "R3 storno",
      rigaIds: [line.id],
    };
    const before = await digest(bolla.richiestaId, lotId);
    await assignment(null, null);
    try {
      await denied(
        await agent
          .post(`/api/consegne/${planned.id}/completa`)
          .send(deliverCommand),
      );
      await denied(
        await agent
          .post(`/api/bolle/${bolla.id}/storno-amministrativo`)
          .send(reverseCommand),
      );
      expect(await digest(bolla.richiestaId, lotId)).toBe(before);
    } finally {
      await assignment(areaId, centreId);
    }
    const reversed = await agent
      .post(`/api/bolle/${bolla.id}/storno-amministrativo`)
      .send(reverseCommand);
    expect(reversed.status, reversed.text).toBe(200);
  }, 60_000);

  it("R3-PLAN: ritiro non effettuato resta operativo; la conversione sociale passa dalla pianificazione Centro", async () => {
    const agent = await login();
    const bolla = await readyBolla(agent);
    const failedPickup = await agent
      .post(`/api/bolle/${bolla.id}/ritiro-non-effettuato`)
      .send({ motivo: "R3 ritiro sintetico" });
    expect(failedPickup.status, failedPickup.text).toBe(200);
    expect(failedPickup.body.ritiroNonEffettuatoAt).toBeTruthy();
    const converted = await agent
      .post(`/api/bolle/${bolla.id}/converti-consegna`)
      .send({
        indirizzoConsegna: "Via sintetica 1",
        dataPrevista: "2026-10-01",
      });
    expect(converted.status, converted.text).toBe(409);
    expect(converted.body.error).toContain("pianificata dal Centro");
    const current = await agent.get(`/api/bolle/${bolla.id}`);
    const planned = await planBolla(agent, {
      id: bolla.id,
      versione: current.body.versione,
    });
    expect(planned.id).toBeGreaterThan(0);
  }, 60_000);

  it("R3-RACE: revoca prima, comando prima e rollback seguono i lock PostgreSQL correnti", async () => {
    const agent = await login();
    const revoker = await pool.connect();
    const blocker = await pool.connect();
    const pending: Promise<request.Response>[] = [];
    let blockerOpen = false;
    try {
      // A: a committed revocation wins before the command locks the user.
      const first = await readyBolla(agent, "ente");
      const firstPayload = {
        ...command(first.versione),
        trasportatoreNome: "R3 race A",
      };
      const beforeFirst = await digest(first.richiestaId, lotId);
      await revoker.query("BEGIN");
      await revoker.query(
        "UPDATE utenti SET area_operativa_id=NULL, centro_ascolto_id=NULL WHERE id=$1",
        [operatorId],
      );
      const firstCommand = Promise.resolve(
        agent.post(`/api/bolle/${first.id}/affida`).send(firstPayload),
      );
      pending.push(firstCommand);
      await waitForLock('FROM "utenti"');
      await revoker.query("COMMIT");
      await denied(await firstCommand);
      expect(await digest(first.richiestaId, lotId)).toBe(beforeFirst);
      await assignment(areaId, centreId);

      // B: the command holds the actor share lock while request lock delays it.
      const second = await readyBolla(agent, "ente");
      const secondPayload = {
        ...command(second.versione),
        trasportatoreNome: "R3 race B",
      };
      await blocker.query("BEGIN");
      blockerOpen = true;
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('m5b.richiesta'), $1)",
        [second.richiestaId],
      );
      const secondCommand = Promise.resolve(
        agent.post(`/api/bolle/${second.id}/affida`).send(secondPayload),
      );
      pending.push(secondCommand);
      await waitForLock("m5b.richiesta");
      const revokeAfterCommand = revoker.query(
        "UPDATE utenti SET area_operativa_id=NULL, centro_ascolto_id=NULL WHERE id=$1",
        [operatorId],
      );
      await waitForLock("UPDATE utenti SET area_operativa_id");
      await blocker.query("COMMIT");
      blockerOpen = false;
      const completed = await secondCommand;
      expect(completed.status, completed.text).toBe(200);
      await revokeAfterCommand;
      const afterSecond = await digest(second.richiestaId, lotId);
      await denied(
        await agent.post(`/api/bolle/${second.id}/affida`).send(secondPayload),
      );
      expect(await digest(second.richiestaId, lotId)).toBe(afterSecond);
      await assignment(areaId, centreId);
      const authorizedReplay = await agent
        .post(`/api/bolle/${second.id}/affida`)
        .send(secondPayload);
      expect(authorizedReplay.status, authorizedReplay.text).toBe(200);
      expect(await digest(second.richiestaId, lotId)).toBe(afterSecond);

      // C: an uncommitted revocation is not interpreted as a real denial.
      const third = await readyBolla(agent, "ente");
      const thirdPayload = {
        ...command(third.versione),
        trasportatoreNome: "R3 race C",
      };
      await revoker.query("BEGIN");
      await revoker.query(
        "UPDATE utenti SET area_operativa_id=NULL, centro_ascolto_id=NULL WHERE id=$1",
        [operatorId],
      );
      const thirdCommand = Promise.resolve(
        agent.post(`/api/bolle/${third.id}/affida`).send(thirdPayload),
      );
      pending.push(thirdCommand);
      await waitForLock('FROM "utenti"');
      await revoker.query("ROLLBACK");
      const afterRollback = await thirdCommand;
      expect(afterRollback.status, afterRollback.text).toBe(200);
    } finally {
      if (blockerOpen) await blocker.query("ROLLBACK").catch(() => undefined);
      await revoker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      revoker.release();
      await Promise.allSettled(pending);
      await assignment(areaId, centreId);
    }
  }, 90_000);
});
