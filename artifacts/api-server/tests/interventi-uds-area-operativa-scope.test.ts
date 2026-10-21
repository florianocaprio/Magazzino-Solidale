import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  beneficiariTable,
  centriAscoltoTable,
  areeOperativeTable,
  db,
  interventiTable,
  pool,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";

const rnd = () => Math.random().toString(36).slice(2, 8);
const interventoIds: number[] = [];
const beneficiarioIds: number[] = [];
const centroIds: number[] = [];
const zonaIds: number[] = [];
const areaOperativaIds: number[] = [];
let operatorUserId: number;
let areaOperativaOperatore: number;
let areaOperativaEsterna: number;
let centroOperatore: number;
let zonaOperatore: number;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          centroAscoltoId: number;
          areaOperativaId: number;
          zonaUdsId: number;
          aree: string[];
          permessi: string[];
        };
      }
    ).user = {
      id: operatorUserId,
      centroAscoltoId: centroOperatore,
      areaOperativaId: areaOperativaOperatore,
      zonaUdsId: zonaOperatore,
      aree: ["uds"],
      permessi: ["uds.interventi.view", "uds.interventi.create"],
    };
    next();
  });
  app.use(interventiRouter);
  return app;
}

async function createAreaOperativa(nome: string): Promise<number> {
  const [areaOperativa] = await db
    .insert(areeOperativeTable)
    .values({ nome })
    .returning({ id: areeOperativeTable.id });
  areaOperativaIds.push(areaOperativa.id);
  return areaOperativa.id;
}

async function createCentro(areaOperativaId: number): Promise<number> {
  const [centro] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, areaOperativaId })
    .returning({ id: centriAscoltoTable.id });
  centroIds.push(centro.id);
  return centro.id;
}

async function createZona(areaOperativaId: number): Promise<number> {
  const [zona] = await db
    .insert(zoneUdsTable)
    .values({ nome: `Zona ${rnd()}`, areaOperativaId })
    .returning({ id: zoneUdsTable.id });
  zonaIds.push(zona.id);
  return zona.id;
}

async function createBeneficiario(
  areaOperativaId: number | null,
  centroAscoltoId: number | null,
  zonaUdsId: number | null,
): Promise<number> {
  const [beneficiario] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      nome: "Persona",
      cognome: rnd(),
      sesso: "M",
      uds: true,
      areaOperativaId,
      centroAscoltoId,
      zonaUdsId,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(beneficiario.id);
  return beneficiario.id;
}

beforeAll(async () => {
  areaOperativaOperatore = await createAreaOperativa(`Roma ${rnd()}`);
  areaOperativaEsterna = await createAreaOperativa(`Milano ${rnd()}`);
  centroOperatore = await createCentro(areaOperativaOperatore);
  zonaOperatore = await createZona(areaOperativaOperatore);
  const [operator] = await db
    .insert(utentiTable)
    .values({
      username: `uds_int_scope_${rnd()}`,
      passwordHash: "test-only",
      nome: "Operatore UDS",
      attivo: true,
      centroAscoltoId: centroOperatore,
      areaOperativaId: areaOperativaOperatore,
      zonaUdsId: zonaOperatore,
    })
    .returning({ id: utentiTable.id });
  operatorUserId = operator.id;
});

afterAll(async () => {
  if (interventoIds.length > 0) {
    await db
      .delete(interventiTable)
      .where(inArray(interventiTable.id, interventoIds));
  }
  if (beneficiarioIds.length > 0) {
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, beneficiarioIds));
  }
  await db.delete(utentiTable).where(eq(utentiTable.id, operatorUserId));
  if (zonaIds.length > 0)
    await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds));
  if (centroIds.length > 0) {
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, centroIds));
  }
  if (areaOperativaIds.length > 0)
    await db
      .delete(areeOperativeTable)
      .where(inArray(areeOperativeTable.id, areaOperativaIds));
  await pool.end();
});

