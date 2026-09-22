/* @vitest-environment node */

import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  areeOperativeTable,
  auditEventiTable,
  db,
  lottiLogiciTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  pool,
  prodottiTable,
  utentiTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import areasRouter from "../src/routes/aree-operative";
import carichiRouter from "../src/routes/carichi";
import giacenzeRouter from "../src/routes/giacenze";
import lottiRouter from "../src/routes/lotti";
import logicalLotsRouter from "../src/routes/lotti-logici";
import prodottiRouter from "../src/routes/prodotti";
import {
  ensureAmbienteModuli,
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { ensureGeneralLogicalLot } from "../src/lib/logicalLots";

const suffix = `${process.pid}${Date.now().toString(36)}`;
let app: Express;
let userId: number;
let areaAId: number;
let areaBId: number;
let warehouseAId: number;
let warehouseLegacyId: number;
let generalAId: number;
let generalBId: number;
let pieceProductId: number;
let kgProductId: number;
let fractionalPieceProductId: number;
let physicalLotProductId: number;
let originalLottiEnabled = true;

function makeApp(
  options: {
    areaOperativaId?: number | null;
    permissions?: string[];
    isSuperAdmin?: boolean;
  } = {},
): Express {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.user = {
      id: userId,
      username: `m2_${suffix}`,
      matricola: `M2-${suffix}`,
      nome: "M2",
      cognome: "Test",
      email: null,
      emailDaAggiornare: false,
      ruoloId: null,
      ruoloNome: null,
      centroAscoltoId: null,
      centroAscoltoNome: null,
      areaOperativaId: options.areaOperativaId ?? null,
      areaOperativaNome: null,
      zonaUdsId: null,
      zonaUdsNome: null,
      isAdmin: false,
      isSuperAdmin: options.isSuperAdmin ?? true,
      aree: ["magazzino"],
      permessi: options.permissions ?? [
        "magazzino.view",
        "magazzino.products.manage",
        "magazzino.stock.receive",
        "magazzino.stock.adjust",
      ],
      mustChangePassword: false,
    };
    next();
  });
  instance.use(areasRouter);
  instance.use(prodottiRouter);
  instance.use(logicalLotsRouter);
  instance.use(carichiRouter);
  instance.use(giacenzeRouter);
  instance.use(lottiRouter);
  return instance;
}

async function createProduct(input: Record<string, unknown>) {
  return request(app)
    .post("/prodotti")
    .send({
      nome: `Prodotto ${suffix}`,
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      ...input,
    });
}

async function postLoad(input: Record<string, unknown>) {
  return request(app)
    .post("/carichi")
    .send({
      magazzinoId: warehouseAId,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-09-17",
      righe: [],
      ...input,
    });
}

beforeAll(async () => {
  const required = await pool.query(`
    SELECT count(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (table_name, column_name) IN (
      ('prodotti', 'quantita_frazionabile'),
      ('prodotti', 'lotto_fisico_obbligatorio'),
      ('lotti', 'lotto_logico_id')
    )
  `);
  if (required.rows[0].count !== 3) {
    throw new Error("Applicare la migrazione M2 al database di test");
  }
  await ensureAmbienteModuli();
  originalLottiEnabled =
    (await listModuliFunzionali()).find((item) => item.codice === "LOTTI")
      ?.attivo ?? true;
  await updateModuloAmbiente("LOTTI", true, null);

  [{ id: userId }] = await db
    .insert(utentiTable)
    .values({
      username: `m2_${suffix}`,
      passwordHash: "x",
      nome: "Test M2",
    })
    .returning({ id: utentiTable.id });
  [{ id: areaAId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area M2 A ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: areaBId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area M2 B ${suffix}`, attivo: false })
    .returning({ id: areeOperativeTable.id });
  [{ id: generalAId }] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: areaAId,
      codice: "GENERALE",
      descrizione: "Generale",
      isGenerale: true,
    })
    .returning({ id: lottiLogiciTable.id });
  [{ id: generalBId }] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: areaBId,
      codice: "GENERALE",
      descrizione: "Generale",
      isGenerale: true,
    })
    .returning({ id: lottiLogiciTable.id });
  [{ id: warehouseAId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M2A-${suffix}`.slice(0, 20),
      nome: `Magazzino M2 ${suffix}`,
      areaOperativaId: areaAId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: warehouseLegacyId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `M2L-${suffix}`.slice(0, 20),
      nome: `Magazzino legacy M2 ${suffix}`,
      areaOperativaId: null,
    })
    .returning({ id: magazziniTable.id });
  app = makeApp();
});

