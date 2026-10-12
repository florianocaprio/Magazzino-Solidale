/* @vitest-environment node */
import {
  db,
  lottiTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  rilevazioniMonitoraggioFseTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fseRouter from "../src/routes/fse";
import caricoRouter from "../src/routes/carico-pratiche";
import {
  buildFseCanonicalReport,
  listFseCanonicalPage,
} from "../src/lib/fseCanonicalReporting";
import {
  cleanup,
  createAreaOperativa,
  createCentroRec,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  makeScopedApp,
  newScope,
} from "./scope-helpers";

const scope = newScope();
let area: number,
  otherArea: number,
  centro: number,
  warehouse: number,
  otherWarehouse: number,
  product: number,
  lot: number,
  actor: number;
const period = {
  dataDa: "2026-10-01",
  dataA: "2026-10-31",
  includeArretrati: true,
};
const app = (
  areaOperativaId: number | null,
  centroAscoltoId: number | null,
  isAdmin = false,
) =>
  makeScopedApp(fseRouter, {
    id: actor,
    areaOperativaId,
    centroAscoltoId,
    isAdmin,
    permessi: ["magazzino.fse.view"],
  });
async function operation() {
  const [row] = await db
    .insert(operazioniDistribuzioneMagazzinoTable)
    .values({
      magazzinoId: warehouse,
      dataDistribuzione: "2026-10-11",
      canaleOperativo: "EMPORIO",
      dominioOrigine: "M64_TEST",
      entitaOrigineTipo: "regression",
      entitaOrigineId: Math.floor(Math.random() * 100000000),
      indigentiSaltuari: 1,
      indigentiContinuativi: 0,
      creatoDa: actor,
    })
    .returning();
  return row.id;
}
async function movement(
  overrides: Partial<typeof movimentiTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(movimentiTable)
    .values({
      tipoMovimento: "scarico",
      tipoDettaglio: "m64_test",
      dataMovimento: "2026-10-11",
      magazzinoId: warehouse,
      prodottoId: product,
      lottoId: lot,
      quantita: "10",
      quantitaPezzi: "10",
      unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      canaleOperativo: "EMPORIO",
      ...overrides,
    })
    .returning();
  return row;
}
beforeAll(async () => {
  area = await createAreaOperativa(scope);
  otherArea = await createAreaOperativa(scope);
  centro = (await createCentroRec(scope, { areaOperativaId: area })).id;
  warehouse = await createMagazzino(scope, null, { areaOperativaId: area });
  otherWarehouse = await createMagazzino(scope, null, {
    areaOperativaId: otherArea,
  });
  actor = await createUtente(scope, { centroId: centro });
  product = await createProdotto(scope);
  lot = await createLotto(scope, {
    prodottoId: product,
    magazzinoId: warehouse,
    quantita: 100,
  });
  await db
    .update(lottiTable)
    .set({ fsePlus: true, fondoOrigine: "FSE_PLUS" })
    .where(eq(lottiTable.id, lot));
});
afterAll(async () => {
  await db
    .delete(rilevazioniMonitoraggioFseTable)
    .where(
      inArray(rilevazioniMonitoraggioFseTable.magazzinoId, scope.magazzinoIds),
    );
  await cleanup(scope);
  await pool.end();
});

describe("M6.4 — scope e proiezioni canoniche", () => {
  it("F04/F27: lista pratiche con scope FSE multiplo o vuoto mantiene SQL valido", async () => {
    for (const isAdmin of [true, false]) {
      const api = makeScopedApp(caricoRouter, {
        id: actor,
        isAdmin,
        areaOperativaId: null,
        centroAscoltoId: null,
        permessi: ["magazzino.view"],
      });
      const response = await request(api)
        .get("/carico-pratiche")
        .query({ areaOperativaId: area });
      expect(response.status, response.text).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    }
  });
  it("F11: il saldo progressivo rispetta anche il cutoff delle operazioni", async () => {
    const op = await operation();
    const original = await movement({ operazioneDistribuzioneId: op });
    const before = await buildFseCanonicalReport({
      ...period,
      magazzinoId: warehouse,
      cutoff: { maxMovimentoId: original.id, maxOperazioneDistribuzioneId: op },
    });
    const lateOp = await operation();
    const late = await movement({
      operazioneDistribuzioneId: lateOp,
      dataMovimento: "2026-10-10",
    });
    const after = await buildFseCanonicalReport({
      ...period,
      magazzinoId: warehouse,
      cutoff: { maxMovimentoId: late.id, maxOperazioneDistribuzioneId: op },
    });
    expect(after.lines.find((row) => row.movementId === original.id)).toEqual(
      before.lines.find((row) => row.movementId === original.id),
    );
    expect(after.balances).toEqual(before.balances);
  });
  it("F01: null/null ordinario non ottiene accesso globale neppure via ID", async () => {
    const response = await request(app(null, null))
      .get("/fse/rendicontazione/preview")
      .query({ ...period, magazzinoId: warehouse });
    expect(response.status).toBe(403);
  });
  it("F01: il solo grant senza area applicativa FSE non abilita la lettura", async () => {
    const response = await request(
      makeScopedApp(fseRouter, {
        id: actor,
        areaOperativaId: area,
        centroAscoltoId: centro,
        aree: [],
        permessi: ["magazzino.fse.view"],
        isAdmin: false,
      }),
    )
      .get("/fse/rendicontazione/preview")
      .query({ ...period, magazzinoId: warehouse });
    expect(response.status).toBe(403);
  });
  it("F02/F03: admin vincolato, condiviso nella propria Area e admin globale", async () => {
    expect(
      (
        await request(app(area, centro, true))
          .get("/fse/rendicontazione/preview")
          .query({ ...period, magazzinoId: otherWarehouse })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app(area, centro))
          .get("/fse/rendicontazione/preview")
          .query({ ...period, magazzinoId: warehouse })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app(null, null, true))
          .get("/fse/rendicontazione/preview")
          .query({ ...period, magazzinoId: warehouse })
      ).status,
    ).toBe(200);
  });
  it("F07/F09: storno parziale è bloccante anche nella coda SQL e nella pagina righe", async () => {
    const op = await operation();
    const original = await movement({ operazioneDistribuzioneId: op });
    await movement({
      tipoMovimento: "carico",
      naturaContabile: "STORNO",
      movimentoOrigineId: original.id,
      operazioneDistribuzioneId: op,
      quantita: "3",
      quantitaPezzi: "3",
    });
    const report = await buildFseCanonicalReport({
      ...period,
      magazzinoId: warehouse,
    });
    expect(
      report.events.find((e) => e.eventKey === `DISTRIBUZIONE:${op}`)?.blocking,
    ).toBe(true);
    const page = await listFseCanonicalPage({
      ...period,
      magazzinoId: warehouse,
      projection: "events",
      page: 1,
      pageSize: 200,
      filters: { statoRendicontazione: "BLOCCATO" },
    });
    expect(page.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKey: `DISTRIBUZIONE:${op}`,
          blocking: true,
        }),
      ]),
    );
    const quality = await listFseCanonicalPage({
      ...period,
      magazzinoId: warehouse,
      projection: "quality",
      page: 1,
      pageSize: 200,
      filters: { statoRendicontazione: "BLOCCATO" },
    });
    expect(quality.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "STATISTICHE_STORNO_PARZIALE_NON_RIPARTIBILI",
          blocking: true,
        }),
      ]),
    );
    const linePage = await listFseCanonicalPage({
      ...period,
      magazzinoId: warehouse,
      projection: "lines",
      page: 1,
      pageSize: 1,
      filters: { statoRendicontazione: "BLOCCATO" },
    });
    expect(linePage.rows).toEqual([
      expect.objectContaining({
        movementId: original.id,
        qualityCodes: expect.arrayContaining([
          "STATISTICHE_STORNO_PARZIALE_NON_RIPARTIBILI",
        ]),
      }),
    ]);
  });
  it("F07: non somma unità diverse per dichiarare uno storno completo", async () => {
    const op = await operation();
    const a = await movement({
      operazioneDistribuzioneId: op,
      quantita: "5",
      quantitaPezzi: "5",
    });
    await movement({
      operazioneDistribuzioneId: op,
      quantita: "5",
      quantitaPezzi: null,
      quantitaKgLt: "5",
      unitaMisura: "kg",
    });
    await movement({
      tipoMovimento: "carico",
      naturaContabile: "STORNO",
      movimentoOrigineId: a.id,
      operazioneDistribuzioneId: op,
      quantita: "10",
      quantitaPezzi: "10",
    });
    const report = await buildFseCanonicalReport({
      ...period,
      magazzinoId: warehouse,
    });
    expect(
      report.events.find((e) => e.eventKey === `DISTRIBUZIONE:${op}`),
    ).toMatchObject({ blocking: true, netStatisticsStatus: "GROSS_ONLY" });
  });
  it("F08: legacy ambiguo è visibile nella qualità, mai attribuito a FSE_PLUS", async () => {
    const legacy = await movement({
      fondoOrigine: "NESSUN_FONDO",
      naturaContabile: "CARICO",
      tipoMovimento: "carico",
    });
    const report = await buildFseCanonicalReport({
      ...period,
      magazzinoId: warehouse,
    });
    expect(report.lines.some((l) => l.movementId === legacy.id)).toBe(false);
    const page = await listFseCanonicalPage({
      ...period,
      magazzinoId: warehouse,
      projection: "quality",
      page: 1,
      pageSize: 200,
    });
    expect(page.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "FONDO_LEGACY_NON_DETERMINATO",
          blocking: true,
        }),
      ]),
    );
  });
  it("F09/F10: filtro prodotto non nasconde un blocco di un'altra riga dello stesso evento", async () => {
    const op = await operation();
    await movement({ operazioneDistribuzioneId: op });
    const otherProduct = await createProdotto(scope);
    await movement({
      operazioneDistribuzioneId: op,
      prodottoId: otherProduct,
      lottoId: null,
      fondoOrigine: "NESSUN_FONDO",
    });
    const page = await listFseCanonicalPage({
      ...period,
      magazzinoId: warehouse,
      projection: "events",
      page: 1,
      pageSize: 200,
      filters: { prodottoId: product, statoRendicontazione: "BLOCCATO" },
    });
    expect(page.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKey: `DISTRIBUZIONE:${op}`,
          qualityCodes: expect.arrayContaining(["EVENTO_FONDI_MISTI"]),
        }),
      ]),
    );
  });
  it("F11: movimento oltre cutoff non altera il fondo dell'evento nella coda", async () => {
    const op = await operation();
    const original = await movement({ operazioneDistribuzioneId: op });
    await movement({
      operazioneDistribuzioneId: op,
      fondoOrigine: "NESSUN_FONDO",
    });
    const cutoff = {
      maxMovimentoId: original.id,
      maxOperazioneDistribuzioneId: op,
    };
    const page = await listFseCanonicalPage({
      ...period,
      magazzinoId: warehouse,
      cutoff,
      projection: "events",
      page: 1,
      pageSize: 200,
      filters: { statoRendicontazione: "DA_RENDICONTARE" },
    });
    expect(page.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKey: `DISTRIBUZIONE:${op}`,
          blocking: false,
        }),
      ]),
    );
  });
  it("F11: coda e builder usano dataAsOf anche per la rilevazione successiva al periodo", async () => {
    const op = await operation();
    await db
      .update(operazioniDistribuzioneMagazzinoTable)
      .set({ canaleOperativo: "PACCHI", numeroPacchi: 1 })
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, op));
    await movement({
      operazioneDistribuzioneId: op,
      canaleOperativo: "PACCHI",
    });
    const [monitor] = await db
      .insert(rilevazioniMonitoraggioFseTable)
      .values({
        magazzinoId: warehouse,
        annoMese: "2026-10",
        canaleUfficiale: "PACCHI",
        dataRiferimento: "2026-10-20",
        fonte: "RILEVAZIONE_MANUALE_VERIFICATA",
        completezza: "COMPLETA",
        creatoDa: actor,
        aggiornatoDa: actor,
      })
      .returning();
    try {
      const input = {
        ...period,
        dataA: "2026-10-15",
        dataAsOf: "2026-10-31",
        magazzinoId: warehouse,
      };
      const report = await buildFseCanonicalReport(input);
      const event = report.events.find(
        (e) => e.eventKey === `DISTRIBUZIONE:${op}`,
      )!;
      expect(event.blocking).toBe(false);
      const page = await listFseCanonicalPage({
        ...input,
        projection: "events",
        page: 1,
        pageSize: 200,
        filters: { statoRendicontazione: "DA_RENDICONTARE" },
      });
      expect(page.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventKey: event.eventKey,
            blocking: false,
          }),
        ]),
      );
    } finally {
      await db
        .delete(rilevazioniMonitoraggioFseTable)
        .where(eq(rilevazioniMonitoraggioFseTable.id, monitor.id));
    }
  });
  it("F24: i nuovi indicatori non includono note amministrative libere", async () => {
    await db.insert(rilevazioniMonitoraggioFseTable).values({
      magazzinoId: warehouse,
      annoMese: "2026-10",
      canaleUfficiale: "PACCHI",
      dataRiferimento: "2026-10-11",
      fonte: "RILEVAZIONE_MANUALE_VERIFICATA",
      completezza: "COMPLETA",
      noteAudit: "=dato riservato sintetico",
      creatoDa: actor,
      aggiornatoDa: actor,
    });
    const report = await buildFseCanonicalReport({
      ...period,
      magazzinoId: warehouse,
    });
    expect(report.indicators).toHaveLength(1);
    expect(report.indicators[0].values).not.toHaveProperty("noteAudit");
  });
});