describe("Interventi UDS con confine area operativa", () => {
  it("consente storico e inserimento per una persona UDS della stessa area operativa anche in altro centro e zona", async () => {
    const altroCentro = await createCentro(areaOperativaOperatore);
    const altraZona = await createZona(areaOperativaOperatore);
    const beneficiarioId = await createBeneficiario(
      areaOperativaOperatore,
      altroCentro,
      altraZona,
    );
    const [storico] = await db
      .insert(interventiTable)
      .values({
        beneficiarioId,
        dataIntervento: "2026-08-14",
        tipoIntervento: "ascolto",
        ambito: "uds",
        areaOperativaIdSnapshot: areaOperativaOperatore,
        zonaUdsIdSnapshot: altraZona,
      })
      .returning({ id: interventiTable.id });
    interventoIds.push(storico.id);

    const list = await request(makeApp())
      .get("/interventi")
      .query({ beneficiarioId: String(beneficiarioId), ambito: "uds" });
    expect(list.status).toBe(200);
    expect(list.body.map((row: { id: number }) => row.id)).toContain(
      storico.id,
    );

    const created = await request(makeApp()).post("/interventi").send({
      beneficiarioId,
      dataIntervento: "2026-08-14",
      tipoIntervento: "ascolto",
      ambito: "uds",
    });
    expect(created.status).toBe(201);
    interventoIds.push(created.body.id);
  });

  it("filtra lo stesso bisogno, usa data civile e zona storica, e pagina oltre 200 senza duplicazioni", async () => {
    const zone = await createZona(areaOperativaOperatore);
    const person = await createBeneficiario(
      areaOperativaOperatore,
      null,
      zonaOperatore,
    );
    const rows = await db
      .insert(interventiTable)
      .values(
        Array.from({ length: 205 }, (_, n) => ({
          beneficiarioId: person,
          tipoIntervento: "ascolto",
          ambito: "uds",
          dataIntervento: "2026-08-14",
          dataOraConclusione: new Date("2026-09-10T10:00:00Z"),
          areaOperativaIdSnapshot: areaOperativaOperatore,
          zonaUdsIdSnapshot: zone,
        })),
      )
      .returning({ id: interventiTable.id });
    interventoIds.push(...rows.map((r) => r.id));
    const latest = rows.at(-1)!.id;
    try {
      await pool.query(
        `INSERT INTO bisogni_pianificati(intervento_id,tipo,descrizione,stato) VALUES
        ($1,'richiesta','Richiesta completata','completato'),($1,'azione','Azione aperta','da_pianificare')`,
        [latest],
      );
      const params = {
        ambito: "uds",
        beneficiarioId: person,
        da: "2026-08-14",
        a: "2026-08-14",
        zonaUdsId: zone,
        limite: 200,
      };
      const first = await request(makeApp())
        .get("/interventi/pagina")
        .query(params);
      expect(first.status).toBe(200);
      expect(first.body.total).toBe(205);
      expect(first.body.items).toHaveLength(200);
      expect(first.body.items[0].id).toBe(latest);
      const second = await request(makeApp())
        .get("/interventi/pagina")
        .query({ ...params, pagina: 2 });
      expect(second.body.items).toHaveLength(5);
      expect(
        new Set([...first.body.items, ...second.body.items].map((r) => r.id))
          .size,
      ).toBe(205);
      const mismatch = await request(makeApp())
        .get("/interventi/pagina")
        .query({ ...params, tipoBisogno: "richiesta", bisogni: "aperti" });
      expect(mismatch.body.total).toBe(0);
      const matched = await request(makeApp())
        .get("/interventi/pagina")
        .query({ ...params, tipoBisogno: "azione", bisogni: "aperti" });
      expect(matched.body.total).toBe(1);
      expect(matched.body.items[0].id).toBe(latest);
      const currentZone = await request(makeApp())
        .get("/interventi/pagina")
        .query({ ...params, zonaUdsId: zonaOperatore });
      expect(currentZone.body.total).toBe(0);
      expect(
        (
          await request(makeApp())
            .get("/interventi")
            .query({ ...params, tipoBisogno: "azione", bisogni: "nessuno" })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(makeApp())
            .get("/interventi")
            .query({ ...params, tipoBisogno: "invalid" })
        ).status,
      ).toBe(400);
    } finally {
      await pool.query(
        "DELETE FROM bisogni_pianificati WHERE intervento_id=$1",
        [latest],
      );
    }
  });

  it.each([
    [
      "un'altra area operativa",
      () => createBeneficiario(areaOperativaEsterna, null, null),
    ],
    ["area operativa NULL", () => createBeneficiario(null, null, null)],
  ])(
    "non espone né consente interventi UDS per %s",
    async (_label, createPerson) => {
      const beneficiarioId = await createPerson();
      const list = await request(makeApp())
        .get("/interventi")
        .query({ beneficiarioId: String(beneficiarioId), ambito: "uds" });
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);

      const created = await request(makeApp()).post("/interventi").send({
        beneficiarioId,
        dataIntervento: "2026-08-14",
        tipoIntervento: "ascolto",
        ambito: "uds",
      });
      expect(created.status).toBe(403);
    },
  );
});
