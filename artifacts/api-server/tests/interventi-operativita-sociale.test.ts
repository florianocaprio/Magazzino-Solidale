import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  beneficiariTable,
  centriAscoltoTable,
  areeOperativeTable,
  db,
  interventiMaterialiTable,
  interventiStoricoStatiTable,
  interventiTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  pool,
  prodottiTable,
  scarichiTable,
  scaricoRigheTable,
  tipiInterventoTable,
  utentiTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";

const rnd = () => Math.random().toString(36).slice(2, 10);
const ids = {
  areaOperativa: [] as number[],
  centri: [] as number[],
  beneficiari: [] as number[],
  utenti: [] as number[],
  interventi: [] as number[],
  prodotti: [] as number[],
  magazzini: [] as number[],
  lotti: [] as number[],
  tipi: [] as number[],
};

let roma: number;
let milano: number;
let centroRoma: number;
let centroMilano: number;
let operatoreRoma: number;
let assegnatoRoma: number;
let operatoreMilano: number;
let beneficiarioRoma: number;
let beneficiarioMilano: number;
let prodottoId: number;
let magazzinoId: number;
let tipologiaId: number;

function makeApp(
  options: {
    userId?: number;
    areaOperativaId?: number;
    centroId?: number;
    aree?: string[];
  } = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          areaOperativaId: number;
          centroAscoltoId: number;
          zonaUdsId: null;
          aree: string[];
          permessi: string[];
          isAdmin: boolean;
          isSuperAdmin: boolean;
        };
      }
    ).user = {
      id: options.userId ?? operatoreRoma,
      areaOperativaId: options.areaOperativaId ?? roma,
      centroAscoltoId: options.centroId ?? centroRoma,
      zonaUdsId: null,
      aree: options.aree ?? ["sociale"],
      permessi: [
        "sociale.interventi.view",
        "sociale.interventi.create",
        "sociale.interventi.update",
        "sociale.interventi.complete",
        "sociale.interventi.cancel",
      ],
      isAdmin: false,
      isSuperAdmin: false,
    };
    next();
  });
  app.use(interventiRouter);
  return app;
}

async function createIntervento(input: {
  stato: string;
  beneficiarioId?: number;
  operatoreId?: number;
  ambito?: string;
  pianificata?: Date | null;
  avvio?: Date | null;
  risultato?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId: input.beneficiarioId ?? beneficiarioRoma,
      operatoreId: input.operatoreId ?? assegnatoRoma,
      tipoIntervento: `Operativo ${rnd()}`,
      stato: input.stato,
      ambito: input.ambito ?? "sociale",
      priorita: "normale",
      dataOraPianificata: input.pianificata ?? null,
      dataOraAvvio: input.avvio ?? null,
      risultato: input.risultato ?? null,
      dataAggiornamento: new Date(),
    } as never)
    .returning({ id: interventiTable.id });
  ids.interventi.push(row.id);
  return row.id;
}

async function versioneIntervento(id: number): Promise<string> {
  const [row] = await db
    .select({ versione: interventiTable.dataAggiornamento })
    .from(interventiTable)
    .where(eq(interventiTable.id, id));
  if (!row?.versione) throw new Error("Versione intervento non disponibile");
  return row.versione.toISOString();
}

