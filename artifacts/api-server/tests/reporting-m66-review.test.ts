import { randomUUID, randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  db,
  areeOperativeTable,
  pool,
  utentiTable,
  magazziniTable,
  prodottiTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  beneficiariTable,
  bolleTable,
  fseFascicoliSocialiSnapshotTable,
  lottiTable,
  importazioniAgeaTable,
  riconciliazioniFseTable,
  riconciliazioniFseRigheTable,
  esportazioniFseTable,
  esportazioniFseEventiTable,
  consegneTable,
  sessioniCassaEmporioTable,
  speseEmporioTable,
  menseTable,
  mensaAccessiTable,
  mensaPastiTable,
  mensaGiornateServizioTable,
  interventiTable,
} from "@workspace/db";
import { withReportExecutor } from "../src/lib/reporting/queryContext";
import { buildFseCanonicalReport } from "../src/lib/fseCanonicalReporting";
import { fseQueuePanel } from "../src/lib/reporting/fseQueue";
import { buildFsePlusReport } from "../src/lib/reporting/fsePlus";
import { buildLogisticaReport } from "../src/lib/reporting/logistica";
import { buildEmporioReport } from "../src/lib/reporting/emporio";
import { buildGeneralReport } from "../src/lib/reporting/generale";
import { buildMensaReport } from "../src/lib/reporting/mensa";
import { availableStockPanel } from "../src/lib/reporting/stock";
import { buildDrilldown } from "../src/lib/reporting/drilldown";
import type { ReportFilters } from "../src/lib/reporting/types";
import { utcTimestampRomeDate } from "../src/lib/reporting/sql";
import { dashboard } from "../src/lib/reporting/shared";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const period = { da: "2026-01-01", a: "2026-01-31" };
function filters(warehouse: number): ReportFilters {
  return {
    ...period,
    anno: 2026,
    areaOperativaId: null,
    centroAscoltoId: null,
    magazzinoId: warehouse,
    mensaId: null,
    zonaUdsId: null,
    operatoreId: null,
    tipoIntervento: null,
    tipoServizio: null,
    areaOperativaMode: "all",
    centroMode: "all",
    zonaMode: "all",
    callerAreas: ["magazzino", "logistica"],
    callerPermissions: ["magazzino.fse.view"],
    callerIsAdmin: true,
  };
}
async function isolated(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error("Rollback synthetic review fixture");
  try {
    await db.transaction(async (tx) => {
      // Vitest's timeout does not cancel PostgreSQL. Bound each statement so
      // a failed fixture rolls back instead of blocking the following files.
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      await withReportExecutor(tx, () => run(tx));
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
async function fixture(tx: Tx) {
  const key = randomUUID().slice(0, 8);
  const [area] = await tx
    .insert(areeOperativeTable)
    .values({ nome: `R66-${key}` })
    .returning();
  const [user] = await tx
    .insert(utentiTable)
    .values({
      username: `R66-${key}`,
      passwordHash: "test-only",
      nome: "Synthetic",
    })
    .returning();
  const [warehouse] = await tx
    .insert(magazziniTable)
    .values({
      codice: `R66-${key}`,
      nome: "Review synthetic warehouse",
      areaOperativaId: area.id,
    })
    .returning();
  const [product] = await tx
    .insert(prodottiTable)
    .values({
      codice: `R66-${key}`,
      nome: "Review product",
      unitaMisura: "pz",
      tipoProdotto: "alimentare",
    })
    .returning();
  const [op] = await tx
    .insert(operazioniDistribuzioneMagazzinoTable)
    .values({
      magazzinoId: warehouse.id,
      dataDistribuzione: "2026-01-15",
      canaleOperativo: "EMPORIO",
      dominioOrigine: "REVIEW",
      entitaOrigineTipo: "FIXTURE",
      entitaOrigineId: warehouse.id,
      indigentiSaltuari: 1,
      creatoDa: user.id,
    })
    .returning();
  const movement = {
    tipoMovimento: "scarico",
    tipoDettaglio: "review",
    dataMovimento: "2026-01-15",
    magazzinoId: warehouse.id,
    prodottoId: product.id,
    quantita: "10",
    quantitaPezzi: "10",
    unitaMisura: "pz",
    fondoOrigine: "FSE_PLUS",
    naturaContabile: "DISTRIBUZIONE_FINALE",
    operazioneDistribuzioneId: op.id,
    canaleOperativo: "EMPORIO",
  };
  return {
    user,
    warehouse,
    product,
    op,
    movement,
    filter: filters(warehouse.id),
  };
}
beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (
    process.env.REPORTING_TEST_DISPOSABLE_DB !== "verified" ||
    target.hostname !== "127.0.0.1" ||
    target.port !== "59666" ||
    target.pathname !== "/m66_dev"
  )
    throw Error("Dedicated disposable DB required");
  await ensureAmbienteModuli();
  for (const code of [
    "REPORT",
    "MAGAZZINO_SOLIDALE",
    "LOTTI",
    "BOLLE",
    "EMPORIO_SOLIDALE",
    "MENSA",
    "UDS",
    "CENTRO_ASCOLTO",
  ])
    await updateModuloAmbiente(code, true, null);
});

it("AC-01 one person across five sources and months remains one identity, plus one UDS-only person", () =>
  isolated(async (tx) => {
    const f = await fixture(tx);
    const people = await tx
      .insert(beneficiariTable)
      .values(
        ["P1", "P2"].map((label) => ({
          codice: `${label}-${randomUUID().slice(0, 8)}`,
          nome: label,
          cognome: "Synthetic",
          areaOperativaId: f.warehouse.areaOperativaId,
        })),
      )
      .returning();
    const [mensa] = await tx
      .insert(menseTable)
      .values({
        codice: `U-${randomUUID().slice(0, 8)}`,
        nome: "Union Mensa",
        areaOperativaId: f.warehouse.areaOperativaId!,
        magazzinoId: f.warehouse.id,
      })
      .returning();
    for (const month of ["01", "02"]) {
      const date = `2026-${month}-15`;
      await tx.insert(bolleTable).values({
        numeroBolla: `U-${randomUUID().slice(0, 20)}`,
        dataBolla: date,
        beneficiarioId: people[0].id,
        magazzinoId: f.warehouse.id,
        stato: "consegnato",
      });
      const [access] = await tx
        .insert(mensaAccessiTable)
        .values({
          mensaId: mensa.id,
          beneficiarioId: people[0].id,
          dataOra: new Date(`${date}T12:00:00Z`),
          esito: "consentito",
          motivoEsito: "abilitato",
          modalitaAccesso: "manuale",
          tipoServizio: "pranzo",
          operatoreId: f.user.id,
          idempotencyKey: randomUUID(),
        })
        .returning();
      await tx.insert(mensaPastiTable).values({
        mensaId: mensa.id,
        beneficiarioId: people[0].id,
        accessoMensaId: access.id,
        dataServizio: date,
        tipoServizio: "pranzo",
        operatoreId: f.user.id,
        idempotencyKey: randomUUID(),
      });
      const [appointment] = await tx
        .insert(consegneTable)
        .values({
          codice: `U-${randomUUID().slice(0, 20)}`,
          beneficiarioId: people[0].id,
          tipoPianificazione: "accesso_emporio",
          tipoConsegna: "ritiro",
          dataPrevista: date,
          magazzinoId: f.warehouse.id,
          magazzinoEmporioId: f.warehouse.id,
          stato: "effettuata",
          statoAccessoEmporio: "effettuato",
        })
        .returning();
      const [session] = await tx
        .insert(sessioniCassaEmporioTable)
        .values({
          accessoEmporioId: appointment.id,
          beneficiarioId: people[0].id,
          magazzinoEmporioId: f.warehouse.id,
          statoSessione: "chiusa",
        })
        .returning();
      await tx.insert(speseEmporioTable).values({
        sessioneCassaId: session.id,
        accessoEmporioId: appointment.id,
        beneficiarioId: people[0].id,
        areaOperativaId: f.warehouse.areaOperativaId,
        magazzinoEmporioId: f.warehouse.id,
        numeroSpesa: `U-${randomUUID()}`,
        dataChiusura: new Date(`${date}T12:00:00Z`),
        totaleCreditoConsumati: "1",
        saldoPrima: "2",
        saldoDopo: "1",
        statoSpesa: "chiusa",
      });
      await tx.insert(interventiTable).values([
        {
          beneficiarioId: people[0].id,
          tipoIntervento: "Colloquio",
          ambito: "sociale",
          stato: "concluso",
          dataIntervento: date,
          areaOperativaIdSnapshot: f.warehouse.areaOperativaId,
        },
        {
          beneficiarioId: people[1].id,
          tipoIntervento: "Contatto",
          ambito: "uds",
          stato: "concluso",
          dataIntervento: date,
          areaOperativaIdSnapshot: f.warehouse.areaOperativaId,
        },
      ]);
    }
    const query = {
      ...f.filter,
      magazzinoId: null,
      areaOperativaId: f.warehouse.areaOperativaId,
      areaOperativaMode: "query" as const,
      a: "2026-02-28",
    };
    const report = await buildGeneralReport(query);
    expect(
      report.kpi.find((k) => k.key === "personeUnicheComplessive"),
    ).toMatchObject({ value: 2, exactValue: "2" });
    for (const key of [
      "pacchiDistribuiti",
      "pastiErogati",
      "speseEmporio",
      "interventiCentroAscolto",
      "interventiUds",
    ]) {
      expect(
        report.kpi.find((k) => k.key === key),
        key,
      ).toMatchObject({ value: 2 });
    }
    const monthly = report.series.find((s) => s.key === "attivitaPerMeseArea")!;
    expect(monthly.points).toHaveLength(10);
    expect(
      monthly.points.every(
        (p) => p.exactValue === "1" && p.exactSecondaryValue === "1",
      ),
    ).toBe(true);
  }));

it("AC-08 two Mense on one day, lunch/dinner and registered zero meals retain three distinct denominators", () =>
  isolated(async (tx) => {
    const f = await fixture(tx);
    const [warehouse2] = await tx
      .insert(magazziniTable)
      .values({
        codice: `M-${randomUUID().slice(0, 8)}`,
        nome: "Second synthetic",
        areaOperativaId: f.warehouse.areaOperativaId!,
      })
      .returning();
    const mense = await tx
      .insert(menseTable)
      .values(
        [f.warehouse, warehouse2].map((w, i) => ({
          codice: `M${i}-${randomUUID().slice(0, 8)}`,
          nome: `Denominator ${i}`,
          areaOperativaId: w.areaOperativaId!,
          magazzinoId: w.id,
        })),
      )
      .returning();
    const people = await tx
      .insert(beneficiariTable)
      .values(
        [0, 1].map((i) => ({
          codice: `M-${randomUUID().slice(0, 8)}`,
          nome: "Synthetic",
          cognome: `Meals ${i}`,
        })),
      )
      .returning();
    for (const [m, service] of [
      [mense[0], "pranzo"],
      [mense[0], "cena"],
      [mense[1], "pranzo"],
    ] as const) {
      // A person cannot legitimately receive the same service twice on the
      // same day across different Mense (canonical DB invariant).
      const person = people[m.id === mense[0].id ? 0 : 1];
      const [access] = await tx
        .insert(mensaAccessiTable)
        .values({
          mensaId: m.id,
          beneficiarioId: person.id,
          dataOra: new Date("2026-01-15T12:00:00Z"),
          esito: "consentito",
          motivoEsito: "abilitato",
          modalitaAccesso: "manuale",
          tipoServizio: service,
          operatoreId: f.user.id,
          idempotencyKey: randomUUID(),
        })
        .returning();
      await tx.insert(mensaPastiTable).values({
        mensaId: m.id,
        beneficiarioId: person.id,
        accessoMensaId: access.id,
        dataServizio: "2026-01-15",
        tipoServizio: service,
        operatoreId: f.user.id,
        idempotencyKey: randomUUID(),
      });
      await tx.insert(mensaGiornateServizioTable).values({
        mensaId: m.id,
        dataServizio: "2026-01-15",
        tipoServizio: service,
      });
    }
    await tx.insert(mensaGiornateServizioTable).values({
      mensaId: mense[1].id,
      dataServizio: "2026-01-16",
      tipoServizio: "cena",
    });
    const report = await buildMensaReport({
      ...f.filter,
      magazzinoId: null,
      areaOperativaId: f.warehouse.areaOperativaId,
      areaOperativaMode: "query",
    });
    for (const [key, value] of [
      ["giorniCalendario", 31],
      ["giornateServizio", 1],
      ["giornateMensaServizio", 4],
      ["pastiErogati", 3],
      ["mediaPastiMensaServizio", 0.75],
    ] as const)
      expect(
        report.kpi.find((k) => k.key === key),
        key,
      ).toMatchObject({ value });
    expect(
      report.kpi.find((k) => k.key === "mediaPastiMensaServizio"),
    ).toMatchObject({ numerator: "3", denominator: "4", exactValue: "0.75" });
  }));

it("AC-09 expired stock is physical but not distributable; kg and pieces never collapse", () =>
  isolated(async (tx) => {
    const f = await fixture(tx);
    const [kg] = await tx
      .insert(prodottiTable)
      .values({
        codice: `KG-${randomUUID().slice(0, 10)}`,
        nome: "Exact kg",
        unitaMisura: "kg",
        tipoProdotto: "alimentare",
        quantitaFrazionabile: true,
      })
      .returning();
    await tx.insert(lottiTable).values([
      {
        prodottoId: f.product.id,
        magazzinoId: f.warehouse.id,
        dataCarico: "2020-01-01",
        dataScadenza: "2020-01-02",
        quantitaCaricata: "3",
        quantitaResidua: "3",
      },
      {
        prodottoId: f.product.id,
        magazzinoId: f.warehouse.id,
        dataCarico: "2020-01-01",
        dataScadenza: "2099-12-31",
        quantitaCaricata: "7",
        quantitaResidua: "7",
      },
      {
        prodottoId: kg.id,
        magazzinoId: f.warehouse.id,
        dataCarico: "2020-01-01",
        dataScadenza: null,
        quantitaCaricata: "0.3",
        quantitaResidua: "0.3",
      },
    ]);
    const stock = await availableStockPanel(f.filter);
    const rows = stock.tables.find(
      (t) => t.key === "disponibilitaCorrente",
    )!.rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.prodottoId === f.product.id)).toMatchObject({
      unita: "pz",
      fisica: "10.000000",
      distribuibile: "7.000000",
      disponibile: "7.000000",
    });
    expect(rows.find((r) => r.prodottoId === kg.id)).toMatchObject({
      unita: "kg",
      fisica: "0.300000",
      distribuibile: "0.300000",
      disponibile: "0.300000",
    });
  }));

