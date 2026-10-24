import { describe, it, expect, afterEach, afterAll, beforeAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, prodottiTable, utentiTable, magazziniTable, areeOperativeTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import prodottiRouter from "../src/routes/prodotti";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

const rnd = () => Math.random().toString(36).slice(2, 8);

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: testUserId,
      username: `prodotti_${testUserId}`,
      isAdmin: true,
    } as NonNullable<typeof req.user>;
    next();
  });
  app.use(prodottiRouter);
  return app;
}

const app = makeApp();
const prodottoIds: number[] = [];
let testUserId: number;
let testWarehouseId: number;
let testAreaId: number;

async function setEmporioEnabled(enabled: boolean): Promise<void> {
  await updateModuloAmbiente("EMPORIO_SOLIDALE", enabled, null);
}

beforeAll(async () => {
  const [testUser] = await db
    .insert(utentiTable)
    .values({
      username: `prodotti_${rnd()}`,
      passwordHash: "x",
      nome: "Test Prodotti",
    })
    .returning({ id: utentiTable.id });
  testUserId = testUser.id;
  const [area] = await db.insert(areeOperativeTable).values({ nome: `Prodotti ${rnd()}` }).returning();
  testAreaId = area.id;
  const [warehouse] = await db.insert(magazziniTable).values({ nome: `Prodotti ${rnd()}`, codice: `PR-${rnd()}`, areaOperativaId: area.id }).returning();
  testWarehouseId = warehouse.id;
});

afterEach(async () => {
  if (prodottoIds.length > 0) {
    await db.delete(prodottiTable).where(inArray(prodottiTable.id, prodottoIds));
    prodottoIds.length = 0;
  }
  await setEmporioEnabled(true);
});

afterAll(async () => {
  await db.delete(utentiTable).where(eq(utentiTable.id, testUserId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, testWarehouseId));
  await db.delete(areeOperativeTable).where(eq(areeOperativeTable.id, testAreaId));
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
  },
  );

  it("usa Valore Credito Solidale 1 come default quando abilita un prodotto Emporio", async () => {
    await setEmporioEnabled(true);
    const created = await request(app)
      .post("/prodotti")
      .send({ nome: `Emporio ${rnd()}`, tipoProdotto: "alimentare", unitaMisura: "pz", abilitatoEmporio: true,
      });
    expect(created.status).toBe(201);
    prodottoIds.push(created.body.id);
    expect(created.body.creditoSolidaleValore).toBe(1);

    const base = await request(app)
      .post("/prodotti")
      .send({ nome: `Base ${rnd()}`, tipoProdotto: "alimentare", unitaMisura: "pz",
      });
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
      .send({ codice: "   ", nome: `Prodotto ${rnd()}`, tipoProdotto: "sanitario", unitaMisura: "pz",
      });

    expect(res.status).toBe(201);
    prodottoIds.push(res.body.id);
    expect(res.body.codice).toMatch(/^SAN-\d{6}$/);
  });

  it("rifiuta un codice manuale duplicato con errore chiaro", async () => {
    const codice = `MAN-${rnd()}`;
    const first = await request(app)
      .post("/prodotti")
      .send({ codice, nome: `Prodotto ${rnd()}`, tipoProdotto: "altro", unitaMisura: "pz",
      });
    expect(first.status).toBe(201);
    prodottoIds.push(first.body.id);

    const dup = await request(app)
      .post("/prodotti")
      .send({ codice, nome: `Prodotto ${rnd()}`, tipoProdotto: "altro", unitaMisura: "pz",
      });

    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("Il codice prodotto indicato è già associato a un altro prodotto.",
    );
  });
});

describe("GET /prodotti — ordinamento e ricerca", () => {
  it("restituisce prima il prodotto inserito più di recente", async () => {
    const marker = `Ordine ${rnd()}`;
    const first = await request(app)
      .post("/prodotti")
      .send({ nome: `${marker} Primo`, tipoProdotto: "alimentare", unitaMisura: "pz",
      });
    const second = await request(app)
      .post("/prodotti")
      .send({ nome: `${marker} Secondo`, tipoProdotto: "alimentare", unitaMisura: "pz",
      });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    prodottoIds.push(first.body.id, second.body.id);

    const list = await request(app).get("/prodotti").query({ search: marker });

    expect(list.status).toBe(200);
    expect(list.body.map((p: { id: number }) => p.id)).toEqual([second.body.id, first.body.id,
    ]);
  });

  it("cerca anche per codice prodotto e codice a barre", async () => {
    const codice = `SRC-${rnd()}`;
    const created = await request(app)
      .post("/prodotti")
      .send({ codice, nome: `Ricerca ${rnd()}`, tipoProdotto: "altro", unitaMisura: "pz",
      });
    expect(created.status).toBe(201);
    prodottoIds.push(created.body.id);

    const byCodice = await request(app).get("/prodotti").query({ search: codice });
    const byBarcode = await request(app).get("/prodotti").query({ search: created.body.codiceBarre });

    expect(byCodice.status).toBe(200);
    expect(byBarcode.status).toBe(200);
    expect(byCodice.body.map((p: { id: number }) => p.id)).toContain(created.body.id,
    );
    expect(byBarcode.body.map((p: { id: number }) => p.id)).toContain(created.body.id,
    );
  });
});

