import { afterAll, describe, expect, it } from "vitest";
import type { Request } from "express";
import { db, pool, beneficiariTable, bolleTable, bollaRigheTable, areeOperativeTable, centriAscoltoTable, lottiTable, magazziniTable, movimentiTable, prodottiTable, consegneTable, sessioniCassaEmporioTable, speseEmporioTable, speseEmporioRigheTable, interventiTable, menseTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { parseReportFilters, ReportingError } from "../src/lib/reporting/filters";
import { reportingAgeBand } from "../src/lib/reporting/ageBands";
import { buildPacchiReport } from "../src/lib/reporting/pacchi";
import { buildCentroAscoltoReport, isSocialPlannedExpired } from "../src/lib/reporting/centroAscolto";
import { buildEmporioReport } from "../src/lib/reporting/emporio";
import { buildMensaReport } from "../src/lib/reporting/mensa";
import { buildUdsReport } from "../src/lib/reporting/uds";
import { buildLogisticaReport } from "../src/lib/reporting/logistica";
import { buildFsePlusReport } from "../src/lib/reporting/fsePlus";
import { buildGeneralReport } from "../src/lib/reporting/generale";
import type { ReportFilters } from "../src/lib/reporting/types";
import { requireSourceArea } from "../src/routes/report-integrato";
import { buildDrilldown } from "../src/lib/reporting/drilldown";
import { dateTimeEuropeRomeToUtc } from "../src/lib/interventiViste";
import { buildReportFilterOptions } from "../src/lib/reporting/filterOptions";
import { kpi as reportKpi } from "../src/lib/reporting/shared";

function requestFor(
  query: Record<string, unknown>,
  scope: {
    areaOperativaId?: number | null;
    centroAscoltoId?: number | null;
    zonaUdsId?: number | null;
    aree?: string[];
    permessi?: string[];
    isAdmin?: boolean;
  } = {},
) {
  return {
    query,
    user: {
      areaOperativaId: scope.areaOperativaId ?? null,
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
    da: "2026-01-01",
    a: "2026-12-31",
    anno: 2026,
    areaOperativaId: null,
    centroAscoltoId: null,
    magazzinoId: null,
    mensaId: null,
    zonaUdsId: null,
    operatoreId: null,
    tipoIntervento: null,
    tipoServizio: null,
    areaOperativaMode: "all",
    centroMode: "all",
    zonaMode: "all",
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

  it("impedisce a area operativa, centro e zona scoped di allargare il perimetro", () => {
    expect(() => parseReportFilters(requestFor({ areaOperativaId: "2" }, { areaOperativaId: 1 }))).toThrowError(/perimetro/);
    expect(() => parseReportFilters(requestFor({ centroAscoltoId: "3" }, { centroAscoltoId: 2 }))).toThrowError(/perimetro/);
    expect(() => parseReportFilters(requestFor({ zonaUdsId: "4" }, { zonaUdsId: 3 }))).toThrowError(/perimetro/);
    const parsed = parseReportFilters(requestFor({}, { areaOperativaId: 1, centroAscoltoId: 2, zonaUdsId: 3 }));
    expect(parsed).toMatchObject({
      areaOperativaId: 1,
      centroAscoltoId: 2,
      zonaUdsId: 3,
      areaOperativaMode: "caller",
      centroMode: "caller",
      zonaMode: "caller",
    });
  });

  it("accetta filtri espliciti per un utente globale ma rifiuta identificativi malformati", () => {
    expect(
      parseReportFilters(
        requestFor({
          areaOperativaId: "5",
          centroAscoltoId: "6",
          zonaUdsId: "7",
        }),
      ),
    ).toMatchObject({ areaOperativaId: 5, centroAscoltoId: 6, zonaUdsId: 7 });
    for (const value of ["x", "0", "-2", "1.5"]) {
      expect(() => parseReportFilters(requestFor({ areaOperativaId: value }))).toThrowError(/areaOperativaId/);
    }
  });
});

describe("contratto reporting Magazzino 2.0C", () => {
  it("versiona ogni builder integrato e pubblica exactValue per ogni KPI", async () => {
    const filters = fullFilters();
    const reports = await Promise.all([buildGeneralReport(filters), buildPacchiReport(filters), buildCentroAscoltoReport(filters), buildEmporioReport(filters), buildMensaReport(filters), buildUdsReport(filters), buildLogisticaReport(filters), buildFsePlusReport(filters)]);
    for (const report of reports) {
      expect(report.reportingModelVersion).toBe("MAGAZZINO_2_0C_V1");
      expect(report.kpi.every((item) => Object.hasOwn(item, "exactValue"))).toBe(true);
    }
  });

  it("conserva null e decimali esatti senza usarli per la proiezione grafica", () => {
    expect(reportKpi("mancante", null)).toMatchObject({
      value: null,
      exactValue: null,
      availability: "missing",
    });
    expect(reportKpi("decimale", 1.234568, "kgLt", null, "ok", "1.234567")).toMatchObject({ value: 1.234568, exactValue: "1.234567", unit: "kgLt" });
  });
});

describe("RBAC delle sorgenti report", () => {
  it("richiede sia Analisi (guard globale) sia l'area sorgente della dashboard", () => {
    const middleware = requireSourceArea("mensa");
    const next = () => {
      throw new Error("next non atteso");
    };
    let status = 0;
    const res = {
      status: (code: number) => {
        status = code;
        return { json: () => undefined };
      },
    } as never;
    middleware(requestFor({}, { aree: ["analisi"] }), res, next);
    expect(status).toBe(403);

    let allowed = false;
    middleware(requestFor({}, { aree: ["analisi", "mensa"] }), res, () => {
      allowed = true;
    });
    expect(allowed).toBe(true);
  });

  it("include Mensa nella dashboard generale solo con il permesso dedicato o per admin", async () => {
    const withoutPermission = await buildGeneralReport({
      ...fullFilters(),
      callerIsAdmin: false,
      callerAreas: ["analisi", "mensa"],
      callerPermissions: [],
    });
    expect(withoutPermission.kpi.some((item) => item.key === "pastiErogati")).toBe(false);

    const withPermission = await buildGeneralReport({
      ...fullFilters(),
      callerIsAdmin: false,
      callerAreas: ["analisi", "mensa"],
      callerPermissions: ["mensa.reports.view"],
    });
    expect(withPermission.kpi.some((item) => item.key === "pastiErogati")).toBe(true);

    const admin = await buildGeneralReport({
      ...fullFilters(),
      callerAreas: ["analisi"],
      callerPermissions: [],
      callerIsAdmin: true,
    });
    expect(admin.kpi.some((item) => item.key === "pastiErogati")).toBe(true);
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

describe("semantica dei servizi Centro di Ascolto", () => {
  it("conta come servite solo le persone con interventi conclusi e applica il cutoff temporale", async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const interventionIds: number[] = [];
    const [areaOperativa] = await db
      .insert(areeOperativeTable)
      .values({ nome: `Social report areaOperativa ${suffix}` })
      .returning({ id: areeOperativeTable.id });
    const [centre] = await db
      .insert(centriAscoltoTable)
      .values({
        nome: `Social report centre ${suffix}`,
        areaOperativaId: areaOperativa.id,
      })
      .returning({ id: centriAscoltoTable.id });
    const beneficiaries = await db
      .insert(beneficiariTable)
      .values([
        {
          codice: `SRV-${suffix}`,
          nome: "Servita",
          cognome: "Report",
          areaOperativaId: areaOperativa.id,
          centroAscoltoId: centre.id,
        },
        {
          codice: `PLN-${suffix}`,
          nome: "Pianificata",
          cognome: "Report",
          areaOperativaId: areaOperativa.id,
          centroAscoltoId: centre.id,
        },
      ])
      .returning({ id: beneficiariTable.id, codice: beneficiariTable.codice });
    const served = beneficiaries.find((row) => row.codice.startsWith("SRV"))!;
    const plannedOnly = beneficiaries.find((row) => row.codice.startsWith("PLN"))!;
    const now = new Date();
    const past = new Date(now.getTime() - 60 * 60 * 1000);
    const future = new Date(now.getTime() + 60 * 60 * 1000);
    try {
      const created = await db
        .insert(interventiTable)
        .values([
          {
            beneficiarioId: served.id,
            tipoIntervento: `Concluso ${suffix}`,
            ambito: "sociale",
            stato: "concluso",
            dataOraConclusione: now,
          },
          {
            beneficiarioId: served.id,
            tipoIntervento: `Annullato ${suffix}`,
            ambito: "sociale",
            stato: "annullato",
            dataIntervento: "2026-08-17",
          },
          {
            beneficiarioId: served.id,
            tipoIntervento: `Mancata ${suffix}`,
            ambito: "sociale",
            stato: "mancata_presentazione",
            dataIntervento: "2026-08-17",
          },
          {
            beneficiarioId: served.id,
            tipoIntervento: `Scaduto ${suffix}`,
            ambito: "sociale",
            stato: "pianificato",
            dataOraPianificata: past,
          },
          {
            beneficiarioId: served.id,
            tipoIntervento: `Futuro ${suffix}`,
            ambito: "sociale",
            stato: "pianificato",
            dataOraPianificata: future,
          },
          {
            beneficiarioId: plannedOnly.id,
            tipoIntervento: `Solo pianificato ${suffix}`,
            ambito: "sociale",
            stato: "pianificato",
            dataOraPianificata: future,
          },
        ])
        .returning({ id: interventiTable.id });
      interventionIds.push(...created.map((row) => row.id));
      const filters = {
        ...fullFilters(),
        da: "2020-01-01",
        a: "2100-12-31",
        anno: 2026,
        areaOperativaId: areaOperativa.id,
        centroAscoltoId: centre.id,
        areaOperativaMode: "query" as const,
        centroMode: "query" as const,
      };
      const report = await buildCentroAscoltoReport(filters);
      expect(report.kpi.find((item) => item.key === "personeServite")?.value).toBe(1);
      expect(report.kpi.find((item) => item.key === "interventiEffettuati")?.value).toBe(1);
      expect(report.kpi.find((item) => item.key === "annullati")?.value).toBe(1);
      expect(report.kpi.find((item) => item.key === "mancatePresentazioni")?.value).toBe(1);
      expect(report.kpi.find((item) => item.key === "scaduti")?.value).toBe(1);
      expect(report.kpi.find((item) => item.key === "pianificati")?.value).toBe(2);
      const peopleDetails = await buildDrilldown({
        section: "centro-ascolto",
        metric: "personeServite",
        filters,
        page: 1,
        pageSize: 25,
      });
      const interventionDetails = await buildDrilldown({
        section: "centro-ascolto",
        metric: "interventi",
        filters,
        page: 1,
        pageSize: 25,
      });
      expect(peopleDetails.total).toBe(1);
      expect(interventionDetails.total).toBe(1);
    } finally {
      if (interventionIds.length) await db.delete(interventiTable).where(inArray(interventiTable.id, interventionIds));
      await db.delete(beneficiariTable).where(
        inArray(
          beneficiariTable.id,
          beneficiaries.map((row) => row.id),
        ),
      );
      await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, [centre.id]));
      await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, [areaOperativa.id]));
    }
  });

  it("non considera scaduto un appuntamento futuro nella stessa data civile Europe/Rome", () => {
    const now = dateTimeEuropeRomeToUtc("2026-08-17", 12, 0);
    const pastToday = dateTimeEuropeRomeToUtc("2026-08-17", 10, 0);
    const futureToday = dateTimeEuropeRomeToUtc("2026-08-17", 15, 0);
    expect(isSocialPlannedExpired(pastToday, "2026-08-17", now)).toBe(true);
    expect(isSocialPlannedExpired(futureToday, "2026-08-17", now)).toBe(false);
  });
});

describe("regole di conteggio Pacchi e FSE+", () => {
  it("conta solo bolle consegnate, non duplica il pacco e usa il Fondo del Movimento per FSE+", async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const ids = {
      bolle: [] as number[],
      righe: [] as number[],
      movimenti: [] as number[],
      lotti: [] as number[],
      accessi: [] as number[],
      sessioni: [] as number[],
      spese: [] as number[],
      spesaRighe: [] as number[],
      mense: [] as number[],
    };
    const [areaOperativa] = await db
      .insert(areeOperativeTable)
      .values({ nome: `Report areaOperativa ${suffix}` })
      .returning({ id: areeOperativeTable.id });
    const [otherAreaOperativa] = await db
      .insert(areeOperativeTable)
      .values({ nome: `Other report areaOperativa ${suffix}` })
      .returning({ id: areeOperativeTable.id });
    const [centre] = await db
      .insert(centriAscoltoTable)
      .values({
        nome: `Report centre ${suffix}`,
        areaOperativaId: areaOperativa.id,
      })
      .returning({ id: centriAscoltoTable.id });
    const [warehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `R-${suffix}`,
        nome: `Report warehouse ${suffix}`,
        areaOperativaId: areaOperativa.id,
        centroAscoltoId: centre.id,
      })
      .returning({ id: magazziniTable.id });
    const [beneficiary] = await db
      .insert(beneficiariTable)
      .values({
        codice: `RB-${suffix}`,
        nome: "Report",
        cognome: "Test",
        sesso: "F",
        areaOperativaId: areaOperativa.id,
        centroAscoltoId: centre.id,
      })
      .returning({ id: beneficiariTable.id });
    const products = await db
      .insert(prodottiTable)
      .values([
        {
          codice: `RP-KG-${suffix}`,
          nome: `Report kg ${suffix}`,
          tipoProdotto: "alimentare",
          unitaMisura: "kg",
          fsePlus: false,
        },
        {
          codice: `RP-PZ-${suffix}`,
          nome: `Report pezzi ${suffix}`,
          tipoProdotto: "alimentare",
          unitaMisura: "pz",
          fsePlus: false,
        },
      ])
      .returning({
        id: prodottiTable.id,
        unitaMisura: prodottiTable.unitaMisura,
      });
    const productKg = products.find((row) => row.unitaMisura === "kg")!;
    const productPz = products.find((row) => row.unitaMisura === "pz")!;
    try {
      const createdBolle = await db
        .insert(bolleTable)
        .values([
          {
            numeroBolla: `RBO-${suffix}-1`,
            dataBolla: "2026-06-01",
            beneficiarioId: beneficiary.id,
            magazzinoId: warehouse.id,
            stato: "bozza",
          },
          {
            numeroBolla: `RBO-${suffix}-2`,
            dataBolla: "2026-06-01",
            beneficiarioId: beneficiary.id,
            magazzinoId: warehouse.id,
            stato: "annullato",
          },
          {
            numeroBolla: `RBO-${suffix}-3`,
            dataBolla: "2026-06-01",
            beneficiarioId: beneficiary.id,
            magazzinoId: warehouse.id,
            stato: "consegnato",
          },
          {
            numeroBolla: `RBO-${suffix}-4`,
            dataBolla: "2026-06-01",
            beneficiarioId: beneficiary.id,
            magazzinoId: warehouse.id,
            stato: "consegnato",
          },
        ])
        .returning({ id: bolleTable.id, numeroBolla: bolleTable.numeroBolla });
      ids.bolle.push(...createdBolle.map((row) => row.id));
      const finalBolla = createdBolle.find((row) => row.numeroBolla.endsWith("-3"))!;
      const emporioBolla = createdBolle.find((row) => row.numeroBolla.endsWith("-4"))!;
      const createdRows = await db
        .insert(bollaRigheTable)
        .values([
          {
            bollaId: finalBolla.id,
            prodottoId: productKg.id,
            quantita: "2.00",
            unitaMisura: "kg",
          },
          {
            bollaId: finalBolla.id,
            prodottoId: productKg.id,
            quantita: "3.00",
            unitaMisura: "kg",
          },
          {
            bollaId: finalBolla.id,
            prodottoId: productPz.id,
            quantita: "7.00",
            unitaMisura: "pz",
          },
          {
            bollaId: emporioBolla.id,
            prodottoId: productPz.id,
            quantita: "4.00",
            unitaMisura: "pz",
          },
        ])
        .returning({ id: bollaRigheTable.id });
      ids.righe.push(...createdRows.map((row) => row.id));
      const lots = await db
        .insert(lottiTable)
        .values([
          {
            prodottoId: productKg.id,
            codiceLotto: `FSE-${suffix}`,
            dataCarico: "2026-01-01",
            quantitaCaricata: "10",
            quantitaResidua: "8",
            magazzinoId: warehouse.id,
            fsePlus: true,
            fondoOrigine: "FSE_PLUS",
          },
          {
            prodottoId: productKg.id,
            codiceLotto: `NO-${suffix}`,
            dataCarico: "2026-01-01",
            quantitaCaricata: "10",
            quantitaResidua: "7",
            magazzinoId: warehouse.id,
            fsePlus: false,
          },
          {
            prodottoId: productPz.id,
            codiceLotto: `PZ-${suffix}`,
            dataCarico: "2026-01-01",
            quantitaCaricata: "20",
            quantitaResidua: "16",
            magazzinoId: warehouse.id,
            fsePlus: false,
          },
          {
            prodottoId: productKg.id,
            codiceLotto: `HIST-${suffix}`,
            dataCarico: "2026-05-01",
            dataScadenza: "2026-06-30",
            quantitaCaricata: "4",
            quantitaResidua: "0",
            magazzinoId: warehouse.id,
            fsePlus: false,
          },
        ])
        .returning({
          id: lottiTable.id,
          prodottoId: lottiTable.prodottoId,
          fsePlus: lottiTable.fsePlus,
        });
      ids.lotti.push(...lots.map((row) => row.id));
      const createdMovements = await db
        .insert(movimentiTable)
        .values([
          {
            tipoMovimento: "scarico",
            tipoDettaglio: "bolla",
            dataMovimento: "2026-06-01",
            magazzinoId: warehouse.id,
            prodottoId: productKg.id,
            lottoId: lots.find((row) => row.fsePlus)!.id,
            quantita: "2",
            unitaMisura: "kg",
            beneficiarioId: beneficiary.id,
            bollaId: finalBolla.id,
            bollaRigaId: createdRows[0].id,
            fondoOrigine: "FSE_PLUS",
          },
          {
            tipoMovimento: "scarico",
            tipoDettaglio: "bolla",
            dataMovimento: "2026-06-01",
            magazzinoId: warehouse.id,
            prodottoId: productKg.id,
            lottoId: lots.find((row) => !row.fsePlus && row.prodottoId === productKg.id)!.id,
            quantita: "3",
            unitaMisura: "kg",
            beneficiarioId: beneficiary.id,
            bollaId: finalBolla.id,
            bollaRigaId: createdRows[1].id,
          },
          {
            tipoMovimento: "carico",
            tipoDettaglio: "test_as_of",
            dataMovimento: "2026-05-01",
            magazzinoId: warehouse.id,
            prodottoId: productKg.id,
            lottoId: lots[3].id,
            quantita: "4",
            quantitaKgLt: "4",
            unitaMisura: "kg",
            fondoOrigine: "NESSUN_FONDO",
            naturaContabile: "CARICO",
          },
          {
            tipoMovimento: "scarico",
            tipoDettaglio: "test_as_of",
            dataMovimento: "2027-01-02",
            magazzinoId: warehouse.id,
            prodottoId: productKg.id,
            lottoId: lots[3].id,
            quantita: "4",
            quantitaKgLt: "4",
            unitaMisura: "kg",
            fondoOrigine: "NESSUN_FONDO",
            naturaContabile: "DISTRIBUZIONE_FINALE",
          },
        ])
        .returning({ id: movimentiTable.id });
      ids.movimenti.push(...createdMovements.map((row) => row.id));

      const [access] = await db
        .insert(consegneTable)
        .values({
          codice: `RA-${suffix}`,
          beneficiarioId: beneficiary.id,
          tipoPianificazione: "accesso_emporio",
          tipoConsegna: "ritiro",
          dataPrevista: "2026-06-01",
          magazzinoId: warehouse.id,
          magazzinoEmporioId: warehouse.id,
          stato: "effettuata",
          statoAccessoEmporio: "effettuato",
          dataOraEffettivaAccesso: new Date("2026-06-01T10:00:00Z"),
        })
        .returning({ id: consegneTable.id });
      ids.accessi.push(access.id);
      const [session] = await db
        .insert(sessioniCassaEmporioTable)
        .values({
          accessoEmporioId: access.id,
          beneficiarioId: beneficiary.id,
          magazzinoEmporioId: warehouse.id,
          centroAscoltoId: centre.id,
          areaOperativaId: areaOperativa.id,
          statoSessione: "chiusa",
          dataChiusura: new Date("2026-06-01T10:15:00Z"),
        })
        .returning({ id: sessioniCassaEmporioTable.id });
      ids.sessioni.push(session.id);
      const [expense] = await db
        .insert(speseEmporioTable)
        .values({
          sessioneCassaId: session.id,
          accessoEmporioId: access.id,
          beneficiarioId: beneficiary.id,
          centroAscoltoId: centre.id,
          areaOperativaId: areaOperativa.id,
          magazzinoEmporioId: warehouse.id,
          bollaId: emporioBolla.id,
          numeroSpesa: `RS-${suffix}`,
          dataChiusura: new Date("2026-06-01T10:15:00Z"),
          totaleCreditoConsumati: "4",
          saldoPrima: "10",
          saldoDopo: "6",
          statoSpesa: "chiusa",
        })
        .returning({ id: speseEmporioTable.id });
      ids.spese.push(expense.id);
      const expenseRows = await db
        .insert(speseEmporioRigheTable)
        .values({
          spesaEmporioId: expense.id,
          prodottoId: productPz.id,
          descrizioneProdotto: `Report pezzi ${suffix}`,
          quantita: "4",
          creditoUnitario: "1",
          creditoTotale: "4",
          bollaRigaId: createdRows[3].id,
        })
        .returning({ id: speseEmporioRigheTable.id });
      ids.spesaRighe.push(...expenseRows.map((row) => row.id));
      const [canteen] = await db
        .insert(menseTable)
        .values({
          codice: `RM-${suffix}`,
          nome: `Report mensa ${suffix}`,
          areaOperativaId: areaOperativa.id,
          magazzinoId: warehouse.id,
        })
        .returning({ id: menseTable.id });
      ids.mense.push(canteen.id);

      const filters = {
        ...fullFilters(),
        areaOperativaId: areaOperativa.id,
        centroAscoltoId: centre.id,
        magazzinoId: warehouse.id,
        areaOperativaMode: "query" as const,
        centroMode: "query" as const,
      };
      const parcelReport = await buildPacchiReport(filters);
      expect(parcelReport.kpi.find((item) => item.key === "pacchiDistribuiti")?.value).toBe(1);
      expect(parcelReport.kpi.find((item) => item.key === "nucleiServiti")?.value).toBe(1);
      expect(parcelReport.kpi.find((item) => item.key === "prodottiDistinti")?.value).toBe(2);
      expect(parcelReport.kpi.find((item) => item.key === "righeProdotto")?.value).toBe(3);
      expect(parcelReport.kpi.find((item) => item.key === "kgCalcolabili")?.value).toBe(5);
      expect(parcelReport.kpi.some((item) => item.key === "quantitaProdotti")).toBe(false);
      const parcelProducts = parcelReport.tables.find((table) => table.key === "prodotti")?.rows ?? [];
      expect(parcelProducts).toEqual(expect.arrayContaining([expect.objectContaining({ unitaMisura: "kg", quantita: 5 }), expect.objectContaining({ unitaMisura: "pz", quantita: 7 })]));

      const emporioReport = await buildEmporioReport(filters);
      expect(emporioReport.kpi.find((item) => item.key === "speseConcluse")?.value).toBe(1);
      expect(emporioReport.kpi.find((item) => item.key === "prodottiDistintiDistribuiti")?.value).toBe(1);
      const emporioDistinctDetails = await buildDrilldown({
        section: "emporio",
        metric: "prodottiDistintiDistribuiti",
        filters,
        page: 1,
        pageSize: 25,
      });
      expect(emporioDistinctDetails.total).toBe(emporioReport.kpi.find((item) => item.key === "prodottiDistintiDistribuiti")?.value);
      expect(emporioDistinctDetails.rows[0]).toMatchObject({
        prodottoId: productPz.id,
        unita: "pz",
      });

      const generalReport = await buildGeneralReport(filters);
      expect(generalReport.kpi.find((item) => item.key === "pacchiDistribuiti")?.value).toBe(1);
      expect(generalReport.kpi.find((item) => item.key === "speseEmporio")?.value).toBe(1);
      expect(generalReport.kpi.find((item) => item.key === "nucleiPacchi")?.value).toBe(1);

      const fseReport = await buildFsePlusReport(filters);
      expect(fseReport.reportingModelVersion).toBe("MAGAZZINO_2_0C_V1");
      expect(fseReport.kpi.find((item) => item.key === "prodottiFseDistinti")?.value).toBe(1);
      expect(fseReport.kpi.find((item) => item.key === "giacenzaFseCorrenteKgLt")?.exactValue).toMatch(/^\d+(?:\.\d+)?$/);
      expect(fseReport.tables.find((table) => table.key === "01_Prodotti_FSE")?.rows[0]).toMatchObject({
        quantitaFse: 2,
        quantitaTotale: 5,
        percentualeFse: 40,
      });
      const fseDetails = await buildDrilldown({
        section: "fse-plus",
        metric: "prodottiFse",
        filters,
        page: 1,
        pageSize: 25,
      });
      expect(fseDetails.columns).toEqual(["id", "data", "documento", "beneficiarioCodice", "prodotto", "lotto", "quantita", "unita", "canale"]);
      expect(fseDetails.rows[0]).toMatchObject({
        beneficiarioCodice: `RB-${suffix}`,
        canale: "pacchi",
        unita: "kg",
      });
      expect(fseDetails.rows[0]).not.toHaveProperty("nome");
      expect(fseDetails.rows[0]).not.toHaveProperty("cognome");
      const fseDistinctDetails = await buildDrilldown({
        section: "fse-plus",
        metric: "prodottiFseDistinti",
        filters,
        page: 1,
        pageSize: 25,
      });
      expect(fseDistinctDetails.total).toBe(fseReport.kpi.find((item) => item.key === "prodottiFseDistinti")?.value);
      expect(fseDistinctDetails.rows[0]).toMatchObject({
        prodottoId: productKg.id,
        unita: "kg",
      });
      const mensaOnlyFseReport = await buildFsePlusReport({
        ...filters,
        callerIsAdmin: false,
        callerAreas: ["mensa"],
        callerPermissions: ["mensa.reports.view"],
      });
      expect(mensaOnlyFseReport.kpi.find((item) => item.key === "prodottiFseDistinti")?.value).toBe(0);
      expect(mensaOnlyFseReport.tables.find((table) => table.key === "01_Prodotti_FSE")?.rows).toHaveLength(0);
      await expect(
        buildDrilldown({
          section: "pacchi",
          metric: "nonEsiste",
          filters,
          page: 1,
          pageSize: 25,
        }),
      ).rejects.toThrow(/non disponibile/);
      const parcelDetails = await buildDrilldown({
        section: "pacchi",
        metric: "pacchiDistribuiti",
        filters,
        page: 1,
        pageSize: 25,
      });
      const householdDetails = await buildDrilldown({
        section: "pacchi",
        metric: "nucleiServiti",
        filters,
        page: 1,
        pageSize: 25,
      });
      expect(parcelDetails.total).toBe(1);
      expect(householdDetails.total).toBe(1);
      const logisticsReport = await buildLogisticaReport(filters);
      expect(
        logisticsReport.kpi.find((item) => item.key === "merceScaduta")?.value,
      ).toBe(1);
      const stockRows = logisticsReport.tables.find((table) => table.key === "giacenze")?.rows ?? [];
      expect(stockRows).toEqual(expect.arrayContaining([expect.objectContaining({ unitaMisura: "kg", quantita: 15 }), expect.objectContaining({ unitaMisura: "pz", quantita: 16 })]));

      const pacchiOptions = await buildReportFilterOptions(requestFor({}, { areaOperativaId: areaOperativa.id, aree: ["analisi", "sociale"] }), "pacchi", areaOperativa.id);
      expect(pacchiOptions.warehouses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: warehouse.id,
            nome: `Report warehouse ${suffix}`,
          }),
        ]),
      );
      expect(pacchiOptions.areeOperative.map((item) => item.id)).toEqual([areaOperativa.id]);
      expect(pacchiOptions.areeOperative.map((item) => item.id)).not.toContain(otherAreaOperativa.id);
      expect(pacchiOptions.mense).toEqual([]);
      expect(pacchiOptions.zones).toEqual([]);

      const unauthorizedPacchiOptions = await buildReportFilterOptions(requestFor({}, { areaOperativaId: areaOperativa.id, aree: ["analisi"] }), "pacchi", areaOperativa.id);
      expect(unauthorizedPacchiOptions).toMatchObject({
        areeOperative: [],
        centres: [],
        warehouses: [],
        mense: [],
        zones: [],
      });

      const mensaOptionsWithoutPermission = await buildReportFilterOptions(
        requestFor(
          {},
          {
            areaOperativaId: areaOperativa.id,
            aree: ["analisi", "mensa"],
            permessi: [],
          },
        ),
        "mensa",
        areaOperativa.id,
      );
      expect(mensaOptionsWithoutPermission.mense).toEqual([]);
      const mensaOptionsWithPermission = await buildReportFilterOptions(
        requestFor(
          {},
          {
            areaOperativaId: areaOperativa.id,
            aree: ["analisi", "mensa"],
            permessi: ["mensa.reports.view"],
          },
        ),
        "mensa",
        areaOperativa.id,
      );
      expect(mensaOptionsWithPermission.mense).toEqual([
        expect.objectContaining({
          id: canteen.id,
          nome: `Report mensa ${suffix}`,
        }),
      ]);
    } finally {
      if (ids.mense.length) await db.delete(menseTable).where(inArray(menseTable.id, ids.mense));
      if (ids.spesaRighe.length) await db.delete(speseEmporioRigheTable).where(inArray(speseEmporioRigheTable.id, ids.spesaRighe));
      if (ids.spese.length) await db.delete(speseEmporioTable).where(inArray(speseEmporioTable.id, ids.spese));
      if (ids.sessioni.length) await db.delete(sessioniCassaEmporioTable).where(inArray(sessioniCassaEmporioTable.id, ids.sessioni));
      if (ids.accessi.length) await db.delete(consegneTable).where(inArray(consegneTable.id, ids.accessi));
      if (ids.movimenti.length) await db.delete(movimentiTable).where(inArray(movimentiTable.id, ids.movimenti));
      if (ids.righe.length) await db.delete(bollaRigheTable).where(inArray(bollaRigheTable.id, ids.righe));
      if (ids.bolle.length) await db.delete(bolleTable).where(inArray(bolleTable.id, ids.bolle));
      if (ids.lotti.length) await db.delete(lottiTable).where(inArray(lottiTable.id, ids.lotti));
      await db.delete(prodottiTable).where(
        inArray(
          prodottiTable.id,
          products.map((row) => row.id),
        ),
      );
      await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, [beneficiary.id]));
      await db.delete(magazziniTable).where(inArray(magazziniTable.id, [warehouse.id]));
      await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, [centre.id]));
      await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, [areaOperativa.id]));
      await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, [otherAreaOperativa.id]));
    }
  });
});

