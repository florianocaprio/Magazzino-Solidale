import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
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
  utentiTable,
} from "@workspace/db";
import { eq, inArray, sum } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";

const rnd = () => Math.random().toString(36).slice(2, 10);
const ALL_SOCIAL_PERMISSIONS = [
  "sociale.interventi.view",
  "sociale.interventi.create",
  "sociale.interventi.update",
  "sociale.interventi.complete",
  "sociale.interventi.cancel",
];
const ids = {
  citta: [] as number[],
  centri: [] as number[],
  beneficiari: [] as number[],
  utenti: [] as number[],
  interventi: [] as number[],
  prodotti: [] as number[],
  magazzini: [] as number[],
  lotti: [] as number[],
};

let areaA: number;
let areaB: number;
let centroA: number;
let centroB: number;
let beneficiarioA: number;
let beneficiarioAreaNull: number;
let beneficiarioCentroNull: number;
let beneficiarioUds: number;
let operatoreId: number;
let prodottoId: number;
let magazzinoA: number;
let magazzinoB: number;
let magazzinoCentroB: number;
let magazzinoInattivo: number;

function app(
  options: {
    cittaId?: number | null;
    centroId?: number | null;
    aree?: string[];
    permessi?: string[];
    isAdmin?: boolean;
  } = {},
): Express {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    (req as unknown as { user: Record<string, unknown> }).user = {
      id: operatoreId,
      cittaId: options.cittaId === undefined ? areaA : options.cittaId,
      centroAscoltoId:
        options.centroId === undefined ? centroA : options.centroId,
      zonaUdsId: null,
      aree: options.aree ?? ["sociale"],
      permessi: options.permessi ?? ALL_SOCIAL_PERMISSIONS,
      isAdmin: options.isAdmin ?? false,
      isSuperAdmin: false,
    };
    next();
  });
  server.use(interventiRouter);
  return server;
}

async function createIntervento(
  input: {
    beneficiarioId?: number;
    ambito?: "sociale" | "uds" | null;
    stato?: string;
    note?: string;
    descrizione?: string;
  } = {},
) {
  const now = new Date();
  const [row] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId: input.beneficiarioId ?? beneficiarioA,
      tipoIntervento: `Audit CDA ${rnd()}`,
      ambito: input.ambito === undefined ? "sociale" : input.ambito,
      stato: input.stato ?? "da_pianificare",
      descrizione: input.descrizione ?? "Descrizione sociale riservata",
      note: input.note ?? "Nota sociale riservata",
      dataOraAvvio:
        input.stato === "in_corso" ? new Date(now.getTime() - 60_000) : null,
      dataOraPianificata: input.stato === "pianificato" ? now : null,
      dataAggiornamento: now,
    } as never)
    .returning();
  ids.interventi.push(row.id);
  return row;
}

async function versione(id: number): Promise<string> {
  const [row] = await db
    .select({ value: interventiTable.dataAggiornamento })
    .from(interventiTable)
    .where(eq(interventiTable.id, id));
  if (!row?.value) throw new Error("Versione assente");
  return row.value.toISOString();
}

async function totaleMovimenti(interventoId: number): Promise<number> {
  const [row] = await db
    .select({ totale: sum(movimentiTable.quantita) })
    .from(movimentiTable)
    .where(
      eq(movimentiTable.documentoRiferimento, `INTERVENTO-${interventoId}`),
    );
  return Number(row?.totale ?? 0);
}