describe("Eliminazione definitiva dei soli prodotti inutilizzati", () => {
  async function product() {
    const res = await request(app).post("/prodotti").send({ nome: `Unused ${rnd()}`, tipoProdotto: "altro", unitaMisura: "pz" });
    expect(res.status).toBe(201);
    prodottoIds.push(res.body.id);
    return res.body.id as number;
  }

  it.each([true, false])("elimina un prodotto senza dipendenze (attivo=%s), mantenendo audit e vecchia disattivazione", async (active) => {
    const id = await product();
    if (!active) {
      expect((await request(app).delete(`/prodotti/${id}`)).status).toBe(200);
      expect((await request(app).get(`/prodotti/${id}`)).status).toBe(200);
    }
    const preview = await request(app).get(`/prodotti/${id}/eliminazione`);
    expect(preview.body).toEqual({ eliminabile: true, motivo: null });
    expect((await request(app).delete(`/prodotti/${id}/eliminazione`)).status).toBe(204);
    expect((await request(app).get(`/prodotti/${id}`)).status).toBe(404);
    const audit = await pool.query("SELECT azione FROM audit_eventi WHERE entita_tipo='prodotto' AND entita_id=$1 AND azione='PRODOTTO_ELIMINATO'", [id]);
    expect(audit.rows).toHaveLength(1);
    expect((await request(app).delete(`/prodotti/${id}/eliminazione`)).status).toBe(404);
  });

  it("rifiuta anche un lotto esaurito creato dopo la verifica iniziale", async () => {
    const id = await product();
    expect((await request(app).get(`/prodotti/${id}/eliminazione`)).body.eliminabile).toBe(true);
    const lot = await pool.query("INSERT INTO lotti (prodotto_id,data_carico,quantita_caricata,quantita_residua,magazzino_id) VALUES ($1,CURRENT_DATE,10,0,$2) RETURNING id", [id, testWarehouseId]);
    try {
      expect((await request(app).get(`/prodotti/${id}/eliminazione`)).body.eliminabile).toBe(false);
      expect((await request(app).delete(`/prodotti/${id}/eliminazione`)).status).toBe(409);
      expect((await request(app).get(`/prodotti/${id}`)).status).toBe(200);
    } finally { await pool.query("DELETE FROM lotti WHERE id=$1", [lot.rows[0].id]); }
  });

  it("protegge i movimenti anche senza una partita residua", async () => {
    const id = await product();
    const movement = await pool.query("INSERT INTO movimenti (prodotto_id,tipo_movimento,tipo_dettaglio,data_movimento,magazzino_id,quantita,unita_misura) VALUES ($1,'CARICO','TEST',CURRENT_DATE,$2,1,'pz') RETURNING id", [id, testWarehouseId]);
    try { expect((await request(app).delete(`/prodotti/${id}/eliminazione`)).status).toBe(409); }
    finally { await pool.query("DELETE FROM movimenti WHERE id=$1", [movement.rows[0].id]); }
  });

  it("non consente eliminazione o verifica senza permesso di gestione", async () => {
    const id = await product();
    const restricted = express();
    restricted.use((req, _res, next) => {
      req.user = { id: testUserId, username: 'readonly', isAdmin: false, permessi: [] } as NonNullable<typeof req.user>;
      next();
    });
    restricted.use(prodottiRouter);
    expect((await request(restricted).get(`/prodotti/${id}/eliminazione`)).status).toBe(403);
    expect((await request(restricted).delete(`/prodotti/${id}/eliminazione`)).status).toBe(403);
    expect((await request(app).get(`/prodotti/${id}`)).status).toBe(200);
  });

  it("serializza un carico concorrente prima di rivalutare l'eliminazione", async () => {
    const id = await product();
    const writer = await pool.connect();
    let lotId: number | undefined;
    let deletion: Promise<request.Response> | undefined;
    try {
      await writer.query('BEGIN');
      lotId = (await writer.query("INSERT INTO lotti (prodotto_id,data_carico,quantita_caricata,quantita_residua,magazzino_id) VALUES ($1,CURRENT_DATE,1,1,$2) RETURNING id", [id, testWarehouseId])).rows[0].id;
      deletion = request(app).delete(`/prodotti/${id}/eliminazione`).then(r => r);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const locks = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [writer.processID]);
        if (locks.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await writer.query('COMMIT');
      expect((await deletion).status).toBe(409);
    } finally {
      await writer.query('ROLLBACK');
      writer.release();
      if (deletion) await deletion;
      if (lotId) await pool.query('DELETE FROM lotti WHERE id=$1', [lotId]);
    }
  });
});

describe("Contenuto fisico per pezzo", () => {
  it("crea in pezzi, aggiorna il default e rifiuta coppie incomplete", async () => {
    const created = await request(app).post("/prodotti").send({ nome: "Pasta 500g", tipoProdotto: "alimentare", unitaMisura: "pz", fattoreKgLtPezzo: 0.5, unitaMisuraPeso: "kg" });
    expect(created.status).toBe(201);
    prodottoIds.push(created.body.id);
    expect(created.body).toMatchObject({ unitaMisura: "pz", fattoreKgLtPezzo: 0.5, unitaMisuraPeso: "kg" });
    expect((await request(app).patch(`/prodotti/${created.body.id}`).send({ fattoreKgLtPezzo: 1 })).status).toBe(200);
    expect((await request(app).patch(`/prodotti/${created.body.id}`).send({ unitaMisuraPeso: null })).status).toBe(400);
    expect((await request(app).patch(`/prodotti/${created.body.id}`).send({ fattoreKgLtPezzo: 0 })).status).toBe(400);
    expect((await request(app).patch(`/prodotti/${created.body.id}`).send({ fattoreKgLtPezzo: null, unitaMisuraPeso: null })).status).toBe(200);
  });
});
