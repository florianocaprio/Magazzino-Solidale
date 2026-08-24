/* @vitest-environment node */

import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  areeOperativeTable,
  beneficiariTable,
  centriAscoltoTable,
  db,
  lottiTable,
  magazziniTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prodottiTable,
  scarichiTable,
  scaricoRigheTable,
  utentiTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import scarichiRouter from "../src/routes/scarichi";
import { isReportingSnapshotConcurrencyError } from "../src/lib/reporting/eventSnapshots";
import {
  ensureAmbienteModuli,
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";

let app: Express;
let userId: number;
let magazzinoId: number;
let prodottoId: number;
let lottoId: number;
let beneficiarioId: number;
let areaOperativaId: number;
let centroAscoltoId: number;
let areaOperativaAlternativaId: number;
let centroAscoltoAlternativoId: number;
let originalScarichiAttivo = true;
const suffix = `${process.pid}${Date.now().toString(36)}`;

beforeAll(async () => {
  await ensureAmbienteModuli();
  originalScarichiAttivo =
    (await listModuliFunzionali()).find((item) => item.codice === "SCARICHI")
      ?.attivo ?? true;
  await updateModuloAmbiente("SCARICHI", true, null);
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
  await db
    .delete(movimentiTable)
    .where(eq(movimentiTable.magazzinoId, magazzinoId));
  await db
    .delete(operazioniDistribuzioneMagazzinoTable)
    .where(eq(operazioniDistribuzioneMagazzinoTable.magazzinoId, magazzinoId));
  const scarichi = await db
    .select({ id: scarichiTable.id })
    .from(scarichiTable)
    .where(eq(scarichiTable.magazzinoId, magazzinoId));
  for (const scarico of scarichi) {
    await db
      .delete(scaricoRigheTable)
      .where(eq(scaricoRigheTable.scaricoId, scarico.id));
  }
  await db
    .delete(scarichiTable)
    .where(eq(scarichiTable.magazzinoId, magazzinoId));
  await db.delete(lottiTable).where(eq(lottiTable.id, lottoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, magazzinoId));
  await db
    .delete(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  await db
    .delete(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, centroAscoltoId));
  await db
    .delete(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, centroAscoltoAlternativoId));
  await db
    .delete(areeOperativeTable)
    .where(eq(areeOperativeTable.id, areaOperativaId));
  await db
    .delete(areeOperativeTable)
    .where(eq(areeOperativeTable.id, areaOperativaAlternativaId));
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await updateModuloAmbiente("SCARICHI", originalScarichiAttivo, null);
  await pool.end();
});

describe("scarico manuale beneficiario 2.0A", () => {
  it("nega atomicamente lo Scarico scoped se il Beneficiario cambia Area mentre attende il lock", async () => {
    const scarichiPrima = await db
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(eq(scarichiTable.magazzinoId, magazzinoId));
    const operazioniPrima = await db
      .select({ id: operazioniDistribuzioneMagazzinoTable.id })
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(
        eq(operazioniDistribuzioneMagazzinoTable.magazzinoId, magazzinoId),
      );
    const movimentiPrima = await db
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, magazzinoId));
    const [lottoPrima] = await db
      .select({ quantitaResidua: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));

    const client = await pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE beneficiari
         SET area_operativa_id = $1, centro_ascolto_id = $2, num_componenti = 4
         WHERE id = $3`,
        [areaOperativaAlternativaId, centroAscoltoAlternativoId, beneficiarioId],
      );

      const responsePromise = Promise.resolve(
        request(app)
          .post("/scarichi")
          .send({
            magazzinoId,
            beneficiarioId,
            dataScarico: "2026-08-22",
            causale: "consegna_beneficiario",
            canaleOperativo: "PACCHI",
            righe: [{ prodottoId, quantita: 1, unitaMisura: "kg" }],
          }),
      );
      const beforeCommit = await Promise.race([
        responsePromise.then(() => "resolved" as const),
        new Promise<"blocked">((resolve) =>
          setTimeout(() => resolve("blocked"), 50),
        ),
      ]);
      expect(beforeCommit).toBe("blocked");

      await client.query("COMMIT");
      committed = true;
      const response = await Promise.race([
        responsePromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Lo Scarico scoped è rimasto in attesa")),
            5_000,
          ),
        ),
      ]);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: "Risorsa non accessibile per il tuo profilo",
      });
      expect(JSON.stringify(response.body)).not.toContain(
        String(areaOperativaAlternativaId),
      );
      expect(JSON.stringify(response.body)).not.toContain(
        String(centroAscoltoAlternativoId),
      );
    } finally {
      if (!committed) await client.query("ROLLBACK");
      client.release();
    }

    await db
      .update(beneficiariTable)
      .set({
        areaOperativaId,
        centroAscoltoId,
        numComponenti: 1,
      })
      .where(eq(beneficiariTable.id, beneficiarioId));

    const scarichiDopo = await db
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(eq(scarichiTable.magazzinoId, magazzinoId));
    const operazioniDopo = await db
      .select({ id: operazioniDistribuzioneMagazzinoTable.id })
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(
        eq(operazioniDistribuzioneMagazzinoTable.magazzinoId, magazzinoId),
      );
    const movimentiDopo = await db
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, magazzinoId));
    const [lottoDopo] = await db
      .select({ quantitaResidua: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    expect(scarichiDopo).toHaveLength(scarichiPrima.length);
    expect(operazioniDopo).toHaveLength(operazioniPrima.length);
    expect(movimentiDopo).toHaveLength(movimentiPrima.length);
    expect(lottoDopo.quantitaResidua).toBe(lottoPrima.quantitaResidua);
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