it.each(["NESSUN_FONDO", "FSE_PLUS"])(
  "AC-12 formal: Emporio product table preserves the real ledger decimal sum (%s)",
  (fund) =>
    isolated(async (tx) => {
      // SQL boundary fixture, not an assertion that checkout produced these facts.
      // All records are transactional and rolled back even when the oracle fails.
      const f = await fixture(tx);
      await tx.execute(sql`UPDATE prodotti SET unita_misura='kg',quantita_frazionabile=true
      WHERE id=${f.product.id}`);
      const [person] = await tx
        .insert(beneficiariTable)
        .values({
          codice: `Q${randomUUID().slice(0, 12)}`,
          nome: "Synthetic",
          cognome: "Precision",
        })
        .returning();
      const [bolla] = await tx
        .insert(bolleTable)
        .values({
          numeroBolla: `Q${randomUUID().slice(0, 20)}`,
          dataBolla: "2026-01-15",
          beneficiarioId: person.id,
          magazzinoId: f.warehouse.id,
          stato: "consegnato",
        })
        .returning();
      const [access] = await tx
        .insert(consegneTable)
        .values({
          codice: `Q${randomUUID().slice(0, 20)}`,
          beneficiarioId: person.id,
          tipoPianificazione: "accesso_emporio",
          tipoConsegna: "ritiro",
          dataPrevista: "2026-01-15",
          magazzinoId: f.warehouse.id,
          magazzinoEmporioId: f.warehouse.id,
          stato: "effettuata",
          statoAccessoEmporio: "effettuato",
        })
        .returning();
      const [session] = await tx
        .insert(sessioniCassaEmporioTable)
        .values({
          accessoEmporioId: access.id,
          beneficiarioId: person.id,
          magazzinoEmporioId: f.warehouse.id,
          statoSessione: "chiusa",
        })
        .returning();
      const [expense] = await tx
        .insert(speseEmporioTable)
        .values({
          sessioneCassaId: session.id,
          accessoEmporioId: access.id,
          beneficiarioId: person.id,
          magazzinoEmporioId: f.warehouse.id,
          bollaId: bolla.id,
          numeroSpesa: `Q${randomUUID()}`,
          dataChiusura: new Date("2026-01-15T12:00:00Z"),
          totaleCreditoConsumati: "10001",
          saldoPrima: "10001",
          saldoDopo: "0",
          statoSpesa: "chiusa",
        })
        .returning();
      await tx.execute(sql`WITH lines AS (
      INSERT INTO bolla_righe(bolla_id,prodotto_id,quantita,unita_misura)
      SELECT ${bolla.id},${f.product.id},99999999.123456,'kg'
      FROM generate_series(1,10001) RETURNING id
    ), movements AS (
      INSERT INTO movimenti(tipo_movimento,tipo_dettaglio,data_movimento,magazzino_id,
        prodotto_id,quantita,unita_misura,fondo_origine,natura_contabile,
        canale_operativo,bolla_id,bolla_riga_id,operazione_distribuzione_id)
      SELECT 'scarico','formal-boundary','2026-01-15',${f.warehouse.id},
        ${f.product.id},99999999.123456,'kg',${fund},'DISTRIBUZIONE_FINALE',
        'EMPORIO',${bolla.id},id,${f.op.id} FROM lines RETURNING id
    ) INSERT INTO spese_emporio_righe(spesa_emporio_id,prodotto_id,descrizione_prodotto,
        quantita,credito_unitario,credito_totale,bolla_riga_id)
      SELECT ${expense.id},${f.product.id},'Synthetic precision',99999999.123456,1,1,id FROM lines`);
      const [oracle] = (
        await tx.execute(sql`SELECT sum(quantita)::text AS exact,
      count(*)::text AS count FROM movimenti WHERE bolla_id=${bolla.id}`)
      ).rows;
      expect(oracle.count).toBe("10001");
      expect(oracle.exact).toBe("1000099991233.683456");
      const report = await buildEmporioReport(f.filter);
      const row = report.tables
        .find((table) => table.key === "prodotti")
        ?.rows.find((item) => item.prodottoId === f.product.id);
      expect(row).toBeDefined();
      console.info("AC12_EMP_ORACLE", {
        sql: oracle.exact,
        dto: row?.quantita,
      });
      // Do not accept a rounded number or re-round the SQL oracle to make it pass.
      expect(String(row?.quantita)).toBe(oracle.exact);
      expect(row).toMatchObject({
        quantita: oracle.exact,
        quantitaFse: fund === "FSE_PLUS" ? oracle.exact : "0",
        quantitaNonFse: fund === "NESSUN_FONDO" ? oracle.exact : "0",
      });
    }),
);
afterAll(async () => {
  await pool.end();
});