describe("query aggregate reali", () => {
  it("esegue tutte le dashboard sullo schema PostgreSQL corrente", async () => {
    const filters = fullFilters();
    const reports = await Promise.all([buildPacchiReport(filters), buildCentroAscoltoReport(filters), buildEmporioReport(filters), buildMensaReport(filters), buildUdsReport(filters), buildLogisticaReport(filters), buildFsePlusReport(filters), buildGeneralReport(filters)]);
    expect(reports.map((report) => report.section)).toEqual(["pacchi", "centro-ascolto", "emporio", "mensa", "uds", "magazzino-logistica", "fse-plus", "generale"]);
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
      emporio: ["utentiServiti", "accessi", "speseConcluse", "prodottiDistribuiti", "prodottiDistintiDistribuiti"],
      mensa: ["pastiErogati", "personeUniche", "accessiNegati"],
      uds: ["interventi", "personeUniche", "primiContatti"],
      "magazzino-logistica": ["movimentiCarico", "movimentiScarico", "trasferimenti"],
      "fse-plus": ["prodottiFse", "prodottiFseDistinti", "nucleiRaggiunti", "personeRaggiunte"],
    } as const;
    for (const [section, sectionMetrics] of Object.entries(metrics)) {
      for (const metric of sectionMetrics) {
        const result = await buildDrilldown({
          section: section as keyof typeof metrics,
          metric,
          filters,
          page: 1,
          pageSize: 2,
        });
        expect(result.pageSize).toBe(2);
        expect(result.rows.length).toBeLessThanOrEqual(2);
      }
    }
  });
});