beforeAll(async () => {
  const aree = await db
    .insert(cittaTable)
    .values([
      { nome: `Area Audit A ${rnd()}` },
      { nome: `Area Audit B ${rnd()}` },
    ])
    .returning({ id: cittaTable.id });
  [areaA, areaB] = aree.map((row) => row.id);
  ids.citta.push(areaA, areaB);
  const centri = await db
    .insert(centriAscoltoTable)
    .values([
      { nome: `Centro Audit A ${rnd()}`, cittaId: areaA },
      { nome: `Centro Audit B ${rnd()}`, cittaId: areaB },
    ])
    .returning({ id: centriAscoltoTable.id });
  [centroA, centroB] = centri.map((row) => row.id);
  ids.centri.push(centroA, centroB);
  const [utente] = await db
    .insert(utentiTable)
    .values({
      username: `audit_cda_${rnd()}`,
      passwordHash: "test",
      nome: "Operatore Audit",
      attivo: true,
      cittaId: areaA,
      centroAscoltoId: centroA,
    })
    .returning({ id: utentiTable.id });
  operatoreId = utente.id;
  ids.utenti.push(utente.id);
  const persone = await db
    .insert(beneficiariTable)
    .values([
      {
        codice: `CDA-A-${rnd()}`,
        nome: "Persona",
        cognome: "Area A",
        sesso: "F",
        cittaId: areaA,
        centroAscoltoId: centroA,
      },
      {
        codice: `CDA-NULL-A-${rnd()}`,
        nome: "Persona",
        cognome: "Area Null",
        sesso: "F",
        cittaId: null,
        centroAscoltoId: centroA,
      },
      {
        codice: `CDA-NULL-C-${rnd()}`,
        nome: "Persona",
        cognome: "Centro Null",
        sesso: "M",
        cittaId: areaA,
        centroAscoltoId: null,
      },
      {
        codice: `CDA-UDS-${rnd()}`,
        nome: "Persona",
        cognome: "UDS",
        sesso: "M",
        cittaId: areaA,
        centroAscoltoId: centroA,
        uds: true,
      },
    ])
    .returning({ id: beneficiariTable.id });
  [
    beneficiarioA,
    beneficiarioAreaNull,
    beneficiarioCentroNull,
    beneficiarioUds,
  ] = persone.map((row) => row.id);
  ids.beneficiari.push(...persone.map((row) => row.id));
  const [prodotto] = await db
    .insert(prodottiTable)
    .values({
      codice: `CDA-P-${rnd()}`,
      nome: "Prodotto Audit",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
    })
    .returning({ id: prodottiTable.id });
  prodottoId = prodotto.id;
  ids.prodotti.push(prodotto.id);
  const magazzini = await db
    .insert(magazziniTable)
    .values([
      { codice: `CDA-MA-${rnd()}`, nome: "Magazzino A", cittaId: areaA },
      { codice: `CDA-MB-${rnd()}`, nome: "Magazzino B", cittaId: areaB },
      {
        codice: `CDA-MCB-${rnd()}`,
        nome: "Magazzino Centro B",
        cittaId: areaA,
        centroAscoltoId: centroB,
      },
      {
        codice: `CDA-MI-${rnd()}`,
        nome: "Magazzino inattivo",
        cittaId: areaA,
        stato: "inattivo",
      },
    ])
    .returning({ id: magazziniTable.id });
  [magazzinoA, magazzinoB, magazzinoCentroB, magazzinoInattivo] = magazzini.map(
    (row) => row.id,
  );
  ids.magazzini.push(...magazzini.map((row) => row.id));
  const [lotto] = await db
    .insert(lottiTable)
    .values({
      prodottoId,
      dataCarico: "2026-08-01",
      quantitaCaricata: "20",
      quantitaResidua: "20",
      magazzinoId: magazzinoA,
    })
    .returning({ id: lottiTable.id });
  ids.lotti.push(lotto.id);
});

afterAll(async () => {
  if (ids.interventi.length) {
    await db.delete(movimentiTable).where(
      inArray(
        movimentiTable.documentoRiferimento,
        ids.interventi.map((id) => `INTERVENTO-${id}`),
      ),
    );
    const scarichi = await db
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(inArray(scarichiTable.magazzinoId, ids.magazzini));
    if (scarichi.length) {
      const scaricoIds = scarichi.map((row) => row.id);
      await db
        .delete(scaricoRigheTable)
        .where(inArray(scaricoRigheTable.scaricoId, scaricoIds));
      await db
        .delete(scarichiTable)
        .where(inArray(scarichiTable.id, scaricoIds));
    }
    await db
      .delete(interventiStoricoStatiTable)
      .where(inArray(interventiStoricoStatiTable.interventoId, ids.interventi));
    await db
      .delete(interventiMaterialiTable)
      .where(inArray(interventiMaterialiTable.interventoId, ids.interventi));
    await db
      .delete(interventiTable)
      .where(inArray(interventiTable.id, ids.interventi));
  }
  if (ids.lotti.length)
    await db.delete(lottiTable).where(inArray(lottiTable.id, ids.lotti));
  await db.delete(prodottiTable).where(inArray(prodottiTable.id, ids.prodotti));
  await db
    .delete(magazziniTable)
    .where(inArray(magazziniTable.id, ids.magazzini));
  await db
    .delete(beneficiariTable)
    .where(inArray(beneficiariTable.id, ids.beneficiari));
  await db.delete(utentiTable).where(inArray(utentiTable.id, ids.utenti));
  await db
    .delete(centriAscoltoTable)
    .where(inArray(centriAscoltoTable.id, ids.centri));
  await db.delete(cittaTable).where(inArray(cittaTable.id, ids.citta));
  await pool.end();
});