beforeAll(async () => {
  const areeOperative = await db
    .insert(areeOperativeTable)
    .values([{ nome: `Roma 53CD ${rnd()}` }, { nome: `Milano 53CD ${rnd()}` }])
    .returning({ id: areeOperativeTable.id });
  [roma, milano] = areeOperative.map((row) => row.id);
  ids.areaOperativa.push(roma, milano);
  const centers = await db
    .insert(centriAscoltoTable)
    .values([
      { nome: `Centro Roma ${rnd()}`, areaOperativaId: roma },
      { nome: `Centro Milano ${rnd()}`, areaOperativaId: milano },
    ])
    .returning({ id: centriAscoltoTable.id });
  [centroRoma, centroMilano] = centers.map((row) => row.id);
  ids.centri.push(centroRoma, centroMilano);
  const users = await db
    .insert(utentiTable)
    .values([
      {
        username: `op53cd_${rnd()}`,
        passwordHash: "test",
        nome: "Operatore Effettivo",
        attivo: true,
        areaOperativaId: roma,
        centroAscoltoId: centroRoma,
      },
      {
        username: `assigned53cd_${rnd()}`,
        passwordHash: "test",
        nome: "Operatore Assegnato",
        attivo: true,
        areaOperativaId: roma,
        centroAscoltoId: centroRoma,
      },
      {
        username: `milan53cd_${rnd()}`,
        passwordHash: "test",
        nome: "Operatore Milano",
        attivo: true,
        areaOperativaId: milano,
        centroAscoltoId: centroMilano,
      },
    ])
    .returning({ id: utentiTable.id });
  [operatoreRoma, assegnatoRoma, operatoreMilano] = users.map((row) => row.id);
  ids.utenti.push(...users.map((row) => row.id));
  const beneficiaries = await db
    .insert(beneficiariTable)
    .values([
      {
        codice: `BEN53CD-${rnd()}`,
        nome: "Mario",
        cognome: "Roma",
        sesso: "M",
        areaOperativaId: roma,
        centroAscoltoId: centroRoma,
      },
      {
        codice: `BEN53CD-${rnd()}`,
        nome: "Marta",
        cognome: "Milano",
        sesso: "F",
        areaOperativaId: milano,
        centroAscoltoId: centroMilano,
      },
    ])
    .returning({ id: beneficiariTable.id });
  [beneficiarioRoma, beneficiarioMilano] = beneficiaries.map((row) => row.id);
  ids.beneficiari.push(beneficiarioRoma, beneficiarioMilano);
  const [product] = await db
    .insert(prodottiTable)
    .values({
      codice: `P53CD-${rnd()}`,
      nome: "Kit igiene",
      tipoProdotto: "igiene",
      unitaMisura: "kit",
    })
    .returning({ id: prodottiTable.id });
  prodottoId = product.id;
  ids.prodotti.push(product.id);
  const [warehouse] = await db
    .insert(magazziniTable)
    .values({
      codice: `M53CD-${rnd()}`,
      nome: "Magazzino Sociale",
      areaOperativaId: roma,
    })
    .returning({ id: magazziniTable.id });
  magazzinoId = warehouse.id;
  ids.magazzini.push(warehouse.id);
  const [lotto] = await db
    .insert(lottiTable)
    .values({
      prodottoId,
      dataCarico: "2026-08-01",
      quantitaCaricata: "20",
      quantitaResidua: "20",
      magazzinoId,
    })
    .returning({ id: lottiTable.id });
  ids.lotti.push(lotto.id);
  const [type] = await db
    .insert(tipiInterventoTable)
    .values({ nome: `Colloquio 53CD ${rnd()}` })
    .returning({ id: tipiInterventoTable.id });
  tipologiaId = type.id;
  ids.tipi.push(type.id);
});

afterAll(async () => {
  if (ids.interventi.length > 0) {
    await db
      .delete(interventiTable)
      .where(inArray(interventiTable.id, ids.interventi));
  }
  if (ids.prodotti.length > 0) {
    await db
      .delete(movimentiTable)
      .where(inArray(movimentiTable.prodottoId, ids.prodotti));
  }
  if (ids.magazzini.length > 0) {
    const scarichi = await db
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(inArray(scarichiTable.magazzinoId, ids.magazzini));
    if (scarichi.length > 0) {
      await db.delete(scaricoRigheTable).where(
        inArray(
          scaricoRigheTable.scaricoId,
          scarichi.map((row) => row.id),
        ),
      );
      await db.delete(scarichiTable).where(
        inArray(
          scarichiTable.id,
          scarichi.map((row) => row.id),
        ),
      );
    }
  }
  if (ids.lotti.length > 0)
    await db.delete(lottiTable).where(inArray(lottiTable.id, ids.lotti));
  if (ids.prodotti.length > 0)
    await db
      .delete(prodottiTable)
      .where(inArray(prodottiTable.id, ids.prodotti));
  if (ids.magazzini.length > 0)
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, ids.magazzini));
  if (ids.tipi.length > 0)
    await db
      .delete(tipiInterventoTable)
      .where(inArray(tipiInterventoTable.id, ids.tipi));
  await db
    .delete(beneficiariTable)
    .where(inArray(beneficiariTable.id, ids.beneficiari));
  await db.delete(utentiTable).where(inArray(utentiTable.id, ids.utenti));
  await db
    .delete(centriAscoltoTable)
    .where(inArray(centriAscoltoTable.id, ids.centri));
  await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, ids.areaOperativa));
  await pool.end();
});