afterAll(async () => {
  await updateModuloAmbiente("LOTTI", originalLottiEnabled, null);
  await pool.end();
});

describe("M2 — catalogo globale e quantità", () => {
  it("deriva il default per unità, conserva l'override e registra l'audit", async () => {
    const pieces = await createProduct({
      codice: `M2P-${suffix}`.slice(0, 30),
      nome: `Pezzi M2 ${suffix}`,
      unitaMisura: "pz",
    });
    expect(pieces.status).toBe(201);
    expect(pieces.body.quantitaFrazionabile).toBe(false);
    expect(pieces.body.lottoFisicoObbligatorio).toBe(false);
    pieceProductId = pieces.body.id;

    const kg = await createProduct({
      codice: `M2K-${suffix}`.slice(0, 30),
      nome: `Kg M2 ${suffix}`,
      unitaMisura: "kg",
    });
    expect(kg.status).toBe(201);
    expect(kg.body.quantitaFrazionabile).toBe(true);
    kgProductId = kg.body.id;

    const override = await createProduct({
      codice: `M2O-${suffix}`.slice(0, 30),
      nome: `Override M2 ${suffix}`,
      unitaMisura: "kg",
      quantitaFrazionabile: false,
      lottoFisicoObbligatorio: true,
    });
    expect(override.status).toBe(201);
    expect(override.body).toMatchObject({
      quantitaFrazionabile: false,
      lottoFisicoObbligatorio: true,
    });
    physicalLotProductId = override.body.id;

    const fractionalPieces = await createProduct({
      codice: `M2FP-${suffix}`.slice(0, 30),
      nome: `Pezzi frazionabili M2 ${suffix}`,
      unitaMisura: "pz",
      quantitaFrazionabile: true,
    });
    expect(fractionalPieces.status).toBe(201);
    expect(fractionalPieces.body.quantitaFrazionabile).toBe(true);
    fractionalPieceProductId = fractionalPieces.body.id;

    const events = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "prodotto"),
          eq(auditEventiTable.actorUserId, userId),
        ),
      );
    expect(
      events.filter((event) => event.azione === "PRODOTTO_CREATO"),
    ).toHaveLength(4);
  });

  it("mantiene il Catalogo globale e applica default, RBAC e audit anche al bulk", async () => {
    const deniedApp = makeApp({
      permissions: ["magazzino.view"],
      isSuperAdmin: false,
    });
    const deniedCreate = await request(deniedApp).post("/prodotti").send({
      nome: "Non autorizzato singolo",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
    });
    expect(deniedCreate.status).toBe(403);
    const deniedPatch = await request(deniedApp)
      .patch(`/prodotti/${pieceProductId}`)
      .send({ nome: "Non autorizzato" });
    expect(deniedPatch.status).toBe(403);
    const denied = await request(
      makeApp({
        permissions: ["magazzino.view"],
        isSuperAdmin: false,
      }),
    )
      .post("/prodotti/bulk")
      .send({ righe: [{ nome: "Non autorizzato" }] });
    expect(denied.status).toBe(403);

    const code = `M2B-${suffix}`.slice(0, 30);
    const explicitCode = `M2BE-${suffix}`.slice(0, 30);
    const imported = await request(app)
      .post("/prodotti/bulk")
      .send({
        righe: [
          {
            codice: code,
            nome: `Confezioni bulk M2 ${suffix}`,
            tipoProdotto: "alimentare",
            unitaMisura: "conf",
          },
          {
            codice: explicitCode,
            nome: `Kg bulk esplicito M2 ${suffix}`,
            tipoProdotto: "alimentare",
            unitaMisura: "kg",
            quantitaFrazionabile: false,
            lottoFisicoObbligatorio: true,
          },
        ],
      });
    expect(imported.status).toBe(200);
    expect(imported.body).toEqual({ creati: 2, errori: [] });
    const [product] = await db
      .select()
      .from(prodottiTable)
      .where(eq(prodottiTable.codice, code));
    expect(product).toMatchObject({
      quantitaFrazionabile: false,
      lottoFisicoObbligatorio: false,
    });
    const [explicitProduct] = await db
      .select()
      .from(prodottiTable)
      .where(eq(prodottiTable.codice, explicitCode));
    expect(explicitProduct).toMatchObject({
      quantitaFrazionabile: false,
      lottoFisicoObbligatorio: true,
    });
    const [event] = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.azione, "PRODOTTO_CREATO"),
          eq(auditEventiTable.entitaId, product.id),
        ),
      );
    expect(event).toMatchObject({
      actorType: "user",
      actorUserId: userId,
    });

    const updated = await request(app).patch(`/prodotti/${product.id}`).send({
      quantitaFrazionabile: true,
      lottoFisicoObbligatorio: true,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      quantitaFrazionabile: true,
      lottoFisicoObbligatorio: true,
    });
    const deactivated = await request(app).delete(`/prodotti/${product.id}`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.attivo).toBe(false);
    const reactivated = await request(app)
      .patch(`/prodotti/${product.id}`)
      .send({ attivo: true });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.attivo).toBe(true);
    const audit = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "prodotto"),
          eq(auditEventiTable.entitaId, product.id),
        ),
      );
    expect(audit.map((row) => row.azione)).toEqual([
      "PRODOTTO_CREATO",
      "PRODOTTO_MODIFICATO",
      "PRODOTTO_DISATTIVATO",
      "PRODOTTO_ATTIVATO",
    ]);
  });

  it("non ricalcola la frazionabilità quando il PATCH cambia soltanto l'unità di misura", async () => {
    const pieces = await createProduct({
      codice: `M2PU-${suffix}`.slice(0, 30),
      nome: `Pezzi invarianti M2 ${suffix}`,
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    expect(pieces.status).toBe(201);
    const piecesToKg = await request(app)
      .patch(`/prodotti/${pieces.body.id}`)
      .send({ unitaMisura: "kg" });
    expect(piecesToKg.status).toBe(200);
    expect(piecesToKg.body).toMatchObject({
      unitaMisura: "kg",
      quantitaFrazionabile: false,
    });

    const kg = await createProduct({
      codice: `M2KU-${suffix}`.slice(0, 30),
      nome: `Kg invarianti M2 ${suffix}`,
      unitaMisura: "kg",
      quantitaFrazionabile: true,
    });
    expect(kg.status).toBe(201);
    const kgToPieces = await request(app)
      .patch(`/prodotti/${kg.body.id}`)
      .send({ unitaMisura: "pz" });
    expect(kgToPieces.status).toBe(200);
    expect(kgToPieces.body).toMatchObject({
      unitaMisura: "pz",
      quantitaFrazionabile: true,
    });
  });

  it("annulla la creazione Prodotto se la scrittura audit fallisce", async () => {
    const code = `M2RB-${suffix}`.slice(0, 30);
    await pool.query(`CREATE OR REPLACE FUNCTION test_m2_product_audit_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.azione = 'PRODOTTO_CREATO' AND NEW.changes->>'codice' = '${code}' THEN
          RAISE EXCEPTION 'synthetic M2 product audit failure';
        END IF;
        RETURN NEW;
      END; $$`);
    await pool.query(
      "DROP TRIGGER IF EXISTS test_m2_product_audit_failure_trigger ON audit_eventi",
    );
    await pool.query(`CREATE TRIGGER test_m2_product_audit_failure_trigger
      BEFORE INSERT ON audit_eventi
      FOR EACH ROW EXECUTE FUNCTION test_m2_product_audit_failure()`);
    try {
      const response = await createProduct({
        codice: code,
        nome: `Rollback audit M2 ${suffix}`,
      });
      expect(response.status).toBe(500);
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_m2_product_audit_failure_trigger ON audit_eventi",
      );
      await pool.query(
        "DROP FUNCTION IF EXISTS test_m2_product_audit_failure()",
      );
    }
    expect(
      await db
        .select()
        .from(prodottiTable)
        .where(eq(prodottiTable.codice, code)),
    ).toHaveLength(0);
  });

  it("rifiuta quantità decimali sui prodotti non frazionabili e non richiede un lotto fisico implicito", async () => {
    const rejected = await postLoad({
      righe: [
        {
          prodottoId: pieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1.5",
        },
      ],
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain("numero intero");

    const rejectedKgOverride = await postLoad({
      righe: [
        {
          prodottoId: physicalLotProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "0.25",
          codiceLotto: "KG-OVERRIDE",
        },
      ],
    });
    expect(rejectedKgOverride.status).toBe(400);
    expect(rejectedKgOverride.body.error).toContain("numero intero");

    const acceptedPiecesOverride = await postLoad({
      righe: [
        {
          prodottoId: fractionalPieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "0.1",
        },
      ],
    });
    expect(acceptedPiecesOverride.status).toBe(201);

    const accepted = await postLoad({
      righe: [
        {
          prodottoId: kgProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1.5",
        },
      ],
    });
    expect(accepted.status).toBe(201);
    const [physical] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, accepted.body.righe[0].lottoId));
    expect(physical).toMatchObject({
      lottoLogicoId: generalAId,
      codiceLotto: null,
      quantitaCaricata: "1.50",
    });
    const [movement] = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.lottoId, physical.id));
    expect(movement).toMatchObject({
      operatoreId: userId,
      auditEventoId: expect.any(Number),
    });

    const missingPhysicalCode = await postLoad({
      righe: [
        {
          prodottoId: physicalLotProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "2",
        },
      ],
    });
    expect(missingPhysicalCode.status).toBe(400);
    expect(missingPhysicalCode.body.error).toContain(
      "Codice lotto obbligatorio",
    );
  });

  it("rifiuta i nuovi carichi su un Magazzino legacy senza Area", async () => {
    const response = await postLoad({
      magazzinoId: warehouseLegacyId,
      righe: [
        {
          prodottoId: pieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
        },
      ],
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("Area Operativa");
  });

  it("legge il legacy frazionario e consente solo la rettifica amministrativa motivata", async () => {
    const legacyProduct = await createProduct({
      codice: `M2LQ-${suffix}`.slice(0, 30),
      nome: `Legacy frazionario M2 ${suffix}`,
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    expect(legacyProduct.status).toBe(201);
    const [legacyLot] = await db
      .insert(lottiTable)
      .values({
        prodottoId: legacyProduct.body.id,
        lottoLogicoId: null,
        dataCarico: "2026-01-01",
        quantitaCaricata: "1.500000",
        quantitaResidua: "1.500000",
        magazzinoId: warehouseAId,
      })
      .returning();

    const stock = await request(app).get("/giacenze").query({
      areaOperativaId: areaAId,
      magazzinoId: warehouseAId,
      prodottoId: legacyProduct.body.id,
    });
    expect(stock.status).toBe(200);
    expect(stock.body[0]).toMatchObject({
      giacenzaFisicaPrecisa: "1.500000",
    });

    const ordinaryLoad = await postLoad({
      righe: [
        {
          prodottoId: legacyProduct.body.id,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "0.5",
        },
      ],
    });
    expect(ordinaryLoad.status).toBe(400);

    const adjusted = await request(app)
      .post(`/lotti/${legacyLot.id}/rettifica`)
      .send({
        delta: "-0.5",
        causale: "altro",
        motivazione: "Sanatoria anomalia_quantita_legacy",
      });
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.quantitaResidua).toBe(1);
    const [after] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, legacyLot.id));
    expect(Number(after.quantitaResidua)).toBe(1);
    expect(after.lottoLogicoId).toBeNull();
  });
});

