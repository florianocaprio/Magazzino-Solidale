import { describe, it, expect, afterEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, impostazioniModuliTable, pool, prodottiTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import prodottiRouter from "../src/routes/prodotti";

const rnd = () => Math.random().toString(36).slice(2, 8);

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(prodottiRouter);
  return app;
}

const app = makeApp();
const prodottoIds: number[] = [];

async function setEmporioEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(impostazioniModuliTable)
    .values({ id: 1, emporioAbilitato: enabled, unitaStradaAbilitata: true })
    .onConflictDoUpdate({
      target: impostazioniModuliTable.id,
      set: { emporioAbilitato: enabled, unitaStradaAbilitata: true },
    });
}

afterEach(async () => {
  if (prodottoIds.length > 0) {
    await db.delete(prodottiTable).where(inArray(prodottiTable.id, prodottoIds));
    prodottoIds.length = 0;
  }
  await db.delete(impostazioniModuliTable).where(eq(impostazioniModuliTable.id, 1));
});

afterAll(async () => {
  await pool.end();
});

describe("POST /prodotti — codice prodotto", () => {
  it.each([
    ["alimentare", "ALI"],
    ["vestiario", "VES"],
    ["medicinali", "MED"],
    ["scarpe", "SCA"],
    ["igiene", "IGI"],
    ["sanitario", "SAN"],
    ["altro", "ALT"],
  ])("genera un codice univoco con prefisso %s", async (tipoProdotto, prefisso) => {
    const res = await request(app)
      .post("/prodotti")
      .send({ nome: `Prodotto ${rnd()}`, tipoProdotto, unitaMisura: "pz" });

    expect(res.status).toBe(201);
    prodottoIds.push(res.body.id);
    expect(res.body.codice).toMatch(new RegExp(`^${prefisso}-\\d{6}$`));
  });

  it("usa Valore Credito Solidale 1 come default quando abilita un prodotto Emporio", async () => {
    await setEmporioEnabled(true);
    const created = await request(app)
      .post("/prodotti")
      .send({ nome: `Emporio ${rnd()}`, tipoProdotto: "alimentare", unitaMisura: "pz", abilitatoEmporio: true });
    expect(created.status).toBe(201);
    prodottoIds.push(created.body.id);
    expect(created.body.creditoSolidaleValore).toBe(1);

    const base = await request(app)
      .post("/prodotti")
      .send({ nome: `Base ${rnd()}`, tipoProdotto: "alimentare", unitaMisura: "pz" });
    expect(base.status).toBe(201);
    prodottoIds.push(base.body.id);
    expect(base.body.creditoSolidaleValore).toBe(0);

    const enabled = await request(app)
      .patch(`/prodotti/${base.body.id}`)
      .send({ abilitatoEmporio: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.abilitatoEmporio).toBe(true);
    expect(enabled.body.creditoSolidaleValore).toBe(1);
  });

  it("genera il codice anche se il campo codice contiene solo spazi", async () => {
    const res = await request(app)
      .post("/prodotti")
      .send({ codice: "   ", nome: `Prodotto ${rnd()}`, tipoProdotto: "sanitario", unitaMisura: "pz" });

    expect(res.status).toBe(201);
    prodottoIds.push(res.body.id);
    expect(res.body.codice).toMatch(/^SAN-\d{6}$/);
  });

  it("rifiuta un codice manuale duplicato con errore chiaro", async () => {
    const codice = `MAN-${rnd()}`;
    const first = await request(app)
      .post("/prodotti")
      .send({ codice, nome: `Prodotto ${rnd()}`, tipoProdotto: "altro", unitaMisura: "pz" });
    expect(first.status).toBe(201);
    prodottoIds.push(first.body.id);

    const dup = await request(app)
      .post("/prodotti")
      .send({ codice, nome: `Prodotto ${rnd()}`, tipoProdotto: "altro", unitaMisura: "pz" });

    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("Il codice prodotto indicato è già associato a un altro prodotto.");
  });
});

describe("GET /prodotti — ordinamento e ricerca", () => {
  it("restituisce prima il prodotto inserito più di recente", async () => {
    const marker = `Ordine ${rnd()}`;
    const first = await request(app)
      .post("/prodotti")
      .send({ nome: `${marker} Primo`, tipoProdotto: "alimentare", unitaMisura: "pz" });
    const second = await request(app)
      .post("/prodotti")
      .send({ nome: `${marker} Secondo`, tipoProdotto: "alimentare", unitaMisura: "pz" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    prodottoIds.push(first.body.id, second.body.id);

    const list = await request(app).get("/prodotti").query({ search: marker });

    expect(list.status).toBe(200);
    expect(list.body.map((p: { id: number }) => p.id)).toEqual([second.body.id, first.body.id]);
  });

  it("cerca anche per codice prodotto e codice a barre", async () => {
    const codice = `SRC-${rnd()}`;
    const created = await request(app)
      .post("/prodotti")
      .send({ codice, nome: `Ricerca ${rnd()}`, tipoProdotto: "altro", unitaMisura: "pz" });
    expect(created.status).toBe(201);
    prodottoIds.push(created.body.id);

    const byCodice = await request(app).get("/prodotti").query({ search: codice });
    const byBarcode = await request(app).get("/prodotti").query({ search: created.body.codiceBarre });

    expect(byCodice.status).toBe(200);
    expect(byBarcode.status).toBe(200);
    expect(byCodice.body.map((p: { id: number }) => p.id)).toContain(created.body.id);
    expect(byBarcode.body.map((p: { id: number }) => p.id)).toContain(created.body.id);
  });
});
