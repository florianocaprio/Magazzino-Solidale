/* @vitest-environment node */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, beneficiariTable, bolleTable, consegneTable, magazziniTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import mapsRouter from "../src/routes/maps";
import { areaGuard } from "../src/middlewares/auth";
import { dataCivileEuropeRome } from "../src/lib/interventiWorkflow";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import {
  cleanup,
  createBeneficiario,
  createAreaOperativa,
  createCentro,
  createMagazzino,
  createZona,
  insertConsegna,
  insertBolla,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let scope: SeedScope;

beforeAll(async () => {
  for (const code of ["CENTRO_ASCOLTO", "CONSEGNE", "MAGAZZINO_SOLIDALE", "BOLLE", "UDS"]) {
    await updateModuloAmbiente(code, true, null);
  }
});
beforeEach(() => { scope = newScope(); });
afterEach(async () => { await cleanup(scope); });
afterAll(async () => { await pool.end(); });

function app(opts: {
  areaOperativaId?: number | null;
  centroId?: number | null;
  zonaId?: number | null;
  aree?: string[];
  permessi?: string[];
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}) {
  return makeScopedApp(mapsRouter, {
    id: 1,
    centroAscoltoId: opts.centroId ?? null,
    areaOperativaId: opts.areaOperativaId ?? null,
    zonaUdsId: opts.zonaId ?? null,
    aree: opts.aree ?? ["sociale"],
    permessi: opts.permessi ?? [],
    isAdmin: opts.isAdmin ?? false,
    isSuperAdmin: opts.isSuperAdmin ?? false,
  }, [areaGuard]);
}

describe("MAPS — capability, scope e routing", () => {
  it.each([
    { ruolo: "Admin", isAdmin: true, isSuperAdmin: false },
    { ruolo: "SuperAdmin", isAdmin: false, isSuperAdmin: true },
  ])("espone le capability a $ruolo senza aree o permessi espliciti", async ({ isAdmin, isSuperAdmin }) => {
    const response = await request(app({
      aree: [],
      permessi: [],
      isAdmin,
      isSuperAdmin,
    })).get("/maps/capabilities");

    expect(response.status).toBe(200);
    expect(response.body.operational).toBe(true);
    expect(response.body.layers.length).toBeGreaterThan(0);
    expect(response.body.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "centro.punti_operativi" }),
    ]));
  });

  it("non espone layer senza maps.operational e non inventa capability UDS", async () => {
    const denied = await request(app({ aree: ["sociale"] })).get("/maps/capabilities");
    expect(denied.body).toEqual({ operational: false, layers: [] });

    const uds = await request(app({ aree: ["uds"], permessi: ["maps.operational"] })).get("/maps/capabilities");
    expect(uds.status).toBe(200);
    expect(uds.body.layers).toEqual([]);
    expect((await request(app({ aree: ["uds"], permessi: ["maps.operational"] })).get("/maps/layers/uds/interventi")).status).toBe(404);
    expect((await request(app({ aree: ["sociale"] })).get("/maps/layers/pacchi/consegne")).status).toBe(403);
  });

  it("separa il bypass applicativo Admin dagli scope area operativa, centro e zona", async () => {
    const areaOperativaA = await createAreaOperativa(scope);
    const areaOperativaB = await createAreaOperativa(scope);
    const centreA = await createCentro(scope);
    const centreB = await createCentro(scope);
    const zoneA = await createZona(scope, areaOperativaA);
    const zoneB = await createZona(scope, areaOperativaB);
    const today = dataCivileEuropeRome();

    const combinations = [
      { areaOperativaId: areaOperativaA, centreId: centreA, zoneId: zoneA.id },
      { areaOperativaId: areaOperativaA, centreId: centreB, zoneId: zoneA.id },
      { areaOperativaId: areaOperativaB, centreId: centreA, zoneId: zoneB.id },
      { areaOperativaId: areaOperativaB, centreId: centreB, zoneId: zoneB.id },
    ];
    const deliveryIds: number[] = [];
    for (const combination of combinations) {
      const warehouse = await createMagazzino(scope, combination.centreId, { areaOperativaId: combination.areaOperativaId });
      const beneficiary = await createBeneficiario(scope, combination.centreId, {
        areaOperativaId: combination.areaOperativaId,
        zonaUdsId: combination.zoneId,
      });
      const delivery = await insertConsegna(scope, {
        beneficiarioId: beneficiary,
        magazzinoId: warehouse,
        dataPrevista: today,
      });
      deliveryIds.push(delivery);
      await db.update(consegneTable)
        .set({ indirizzoConsegna: `Via scope ${delivery}` })
        .where(eq(consegneTable.id, delivery));
    }

    const visibleIds = async (options: Parameters<typeof app>[0]) => {
      const response = await request(app(options))
        .get(`/maps/layers/pacchi/consegne?da=${today}&a=${today}`);
      expect(response.status).toBe(200);
      return response.body.map((marker: { entityId: number }) => marker.entityId).sort((a: number, b: number) => a - b);
    };
    const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

    expect(await visibleIds({ aree: [], isAdmin: true })).toEqual(sorted(deliveryIds));
    expect(await visibleIds({ aree: [], isAdmin: true, areaOperativaId: areaOperativaA }))
      .toEqual(sorted([deliveryIds[0], deliveryIds[1]]));
    expect(await visibleIds({ aree: [], isAdmin: true, centroId: centreA }))
      .toEqual(sorted([deliveryIds[0], deliveryIds[2]]));
    expect(await visibleIds({ aree: [], isAdmin: true, areaOperativaId: areaOperativaA, centroId: centreA }))
      .toEqual([deliveryIds[0]]);
    expect(await visibleIds({ aree: [], isSuperAdmin: true, zonaId: zoneA.id }))
      .toEqual(sorted([deliveryIds[0], deliveryIds[1]]));
    expect(await visibleIds({
      aree: ["sociale"],
      permessi: ["maps.operational"],
      areaOperativaId: areaOperativaA,
    })).toEqual(sorted([deliveryIds[0], deliveryIds[1]]));

    const standardDenied = await request(app({ aree: ["sociale"], areaOperativaId: areaOperativaA }))
      .get(`/maps/layers/pacchi/consegne?da=${today}&a=${today}`);
    expect(standardDenied.status).toBe(403);
  });

  it("applica gli scope anche alle route di Admin e SuperAdmin, lasciando globali solo i caller senza scope", async () => {
    const areaOperativaA = await createAreaOperativa(scope);
    const areaOperativaB = await createAreaOperativa(scope);
    const centreA = await createCentro(scope);
    const centreB = await createCentro(scope);
    const warehouseA = await createMagazzino(scope, centreA, { areaOperativaId: areaOperativaA });
    const warehouseB = await createMagazzino(scope, centreB, { areaOperativaId: areaOperativaB });
    await db.update(magazziniTable).set({ indirizzo: "Via Origine A 1" }).where(eq(magazziniTable.id, warehouseA));
    await db.update(magazziniTable).set({ indirizzo: "Via Origine B 1" }).where(eq(magazziniTable.id, warehouseB));
    const beneficiaryA = await createBeneficiario(scope, centreA, { areaOperativaId: areaOperativaA });
    const beneficiaryB = await createBeneficiario(scope, centreB, { areaOperativaId: areaOperativaB });
    const deliveryA = await insertConsegna(scope, { beneficiarioId: beneficiaryA, magazzinoId: warehouseA });
    const deliveryB = await insertConsegna(scope, { beneficiarioId: beneficiaryB, magazzinoId: warehouseB });
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Destinazione A 1" }).where(eq(consegneTable.id, deliveryA));
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Destinazione B 1" }).where(eq(consegneTable.id, deliveryB));

    expect((await request(app({ aree: [], isAdmin: true, areaOperativaId: areaOperativaA }))
      .get(`/maps/routes/consegne/${deliveryA}`)).status).toBe(200);
    expect((await request(app({ aree: [], isAdmin: true, areaOperativaId: areaOperativaA }))
      .get(`/maps/routes/consegne/${deliveryB}`)).status).toBe(403);
    expect((await request(app({ aree: [], isSuperAdmin: true, centroId: centreA }))
      .get(`/maps/routes/consegne/${deliveryB}`)).status).toBe(403);
    expect((await request(app({ aree: [], isSuperAdmin: true }))
      .get(`/maps/routes/consegne/${deliveryB}`)).status).toBe(200);
    expect((await request(app({ aree: [], isAdmin: true }))
      .get(`/maps/routes/consegne/${deliveryB}`)).status).toBe(200);
    expect((await request(app({
      aree: ["sociale"],
      permessi: ["maps.route"],
      areaOperativaId: areaOperativaA,
    })).get(`/maps/routes/consegne/${deliveryB}`)).status).toBe(403);
  });

  it("restituisce solo consegne della area operativa e del centro del caller", async () => {
    const areaOperativaA = await createAreaOperativa(scope);
    const areaOperativaB = await createAreaOperativa(scope);
    const centreA = await createCentro(scope);
    const centreB = await createCentro(scope);
    const warehouseA = await createMagazzino(scope, centreA, { areaOperativaId: areaOperativaA });
    const warehouseB = await createMagazzino(scope, centreB, { areaOperativaId: areaOperativaB });
    await db.update(magazziniTable).set({ indirizzo: "Via Roma 1", comune: "Roma" }).where(eq(magazziniTable.id, warehouseA));
    await db.update(magazziniTable).set({ indirizzo: "Via Milano 1", comune: "Milano" }).where(eq(magazziniTable.id, warehouseB));
    const beneficiaryA = await createBeneficiario(scope, centreA, { areaOperativaId: areaOperativaA });
    const beneficiaryB = await createBeneficiario(scope, centreB, { areaOperativaId: areaOperativaB });
    const today = dataCivileEuropeRome();
    const deliveryA = await insertConsegna(scope, { beneficiarioId: beneficiaryA, magazzinoId: warehouseA, dataPrevista: today });
    await insertConsegna(scope, { beneficiarioId: beneficiaryB, magazzinoId: warehouseB, dataPrevista: today });
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Destinazione 10" }).where(eq(consegneTable.id, deliveryA));
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Segreta 20" }).where(eq(consegneTable.beneficiarioId, beneficiaryB));

    const response = await request(app({ areaOperativaId: areaOperativaA, centroId: centreA, permessi: ["maps.operational", "maps.route"] }))
      .get(`/maps/layers/pacchi/consegne?da=${today}&a=${today}`);
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ entityId: deliveryA, address: "Via Destinazione 10" });
    expect(JSON.stringify(response.body)).not.toContain("Via Segreta");
  });

  it("costruisce un URL minimizzato con i soli indirizzi e nega una consegna fuori scope", async () => {
    const areaOperativaA = await createAreaOperativa(scope);
    const areaOperativaB = await createAreaOperativa(scope);
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre, { areaOperativaId: areaOperativaA });
    await db.update(magazziniTable).set({ indirizzo: "Via dell'Origine 1", comune: "Roma" }).where(eq(magazziniTable.id, warehouse));
    const beneficiary = await createBeneficiario(scope, centre, { areaOperativaId: areaOperativaA });
    const delivery = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse });
    await db.update(consegneTable).set({ indirizzoConsegna: "Via A & B 2" }).where(eq(consegneTable.id, delivery));

    const allowed = await request(app({ areaOperativaId: areaOperativaA, centroId: centre, permessi: ["maps.route"] })).get(`/maps/routes/consegne/${delivery}`);
    expect(allowed.status).toBe(200);
    const url = new URL(allowed.body.url);
    expect(url.searchParams.get("origin")).toBe("Via dell'Origine 1, Roma");
    expect(url.searchParams.get("destination")).toBe("Via A & B 2");
    expect(allowed.body.url).not.toContain("Test");
    expect(Object.keys(allowed.body).sort()).toEqual(["destination", "origin", "provider", "url"]);

    const denied = await request(app({ areaOperativaId: areaOperativaB, permessi: ["maps.route"] })).get(`/maps/routes/consegne/${delivery}`);
    expect(denied.status).toBe(403);
  });

  it("rifiuta route per ritiro in sede e intervalli oltre il limite", async () => {
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre);
    await db.update(magazziniTable).set({ indirizzo: "Via Origine 1" }).where(eq(magazziniTable.id, warehouse));
    const beneficiary = await createBeneficiario(scope, centre);
    const delivery = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse });
    await db.update(consegneTable).set({ tipoConsegna: "in_sede", indirizzoConsegna: null }).where(eq(consegneTable.id, delivery));
    const scoped = app({ centroId: centre, permessi: ["maps.route", "maps.operational"] });
    expect((await request(scoped).get(`/maps/routes/consegne/${delivery}`)).status).toBe(422);
    expect((await request(scoped).get("/maps/layers/pacchi/consegne?da=2026-01-01&a=2026-03-01")).status).toBe(400);
  });

  it("rifiuta route con moduli disabilitati o indirizzi mancanti", async () => {
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const delivery = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse });
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Destinazione 1" }).where(eq(consegneTable.id, delivery));
    const scoped = app({ centroId: centre, permessi: ["maps.route"] });

    expect((await request(scoped).get(`/maps/routes/consegne/${delivery}`)).status).toBe(422);
    await db.update(magazziniTable).set({ indirizzo: "Via Origine 1" }).where(eq(magazziniTable.id, warehouse));
    await db.update(consegneTable).set({ indirizzoConsegna: null }).where(eq(consegneTable.id, delivery));
    expect((await request(scoped).get(`/maps/routes/consegne/${delivery}`)).status).toBe(422);

    await db.update(consegneTable).set({ indirizzoConsegna: "Via Destinazione 1" }).where(eq(consegneTable.id, delivery));
    try {
      await updateModuloAmbiente("CONSEGNE", false, null);
      expect((await request(scoped).get(`/maps/routes/consegne/${delivery}`)).status).toBe(403);
    } finally {
      await updateModuloAmbiente("CONSEGNE", true, null);
    }
  });

  it("localizza un ritiro mancato solo sul domicilio utilizzabile, mai sul magazzino", async () => {
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre);
    await db.update(magazziniTable).set({ indirizzo: "Via Magazzino 99" }).where(eq(magazziniTable.id, warehouse));
    const withAddress = await createBeneficiario(scope, centre);
    const withoutAddress = await createBeneficiario(scope, centre);
    await db.update(beneficiariTable).set({ domicilio: "Via Domicilio 7" }).where(eq(beneficiariTable.id, withAddress));
    const visibleBolla = await insertBolla(scope, { beneficiarioId: withAddress, magazzinoId: warehouse, stato: "confermato" });
    const hiddenBolla = await insertBolla(scope, { beneficiarioId: withoutAddress, magazzinoId: warehouse, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, visibleBolla));
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, hiddenBolla));

    const today = dataCivileEuropeRome();
    const response = await request(app({ centroId: centre, permessi: ["maps.operational"] }))
      .get(`/maps/layers/pacchi/ritiri-non-effettuati?da=${today}&a=${today}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ entityId: visibleBolla, address: "Via Domicilio 7" });
    expect(JSON.stringify(response.body)).not.toContain("Via Magazzino 99");
  });
});
