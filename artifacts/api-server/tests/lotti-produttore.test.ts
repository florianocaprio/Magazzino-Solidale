/* @vitest-environment node */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  areeOperativeTable,
  centriAscoltoTable,
  magazziniTable,
  prodottiTable,
  utentiTable,
  ruoliTable,
  lottiTable,
  lottiProduttoreTable,
  carichiMagazzinoTable,
  carichiMagazzinoRigheTable,
  movimentiTable,
  auditEventiTable,
  lottiLogiciTable,
} from "@workspace/db";
import { ensureGeneralLogicalLot } from "../src/lib/logicalLots";
import router from "../src/routes/lotti-produttore";
import { createWarehouseLoad } from "../src/lib/inventoryLedger";
import {
  normalizeProducerLotCode,
  verifiedFseLotOrigin,
} from "../src/lib/producerLots";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
const suffix = randomUUID().slice(0, 8);
let logical: number, otherLogical: number;
let area: number,
  otherArea: number,
  warehouse: number,
  otherWarehouse: number,
  product: number,
  requiredProduct: number,
  actor: number,
  role: number;
function app(
  scope: number | null = null,
  admin = true,
  permissions = ["magazzino.view", "magazzino.stock.receive"],
  center: number | null = null,
) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user = {
      id: actor,
      username: `lot-${suffix}`,
      matricola: `LP-${suffix}`,
      isAdmin: admin,
      isSuperAdmin: false,
      aree: ["magazzino"],
      permessi: permissions,
      areaOperativaId: scope,
      areaOperativaAttiva: true,
      centroAscoltoId: center,
      centroAscoltoAttivo: center == null ? undefined : true,
      centroAscoltoAreaOperativaId: center == null ? null : scope,
      zonaUdsId: null,
    };
    next();
  });
  a.use(router);
  return a;
}
const prereg = (code: string | null, extra: Record<string, unknown> = {}) =>
  request(app())
    .post("/lotti-produttore")
    .send({
      areaOperativaId: area,
      prodottoId: product,
      codiceLotto: code,
      idempotencyKey: randomUUID(),
      ...extra,
    });
const load = (
  code: string | null,
  extra: Record<string, unknown> = {},
  w?: number,
) =>
  db.transaction((tx) =>
    createWarehouseLoad(tx, {
      magazzinoId: w ?? warehouse,
      lottoLogicoId: w === otherWarehouse ? otherLogical : logical,
      origineCarico: "DONAZIONE",
      dataCarico: "2026-10-20",
      creatoDa: actor,
      righe: [
        {
          prodottoId: product,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "2.000001",
          codiceLotto: code,
          ...extra,
        },
      ],
    }),
  );
