import { afterAll, describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  db, pool, beneficiariTable, bolleTable, bollaRigheTable, cittaTable,
  centriAscoltoTable, lottiTable, magazziniTable, movimentiTable, prodottiTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { parseReportFilters, ReportingError } from "../src/lib/reporting/filters";
import { reportingAgeBand } from "../src/lib/reporting/ageBands";
import { buildPacchiReport } from "../src/lib/reporting/pacchi";
import { buildCentroAscoltoReport } from "../src/lib/reporting/centroAscolto";
import { buildEmporioReport } from "../src/lib/reporting/emporio";
import { buildMensaReport } from "../src/lib/reporting/mensa";
import { buildUdsReport } from "../src/lib/reporting/uds";
import { buildLogisticaReport } from "../src/lib/reporting/logistica";
import { buildFsePlusReport } from "../src/lib/reporting/fsePlus";
import { buildGeneralReport } from "../src/lib/reporting/generale";
import type { ReportFilters } from "../src/lib/reporting/types";
import { requireSourceArea } from "../src/routes/report-integrato";
import { buildDrilldown } from "../src/lib/reporting/drilldown";

function requestFor(
  query: Record<string, unknown>,
  scope: { cittaId?: number | null; centroAscoltoId?: number | null; zonaUdsId?: number | null; aree?: string[]; permessi?: string[]; isAdmin?: boolean } = {},
) {
  return {
    query,
    user: {
      cittaId: scope.cittaId ?? null,
      centroAscoltoId: scope.centroAscoltoId ?? null,
      zonaUdsId: scope.zonaUdsId ?? null,
      aree: scope.aree ?? ["analisi"],
      permessi: scope.permessi ?? [],
      isAdmin: scope.isAdmin ?? false,
    },
  } as unknown as Request;
}

function fullFilters(): ReportFilters {
  return {
    da: "2026-01-01", a: "2026-12-31", anno: 2026,
    cittaId: null, centroAscoltoId: null, magazzinoId: null, mensaId: null,
    zonaUdsId: null, operatoreId: null, tipoIntervento: null, tipoServizio: null,
    cittaMode: "all", centroMode: "all", zonaMode: "all",
    callerAreas: ["sociale", "emporio", "mensa", "uds", "magazzino", "logistica"],
    callerPermissions: ["mensa.reports.view"],
    callerIsAdmin: true,
  };
}

afterAll(async () => {
  await pool.end();
});

describe("filtri condivisi dei report", () => {
  it("valida date, ordine e anno", () => {
    expect(() => parseReportFilters(requestFor({ da: "2026-02-30", a: "2026-03-01" }))).toThrowError(ReportingError);
    expect(() => parseReportFilters(requestFor({ da: "2026-03-02", a: "2026-03-01" }))).toThrowError(/successiva/);
    expect(() => parseReportFilters(requestFor({ anno: "1999" }))).toThrowError(/anno/);
    const parsed = parseReportFilters(requestFor({ anno: "2025" }));
    expect(parsed.da).toBe("2025-01-01");
    expect(parsed.a).toBe("2025-12-31");
  });

  it("impedisce a città, centro e zona scoped di allargare il perimetro", () => {
    expect(() => parseReportFilters(requestFor({ cittaId: "2" }, { cittaId: 1 }))).toThrowError(/perimetro/);
    expect(() => parseReportFilters(requestFor({ centroAscoltoId: "3" }, { centroAscoltoId: 2 }))).toThrowError(/perimetro/);
    expect(() => parseReportFilters(requestFor({ zonaUdsId: "4" }, { zonaUdsId: 3 }))).toThrowError(/perimetro/);
    const parsed = parseReportFilters(requestFor({}, { cittaId: 1, centroAscoltoId: 2, zonaUdsId: 3 }));
    expect(parsed).toMatchObject({ cittaId: 1, centroAscoltoId: 2, zonaUdsId: 3, cittaMode: "caller", centroMode: "caller", zonaMode: "caller" });
  });

  it("accetta filtri espliciti per un utente globale ma rifiuta identificativi malformati", () => {
    expect(parseReportFilters(requestFor({ cittaId: "5", centroAscoltoId: "6", zonaUdsId: "7" }))).toMatchObject({ cittaId: 5, centroAscoltoId: 6, zonaUdsId: 7 });
    for (const value of ["x", "0", "-2", "1.5"]) {
      expect(() => parseReportFilters(requestFor({ cittaId: value }))).toThrowError(/cittaId/);
    }
  });
});

describe("RBAC delle sorgenti report", () => {
  it("richiede sia Analisi (guard globale) sia l'area sorgente della dashboard", () => {
    const middleware = requireSourceArea("mensa");
    const next = () => { throw new Error("next non atteso"); };
    let status = 0;
    const res = { status: (code: number) => { status = code; return { json: () => undefined }; } } as never;
    middleware(requestFor({}, { aree: ["analisi"] }), res, next);
    expect(status).toBe(403);

    let allowed = false;
    middleware(requestFor({}, { aree: ["analisi", "mensa"] }), res, () => { allowed = true; });
    expect(allowed).toBe(true);
  });
});

describe("fasce di età centralizzate", () => {
  it.each([
    ["2008-08-16", "2026-08-15", "0_17"],
    ["2008-08-15", "2026-08-15", "18_29"],
    ["1996-08-16", "2026-08-15", "18_29"],
    ["1996-08-15", "2026-08-15", "30_64"],
    ["1961-08-16", "2026-08-15", "30_64"],
    ["1961-08-15", "2026-08-15", "65_plus"],
  ])("classifica %s alla data %s come %s", (birthDate, referenceDate, expected) => {
    expect(reportingAgeBand(birthDate, null, referenceDate)).toBe(expected);
  });

  it("usa la fascia presunta solo in assenza della data e distingue il dato mancante", () => {
    expect(reportingAgeBand(null, "18_29", "2026-08-15")).toBe("18_29");
    expect(reportingAgeBand(null, null, "2026-08-15")).toBe("non_determinata");
  });
});

describe("regole di conteggio Pacchi e FSE+", () => {
  it("conta solo bolle consegnate, non duplica il pacco per riga e usa il lotto per FSE+", async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const ids = { bolle: [] as number[], righe: [] as number[], movimenti: [] as number[], lotti: [] as number[] };
    const [city] = await db.insert(cittaTable).values({ nome: `Report city ${suffix}` }).returning({ id: cittaTable.id });
    const [centre] = await db.insert(centriAscoltoTable).values({ nome: `Report centre ${suffix}`, cittaId: city.id }).returning({ id: centriAscoltoTable.id });
    const [warehouse] = await db.insert(magazziniTable).values({ codice: `R-${suffix}`, nome: `Report warehouse ${suffix}`, cittaId: city.id, centroAscoltoId: centre.id }).returning({ id: magazziniTable.id });
    const [beneficiary] = await db.insert(beneficiariTable).values({ codice: `RB-${suffix}`, nome: "Report", cognome: "Test", sesso: "F", cittaId: city.id, centroAscoltoId: centre.id }).returning({ id: beneficiariTable.id });
    const [product] = await db.insert(prodottiTable).values({ codice: `RP-${suffix}`, nome: `Report product ${suffix}`, tipoProdotto: "alimentare", unitaMisura: "kg", fsePlus: false }).returning({ id: prodottiTable.id });
    try {
      const createdBolle = await db.insert(bolleTable).values([
        { numeroBolla: `RBO-${suffix}-1`, dataBolla: "2026-06-01", beneficiarioId: beneficiary.id, magazzinoId: warehouse.id, stato: "bozza" },
        { numeroBolla: `RBO-${suffix}-2`, dataBolla: "2026-06-01", beneficiarioId: beneficiary.id, magazzinoId: warehouse.id, stato: "annullato" },
        { numeroBolla: `RBO-${suffix}-3`, dataBolla: "2026-06-01", beneficiarioId: beneficiary.id, magazzinoId: warehouse.id, stato: "consegnato" },
      ]).returning({ id: bolleTable.id, stato: bolleTable.stato });
      ids.bolle.push(...createdBolle.map((row) => row.id));
      const finalBolla = createdBolle.find((row) => row.stato === "consegnato")!;
      const createdRows = await db.insert(bollaRigheTable).values([
        { bollaId: finalBolla.id, prodottoId: product.id, quantita: "2.00", unitaMisura: "kg" },
        { bollaId: finalBolla.id, prodottoId: product.id, quantita: "3.00", unitaMisura: "kg" },
      ]).returning({ id: bollaRigheTable.id });
      ids.righe.push(...createdRows.map((row) => row.id));
      const lots = await db.insert(lottiTable).values([
        { prodottoId: product.id, codiceLotto: `FSE-${suffix}`, dataCarico: "2026-01-01", quantitaCaricata: "10", quantitaResidua: "8", magazzinoId: warehouse.id, fsePlus: true },
        { prodottoId: product.id, codiceLotto: `NO-${suffix}`, dataCarico: "2026-01-01", quantitaCaricata: "10", quantitaResidua: "7", magazzinoId: warehouse.id, fsePlus: false },
      ]).returning({ id: lottiTable.id, fsePlus: lottiTable.fsePlus });
      ids.lotti.push(...lots.map((row) => row.id));
      const createdMovements = await db.insert(movimentiTable).values([
        { tipoMovimento: "scarico", tipoDettaglio: "bolla", dataMovimento: "2026-06-01", magazzinoId: warehouse.id, prodottoId: product.id, lottoId: lots.find((row) => row.fsePlus)!.id, quantita: "-2", unitaMisura: "kg", beneficiarioId: beneficiary.id, bollaId: finalBolla.id, bollaRigaId: createdRows[0].id },
        { tipoMovimento: "scarico", tipoDettaglio: "bolla", dataMovimento: "2026-06-01", magazzinoId: warehouse.id, prodottoId: product.id, lottoId: lots.find((row) => !row.fsePlus)!.id, quantita: "-3", unitaMisura: "kg", beneficiarioId: beneficiary.id, bollaId: finalBolla.id, bollaRigaId: createdRows[1].id },
      ]).returning({ id: movimentiTable.id });
      ids.movimenti.push(...createdMovements.map((row) => row.id));

      const filters = { ...fullFilters(), cittaId: city.id, centroAscoltoId: centre.id, magazzinoId: warehouse.id, cittaMode: "query" as const, centroMode: "query" as const };
      const parcelReport = await buildPacchiReport(filters);
      expect(parcelReport.kpi.find((item) => item.key === "pacchiDistribuiti")?.value).toBe(1);
      expect(parcelReport.kpi.find((item) => item.key === "nucleiServiti")?.value).toBe(1);
      expect(parcelReport.kpi.find((item) => item.key === "quantitaProdotti")?.value).toBe(5);
      expect(parcelReport.kpi.find((item) => item.key === "quantitaFse")?.value).toBe(2);
      expect(parcelReport.kpi.find((item) => item.key === "quantitaNonFse")?.value).toBe(3);

      const fseReport = await buildFsePlusReport(filters);
      expect(fseReport.kpi.find((item) => item.key === "prodottiFseDistribuiti")?.value).toBe(2);
      expect(fseReport.tables.find((table) => table.key === "01_Prodotti_FSE")?.rows[0]).toMatchObject({ quantitaFse: 2, quantitaTotale: 5, percentualeFse: 40 });
      const mensaOnlyFseReport = await buildFsePlusReport({
        ...filters,
        callerIsAdmin: false,
        callerAreas: ["mensa"],
        callerPermissions: ["mensa.reports.view"],
      });
      expect(mensaOnlyFseReport.kpi.find((item) => item.key === "prodottiFseDistribuiti")?.value).toBe(0);
      expect(mensaOnlyFseReport.tables.find((table) => table.key === "01_Prodotti_FSE")?.rows).toHaveLength(0);
      await expect(buildDrilldown({ section: "pacchi", metric: "nonEsiste", filters, page: 1, pageSize: 25 })).rejects.toThrow(/non disponibile/);
      const parcelDetails = await buildDrilldown({ section: "pacchi", metric: "pacchiDistribuiti", filters, page: 1, pageSize: 25 });
      const householdDetails = await buildDrilldown({ section: "pacchi", metric: "nucleiServiti", filters, page: 1, pageSize: 25 });
      expect(parcelDetails.total).toBe(1);
      expect(householdDetails.total).toBe(1);
    } finally {
      if (ids.movimenti.length) await db.delete(movimentiTable).where(inArray(movimentiTable.id, ids.movimenti));
      if (ids.righe.length) await db.delete(bollaRigheTable).where(inArray(bollaRigheTable.id, ids.righe));
      if (ids.bolle.length) await db.delete(bolleTable).where(inArray(bolleTable.id, ids.bolle));
      if (ids.lotti.length) await db.delete(lottiTable).where(inArray(lottiTable.id, ids.lotti));
      await db.delete(prodottiTable).where(inArray(prodottiTable.id, [product.id]));
      await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, [beneficiary.id]));
      await db.delete(magazziniTable).where(inArray(magazziniTable.id, [warehouse.id]));
      await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, [centre.id]));
      await db.delete(cittaTable).where(inArray(cittaTable.id, [city.id]));
    }
  });
});

