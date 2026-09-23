/* @vitest-environment node */

import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  areeOperativeTable,
  auditEventiTable,
  beneficiariTable,
  centriAscoltoTable,
  db,
  lottiTable,
  magazziniTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prenotazioniMagazzinoTable,
  prodottiTable,
  scarichiTable,
  scaricoRigheTable,
  utentiTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import scarichiRouter from "../src/routes/scarichi";
import { isReportingSnapshotConcurrencyError } from "../src/lib/reporting/eventSnapshots";
import {
  ensureAmbienteModuli,
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";

let app: Express;
let userId = 0;
let magazzinoId = 0;
let prodottoId = 0;
let lottoId = 0;
let beneficiarioId = 0;
let areaOperativaId = 0;
let centroAscoltoId = 0;
let areaOperativaAlternativaId = 0;
let centroAscoltoAlternativoId = 0;
let originalScarichiAttivo = true;
let scarichiFlagChanged = false;
const suffix = `${process.pid}${Date.now().toString(36)}`;
let beneficiarySequence = 0;

function scaricoRequest(beneficiaryId: number, quantity = 1) {
  return request(app)
    .post("/scarichi")
    .send({
      magazzinoId,
      beneficiarioId: beneficiaryId,
      dataScarico: "2026-08-22",
      causale: "consegna_beneficiario",
      canaleOperativo: "PACCHI",
      righe: [{ prodottoId, quantita: quantity, unitaMisura: "kg" }],
    });
}

async function createCaseBeneficiary(areaId: number, centreId: number) {
  const [{ id }] = await db
    .insert(beneficiariTable)
    .values({
      codice: `S20T-${suffix}-${++beneficiarySequence}`.slice(0, 20),
      nome: "Beneficiario",
      cognome: "Caso isolato",
      sesso: "X",
      areaOperativaId: areaId,
      centroAscoltoId: centreId,
    })
    .returning({ id: beneficiariTable.id });
  return id;
}

async function inventorySnapshot() {
  const [scarichi, righe, operazioni, movimenti, prenotazioni, audit, lotto] =
    await Promise.all([
      db
        .select({ id: scarichiTable.id })
        .from(scarichiTable)
        .where(eq(scarichiTable.magazzinoId, magazzinoId)),
      db
        .select({ id: scaricoRigheTable.id })
        .from(scaricoRigheTable)
        .where(eq(scaricoRigheTable.prodottoId, prodottoId)),
      db
        .select({ id: operazioniDistribuzioneMagazzinoTable.id })
        .from(operazioniDistribuzioneMagazzinoTable)
        .where(
          eq(operazioniDistribuzioneMagazzinoTable.magazzinoId, magazzinoId),
        ),
      db
        .select({ id: movimentiTable.id })
        .from(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, magazzinoId)),
      db
        .select({
          id: prenotazioniMagazzinoTable.id,
          stato: prenotazioniMagazzinoTable.stato,
          quantita: prenotazioniMagazzinoTable.quantita,
        })
        .from(prenotazioniMagazzinoTable)
        .where(eq(prenotazioniMagazzinoTable.lottoId, lottoId)),
      db
        .select({ id: auditEventiTable.id })
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.magazzinoIdSnapshot, magazzinoId),
            eq(auditEventiTable.azione, "SCARICO_MAGAZZINO_CREATO"),
          ),
        ),
      db
        .select({ quantitaResidua: lottiTable.quantitaResidua })
        .from(lottiTable)
        .where(eq(lottiTable.id, lottoId)),
    ]);
  return {
    scarichi: scarichi.map((row) => row.id).sort(),
    righe: righe.map((row) => row.id).sort(),
    operazioni: operazioni.map((row) => row.id).sort(),
    movimenti: movimenti.map((row) => row.id).sort(),
    prenotazioni: prenotazioni.sort((a, b) => a.id - b.id),
    audit: audit.map((row) => row.id).sort(),
    residuo: lotto[0]?.quantitaResidua,
  };
}

function expectSanitizedDenial(body: unknown, message: string) {
  expect(body).toEqual({ error: message });
  const serialized = JSON.stringify(body);
  for (const value of [
    areaOperativaAlternativaId,
    centroAscoltoAlternativoId,
  ]) {
    expect(serialized).not.toContain(String(value));
  }
  expect(serialized).not.toContain("Beneficiario Caso isolato");
}