it("R66-07 general activity exposes the monthly people measure, not an unnamed secondary series", () => {
  const report = dashboard({
    section: "generale",
    filters: filters(1),
    kpi: [],
    definitions: [],
    series: [{ key: "attivitaPerMeseArea", points: [] }],
  });
  expect(report.series[0]).toMatchObject({
    primary: { label: "eventi", unit: "count" },
    secondary: { label: "personeMese", unit: "count" },
  });
});

it("R66-01 preserves the mixed-fund blocker from the complete canonical event", () =>
  isolated(async (tx) => {
    const f = await fixture(tx);
    await tx
      .insert(movimentiTable)
      .values([f.movement, { ...f.movement, fondoOrigine: "NESSUN_FONDO" }]);
    const canonical = await buildFseCanonicalReport({
      magazzinoId: f.warehouse.id,
      dataDa: period.da,
      dataA: period.a,
      includeArretrati: true,
      excludeCovered: true,
      executor: tx,
    });
    expect(canonical.events).toHaveLength(1);
    expect(canonical.events[0].qualityCodes).toContain("EVENTO_FONDI_MISTI");
    const panel = await fseQueuePanel(
      f.filter,
      sql`mg.id=${f.warehouse.id}`,
      sql`true`,
    );
    expect(
      panel.kpi.find((k) => k.key === "fseEventiQualitaBloccante")?.value,
    ).toBe(1);
    expect(panel.kpi.find((k) => k.key === "fseEventiGenerabili")?.value).toBe(
      0,
    );
  }));