describe("query aggregate reali", () => {
  it("esegue tutte le dashboard sullo schema PostgreSQL corrente", async () => {
    const filters = fullFilters();
    const reports = await Promise.all([
      buildPacchiReport(filters), buildCentroAscoltoReport(filters), buildEmporioReport(filters),
      buildMensaReport(filters), buildUdsReport(filters), buildLogisticaReport(filters),
      buildFsePlusReport(filters), buildGeneralReport(filters),
    ]);
    expect(reports.map((report) => report.section)).toEqual([
      "pacchi", "centro-ascolto", "emporio", "mensa", "uds",
      "magazzino-logistica", "fse-plus", "generale",
    ]);
    for (const report of reports) {
      expect(report.timezone).toBe("Europe/Rome");
      expect(report.filters).not.toHaveProperty("callerAreas");
      expect(report.filters).not.toHaveProperty("callerPermissions");
      expect(report.filters).not.toHaveProperty("callerIsAdmin");
    }
  });

  it("esegue ogni drill-down dichiarato sullo schema corrente", async () => {
    const filters = fullFilters();
    const metrics = {
      pacchi: ["pacchiDistribuiti", "nucleiServiti", "personeRaggiunte", "prodottiFse"],
      "centro-ascolto": ["personePreseInCarico", "personeServite", "interventi"],
      emporio: ["utentiServiti", "accessi", "speseConcluse", "prodottiDistribuiti"],
      mensa: ["pastiErogati", "personeUniche", "accessiNegati"],
      uds: ["interventi", "personeUniche", "primiContatti"],
      "magazzino-logistica": ["movimentiCarico", "movimentiScarico", "trasferimenti"],
      "fse-plus": ["prodottiFse", "nucleiRaggiunti", "personeRaggiunte"],
    } as const;
    for (const [section, sectionMetrics] of Object.entries(metrics)) {
      for (const metric of sectionMetrics) {
        const result = await buildDrilldown({ section: section as keyof typeof metrics, metric, filters, page: 1, pageSize: 2 });
        expect(result.pageSize).toBe(2);
        expect(result.rows.length).toBeLessThanOrEqual(2);
      }
    }
  });
});