describe("gestione operativa degli interventi Sociali", () => {
  describe.each([
    {
      nome: "avvia",
      percorso: "avvia",
      stato: "pianificato",
      body: {},
    },
    {
      nome: "salva operatività",
      percorso: "salva-operativita",
      stato: "in_corso",
      body: {},
    },
    {
      nome: "concludi",
      percorso: "concludi",
      stato: "in_corso",
      body: { conferma: true, risultato: "Concluso" },
    },
    {
      nome: "annulla",
      percorso: "annulla",
      stato: "da_pianificare",
      body: { motivo: "Richiesta del beneficiario" },
    },
    {
      nome: "mancata presentazione",
      percorso: "mancata-presentazione",
      stato: "pianificato",
      body: { nota: "Non presente" },
    },
  ])("versione obbligatoria per $nome", ({ percorso, stato, body }) => {
    async function interventoPerEndpoint(): Promise<number> {
      return createIntervento({
        stato,
        pianificata:
          stato === "pianificato" ? new Date("2026-08-20T08:00:00Z") : null,
        avvio: stato === "in_corso" ? new Date("2026-08-20T08:00:00Z") : null,
      });
    }

    it.each([
      { caso: "mancante", versione: undefined },
      { caso: "null", versione: null },
      { caso: "malformata", versione: "non-un-timestamp" },
    ])("restituisce 400 con versione $caso", async ({ versione }) => {
      const id = await interventoPerEndpoint();
      const payload = versione === undefined ? body : { ...body, versione };
      const response = await request(makeApp())
        .post(`/interventi/${id}/${percorso}`)
        .send(payload);
      expect(response.status).toBe(400);
      expect(response.body.error.toLowerCase()).toContain("versione");
    });

    it("restituisce 409 con una versione valida ma superata", async () => {
      const id = await interventoPerEndpoint();
      const corrente = await versioneIntervento(id);
      const superata = new Date(
        new Date(corrente).getTime() - 1_000,
      ).toISOString();
      const response = await request(makeApp())
        .post(`/interventi/${id}/${percorso}`)
        .send({ ...body, versione: superata });
      expect(response.status).toBe(409);
      expect(response.body.error).toContain("modificato da un altro operatore");
    });
  });

  it("avvia una sola volta da pianificato e distingue operatore assegnato ed effettivo", async () => {
    const id = await createIntervento({
      stato: "pianificato",
      pianificata: new Date("2026-08-20T08:00:00Z"),
    });
    const app = makeApp();
    const versione = await versioneIntervento(id);
    const [first, second] = await Promise.all([
      request(app).post(`/interventi/${id}/avvia`).send({ versione }),
      request(app).post(`/interventi/${id}/avvia`).send({ versione }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const [row] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, id));
    expect(row.stato).toBe("in_corso");
    expect(row.dataOraAvvio).toBeInstanceOf(Date);
    expect(row.operatoreId).toBe(assegnatoRoma);
    const history = await db
      .select()
      .from(interventiStoricoStatiTable)
      .where(eq(interventiStoricoStatiTable.interventoId, id));
    expect(history).toHaveLength(1);
    expect(history[0].operatoreId).toBe(operatoreRoma);
  });

  it("avvia un accesso non programmato senza inventare la pianificazione", async () => {
    const id = await createIntervento({ stato: "da_pianificare" });
    const response = await request(makeApp())
      .post(`/interventi/${id}/avvia`)
      .send({
        versione: await versioneIntervento(id),
        dataOraAvvio: "2026-08-20T08:05:00Z",
      });
    expect(response.status).toBe(200);
    expect(response.body.stato).toBe("in_corso");
    expect(response.body.dataOraPianificata).toBeNull();
    expect(response.body.dataIntervento).toBe("2026-08-20");
  });

  it("salva atomicamente più attività, materiali, documenti e quantità effettive", async () => {
    const id = await createIntervento({
      stato: "in_corso",
      avvio: new Date("2026-08-20T08:00:00Z"),
    });
    const response = await request(makeApp())
      .post(`/interventi/${id}/salva-operativita`)
      .send({
        versione: await versioneIntervento(id),
        risultato: "In lavorazione",
        esito: "Parziale",
        note: "Nota salvata",
        attivita: [
          {
            tipologiaId,
            descrizione: "Colloquio sociale",
            risultato: "Presa in carico",
          },
          {
            tipologiaSnapshot: "Orientamento",
            descrizione: "Orientamento ai servizi",
          },
        ],
        materiali: [
          {
            prodottoId,
            quantitaPrevista: 2,
            quantitaConsegnata: 1,
            statoPreparazione: "pronto",
            magazzinoId,
          },
          {
            descrizioneSnapshot: "Coperta",
            unitaMisuraSnapshot: "pz",
            quantitaPrevista: 0,
            quantitaConsegnata: 1,
            statoPreparazione: "consegnato",
          },
        ],
        documenti: [
          { tipoDescrizione: "ISEE", stato: "da_verificare" },
          {
            tipoDescrizione: "Documento identità",
            stato: "verificato",
            dataScadenza: "2028-08-20",
          },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body.attivita).toHaveLength(2);
    expect(response.body.materiali).toHaveLength(2);
    expect(response.body.materiali[0]).toMatchObject({
      descrizioneSnapshot: "Kit igiene",
      unitaMisuraSnapshot: "kit",
      quantitaPrevista: 2,
      quantitaConsegnata: 1,
    });
    expect(
      response.body.documenti.map((item: { stato: string }) => item.stato),
    ).toEqual(["da_verificare", "verificato"]);

    const invalid = await request(makeApp())
      .post(`/interventi/${id}/salva-operativita`)
      .send({
        versione: response.body.versione,
        materiali: [
          {
            descrizioneSnapshot: "Errore",
            unitaMisuraSnapshot: "pz",
            quantitaPrevista: -1,
          },
        ],
      });
    expect(invalid.status).toBe(400);
    const materials = await db
      .select()
      .from(interventiMaterialiTable)
      .where(eq(interventiMaterialiTable.interventoId, id));
    expect(materials).toHaveLength(2);
  });

  it("non distribuisce materiali Sociali quando il prodotto ha soltanto lotti scaduti", async () => {
    const [prodottoScaduto] = await db
      .insert(prodottiTable)
      .values({
        codice: `P53CD-SCAD-${rnd()}`,
        nome: "Prodotto scaduto",
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
      })
      .returning({ id: prodottiTable.id });
    ids.prodotti.push(prodottoScaduto.id);
    const [lottoScaduto] = await db
      .insert(lottiTable)
      .values({
        prodottoId: prodottoScaduto.id,
        dataCarico: "2000-01-01",
        dataScadenza: "2000-01-02",
        quantitaCaricata: "5",
        quantitaResidua: "5",
        magazzinoId,
      })
      .returning({ id: lottiTable.id });
    ids.lotti.push(lottoScaduto.id);
    const id = await createIntervento({ stato: "in_corso", avvio: new Date() });

    const response = await request(makeApp())
      .post(`/interventi/${id}/salva-operativita`)
      .send({
        versione: await versioneIntervento(id),
        materiali: [
          {
            prodottoId: prodottoScaduto.id,
            quantitaPrevista: 1,
            quantitaConsegnata: 1,
            statoPreparazione: "consegnato",
            magazzinoId,
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/disponibilità insufficiente/i);
    const [lottoDopo] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoScaduto.id));
    expect(lottoDopo.quantitaResidua).toBe("5.00");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.prodottoId, prodottoScaduto.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(interventiMaterialiTable)
        .where(eq(interventiMaterialiTable.interventoId, id)),
    ).toHaveLength(0);
  });

  it("conclude una sola volta e crea il successivo nella stessa transazione", async () => {
    const id = await createIntervento({
      stato: "in_corso",
      avvio: new Date("2026-08-20T08:00:00Z"),
    });
    const invalid = await request(makeApp())
      .post(`/interventi/${id}/concludi`)
      .send({ conferma: true, versione: await versioneIntervento(id) });
    expect(invalid.status).toBe(400);

    const response = await request(makeApp())
      .post(`/interventi/${id}/concludi`)
      .send({
        versione: await versioneIntervento(id),
        conferma: true,
        dataOraConclusione: "2026-08-20T09:00:00Z",
        risultato: "Obiettivo raggiunto",
        attivita: [
          {
            tipologiaSnapshot: "Colloquio",
            descrizione: "Colloquio conclusivo",
          },
        ],
        successivo: {
          tipoIntervento: "Follow-up",
          stato: "pianificato",
          ambito: "sociale",
          priorita: "alta",
          dataOraPianificata: "2026-08-27T08:00:00Z",
          operatoreId: operatoreRoma,
          materiali: [
            {
              descrizioneSnapshot: "Kit follow-up",
              unitaMisuraSnapshot: "kit",
              quantitaPrevista: 1,
            },
          ],
          documenti: [
            { tipoDescrizione: "ISEE aggiornato", stato: "da_acquisire" },
          ],
        },
      });
    expect(response.status).toBe(200);
    expect(response.body.intervento.stato).toBe("concluso");
    expect(response.body.successivo).toMatchObject({
      beneficiarioId: beneficiarioRoma,
      interventoPrecedenteId: id,
      stato: "pianificato",
    });
    ids.interventi.push(response.body.successivo.id);
    const second = await request(makeApp())
      .post(`/interventi/${id}/concludi`)
      .send({
        conferma: true,
        risultato: "Duplicato",
        versione: response.body.operativita.versione,
      });
    expect(second.status).toBe(409);
    const immutable = await request(makeApp())
      .post(`/interventi/${id}/salva-operativita`)
      .send({
        risultato: "Alterazione",
        versione: response.body.operativita.versione,
      });
    expect(immutable.status).toBe(409);
  });

  it("annulla con motivo e registra la mancata presentazione senza falso avvio", async () => {
    const cancellabile = await createIntervento({ stato: "da_pianificare" });
    const missingReason = await request(makeApp())
      .post(`/interventi/${cancellabile}/annulla`)
      .send({ versione: await versioneIntervento(cancellabile) });
    expect(missingReason.status).toBe(400);
    const cancelled = await request(makeApp())
      .post(`/interventi/${cancellabile}/annulla`)
      .send({
        versione: await versioneIntervento(cancellabile),
        motivo: "Richiesta del beneficiario",
      });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.motivoAnnullamento).toBe(
      "Richiesta del beneficiario",
    );

    const planned = await createIntervento({
      stato: "pianificato",
      pianificata: new Date("2026-08-20T08:00:00Z"),
    });
    const noShow = await request(makeApp())
      .post(`/interventi/${planned}/mancata-presentazione`)
      .send({
        versione: await versioneIntervento(planned),
        nota: "Non si è presentato",
      });
    expect(noShow.status).toBe(200);
    expect(noShow.body.stato).toBe("mancata_presentazione");
    expect(noShow.body.dataOraAvvio).toBeNull();
  });

  it("rifiuta conclusioni precedenti all'avvio e rollback del successivo non valido", async () => {
    const id = await createIntervento({
      stato: "in_corso",
      avvio: new Date("2026-08-20T10:00:00Z"),
    });
    const earlier = await request(makeApp())
      .post(`/interventi/${id}/concludi`)
      .send({
        versione: await versioneIntervento(id),
        conferma: true,
        risultato: "Non valido",
        dataOraConclusione: "2026-08-20T09:00:00Z",
      });
    expect(earlier.status).toBe(400);
    const invalidNext = await request(makeApp())
      .post(`/interventi/${id}/concludi`)
      .send({
        versione: await versioneIntervento(id),
        conferma: true,
        risultato: "Non deve restare concluso",
        successivo: {
          tipoIntervento: "Follow-up",
          stato: "pianificato",
          ambito: "sociale",
        },
      });
    expect(invalidNext.status).toBe(400);
    const [row] = await db
      .select({ stato: interventiTable.stato })
      .from(interventiTable)
      .where(eq(interventiTable.id, id));
    expect(row.stato).toBe("in_corso");
  });

  it("isola area operativa, centro e ambito UDS anche sugli ID operativi", async () => {
    const romaId = await createIntervento({ stato: "da_pianificare" });
    const milanoApp = makeApp({
      userId: operatoreMilano,
      areaOperativaId: milano,
      centroId: centroMilano,
    });
    expect(
      (await request(milanoApp).get(`/interventi/${romaId}/operativita`))
        .status,
    ).toBe(403);
    expect(
      (
        await request(milanoApp)
          .post(`/interventi/${romaId}/salva-operativita`)
          .send({ materiali: [] })
      ).status,
    ).toBe(403);
    const udsId = await createIntervento({
      stato: "da_pianificare",
      ambito: "uds",
    });
    expect(
      (await request(makeApp()).get(`/interventi/${udsId}/operativita`)).status,
    ).toBe(403);
    const milanoId = await createIntervento({
      stato: "da_pianificare",
      beneficiarioId: beneficiarioMilano,
      operatoreId: operatoreMilano,
    });
    expect(
      (await request(makeApp()).post(`/interventi/${milanoId}/avvia`).send({}))
        .status,
    ).toBe(403);
  });
});