async function household(
  tx: Tx,
  f: Awaited<ReturnType<typeof fixture>>,
  reversed: boolean,
) {
  const [person] = await tx
    .insert(beneficiariTable)
    .values({
      codice: `R${randomUUID().slice(0, 12)}`,
      nome: "Synthetic",
      cognome: "Review",
    })
    .returning();
  const [bolla] = await tx
    .insert(bolleTable)
    .values({
      numeroBolla: `R${randomUUID().slice(0, 20)}`,
      dataBolla: "2026-01-15",
      beneficiarioId: person.id,
      magazzinoId: f.warehouse.id,
      stato: "consegnato",
    })
    .returning();
  const [original] = await tx
    .insert(movimentiTable)
    .values({ ...f.movement, bollaId: bolla.id })
    .returning();
  if (reversed)
    await tx.insert(movimentiTable).values({
      ...f.movement,
      bollaId: bolla.id,
      tipoMovimento: "storno",
      naturaContabile: "STORNO",
      movimentoOrigineId: original.id,
    });
  await tx.insert(fseFascicoliSocialiSnapshotTable).values({
    beneficiarioId: person.id,
    dataRiferimento: "2026-01-01",
    origineSnapshot: "aggiornamento_manuale",
    utenteId: f.user.id,
    versioneProfilo: 1,
    numeroComponenti: 10,
    eta017: 1,
    eta1829: 2,
    eta3064: 3,
    eta65Plus: 4,
    attendibilitaDato: "operatore_verificato",
    hashCanonico: randomUUID().replaceAll("-", "").repeat(2),
  });
  return person;
}
it("R66-02 KPI and every detail page exclude the fully reversed household", () =>
  isolated(async (tx) => {
    const f = await fixture(tx);
    await household(tx, f, true);
    const live = await household(tx, f, false);
    const report = await buildFsePlusReport(f.filter);
    expect(report.kpi.find((k) => k.key === "nucleiRaggiunti")?.value).toBe(1);
    const detail = await buildDrilldown({
      section: "fse-plus",
      metric: "nucleiRaggiunti",
      filters: f.filter,
      page: 1,
      pageSize: 1,
    });
    expect(detail.total).toBe(1);
    expect(detail.rows[0].id).toBe(live.id);
    expect(
      (
        await buildDrilldown({
          section: "fse-plus",
          metric: "nucleiRaggiunti",
          filters: f.filter,
          page: 2,
          pageSize: 1,
        })
      ).rows,
    ).toEqual([]);
  }));