beforeAll(async () => {
  await ensureAmbienteModuli();
  await updateModuloAmbiente("LOTTI", true, null);
  [{ id: area }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Lotti A ${suffix}` })
    .returning();
  [{ id: otherArea }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Lotti B ${suffix}` })
    .returning();
  [{ id: role }] = await db
    .insert(ruoliTable)
    .values({
      nome: `Lotti-${suffix}`,
      isAdmin: true,
      aree: ["magazzino"],
      permessi: ["magazzino.view", "magazzino.stock.receive"],
    })
    .returning();
  [{ id: actor }] = await db
    .insert(utentiTable)
    .values({
      username: `lp-${suffix}`,
      nome: "Operatore",
      cognome: "Lotti",
      passwordHash: "x",
      ruoloId: role,
    })
    .returning();
  [{ id: warehouse }] = await db
    .insert(magazziniTable)
    .values({
      codice: `LPA-${suffix}`,
      nome: `Lotti A ${suffix}`,
      areaOperativaId: area,
    })
    .returning();
  [{ id: otherWarehouse }] = await db
    .insert(magazziniTable)
    .values({
      codice: `LPB-${suffix}`,
      nome: `Lotti B ${suffix}`,
      areaOperativaId: otherArea,
    })
    .returning();
  logical = (
    await db.transaction((tx) =>
      ensureGeneralLogicalLot(tx, { areaOperativaId: area, creatoDa: actor }),
    )
  ).id;
  otherLogical = (
    await db.transaction((tx) =>
      ensureGeneralLogicalLot(tx, {
        areaOperativaId: otherArea,
        creatoDa: actor,
      }),
    )
  ).id;
  [{ id: product }] = await db
    .insert(prodottiTable)
    .values({
      codice: `LP-${suffix}`,
      nome: "Prodotto lotto",
      tipoProdotto: "alimentare",
      unitaMisura: "kg",
      quantitaFrazionabile: true,
      lottoFisicoObbligatorio: false,
      gestioneScadenza: false,
    })
    .returning();
  [{ id: requiredProduct }] = await db
    .insert(prodottiTable)
    .values({
      codice: `LPR-${suffix}`,
      nome: "Prodotto obbligatorio",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      quantitaFrazionabile: false,
      lottoFisicoObbligatorio: true,
      gestioneScadenza: true,
    })
    .returning();
});
afterAll(async () => {
  const loads = await db
    .select({ id: carichiMagazzinoTable.id })
    .from(carichiMagazzinoTable)
    .where(
      inArray(carichiMagazzinoTable.magazzinoId, [warehouse, otherWarehouse]),
    );
  await db
    .delete(movimentiTable)
    .where(inArray(movimentiTable.magazzinoId, [warehouse, otherWarehouse]));
  if (loads.length) {
    await db.delete(carichiMagazzinoRigheTable).where(
      inArray(
        carichiMagazzinoRigheTable.caricoMagazzinoId,
        loads.map((l) => l.id),
      ),
    );
    await db.delete(carichiMagazzinoTable).where(
      inArray(
        carichiMagazzinoTable.id,
        loads.map((l) => l.id),
      ),
    );
  }
  await db
    .delete(lottiTable)
    .where(inArray(lottiTable.magazzinoId, [warehouse, otherWarehouse]));
  await db
    .delete(lottiProduttoreTable)
    .where(inArray(lottiProduttoreTable.areaOperativaId, [area, otherArea]));
  await db
    .delete(prodottiTable)
    .where(inArray(prodottiTable.id, [product, requiredProduct]));
  await db
    .delete(magazziniTable)
    .where(inArray(magazziniTable.id, [warehouse, otherWarehouse]));
  await db
    .delete(lottiLogiciTable)
    .where(inArray(lottiLogiciTable.areaOperativaId, [area, otherArea]));
  await db
    .delete(areeOperativeTable)
    .where(inArray(areeOperativeTable.id, [area, otherArea]));
  await db.delete(utentiTable).where(eq(utentiTable.id, actor));
  await db.delete(ruoliTable).where(eq(ruoliTable.id, role));
  await pool.end();
});
describe("BUG18 — anagrafica lotto produttore separata dal ledger", () => {
  it("normalizza NFC/maiuscole/bordi mantenendo punteggiatura, spazi interni e zeri", () => {
    expect(normalizeProducerLotCode("  00-é/A  B ")).toBe("00-É/A  B");
    expect(normalizeProducerLotCode("00-e\u0301/A  B")).toBe("00-É/A  B");
    expect(normalizeProducerLotCode("00-AB")).not.toBe(
      normalizeProducerLotCode("00 AB"),
    );
  });
  it("preregistra senza stock, non permette spoof dell'origine, riusa senza mutare autore/data", async () => {
    const response = await prereg("MAN-01", {
      origine: "IMPORTATO",
      produttore: "Fabbrica",
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      origine: "MANUALE",
      residuo: "0.000000",
      numeroPartiteVisibili: 0,
      statoPartite: "MAI_CARICATO",
    });
    expect(
      await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.prodottoId, product)),
    ).toHaveLength(0);
    const later = await load(" man-01 ", {
      trustedImport: verifiedFseLotOrigin("Test FSE validato"),
    });
    expect(later.righe[0].lotto.lottoProduttoreId).toBe(response.body.id);
    const detail = await request(app()).get(
      `/lotti-produttore/${response.body.id}`,
    );
    expect(detail.body.origine).toBe("MANUALE");
    expect(detail.body.primaCreazioneAt).toBe(response.body.primaCreazioneAt);
    expect(detail.body.produttore).toBe("Fabbrica");
    expect(detail.body.residuo).toBe("2.000001");
  });
  it("conserva le tre origini, ignora il fondo e i segnali client non verificati", async () => {
    const automatic = await load("AUTO-01", {
      fondoOrigine: "FSE_PLUS",
      trustedImport: { fonte: "client" },
    });
    const imported = await load("IMP-01", {
      trustedImport: verifiedFseLotOrigin("Test sorgente verificata"),
    });
    await load("AUTO-01", {
      trustedImport: verifiedFseLotOrigin("Import successivo"),
    });
    await load("IMP-01");
    const masters = await db
      .select()
      .from(lottiProduttoreTable)
      .where(
        inArray(lottiProduttoreTable.id, [
          automatic.righe[0].lotto.lottoProduttoreId!,
          imported.righe[0].lotto.lottoProduttoreId!,
        ]),
      );
    expect(
      masters.find((m) => m.id === automatic.righe[0].lotto.lottoProduttoreId)
        ?.origine,
    ).toBe("AUTOMATICO");
    expect(
      masters.find((m) => m.id === imported.righe[0].lotto.lottoProduttoreId)
        ?.origine,
    ).toBe("IMPORTATO");
  });
  it("protegge NULL, riferimenti interni e retry, senza fabbricare codici obbligatori", async () => {
    const key = randomUUID();
    const first = await prereg(null, { idempotencyKey: key });
    const repeat = await prereg(null, { idempotencyKey: key });
    const different = await prereg(null);
    expect(first.status).toBe(201);
    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(first.body.id);
    expect(different.body.id).not.toBe(first.body.id);
    expect(first.body.codiceOriginale).toBeNull();
    expect(first.body.riferimentoInterno).toMatch(/^LP-/);
    expect((await prereg(null, { prodottoId: requiredProduct })).status).toBe(
      400,
    );
    expect((await prereg("KEY-CONFLICT", { idempotencyKey: key })).status).toBe(
      409,
    );
  });
  it("serializza preregistrazione contro carico e non genera duplicati o cambi d'origine", async () => {
    const [manual, automatic] = await Promise.all([
      prereg("RACE-01"),
      load("RACE-01"),
    ]);
    expect(manual.status).toBeLessThan(300);
    const rows = await db
      .select()
      .from(lottiProduttoreTable)
      .where(
        and(
          eq(lottiProduttoreTable.prodottoId, product),
          eq(lottiProduttoreTable.codiceCanonico, "RACE-01"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(automatic.righe[0].lotto.lottoProduttoreId).toBe(rows[0].id);
    expect(["MANUALE", "AUTOMATICO"]).toContain(rows[0].origine);
  });
  it("rifiuta identità incompatibili o estranee e rollbacka master, partita e audit", async () => {
    const master = await prereg("CONFLICT", {
      produttore: "Uno",
      dataScadenza: "2027-01-01",
    });
    expect(master.status).toBe(201);
    await expect(
      load("CONFLICT", { produttore: "Due", dataScadenza: "2027-01-01" }),
    ).rejects.toThrow(/CONFLITTO/);
    await expect(
      load("CONFLICT", {
        lottoProduttoreId: master.body.id,
        dataScadenza: "2028-01-01",
      }),
    ).rejects.toThrow(/CONFLITTO/);
    await expect(
      load("CONFLICT", { lottoProduttoreId: master.body.id }, otherWarehouse),
    ).rejects.toThrow(/non disponibile/);
    await expect(
      db.transaction(async (tx) => {
        await createWarehouseLoad(tx, {
          magazzinoId: warehouse,
          lottoLogicoId: logical,
          origineCarico: "DONAZIONE",
          dataCarico: "2026-10-20",
          creatoDa: actor,
          righe: [
            {
              prodottoId: product,
              fondoOrigine: "NESSUN_FONDO",
              quantitaOperativa: "1",
              codiceLotto: "ROLLBACK",
            },
          ],
        });
        throw new Error("synthetic rollback");
      }),
    ).rejects.toThrow("synthetic rollback");
    expect(
      await db
        .select()
        .from(lottiProduttoreTable)
        .where(eq(lottiProduttoreTable.codiceCanonico, "ROLLBACK")),
    ).toHaveLength(0);
  });
  it("filtra Area e protegge preregistrazione, permessi e revoca prima del replay", async () => {
    const registered = await prereg("SCOPE");
    expect(
      (
        await request(app(otherArea, true)).get(
          `/lotti-produttore/${registered.body.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app(null, false)).get(
          `/lotti-produttore?areaOperativaId=${area}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app(area, false, ["magazzino.view"]))
          .post("/lotti-produttore")
          .send({
            areaOperativaId: area,
            prodottoId: product,
            codiceLotto: "DENIED",
            idempotencyKey: randomUUID(),
          })
      ).status,
    ).toBe(403);
    const key = randomUUID();
    const ok = await prereg(null, { idempotencyKey: key });
    expect(ok.status).toBe(201);
    await db
      .update(utentiTable)
      .set({ attivo: false })
      .where(eq(utentiTable.id, actor));
    try {
      expect((await prereg(null, { idempotencyKey: key })).status).toBe(403);
    } finally {
      await db
        .update(utentiTable)
        .set({ attivo: true })
        .where(eq(utentiTable.id, actor));
    }
  });
  it("un errore audit annulla anche creazione anagrafica e stock", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`CREATE FUNCTION test_lp_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.azione = 'LOTTO_PRODUTTORE_CREATO' THEN RAISE EXCEPTION 'audit sintetico non disponibile'; END IF; RETURN NEW; END $$`,
        );
        await tx.execute(
          sql`CREATE TRIGGER test_lp_audit_failure BEFORE INSERT ON audit_eventi FOR EACH ROW EXECUTE FUNCTION test_lp_audit_failure()`,
        );
        await createWarehouseLoad(tx, {
          magazzinoId: warehouse,
          lottoLogicoId: logical,
          origineCarico: "DONAZIONE",
          dataCarico: "2026-10-20",
          creatoDa: actor,
          righe: [
            {
              prodottoId: product,
              fondoOrigine: "NESSUN_FONDO",
              quantitaOperativa: "1",
              codiceLotto: "AUDIT-ROLLBACK",
            },
          ],
        });
      }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(lottiProduttoreTable)
        .where(eq(lottiProduttoreTable.codiceCanonico, "AUDIT-ROLLBACK")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(lottiTable)
        .where(eq(lottiTable.codiceLotto, "AUDIT-ROLLBACK")),
    ).toHaveLength(0);
  });
  it("origini immutabili nel DB e replay contabile privo di nuove anagrafiche", async () => {
    const key = randomUUID();
    const input = {
      magazzinoId: warehouse,
      lottoLogicoId: logical,
      origineCarico: "DONAZIONE" as const,
      dataCarico: "2026-10-20",
      creatoDa: actor,
      idempotencyKey: key,
      righe: [
        {
          prodottoId: product,
          fondoOrigine: "NESSUN_FONDO" as const,
          quantitaOperativa: "1",
          codiceLotto: "REPLAY",
        },
      ],
    };
    const first = await db.transaction((tx) => createWarehouseLoad(tx, input));
    const replay = await db.transaction((tx) => createWarehouseLoad(tx, input));
    expect(replay.replay).toBe(true);
    expect(replay.righe[0].lotto.lottoProduttoreId).toBe(
      first.righe[0].lotto.lottoProduttoreId,
    );
    await expect(
      db.transaction((tx) =>
        tx
          .update(lottiProduttoreTable)
          .set({ origine: "IMPORTATO" })
          .where(
            eq(
              lottiProduttoreTable.id,
              first.righe[0].lotto.lottoProduttoreId!,
            ),
          ),
      ),
    ).rejects.toThrow();
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "lotto_produttore"),
          eq(
            auditEventiTable.entitaId,
            first.righe[0].lotto.lottoProduttoreId!,
          ),
          eq(auditEventiTable.azione, "LOTTO_PRODUTTORE_CREATO"),
        ),
      );
    expect(n.n).toBe(1);
  });
  it("associa una partita legacy senza inventare origine, autore o data storica", async () => {
    const [old] = await db
      .insert(lottiTable)
      .values({
        magazzinoId: warehouse,
        lottoLogicoId: logical,
        prodottoId: product,
        codiceLotto: "LEGACY-UNKNOWN",
        codiceLottoNormalizzato: "LEGACY-UNKNOWN",
        dataCarico: "2026-01-01",
        quantitaCaricata: "1.000000",
        quantitaResidua: "1.000000",
        fondoOrigine: "NESSUN_FONDO",
      })
      .returning();
    const result = await load("LEGACY-UNKNOWN");
    expect(result.righe[0].lotto.id).toBe(old.id);
    const [master] = await db
      .select()
      .from(lottiProduttoreTable)
      .where(
        eq(lottiProduttoreTable.id, result.righe[0].lotto.lottoProduttoreId!),
      );
    expect(master.origine).toBeNull();
    expect(master.primoAutoreId).toBeNull();
    expect(master.primaCreazioneAt).toBeNull();
    expect(master.dataAssociazione).toBeInstanceOf(Date);
    const filtered = await request(app()).get(
      `/lotti-produttore?areaOperativaId=${area}&origine=AUTOMATICO&q=LEGACY-UNKNOWN`,
    );
    expect(filtered.body.items).toHaveLength(0);
  });
  it("mostra l'anagrafica nell'Area senza rivelare stock o fonte FSE di un altro Centro", async () => {
    const centers = await db
      .insert(centriAscoltoTable)
      .values([
        { nome: `LP visibile ${suffix}`, areaOperativaId: area },
        { nome: `LP altro ${suffix}`, areaOperativaId: area },
      ])
      .returning();
    try {
      await db
        .update(magazziniTable)
        .set({ centroAscoltoId: centers[0].id })
        .where(eq(magazziniTable.id, warehouse));
      const result = await load("SCOPE-HIDDEN", {
        trustedImport: verifiedFseLotOrigin("Sorgente riservata"),
      });
      const response = await request(
        app(area, false, ["magazzino.view"], centers[1].id),
      ).get(`/lotti-produttore/${result.righe[0].lotto.lottoProduttoreId}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        numeroPartiteVisibili: 0,
        residuo: "0.000000",
        disponibile: "0.000000",
        fonte: null,
        statoPartite: "NESSUNA_PARTITA_VISIBILE",
      });
      expect(response.body.partite).toHaveLength(0);
    } finally {
      await db
        .update(magazziniTable)
        .set({ centroAscoltoId: null })
        .where(eq(magazziniTable.id, warehouse));
      await db.delete(centriAscoltoTable).where(
        inArray(
          centriAscoltoTable.id,
          centers.map((c) => c.id),
        ),
      );
    }
  });
});