describe("M2 — lotto logico operativo", () => {
  it("espone Generale anche per un'Area inattiva e protegge il suo ciclo di vita", async () => {
    const listed = await request(app)
      .get("/lotti-logici")
      .query({ areaOperativaId: areaBId });
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: generalBId,
        codice: "GENERALE",
        isGenerale: true,
        stato: "aperto",
        maiCaricato: true,
        esaurito: false,
      }),
    ]);
    const closeGeneral = await request(app)
      .post(`/lotti-logici/${generalBId}/chiudi`)
      .send({ motivo: "non ammesso" });
    expect(closeGeneral.status).toBe(409);
    expect(
      (await request(app).post(`/lotti-logici/${generalBId}/archivia`).send({}))
        .status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/lotti-logici/${generalBId}`)
          .send({ descrizione: "Non modificabile" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/lotti-logici/${generalBId}`)
          .send({ areaOperativaId: areaAId, isGenerale: false })
      ).status,
    ).toBe(409);
    expect(
      (await request(app).delete(`/lotti-logici/${generalBId}`)).status,
    ).toBe(404);
  });

  it("crea il Generale di una nuova Area in modo transazionale, idempotente e con actor system", async () => {
    const created = await request(app)
      .post("/aree-operative")
      .send({
        nome: `Area nuova M2 ${suffix}`,
        sigla: "M2",
      });
    expect(created.status).toBe(201);
    const areaId = created.body.id as number;

    await Promise.all([
      db.transaction((tx) =>
        ensureGeneralLogicalLot(tx, {
          areaOperativaId: areaId,
          creatoDa: userId,
        }),
      ),
      db.transaction((tx) =>
        ensureGeneralLogicalLot(tx, {
          areaOperativaId: areaId,
          creatoDa: userId,
        }),
      ),
    ]);
    const generals = await db
      .select()
      .from(lottiLogiciTable)
      .where(
        and(
          eq(lottiLogiciTable.areaOperativaId, areaId),
          eq(lottiLogiciTable.isGenerale, true),
        ),
      );
    expect(generals).toHaveLength(1);
    expect(generals[0]).toMatchObject({
      stato: "aperto",
      codice: "GENERALE",
    });
    const [event] = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.azione, "LOTTO_LOGICO_GENERALE_CREATO"),
          eq(auditEventiTable.entitaId, generals[0].id),
        ),
      );
    expect(event).toMatchObject({
      actorType: "system",
      actorUserId: null,
      initiatedByUserId: userId,
    });
  });

  it("annulla la nuova Area quando la creazione del Generale fallisce", async () => {
    const areaName = `Area rollback M2 ${suffix}`;
    await pool.query(`CREATE OR REPLACE FUNCTION test_m2_general_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.is_generale AND EXISTS (
          SELECT 1 FROM aree_operative
          WHERE id = NEW.area_operativa_id AND nome = '${areaName}'
        ) THEN
          RAISE EXCEPTION 'synthetic M2 General failure';
        END IF;
        RETURN NEW;
      END; $$`);
    await pool.query(
      "DROP TRIGGER IF EXISTS test_m2_general_failure_trigger ON lotti_logici",
    );
    await pool.query(`CREATE TRIGGER test_m2_general_failure_trigger
      BEFORE INSERT ON lotti_logici
      FOR EACH ROW EXECUTE FUNCTION test_m2_general_failure()`);
    try {
      const response = await request(app)
        .post("/aree-operative")
        .send({ nome: areaName });
      expect(response.status).toBe(500);
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_m2_general_failure_trigger ON lotti_logici",
      );
      await pool.query("DROP FUNCTION IF EXISTS test_m2_general_failure()");
    }
    expect(
      await db
        .select()
        .from(areeOperativeTable)
        .where(eq(areeOperativeTable.nome, areaName)),
    ).toHaveLength(0);
  });

  it("gestisce comandi espliciti, audit e motivo obbligatorio di riapertura", async () => {
    const created = await request(app)
      .post("/lotti-logici")
      .send({
        areaOperativaId: areaAId,
        codice: `raccolta-${suffix}`,
        descrizione: "Raccolta M2",
      });
    expect(created.status).toBe(201);
    const logicalLotId = created.body.id as number;
    const updated = await request(app)
      .patch(`/lotti-logici/${logicalLotId}`)
      .send({ descrizione: "Raccolta M2 aggiornata" });
    expect(updated.status).toBe(200);
    expect(updated.body.descrizione).toBe("Raccolta M2 aggiornata");

    const firstLoad = await postLoad({
      lottoLogicoId: logicalLotId,
      righe: [
        {
          prodottoId: pieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "2",
          codiceLotto: "PROD-1",
        },
      ],
    });
    expect(firstLoad.status).toBe(201);
    const samePhysicalParty = await postLoad({
      lottoLogicoId: logicalLotId,
      righe: [
        {
          prodottoId: pieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
          codiceLotto: "PROD-1",
        },
      ],
    });
    expect(samePhysicalParty.status).toBe(201);
    expect(samePhysicalParty.body.righe[0].lottoId).toBe(
      firstLoad.body.righe[0].lottoId,
    );
    const secondProductAndExpiry = await postLoad({
      lottoLogicoId: logicalLotId,
      righe: [
        {
          prodottoId: kgProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "0.25",
          codiceLotto: "PROD-2",
          dataScadenza: "2027-12-31",
        },
        {
          prodottoId: kgProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "0.5",
          codiceLotto: "PROD-2",
          dataScadenza: "2028-12-31",
        },
      ],
    });
    expect(secondProductAndExpiry.status).toBe(201);
    const physicalDetails = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.lottoLogicoId, logicalLotId));
    expect(new Set(physicalDetails.map((row) => row.prodottoId))).toEqual(
      new Set([pieceProductId, kgProductId]),
    );
    expect(
      physicalDetails.filter((row) => row.prodottoId === kgProductId),
    ).toHaveLength(2);
    expect(secondProductAndExpiry.body.righe[0].lottoId).not.toBe(
      secondProductAndExpiry.body.righe[1].lottoId,
    );
    const generalLoad = await postLoad({
      righe: [
        {
          prodottoId: pieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "3",
          codiceLotto: "PROD-1",
        },
      ],
    });
    expect(generalLoad.status).toBe(201);
    expect(firstLoad.body.righe[0].lottoId).not.toBe(
      generalLoad.body.righe[0].lottoId,
    );

    const closed = await request(app)
      .post(`/lotti-logici/${logicalLotId}/chiudi`)
      .send({ motivo: "raccolta conclusa" });
    expect(closed.status).toBe(200);
    expect(closed.body.stato).toBe("chiuso");
    const loadClosed = await postLoad({
      lottoLogicoId: logicalLotId,
      righe: [
        {
          prodottoId: pieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
        },
      ],
    });
    expect(loadClosed.status).toBe(409);

    const missingReason = await request(app)
      .post(`/lotti-logici/${logicalLotId}/riapri`)
      .send({});
    expect(missingReason.status).toBe(400);
    const reopened = await request(app)
      .post(`/lotti-logici/${logicalLotId}/riapri`)
      .send({ motivo: "nuova donazione collegata" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.stato).toBe("aperto");

    const loadReopened = await postLoad({
      lottoLogicoId: logicalLotId,
      righe: [
        {
          prodottoId: pieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
        },
      ],
    });
    expect(loadReopened.status).toBe(201);

    const events = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "lotto_logico"),
          eq(auditEventiTable.entitaId, logicalLotId),
        ),
      )
      .orderBy(asc(auditEventiTable.id));
    expect(events.map((event) => event.azione)).toEqual([
      "LOTTO_LOGICO_CREATO",
      "LOTTO_LOGICO_MODIFICATO",
      "LOTTO_LOGICO_CHIUSO",
      "LOTTO_LOGICO_RIAPERTO",
    ]);
  });

  it("annulla la modifica del lotto logico se la scrittura audit fallisce", async () => {
    const created = await request(app)
      .post("/lotti-logici")
      .send({
        areaOperativaId: areaAId,
        codice: `audit-rb-${suffix}`,
        descrizione: "Descrizione prima del rollback",
      });
    expect(created.status).toBe(201);
    const logicalLotId = created.body.id as number;
    await pool.query(`CREATE OR REPLACE FUNCTION test_m2_logical_audit_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.azione = 'LOTTO_LOGICO_MODIFICATO' AND NEW.entita_id = ${logicalLotId} THEN
          RAISE EXCEPTION 'synthetic M2 logical lot audit failure';
        END IF;
        RETURN NEW;
      END; $$`);
    await pool.query(
      "DROP TRIGGER IF EXISTS test_m2_logical_audit_failure_trigger ON audit_eventi",
    );
    await pool.query(`CREATE TRIGGER test_m2_logical_audit_failure_trigger
      BEFORE INSERT ON audit_eventi
      FOR EACH ROW EXECUTE FUNCTION test_m2_logical_audit_failure()`);
    try {
      const response = await request(app)
        .patch(`/lotti-logici/${logicalLotId}`)
        .send({ descrizione: "Questa modifica deve essere annullata" });
      expect(response.status).toBe(500);
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_m2_logical_audit_failure_trigger ON audit_eventi",
      );
      await pool.query(
        "DROP FUNCTION IF EXISTS test_m2_logical_audit_failure()",
      );
    }
    const [after] = await db
      .select()
      .from(lottiLogiciTable)
      .where(eq(lottiLogiciTable.id, logicalLotId));
    expect(after.descrizione).toBe("Descrizione prima del rollback");
  });

  it("archivia soltanto da chiuso, lo esclude dai selector normali e lo conserva nello storico", async () => {
    const created = await request(app)
      .post("/lotti-logici")
      .send({
        areaOperativaId: areaAId,
        codice: `arch-${suffix}`,
        descrizione: "Raccolta da archiviare",
      });
    const logicalLotId = created.body.id as number;
    expect(
      (
        await request(app)
          .post(`/lotti-logici/${logicalLotId}/archivia`)
          .send({})
      ).status,
    ).toBe(409);
    expect(
      (await request(app).post(`/lotti-logici/${logicalLotId}/chiudi`).send({}))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/lotti-logici/${logicalLotId}/archivia`)
          .send({})
      ).status,
    ).toBe(200);

    const normal = await request(app)
      .get("/lotti-logici")
      .query({ areaOperativaId: areaAId });
    expect(normal.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: logicalLotId })]),
    );
    const history = await request(app)
      .get("/lotti-logici")
      .query({ areaOperativaId: areaAId, includeStorico: true });
    expect(history.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: logicalLotId, stato: "archiviato" }),
      ]),
    );
    expect(
      (
        await postLoad({
          lottoLogicoId: logicalLotId,
          righe: [
            {
              prodottoId: pieceProductId,
              fondoOrigine: "NESSUN_FONDO",
              quantitaOperativa: "1",
            },
          ],
        })
      ).status,
    ).toBe(409);
  });

  it("impedisce di usare un lotto logico appartenente a un'altra Area", async () => {
    const response = await postLoad({
      lottoLogicoId: generalBId,
      righe: [
        {
          prodottoId: pieceProductId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
        },
      ],
    });
    expect(response.status).toBe(403);

    const scoped = makeApp({
      areaOperativaId: areaAId,
      isSuperAdmin: false,
    });
    expect(
      (
        await request(scoped)
          .get("/lotti-logici")
          .query({ areaOperativaId: areaBId })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(scoped)
          .post("/lotti-logici")
          .send({
            areaOperativaId: areaBId,
            codice: `vietato-${suffix}`,
            descrizione: "Vietato",
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(scoped)
          .patch(`/lotti-logici/${generalBId}`)
          .send({ descrizione: "Vietato" })
      ).status,
    ).toBe(403);
    for (const action of ["chiudi", "riapri", "archivia"] as const) {
      expect(
        (
          await request(scoped)
            .post(`/lotti-logici/${generalBId}/${action}`)
            .send({ motivo: "Vietato" })
        ).status,
      ).toBe(403);
    }
  });
});