it("R66-04 age-band DTO keys match the consumer columns", () =>
  isolated(async (tx) => {
    const f = await fixture(tx);
    await household(tx, f, false);
    const detail = await buildDrilldown({
      section: "fse-plus",
      metric: "personeRaggiunte",
      filters: f.filter,
      page: 1,
      pageSize: 20,
    });
    expect(detail.rows[0]).toMatchObject({
      eta017: 1,
      eta1829: 2,
      eta3064: 3,
      eta65Plus: 4,
    });
    for (const column of detail.columns)
      expect(Object.hasOwn(detail.rows[0], column)).toBe(true);
  }));
it("R66-05 real SQL quantity survives the logistics DTO without Number rounding", () =>
  isolated(async (tx) => {
    const f = await fixture(tx);
    const amount = "99999999.123456";
    await tx.execute(sql`INSERT INTO lotti(prodotto_id,magazzino_id,codice_lotto,quantita_caricata,quantita_residua,data_carico)
    SELECT ${f.product.id},${f.warehouse.id},'REVIEW-'||i,${amount}::numeric,${amount}::numeric,'2026-01-15' FROM generate_series(1,10001) i`);
    await tx.insert(movimentiTable).values({ ...f.movement, quantita: amount });
    const expected = (
      await tx.execute(
        sql`SELECT sum(quantita_residua)::text AS value FROM lotti WHERE magazzino_id=${f.warehouse.id}`,
      )
    ).rows[0].value;
    const report = await buildLogisticaReport(f.filter);
    expect(
      report.tables.find((t) => t.key === "giacenze")?.rows[0].quantita,
    ).toBe(expected);
    expect(
      report.tables.find((t) => t.key === "causali")?.rows[0].quantita,
    ).toBe(amount);
  }));