describe("audit hardening Centro di Ascolto", () => {
  it("applica le cinque permission Sociali server-side", async () => {
    const row = await createIntervento({ stato: "pianificato" });
    expect(
      (
        await request(app({ permessi: [] }))
          .get("/interventi")
          .query({ ambito: "sociale" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app({ permessi: ["sociale.interventi.view"] }))
          .post("/interventi")
          .send({
            beneficiarioId: beneficiarioA,
            tipoIntervento: "Negato",
            ambito: "sociale",
            stato: "da_pianificare",
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app({ permessi: ["sociale.interventi.view"] }))
          .patch(`/interventi/${row.id}`)
          .send({ versione: await versione(row.id), priorita: "alta" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app({ permessi: ["sociale.interventi.view"] }))
          .post(`/interventi/${row.id}/avvia`)
          .send({ versione: await versione(row.id) })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app({ permessi: ["sociale.interventi.view"] }))
          .post(`/interventi/${row.id}/annulla`)
          .send({ versione: await versione(row.id), motivo: "Negato" })
      ).status,
    ).toBe(403);
  });

  it("non rende shared le cartelle Sociali con Area o Centro NULL", async () => {
    const areaNull = await createIntervento({
      beneficiarioId: beneficiarioAreaNull,
    });
    const centroNull = await createIntervento({
      beneficiarioId: beneficiarioCentroNull,
    });
    const scoped = app();
    expect(
      (await request(scoped).get(`/interventi/${areaNull.id}`)).status,
    ).toBe(403);
    expect(
      (await request(scoped).get(`/interventi/${centroNull.id}`)).status,
    ).toBe(403);
    const list = await request(scoped)
      .get("/interventi")
      .query({ ambito: "sociale" });
    expect(list.body.map((row: { id: number }) => row.id)).not.toContain(
      areaNull.id,
    );
    expect(list.body.map((row: { id: number }) => row.id)).not.toContain(
      centroNull.id,
    );
    const global = app({
      cittaId: null,
      centroId: null,
      isAdmin: true,
      permessi: [],
    });
    expect(
      (await request(global).get(`/interventi/${areaNull.id}`)).status,
    ).toBe(200);
    expect(
      (await request(global).get(`/interventi/${centroNull.id}`)).status,
    ).toBe(200);
  });

  it("mantiene operativo UDS senza permission Sociali e senza accesso al Sociale", async () => {
    const uds = await createIntervento({
      beneficiarioId: beneficiarioUds,
      ambito: "uds",
    });
    const social = await createIntervento();
    const udsApp = app({
      cittaId: areaA,
      centroId: null,
      aree: ["uds"],
      permessi: [],
    });
    expect(
      (await request(udsApp).get("/interventi").query({ ambito: "uds" }))
        .status,
    ).toBe(200);
    expect((await request(udsApp).get(`/interventi/${uds.id}`)).status).toBe(
      200,
    );
    expect((await request(udsApp).get(`/interventi/${social.id}`)).status).toBe(
      403,
    );
  });

  it("rende i terminali immutabili e richiede una versione valida al PATCH", async () => {
    const active = await createIntervento();
    for (const payload of [
      { priorita: "alta" },
      { versione: null, priorita: "alta" },
      { versione: "malformata", priorita: "alta" },
    ]) {
      expect(
        (await request(app()).patch(`/interventi/${active.id}`).send(payload))
          .status,
      ).toBe(400);
    }
    const current = await versione(active.id);
    expect(
      (
        await request(app())
          .patch(`/interventi/${active.id}`)
          .send({
            versione: new Date(
              new Date(current).getTime() - 1_000,
            ).toISOString(),
            priorita: "alta",
          })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app()).patch(`/interventi/${active.id}`).send({
          versione: current,
          priorita: "alta",
        })
      ).status,
    ).toBe(200);

    for (const stato of ["concluso", "annullato", "mancata_presentazione"]) {
      const terminale = await createIntervento({ stato });
      expect(
        (
          await request(app())
            .patch(`/interventi/${terminale.id}`)
            .send({
              versione: await versione(terminale.id),
              risultato: "Alterazione",
            })
        ).status,
      ).toBe(409);
    }
  });

  it("richiede una versione valida su ogni comando di workflow", async () => {
    const commands = [
      {
        stato: "pianificato",
        path: "avvia",
        body: {},
      },
      {
        stato: "in_corso",
        path: "salva-operativita",
        body: { materiali: [] },
      },
      {
        stato: "in_corso",
        path: "concludi",
        body: {
          conferma: true,
          risultato: "Completato",
          dataOraConclusione: new Date().toISOString(),
        },
      },
      {
        stato: "da_pianificare",
        path: "annulla",
        body: { motivo: "Richiesta di test" },
      },
      {
        stato: "pianificato",
        path: "mancata-presentazione",
        body: { nota: "Assente" },
      },
      {
        stato: "pianificato",
        path: "transizioni",
        body: { stato: "in_corso" },
      },
    ];

    for (const command of commands) {
      const row = await createIntervento({ stato: command.stato });
      for (const versione of [undefined, null, "malformata"]) {
        const response = await request(app())
          .post(`/interventi/${row.id}/${command.path}`)
          .send({ ...command.body, versione });
        expect(response.status, `${command.path}: ${String(versione)}`).toBe(
          400,
        );
      }
    }
  });

  it("impedisce che due PATCH concorrenti sovrascrivano la stessa versione", async () => {
    const row = await createIntervento();
    const current = await versione(row.id);
    const responses = await Promise.all([
      request(app()).patch(`/interventi/${row.id}`).send({
        versione: current,
        priorita: "alta",
      }),
      request(app()).patch(`/interventi/${row.id}`).send({
        versione: current,
        priorita: "urgente",
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
  });

  it("minimizza la lista Sociale ma conserva il dettaglio autorizzato", async () => {
    const row = await createIntervento();
    const list = await request(app())
      .get("/interventi")
      .query({ ambito: "sociale" });
    const item = list.body.find(
      (candidate: { id: number }) => candidate.id === row.id,
    );
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("descrizione");
    expect(item).not.toHaveProperty("note");
    expect(item).not.toHaveProperty("risultato");
    expect(item).not.toHaveProperty("noteUds");
    const detail = await request(app()).get(`/interventi/${row.id}`);
    expect(detail.body.descrizione).toBe("Descrizione sociale riservata");
    expect(detail.body.note).toBe("Nota sociale riservata");
  });

  it("valida Area, Centro, stato ed esistenza del magazzino", async () => {
    for (const [warehouseId, expected] of [
      [magazzinoA, 200],
      [magazzinoB, 400],
      [magazzinoCentroB, 403],
      [magazzinoInattivo, 400],
      [999_999_999, 400],
    ] as const) {
      const row = await createIntervento({ stato: "in_corso" });
      const response = await request(app())
        .post(`/interventi/${row.id}/salva-operativita`)
        .send({
          versione: await versione(row.id),
          materiali: [
            {
              prodottoId,
              quantitaPrevista: 1,
              quantitaConsegnata: 0,
              statoPreparazione: "da_preparare",
              magazzinoId: warehouseId,
            },
          ],
        });
      expect(response.status).toBe(expected);
    }
  });

  it("scarica solo il delta, evita doppio scarico e fa rollback su errore", async () => {
    const row = await createIntervento({ stato: "in_corso" });
    const payload = (quantitaConsegnata: number, currentVersion: string) => ({
      versione: currentVersion,
      materiali: [
        {
          prodottoId,
          quantitaPrevista: 10,
          quantitaConsegnata,
          statoPreparazione: "consegnato",
          magazzinoId: magazzinoA,
        },
      ],
    });
    const first = await request(app())
      .post(`/interventi/${row.id}/salva-operativita`)
      .send(payload(2, await versione(row.id)));
    expect(first.status).toBe(200);
    expect(await totaleMovimenti(row.id)).toBe(2);
    const second = await request(app())
      .post(`/interventi/${row.id}/salva-operativita`)
      .send(payload(2, first.body.versione));
    expect(second.status).toBe(200);
    expect(await totaleMovimenti(row.id)).toBe(2);
    const third = await request(app())
      .post(`/interventi/${row.id}/salva-operativita`)
      .send(payload(3, second.body.versione));
    expect(third.status).toBe(200);
    expect(await totaleMovimenti(row.id)).toBe(3);
    const decrease = await request(app())
      .post(`/interventi/${row.id}/salva-operativita`)
      .send(payload(2, third.body.versione));
    expect(decrease.status).toBe(409);
    expect(await totaleMovimenti(row.id)).toBe(3);

    const concurrentVersion = await versione(row.id);
    const concurrent = await Promise.all([
      request(app())
        .post(`/interventi/${row.id}/salva-operativita`)
        .send(payload(4, concurrentVersion)),
      request(app())
        .post(`/interventi/${row.id}/salva-operativita`)
        .send(payload(4, concurrentVersion)),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(await totaleMovimenti(row.id)).toBe(4);

    const before = await db
      .select()
      .from(interventiMaterialiTable)
      .where(eq(interventiMaterialiTable.interventoId, row.id));
    const insufficient = await request(app())
      .post(`/interventi/${row.id}/salva-operativita`)
      .send(payload(100, await versione(row.id)));
    expect(insufficient.status).toBe(400);
    const after = await db
      .select()
      .from(interventiMaterialiTable)
      .where(eq(interventiMaterialiTable.interventoId, row.id));
    expect(after.map((item) => item.quantitaConsegnata)).toEqual(
      before.map((item) => item.quantitaConsegnata),
    );
    expect(await totaleMovimenti(row.id)).toBe(4);
  });

  it("non movimenta materiali liberi senza prodotto", async () => {
    const row = await createIntervento({ stato: "in_corso" });
    const response = await request(app())
      .post(`/interventi/${row.id}/salva-operativita`)
      .send({
        versione: await versione(row.id),
        materiali: [
          {
            descrizioneSnapshot: "Coperta donata",
            unitaMisuraSnapshot: "pz",
            quantitaPrevista: 1,
            quantitaConsegnata: 1,
            statoPreparazione: "consegnato",
          },
        ],
      });
    expect(response.status).toBe(200);
    expect(await totaleMovimenti(row.id)).toBe(0);
  });

  it("richiede update per l'operatività allegata alla conclusione", async () => {
    const completeWithoutUpdate = app({
      permessi: [
        "sociale.interventi.view",
        "sociale.interventi.complete",
        "sociale.interventi.create",
      ],
    });
    const onlyResult = await createIntervento({ stato: "in_corso" });
    const concluded = await request(completeWithoutUpdate)
      .post(`/interventi/${onlyResult.id}/concludi`)
      .send({
        versione: await versione(onlyResult.id),
        conferma: true,
        risultato: "Conclusione autorizzata",
      });
    expect(concluded.status).toBe(200);

    const operationalPayloads = [
      {
        attivita: [
          {
            tipologiaSnapshot: "Colloquio",
            descrizione: "Attività conclusiva",
          },
        ],
      },
      {
        documenti: [{ tipoDescrizione: "Verbale", stato: "da_acquisire" }],
      },
      {
        materiali: [
          {
            prodottoId,
            quantitaPrevista: 1,
            quantitaConsegnata: 1,
            statoPreparazione: "consegnato",
            magazzinoId: magazzinoA,
          },
        ],
      },
    ];
    for (const operationalPayload of operationalPayloads) {
      const row = await createIntervento({ stato: "in_corso" });
      const before = await totaleMovimenti(row.id);
      const response = await request(completeWithoutUpdate)
        .post(`/interventi/${row.id}/concludi`)
        .send({
          versione: await versione(row.id),
          conferma: true,
          risultato: "Tentativo non autorizzato",
          ...operationalPayload,
        });
      expect(response.status).toBe(403);
      expect(await totaleMovimenti(row.id)).toBe(before);
    }

    const withOperationalSuccessor = await createIntervento({
      stato: "in_corso",
    });
    const successorDenied = await request(completeWithoutUpdate)
      .post(`/interventi/${withOperationalSuccessor.id}/concludi`)
      .send({
        versione: await versione(withOperationalSuccessor.id),
        conferma: true,
        risultato: "Conclusione con successivo",
        successivo: {
          tipoIntervento: "Follow-up operativo",
          stato: "da_pianificare",
          ambito: "sociale",
          attivita: [
            {
              tipologiaSnapshot: "Follow-up",
              descrizione: "Attività successiva",
            },
          ],
          documenti: [
            { tipoDescrizione: "Documento successivo", stato: "da_acquisire" },
          ],
        },
      });
    expect(successorDenied.status).toBe(403);
    expect(await totaleMovimenti(withOperationalSuccessor.id)).toBe(0);

    const withUpdate = await createIntervento({ stato: "in_corso" });
    const allowed = await request(app())
      .post(`/interventi/${withUpdate.id}/concludi`)
      .send({
        versione: await versione(withUpdate.id),
        conferma: true,
        risultato: "Conclusione operativa autorizzata",
        attivita: [
          {
            tipologiaSnapshot: "Colloquio finale",
            descrizione: "Attività autorizzata",
          },
        ],
        documenti: [{ tipoDescrizione: "Verbale finale", stato: "verificato" }],
        materiali: [
          {
            prodottoId,
            quantitaPrevista: 1,
            quantitaConsegnata: 1,
            statoPreparazione: "consegnato",
            magazzinoId: magazzinoA,
          },
        ],
      });
    expect(allowed.status).toBe(200);
    expect(allowed.body.operativita.attivita).toHaveLength(1);
    expect(allowed.body.operativita.documenti).toHaveLength(1);
    expect(await totaleMovimenti(withUpdate.id)).toBe(1);
  });
});
