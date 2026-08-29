/* @vitest-environment node */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, beneficiariTable, bolleTable, centriAscoltoTable, consegneTable, interventiTable, magazziniTable, mapsGeocodeCacheTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import mapsRouter from "../src/routes/maps";
import consegneRouter from "../src/routes/consegne";
import { areaGuard } from "../src/middlewares/auth";
import { dataCivileEuropeRome } from "../src/lib/interventiWorkflow";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import { normalizeMapsAddress } from "../src/lib/maps-geocoding";
import {
  cleanup,
  createBeneficiario,
  createAreaOperativa,
  createCentro,
  createMagazzino,
  createZona,
  insertConsegna,
  insertBolla,
  insertIntervento,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let scope: SeedScope;
let geocodeCacheKeys: string[];

beforeAll(async () => {
  for (const code of ["CENTRO_ASCOLTO", "CONSEGNE", "MAGAZZINO_SOLIDALE", "BOLLE", "UDS"]) {
    await updateModuloAmbiente(code, true, null);
  }
});
beforeEach(() => { scope = newScope(); geocodeCacheKeys = []; });
afterEach(async () => {
  await cleanup(scope);
  if (geocodeCacheKeys.length) {
    await db.delete(mapsGeocodeCacheTable)
      .where(inArray(mapsGeocodeCacheTable.normalizedAddress, geocodeCacheKeys));
  }
});
afterAll(async () => { await pool.end(); });

async function cacheResolvedMapsAddresses(addresses: string[]) {
  for (const [index, originalAddress] of addresses.entries()) {
    const normalizedAddress = normalizeMapsAddress(originalAddress);
    geocodeCacheKeys.push(normalizedAddress);
    const values = {
      normalizedAddress,
      originalAddress,
      latitude: (41.9 + index / 1_000).toFixed(7),
      longitude: (12.5 + index / 1_000).toFixed(7),
      provider: "test",
      status: "resolved",
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(mapsGeocodeCacheTable).values(values).onConflictDoUpdate({
      target: mapsGeocodeCacheTable.normalizedAddress,
      set: values,
    });
  }
}

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

function consegneApp(opts: Parameters<typeof app>[0]) {
  return makeScopedApp(consegneRouter, {
    id: 1,
    centroAscoltoId: opts.centroId ?? null,
    areaOperativaId: opts.areaOperativaId ?? null,
    zonaUdsId: opts.zonaId ?? null,
    aree: opts.aree ?? ["sociale"],
    permessi: opts.permessi ?? [
      "consegne.view",
      "consegne.manage",
      "consegne.complete",
      "consegne.cancel",
    ],
    isAdmin: opts.isAdmin ?? false,
    isSuperAdmin: opts.isSuperAdmin ?? false,
  });
}

describe("MAPS — capability, scope e routing", () => {
  it("eredita la permission Interventi sia nelle capability sia nell'endpoint", async () => {
    const centre = await createCentro(scope);
    const beneficiary = await createBeneficiario(scope, centre);
    const intervention = await insertIntervento(scope, { beneficiarioId: beneficiary, ambito: "sociale" });
    const now = new Date();
    await db.update(interventiTable).set({
      stato: "pianificato",
      sede: "Via Sociale Riservata 1",
      dataOraPianificata: now,
    }).where(eq(interventiTable.id, intervention));
    const today = dataCivileEuropeRome(now);

    const deniedApp = app({ centroId: centre, permessi: ["maps.operational"] });
    const capabilities = await request(deniedApp).get("/maps/capabilities");
    expect(capabilities.body.layers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "sociale.interventi_pianificati" }),
    ]));
    const denied = await request(deniedApp)
      .get(`/maps/layers/sociale/interventi?da=${today}&a=${today}`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain("Via Sociale Riservata");

    const allowed = await request(app({
      centroId: centre,
      permessi: ["maps.operational", "sociale.interventi.view"],
    })).get(`/maps/layers/sociale/interventi?da=${today}&a=${today}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body[0]).toMatchObject({ entityId: intervention, actions: ["open"] });
  });

  it("eredita bolle.view e rende convert_delivery dipendente da bolle.deliver", async () => {
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    await db.update(beneficiariTable).set({ domicilio: "Via Domicilio Protetto 7" })
      .where(eq(beneficiariTable.id, beneficiary));
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, bolla));
    const today = dataCivileEuropeRome();

    const deniedApp = app({ centroId: centre, permessi: ["maps.operational"] });
    const capabilities = await request(deniedApp).get("/maps/capabilities");
    expect(capabilities.body.layers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "pacchi.ritiri_non_effettuati" }),
    ]));
    const denied = await request(deniedApp)
      .get(`/maps/layers/pacchi/ritiri-non-effettuati?da=${today}&a=${today}`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain("Via Domicilio Protetto");

    const visible = await request(app({
      centroId: centre,
      permessi: ["maps.operational", "bolle.view"],
    })).get(`/maps/layers/pacchi/ritiri-non-effettuati?da=${today}&a=${today}`);
    expect(visible.status).toBe(200);
    expect(visible.body[0]).toMatchObject({ entityId: bolla, actions: ["open"] });

    const actionable = await request(app({
      centroId: centre,
      permessi: ["maps.operational", "bolle.view", "bolle.deliver"],
    })).get(`/maps/layers/pacchi/ritiri-non-effettuati?da=${today}&a=${today}`);
    expect(actionable.body[0].actions).toEqual(["open", "convert_delivery"]);
  });

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

  it("dichiara routeSupported solo con layer Consegne visibile e maps.route", async () => {
    const withoutRoute = await request(app({ permessi: ["maps.operational"] }))
      .get("/maps/capabilities");
    expect(withoutRoute.body.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "pacchi.consegne", routeSupported: false }),
    ]));
    const withRoute = await request(app({ permessi: ["maps.operational", "maps.route"] }))
      .get("/maps/capabilities");
    expect(withRoute.body.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "pacchi.consegne", routeSupported: true }),
    ]));
  });

  it("non propone open per pagine amministrative a un caller standard", async () => {
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre);
    await db.update(centriAscoltoTable).set({ indirizzo: "Via Centro 1" }).where(eq(centriAscoltoTable.id, centre));
    await db.update(magazziniTable).set({ indirizzo: "Via Magazzino 1" }).where(eq(magazziniTable.id, warehouse));

    const standard = await request(app({ centroId: centre, permessi: ["maps.operational"] }))
      .get("/maps/layers/centro/punti-operativi");
    expect(standard.status).toBe(200);
    expect(standard.body.every((marker: { actions: string[] }) => marker.actions.length === 0)).toBe(true);

    const admin = await request(app({ centroId: centre, aree: [], isAdmin: true }))
      .get("/maps/layers/centro/punti-operativi");
    expect(admin.status).toBe(200);
    expect(admin.body.every((marker: { actions: string[] }) => marker.actions.includes("open"))).toBe(true);
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
        uds: true,
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
    await cacheResolvedMapsAddresses([
      "Via Origine A 1",
      "Via Destinazione A 1",
      "Via Origine B 1",
      "Via Destinazione B 1",
    ]);

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

  it("interseca sempre lo scope Beneficiario con lo scope Magazzino", async () => {
    const centreA = await createCentro(scope);
    const centreB = await createCentro(scope);
    const warehouseA = await createMagazzino(scope, centreA);
    const warehouseB = await createMagazzino(scope, centreB);
    const beneficiary = await createBeneficiario(scope, centreA);
    await db.update(beneficiariTable).set({ domicilio: "Via Scope Magazzino 1" })
      .where(eq(beneficiariTable.id, beneficiary));
    const today = dataCivileEuropeRome();
    const deliveryA = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouseA, dataPrevista: today });
    const deliveryB = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouseB, dataPrevista: today });
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Consentita" }).where(eq(consegneTable.id, deliveryA));
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Fuori Scope" }).where(eq(consegneTable.id, deliveryB));
    const bollaA = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouseA, stato: "confermato" });
    const bollaB = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouseB, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, bollaA));
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, bollaB));

    const scoped = app({ centroId: centreA, permessi: ["maps.operational", "bolle.view"] });
    const deliveries = await request(scoped).get(`/maps/layers/pacchi/consegne?da=${today}&a=${today}`);
    expect(deliveries.body.map((item: { entityId: number }) => item.entityId)).toEqual([deliveryA]);
    expect(JSON.stringify(deliveries.body)).not.toContain("Via Fuori Scope");
    const withdrawals = await request(scoped).get(`/maps/layers/pacchi/ritiri-non-effettuati?da=${today}&a=${today}`);
    expect(withdrawals.body.map((item: { entityId: number }) => item.entityId)).toEqual([bollaA]);
  });

  it("mostra solo consegne pianificate e rifiuta la route di una consegna effettuata", async () => {
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre);
    await db.update(magazziniTable).set({ indirizzo: "Via Origine 1" }).where(eq(magazziniTable.id, warehouse));
    const beneficiary = await createBeneficiario(scope, centre);
    const today = dataCivileEuropeRome();
    const planned = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, dataPrevista: today });
    const completed = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, dataPrevista: today, stato: "effettuata" });
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Pianificata 1" }).where(eq(consegneTable.id, planned));
    await db.update(consegneTable).set({ indirizzoConsegna: "Via Effettuata 2" }).where(eq(consegneTable.id, completed));

    const layer = await request(app({ centroId: centre, permessi: ["maps.operational", "maps.route"] }))
      .get(`/maps/layers/pacchi/consegne?da=${today}&a=${today}`);
    expect(layer.status).toBe(200);
    expect(layer.body.map((marker: { entityId: number }) => marker.entityId)).toEqual([planned]);
    const route = await request(app({ centroId: centre, permessi: ["maps.route"] }))
      .get(`/maps/routes/consegne/${completed}`);
    expect(route.status).toBe(409);
    expect(route.body.error).toContain("non è più una pianificazione attiva");
  });

  it("rifiuta esplicitamente N+1 attività invece di troncare il layer", async () => {
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const today = dataCivileEuropeRome();
    const inserted = await db.insert(consegneTable).values(Array.from({ length: 501 }, (_, index) => ({
      codice: `MAP-CAP-${index}`,
      beneficiarioId: beneficiary,
      tipoPianificazione: "consegna_pacco",
      tipoConsegna: "domicilio",
      dataPrevista: today,
      indirizzoConsegna: `Via Cap ${index}`,
      magazzinoId: warehouse,
      stato: "pianificata",
    }))).returning({ id: consegneTable.id });
    scope.consegnaIds.push(...inserted.map((row) => row.id));

    const response = await request(app({ centroId: centre, permessi: ["maps.operational"] }))
      .get(`/maps/layers/pacchi/consegne?da=${today}&a=${today}`);
    expect(response.status).toBe(422);
    expect(response.body.error).toContain("limite operativo");
    expect(response.body).not.toHaveProperty("markers");
  });

  it("impone e conserva lo snapshot dell'indirizzo nelle POST/PATCH Consegna", async () => {
    const centre = await createCentro(scope);
    const warehouse = await createMagazzino(scope, centre);
    await db.update(magazziniTable).set({ indirizzo: "Via Magazzino 1" }).where(eq(magazziniTable.id, warehouse));
    const beneficiary = await createBeneficiario(scope, centre);
    await db.update(beneficiariTable).set({ domicilio: "Via A" }).where(eq(beneficiariTable.id, beneficiary));
    const deliveryApi = consegneApp({ centroId: centre });
    const base = {
      beneficiarioId: beneficiary,
      tipoConsegna: "domicilio",
      dataPrevista: dataCivileEuropeRome(),
      fasciaOraria: "Mattina",
      magazzinoId: warehouse,
    };
    expect((await request(deliveryApi).post("/consegne").send(base)).status).toBe(400);
    expect((await request(deliveryApi).post("/consegne").send({ ...base, indirizzoConsegna: "   " })).status).toBe(400);
    expect((await request(deliveryApi).post("/consegne").send({ ...base, indirizzoConsegna: "X".repeat(201) })).status).toBe(400);

    const created = await request(deliveryApi).post("/consegne")
      .send({ ...base, indirizzoConsegna: "  Via A  " });
    expect(created.status).toBe(201);
    scope.consegnaIds.push(created.body.id);
    expect(created.body.indirizzoConsegna).toBe("Via A");
    expect((await request(deliveryApi).patch(`/consegne/${created.body.id}`)
      .send({ indirizzoConsegna: " " })).status).toBe(400);
    const [unchanged] = await db.select().from(consegneTable).where(eq(consegneTable.id, created.body.id));
    expect(unchanged.indirizzoConsegna).toBe("Via A");

    const legacy = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse });
    expect((await request(deliveryApi).patch(`/consegne/${legacy}`)
      .send({ noteOperative: "correzione" })).status).toBe(400);
    await db.update(consegneTable).set({ tipoConsegna: "in_sede", indirizzoConsegna: null }).where(eq(consegneTable.id, legacy));
    expect((await request(deliveryApi).patch(`/consegne/${legacy}`)
      .send({ tipoConsegna: "domicilio" })).status).toBe(400);

    await db.update(beneficiariTable).set({ domicilio: "Via B" }).where(eq(beneficiariTable.id, beneficiary));
    await cacheResolvedMapsAddresses(["Via Magazzino 1", "Via A"]);
    const route = await request(app({ centroId: centre, permessi: ["maps.route"] }))
      .get(`/maps/routes/consegne/${created.body.id}`);
    expect(route.status).toBe(200);
    expect(route.body.destination).toBe("Via A");
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
    await cacheResolvedMapsAddresses(["Via dell'Origine 1, Roma", "Via A & B 2"]);

    const allowed = await request(app({ areaOperativaId: areaOperativaA, centroId: centre, permessi: ["maps.route"] })).get(`/maps/routes/consegne/${delivery}`);
    expect(allowed.status).toBe(200);
    const url = new URL(allowed.body.url);
    expect(url.origin).toBe("https://www.openstreetmap.org");
    expect(url.searchParams.get("engine")).toBe("fossgis_osrm_car");
    expect(url.searchParams.get("route")).toBe("41.9,12.5;41.901,12.501");
    expect(allowed.body.url).not.toContain("Test");
    expect(allowed.body.url).not.toContain("Via");
    expect(allowed.body).toMatchObject({
      origin: "Via dell'Origine 1, Roma",
      destination: "Via A & B 2",
      provider: "openstreetmap-directions",
    });
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
    const annulledBolla = await insertBolla(scope, { beneficiarioId: withAddress, magazzinoId: warehouse, stato: "annullato" });
    const delivery = await insertConsegna(scope, { beneficiarioId: withAddress, magazzinoId: warehouse });
    const convertedBolla = await insertBolla(scope, { beneficiarioId: withAddress, magazzinoId: warehouse, stato: "confermato", consegnaId: delivery });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, visibleBolla));
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, hiddenBolla));
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, annulledBolla));
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date() }).where(eq(bolleTable.id, convertedBolla));

    const today = dataCivileEuropeRome();
    const response = await request(app({ centroId: centre, permessi: ["maps.operational", "bolle.view"] }))
      .get(`/maps/layers/pacchi/ritiri-non-effettuati?da=${today}&a=${today}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ entityId: visibleBolla, address: "Via Domicilio 7" });
    expect(JSON.stringify(response.body)).not.toContain("Via Magazzino 99");
    expect(response.body.map((marker: { entityId: number }) => marker.entityId))
      .not.toEqual(expect.arrayContaining([annulledBolla, convertedBolla]));
  });
});