it("R66-03 inactive reconciliation history is readable but not an open discrepancy", () =>
  isolated(async (tx) => {
    const f = await fixture(tx);
    const hash = "a".repeat(64);
    const [imp] = await tx
      .insert(importazioniAgeaTable)
      .values({
        magazzinoId: f.warehouse.id,
        nomeFile: "synthetic.xlsx",
        mimeType: "application/octet-stream",
        dimensioneBytes: 1,
        sha256File: hash,
        tracciatoCodice: "TEST",
        parserVersion: "1",
        sheetName: "test",
        dataRiferimento: period.a,
        modalita: "SOLO_ANALISI",
        stato: "CONFERMATA",
        creatoDa: f.user.id,
      })
      .returning();
    const [rec] = await tx
      .insert(riconciliazioniFseTable)
      .values({
        magazzinoId: f.warehouse.id,
        importazioneAgeaId: imp.id,
        dataRiferimento: period.a,
        maxMovimentoId: 0,
        maxOperazioneDistribuzioneId: 0,
        modelVersion: "TEST",
        canonicalHash: hash,
        stato: "DA_RIVEDERE",
        creatoDa: f.user.id,
      })
      .returning();
    const row = {
      riconciliazioneId: rec.id,
      tipoRiga: "MOVIMENTO",
      matchMethod: "TEST",
      contentHash: hash,
    };
    await tx.insert(riconciliazioniFseRigheTable).values([
      {
        ...row,
        businessKey: "current",
        status: "RICONCILIATA_ESATTA",
        blocking: false,
        active: true,
      },
      {
        ...row,
        businessKey: "history",
        status: "SOLO_AGEA",
        blocking: true,
        active: false,
      },
    ]);
    const history = await tx.execute(
      sql`SELECT count(*)::int AS n FROM riconciliazioni_fse_righe WHERE riconciliazione_id=${rec.id} AND blocking`,
    );
    expect(history.rows[0].n).toBe(1); // The old report predicate counts the retained history.
    const report = await buildFsePlusReport(f.filter);
    expect(report.kpi.find((k) => k.key === "scostamentiAperti")?.value).toBe(
      0,
    );
    expect(report.kpi.find((k) => k.key === "righeRiconciliate")?.value).toBe(
      1,
    );
    expect(
      (
        await tx.execute(
          sql`SELECT count(*)::int AS n FROM riconciliazioni_fse_righe WHERE riconciliazione_id=${rec.id}`,
        )
      ).rows[0].n,
    ).toBe(2);
  }));