async function waitForBeneficiaryLock(
  blockerPid: number,
  isSettled: () => boolean,
) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (isSettled())
      throw new Error(
        "La richiesta Scarico è terminata prima del lock transazionale",
      );
    const observation = await pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND pid <> $1
         AND $1 = ANY(pg_blocking_pids(pid))
         AND wait_event_type = 'Lock'
         AND state = 'active'
         AND query ILIKE '%beneficiari%'
         AND query ILIKE '%for update%'`,
      [blockerPid],
    );
    if (observation.rows.length === 1) {
      if (isSettled())
        throw new Error(
          "La richiesta Scarico è terminata durante l'osservazione del lock",
        );
      return observation.rows[0].pid;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    "Nessun backend HTTP osservato sul lock Beneficiario della transazione di test entro 8 s",
  );
}

async function withLockedBeneficiary(inject?: {
  beforeCommit?: () => void;
  afterCommit?: () => void;
}) {
  let caseBeneficiaryId = 0;
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let transactionOpen = false;
  let httpRequest: ReturnType<typeof scaricoRequest> | undefined;
  let pending:
    | Promise<{ response?: { status: number; body: unknown }; error?: unknown }>
    | undefined;
  let settled = false;
  let result: Awaited<NonNullable<typeof pending>> | undefined;
  let primaryError: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    caseBeneficiaryId = await createCaseBeneficiary(
      areaOperativaId,
      centroAscoltoId,
    );
    const [original] = await db
      .select({
        areaOperativaId: beneficiariTable.areaOperativaId,
        centroAscoltoId: beneficiariTable.centroAscoltoId,
        numComponenti: beneficiariTable.numComponenti,
      })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, caseBeneficiaryId));
    expect(original).toMatchObject({ areaOperativaId, centroAscoltoId });
    client = await pool.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    const blocker = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid()::int AS pid",
    );
    await client.query(
      `UPDATE beneficiari SET area_operativa_id = $1, centro_ascolto_id = $2,
       num_componenti = $3 WHERE id = $4`,
      [
        areaOperativaAlternativaId,
        centroAscoltoAlternativoId,
        original.numComponenti + 1,
        caseBeneficiaryId,
      ],
    );
    inject?.beforeCommit?.();
    httpRequest = scaricoRequest(caseBeneficiaryId).timeout({
      deadline: 12_000,
    });
    pending = Promise.resolve(httpRequest)
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      )
      .then((outcome) => {
        settled = true;
        return outcome;
      });
    const waitingPid = await waitForBeneficiaryLock(
      blocker.rows[0].pid,
      () => settled,
    );
    expect(waitingPid).not.toBe(blocker.rows[0].pid);
    await client.query("COMMIT");
    transactionOpen = false;
    result = await pending;
    if (result.error) throw result.error;
    inject?.afterCommit?.();
    expect(result.response?.status).toBe(403);
    expectSanitizedDenial(
      result.response?.body,
      "Risorsa non accessibile per il tuo profilo",
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (transactionOpen && httpRequest) httpRequest.abort();
    if (client && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (pending) {
      try {
        await pending;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (client) client.release();
    if (caseBeneficiaryId) {
      try {
        await db
          .delete(beneficiariTable)
          .where(eq(beneficiariTable.id, caseBeneficiaryId));
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (primaryError && cleanupErrors.length)
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      "Scarico fallito e cleanup incompleto",
    );
  if (primaryError) throw primaryError;
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, "Cleanup Scarico incompleto");
  return {
    blockerObserved: true,
    response: result!.response!,
    caseBeneficiaryId,
  };
}

beforeAll(async () => {
  await ensureAmbienteModuli();
  originalScarichiAttivo =
    (await listModuliFunzionali()).find((item) => item.codice === "SCARICHI")
      ?.attivo ?? true;
  await updateModuloAmbiente("SCARICHI", true, null);
  scarichiFlagChanged = true;
  [{ id: userId }] = await db
    .insert(utentiTable)
    .values({
      username: `scarico20a_${suffix}`,
      passwordHash: "x",
      nome: "Test",
      cognome: "Distribuzione",
    })
    .returning({ id: utentiTable.id });
  [{ id: areaOperativaId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area scarico ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: centroAscoltoId }] = await db
    .insert(centriAscoltoTable)
    .values({
      nome: `Centro scarico ${suffix}`,
      areaOperativaId,
    })
    .returning({ id: centriAscoltoTable.id });
  [{ id: areaOperativaAlternativaId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area scarico alternativa ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: centroAscoltoAlternativoId }] = await db
    .insert(centriAscoltoTable)
    .values({
      nome: `Centro scarico alternativo ${suffix}`,
      areaOperativaId: areaOperativaAlternativaId,
    })
    .returning({ id: centriAscoltoTable.id });
  [{ id: magazzinoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `S20A-${suffix}`.slice(0, 20),
      nome: `Magazzino ${suffix}`,
      areaOperativaId,
      centroAscoltoId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: prodottoId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `S20AP-${suffix}`.slice(0, 30),
      nome: "Prodotto distribuzione manuale",
      tipoProdotto: "alimentare",
      unitaMisura: "kg",
      quantitaFrazionabile: true,
    })
    .returning({ id: prodottiTable.id });
  [{ id: lottoId }] = await db
    .insert(lottiTable)
    .values({
      prodottoId,
      magazzinoId,
      dataCarico: "2026-08-01",
      quantitaCaricata: "10.000000",
      quantitaResidua: "10.000000",
      fondoOrigine: "FONDO_NAZIONALE",
      fsePlus: false,
    })
    .returning({ id: lottiTable.id });
  [{ id: beneficiarioId }] = await db
    .insert(beneficiariTable)
    .values({
      codice: `S20A-${suffix}`.slice(0, 20),
      nome: "Beneficiario",
      cognome: "Test",
      sesso: "X",
      areaOperativaId,
      centroAscoltoId,
    })
    .returning({ id: beneficiariTable.id });

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: userId,
      isAdmin: false,
      isSuperAdmin: false,
      aree: ["magazzino"],
      permessi: ["magazzino.view", "magazzino.stock.issue"],
      centroAscoltoId,
      areaOperativaId,
      zonaUdsId: null,
    };
    next();
  });
  app.use(scarichiRouter);
});

afterAll(async () => {
  const errors: unknown[] = [];
  const clean = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  };
  if (magazzinoId) {
    await clean(() =>
      db
        .delete(movimentiTable)
        .where(eq(movimentiTable.magazzinoId, magazzinoId)),
    );
    await clean(() =>
      db
        .delete(operazioniDistribuzioneMagazzinoTable)
        .where(
          eq(operazioniDistribuzioneMagazzinoTable.magazzinoId, magazzinoId),
        ),
    );
    await clean(async () => {
      const scarichi = await db
        .select({ id: scarichiTable.id })
        .from(scarichiTable)
        .where(eq(scarichiTable.magazzinoId, magazzinoId));
      for (const scarico of scarichi) {
        await db
          .delete(scaricoRigheTable)
          .where(eq(scaricoRigheTable.scaricoId, scarico.id));
      }
    });
    await clean(() =>
      db
        .delete(scarichiTable)
        .where(eq(scarichiTable.magazzinoId, magazzinoId)),
    );
  }
  if (lottoId)
    await clean(() => db.delete(lottiTable).where(eq(lottiTable.id, lottoId)));
  if (prodottoId)
    await clean(() =>
      db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoId)),
    );
  if (magazzinoId)
    await clean(() =>
      db.delete(magazziniTable).where(eq(magazziniTable.id, magazzinoId)),
    );
  if (beneficiarioId)
    await clean(() =>
      db
        .delete(beneficiariTable)
        .where(eq(beneficiariTable.id, beneficiarioId)),
    );
  if (centroAscoltoId)
    await clean(() =>
      db
        .delete(centriAscoltoTable)
        .where(eq(centriAscoltoTable.id, centroAscoltoId)),
    );
  if (centroAscoltoAlternativoId)
    await clean(() =>
      db
        .delete(centriAscoltoTable)
        .where(eq(centriAscoltoTable.id, centroAscoltoAlternativoId)),
    );
  if (areaOperativaId)
    await clean(() =>
      db
        .delete(areeOperativeTable)
        .where(eq(areeOperativeTable.id, areaOperativaId)),
    );
  if (areaOperativaAlternativaId)
    await clean(() =>
      db
        .delete(areeOperativeTable)
        .where(eq(areeOperativeTable.id, areaOperativaAlternativaId)),
    );
  if (userId)
    await clean(() => db.delete(utentiTable).where(eq(utentiTable.id, userId)));
  if (scarichiFlagChanged)
    await clean(() =>
      updateModuloAmbiente("SCARICHI", originalScarichiAttivo, null),
    );
  await clean(() => pool.end());
  if (errors.length)
    throw new AggregateError(errors, "Cleanup fixture Scarico incompleto");
});

describe("scarico manuale beneficiario 2.0A", () => {
  it("SCAR-01: nega preliminarmente il Beneficiario già fuori scope senza effetti", async () => {
    const before = await inventorySnapshot();
    let caseBeneficiaryId = 0;
    try {
      caseBeneficiaryId = await createCaseBeneficiary(
        areaOperativaAlternativaId,
        centroAscoltoAlternativoId,
      );
      const response = await scaricoRequest(caseBeneficiaryId);
      expect(response.status).toBe(403);
      expectSanitizedDenial(
        response.body,
        "Beneficiario non accessibile per il tuo profilo",
      );
    } finally {
      if (caseBeneficiaryId)
        await db
          .delete(beneficiariTable)
          .where(eq(beneficiariTable.id, caseBeneficiaryId));
    }
    expect(await inventorySnapshot()).toEqual(before);
  });

  it("SCAR-02: nega atomicamente lo Scarico scoped dopo il lock del Beneficiario", async () => {
    const before = await inventorySnapshot();
    const result = await withLockedBeneficiary();
    expect(result.blockerObserved).toBe(true);
    expect(
      await db
        .select({ id: beneficiariTable.id })
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, result.caseBeneficiaryId)),
    ).toHaveLength(0);
    expect(await inventorySnapshot()).toEqual(before);
  });

  it("SCAR-03: ripulisce dopo un errore controllato successivo al COMMIT", async () => {
    const before = await inventorySnapshot();
    await expect(
      withLockedBeneficiary({
        beforeCommit: () => {
          throw new Error("iniezione SCAR-03 prima del COMMIT");
        },
      }),
    ).rejects.toThrow("iniezione SCAR-03 prima del COMMIT");
    expect(await inventorySnapshot()).toEqual(before);
    await expect(
      withLockedBeneficiary({
        afterCommit: () => {
          throw new Error("iniezione SCAR-03 dopo COMMIT");
        },
      }),
    ).rejects.toThrow("iniezione SCAR-03 dopo COMMIT");
    expect(await inventorySnapshot()).toEqual(before);
  });

  it("classifica deadlock e serializzazione per una risposta 409 applicativa", () => {
    expect(isReportingSnapshotConcurrencyError({ code: "40P01" })).toBe(true);
    expect(
      isReportingSnapshotConcurrencyError({ cause: { code: "40001" } }),
    ).toBe(true);
    expect(isReportingSnapshotConcurrencyError({ code: "23505" })).toBe(false);
  });

  it("crea una distribuzione PACCHI strutturata e un movimento sulla Partita reale", async () => {
    const response = await request(app)
      .post("/scarichi")
      .send({
        magazzinoId,
        beneficiarioId,
        dataScarico: "2026-08-22",
        causale: "consegna_beneficiario",
        canaleOperativo: "PACCHI",
        righe: [{ prodottoId, quantita: 0.334957, unitaMisura: "kg" }],
      });
    expect(response.status).toBe(201);

    const operations = await db
      .select()
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(
        eq(operazioniDistribuzioneMagazzinoTable.magazzinoId, magazzinoId),
      );
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      canaleOperativo: "PACCHI",
      dominioOrigine: "MAGAZZINO",
      entitaOrigineTipo: "scarico_manual_beneficiario",
      numeroPacchi: 1,
      areaOperativaIdSnapshot: areaOperativaId,
      centroAscoltoIdSnapshot: centroAscoltoId,
      territorioClassificazione: "attribuito",
    });

    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, magazzinoId));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      lottoId,
      beneficiarioId,
      quantita: "0.334957",
      quantitaKgLt: "0.334957",
      fondoOrigine: "FONDO_NAZIONALE",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      canaleOperativo: "PACCHI",
      operazioneDistribuzioneId: operations[0].id,
    });
  });
});
