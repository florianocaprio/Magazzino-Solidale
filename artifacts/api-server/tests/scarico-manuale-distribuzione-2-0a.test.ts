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
      centroAscoltoId: null,
      areaOperativaId: null,
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
    .delete(areeOperativeTable)
    .where(eq(areeOperativeTable.id, areaOperativaId));
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await updateModuloAmbiente("SCARICHI", originalScarichiAttivo, null);
  await pool.end();
});

describe("scarico manuale beneficiario 2.0A", () => {
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