it.each([
  ["2026-01-31 22:59:00", "2026-01-31"],
  ["2026-01-31 23:01:00", "2026-02-01"],
  ["2026-03-28 23:30:00", "2026-03-29"],
  ["2026-03-29 01:30:00", "2026-03-29"],
  ["2026-03-29 22:30:00", "2026-03-30"],
  ["2026-10-25 00:30:00", "2026-10-25"],
  ["2026-10-25 01:30:00", "2026-10-25"],
  ["2026-10-25 23:30:00", "2026-10-26"],
])(
  "AC-10 UTC timestamp %s uses Rome civil date %s regardless of DB timezone",
  (instant, expected) =>
    isolated(async (tx) => {
      for (const zone of ["UTC", "America/New_York"]) {
        await tx.execute(sql`SELECT set_config('TimeZone', ${zone}, true)`);
        const result = await tx.execute(
          sql`SELECT ${utcTimestampRomeDate(sql`${instant}::timestamp`)}::text AS date`,
        );
        expect(result.rows[0].date).toBe(expected);
      }
    }),
);

it.each([10001, 100000])(
  "R66-08 %i covered historical movements do not consume the report row limit",
  (count) =>
    isolated(async (tx) => {
      const f = await fixture(tx),
        hash = "b".repeat(64);
      const inserted =
        await tx.execute(sql`INSERT INTO movimenti(tipo_movimento,tipo_dettaglio,data_movimento,magazzino_id,prodotto_id,quantita,unita_misura,fondo_origine,natura_contabile)
    SELECT 'scarico','review','2025-01-15',${f.warehouse.id},${f.product.id},1,'pz','FSE_PLUS','SCARTO' FROM generate_series(1,${count}) RETURNING id`);
      const [exp] = await tx
        .insert(esportazioniFseTable)
        .values({
          magazzinoId: f.warehouse.id,
          dataDa: "2025-01-01",
          dataA: "2025-01-31",
          dataAsOf: "2025-01-31",
          formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
          modelVersion: "MAGAZZINO_2_0C_R1_V2",
          stato: "INSERITA_MANUALMENTE",
          maxMovimentoId: Number(inserted.rows.at(-1)!.id),
          maxOperazioneDistribuzioneId: 0,
          canonicalHash: hash,
          idempotencyKey: randomBytes(32).toString("hex"),
          eventiTotali: count,
          righeTotali: count,
          righeBloccanti: 0,
          righeWarning: 0,
          creatoDa: f.user.id,
        })
        .returning();
      // Synthetic coverage fixtures model already certified history, not newly generated administrative exports.
      await tx.execute(sql`INSERT INTO esportazioni_fse_eventi(esportazione_id,event_key,content_hash,source_type,source_id,event_date,status)
    SELECT ${exp.id},'MOVIMENTO:'||id,${hash},'TEST',id,'2025-01-15','SCARTO' FROM movimenti WHERE magazzino_id=${f.warehouse.id}`);
      await tx.execute(sql`INSERT INTO esportazioni_fse_righe(esportazione_evento_id,line_key,content_hash,movimento_id,accounting_nature,fund,product_id,product_code_snapshot,product_name_snapshot,unit_snapshot,source_lineage_json,reporting_disposition)
    SELECT e.id,e.event_key,${hash},e.source_id,'SCARTO','FSE_PLUS',${f.product.id},'TEST','Synthetic','pz','{}'::jsonb,'SCARTO' FROM esportazioni_fse_eventi e WHERE e.esportazione_id=${exp.id}`);
      // These bulk fixtures deliberately remain uncommitted for rollback.
      // Autovacuum/ANALYZE on another connection cannot see them and may record
      // empty-table statistics while their pages already exist. Analyze in the
      // owning transaction, before timing, to measure the populated workload
      // rather than that setup race. No planner switches or indexes are changed.
      await tx.execute(sql`ANALYZE movimenti, esportazioni_fse,
        esportazioni_fse_eventi, esportazioni_fse_righe`);
      const populated = await tx.execute(sql`
        SELECT count(*)::int AS n FROM movimenti
        WHERE magazzino_id=${f.warehouse.id}`);
      expect(populated.rows[0].n).toBe(count);
      const start = performance.now();
      const panel = await fseQueuePanel(
        f.filter,
        sql`mg.id=${f.warehouse.id}`,
        sql`true`,
      );
      console.info(
        JSON.stringify({
          case: "R66-08",
          movements: count,
          ms: performance.now() - start,
          heapBytes: process.memoryUsage().heapUsed,
        }),
      );
      expect(panel.kpi.map((k) => k.value)).toEqual([0, 0, 0, 0]);
      await tx.execute(
        sql`UPDATE operazioni_distribuzione_magazzino SET data_distribuzione='2025-12-15' WHERE id=${f.op.id}`,
      );
      await tx
        .insert(movimentiTable)
        .values({ ...f.movement, dataMovimento: "2025-12-15" });
      const pendingStart = performance.now();
      const backlog = await fseQueuePanel(
        f.filter,
        sql`mg.id=${f.warehouse.id}`,
        sql`true`,
      );
      expect(
        backlog.kpi.find((k) => k.key === "fseEventiDaValutare")?.value,
      ).toBe(1);
      expect(
        backlog.kpi.find((k) => k.key === "fseGenerabiliArretrati")?.value,
      ).toBe(1);
      const pendingMs = performance.now() - pendingStart;
      const reportStart = performance.now();
      const report = await buildFsePlusReport(f.filter);
      const reportMs = performance.now() - reportStart;
      expect(
        report.kpi.find((k) => k.key === "fseEventiDaValutare")?.value,
      ).toBe(1);
      expect(reportMs).toBeLessThan(30000); // Same bound as server-side report preparation.
      console.info(
        JSON.stringify({
          case: "R66-08-pending",
          movements: count,
          pendingMs,
          reportMs,
          heapBytes: process.memoryUsage().heapUsed,
        }),
      );
    }),
  120000,
);
