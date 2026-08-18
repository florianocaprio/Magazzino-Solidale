/* @vitest-environment node */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, beneficiariTable, bolleTable, consegneTable, lottiTable, prenotazioniMagazzinoTable, turniTable, turniVolontariTable, volontariTable, mezziTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import bolleRouter from "../src/routes/bolle";
import consegneRouter from "../src/routes/consegne";
import {
  cleanup,
  createBeneficiario,
  createCentro,
  createMagazzino,
  createMezzo,
  createLotto,
  createProdotto,
  createUtente,
  createVolontario,
  insertBolla,
  insertBollaRiga,
  insertConsegna,
  insertPrenotazioneMagazzino,
  insertTurno,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let scope: SeedScope;
beforeEach(() => { scope = newScope(); });
afterEach(async () => { await cleanup(scope); });
afterAll(async () => { await pool.end(); });

describe("Bolle — ritiro non effettuato e conversione", () => {
  it("registra un esito strutturato senza cambiare stato o prenotazioni", async () => {
    const centre = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centre });
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
    const prodotto = await createProdotto(scope);
    const lotto = await createLotto(scope, { prodottoId: prodotto, magazzinoId: warehouse, quantita: 12 });
    const riga = await insertBollaRiga(scope, { bollaId: bolla, prodottoId: prodotto, lottoId: lotto, quantita: 2 });
    await insertPrenotazioneMagazzino(scope, { bollaId: bolla, rigaBollaId: riga, prodottoId: prodotto, lottoId: lotto, magazzinoId: warehouse, quantita: 2 });
    const before = await db.select().from(prenotazioniMagazzinoTable).where(eq(prenotazioniMagazzinoTable.bollaId, bolla));
    const [lottoBefore] = await db.select().from(lottiTable).where(eq(lottiTable.id, lotto));
    const response = await request(makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre })).post(`/bolle/${bolla}/ritiro-non-effettuato`).send({ motivo: "Assente" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stato: "confermato", ritiroNonEffettuatoMotivo: "Assente", ritiroNonEffettuatoOperatoreId: operator });
    expect(response.body.ritiroNonEffettuatoAt).toBeTruthy();
    const converted = await request(makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre }))
      .post(`/bolle/${bolla}/converti-consegna`)
      .send({ indirizzoConsegna: "Via Stock Invariato 1", dataPrevista: "2026-09-01", fasciaOraria: "Mattina" });
    expect(converted.status).toBe(201);
    scope.consegnaIds.push(converted.body.consegnaId);
    const after = await db.select().from(prenotazioniMagazzinoTable).where(eq(prenotazioniMagazzinoTable.bollaId, bolla));
    expect(after).toEqual(before);
    const [lottoAfter] = await db.select().from(lottiTable).where(eq(lottiTable.id, lotto));
    expect(lottoAfter.quantitaResidua).toBe(lottoBefore.quantitaResidua);
  });

  it("nega esito su bolla consegnata e a un altro centro", async () => {
    const centreA = await createCentro(scope);
    const centreB = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centreB });
    const warehouse = await createMagazzino(scope, centreA);
    const beneficiary = await createBeneficiario(scope, centreA);
    const delivered = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "consegnato" });
    const appA = makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centreA });
    expect((await request(appA).post(`/bolle/${delivered}/ritiro-non-effettuato`).send({})).status).toBe(409);
    expect((await request(makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centreB })).post(`/bolle/${delivered}/ritiro-non-effettuato`).send({})).status).toBe(403);
  });

  it("converte in una sola consegna con snapshot anche con richieste concorrenti", async () => {
    const centre = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centre });
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const volunteer = await createVolontario(scope, centre);
    const vehicle = await createMezzo(scope, { centroId: centre });
    await db.update(beneficiariTable).set({ domicilio: "Via Domicilio Vecchio 1" }).where(eq(beneficiariTable.id, beneficiary));
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));
    const app = makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre });
    const payload = { indirizzoConsegna: "Via Snapshot 9", dataPrevista: "2026-09-01", fasciaOraria: "Mattina", volontarioId: volunteer, mezzoId: vehicle };
    const [first, second] = await Promise.all([
      request(app).post(`/bolle/${bolla}/converti-consegna`).send(payload),
      request(app).post(`/bolle/${bolla}/converti-consegna`).send(payload),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.consegnaId).toBe(second.body.consegnaId);
    scope.consegnaIds.push(first.body.consegnaId);
    const deliveries = await db.select().from(consegneTable).where(eq(consegneTable.id, first.body.consegnaId));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ tipoConsegna: "domicilio", indirizzoConsegna: "Via Snapshot 9", stato: "pianificata" });
    const [updatedBolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bolla));
    expect(updatedBolla).toMatchObject({ consegnaId: first.body.consegnaId, indirizzoConsegna: "Via Snapshot 9", stato: "confermato" });
    const turns = await db.select().from(turniTable).where(and(
      eq(turniTable.centroAscoltoId, centre),
      eq(turniTable.data, payload.dataPrevista),
      eq(turniTable.fascia, "09-13"),
    ));
    expect(turns).toHaveLength(1);
    scope.turnoIds.push(turns[0].id);
    const assignments = await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, turns[0].id));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].volontarioId).toBe(volunteer);
  });

  it("esegue consegna, collegamento bolla e sync turno nella stessa transazione e converge al retry", async () => {
    const centre = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centre });
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const volunteer = await createVolontario(scope, centre);
    const oldVehicle = await createMezzo(scope, { centroId: centre });
    const requestedVehicle = await createMezzo(scope, { centroId: centre });
    const date = "2026-09-02";
    const conflictingTurn = await insertTurno(scope, { centroAscoltoId: centre, data: date, fascia: "09-13", mezzoId: oldVehicle });
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));
    const app = makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre });
    const payload = { indirizzoConsegna: "Via Atomica 2", dataPrevista: date, fasciaOraria: "Mattina", volontarioId: volunteer, mezzoId: requestedVehicle };

    const failed = await request(app).post(`/bolle/${bolla}/converti-consegna`).send(payload);
    expect(failed.status).toBe(409);
    expect(failed.body.error).toContain("mezzo diverso");
    expect((await db.select().from(consegneTable).where(eq(consegneTable.beneficiarioId, beneficiary)))).toHaveLength(0);
    expect((await db.select().from(bolleTable).where(eq(bolleTable.id, bolla)))[0].consegnaId).toBeNull();

    await db.update(turniTable).set({ mezzoId: requestedVehicle }).where(eq(turniTable.id, conflictingTurn));
    const retried = await request(app).post(`/bolle/${bolla}/converti-consegna`).send(payload);
    expect(retried.status).toBe(201);
    scope.consegnaIds.push(retried.body.consegnaId);
    const assignments = await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, conflictingTurn));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].volontarioId).toBe(volunteer);
  });

  it("ripara al retry una conversione storica già collegata ma priva di turno", async () => {
    const centre = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centre });
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const volunteer = await createVolontario(scope, centre);
    const vehicle = await createMezzo(scope, { centroId: centre });
    const delivery = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, dataPrevista: "2026-09-03", mezzoId: vehicle });
    await db.update(consegneTable).set({ volontarioId: volunteer, fasciaOraria: "Pomeriggio", indirizzoConsegna: "Via Retry 3" }).where(eq(consegneTable.id, delivery));
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato", consegnaId: delivery });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));

    const response = await request(makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre }))
      .post(`/bolle/${bolla}/converti-consegna`)
      .send({ indirizzoConsegna: "Via Retry 3", dataPrevista: "2026-09-03", fasciaOraria: "Pomeriggio" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ created: false, consegnaId: delivery });
    const turns = await db.select().from(turniTable).where(and(eq(turniTable.centroAscoltoId, centre), eq(turniTable.data, "2026-09-03"), eq(turniTable.fascia, "14-18")));
    expect(turns).toHaveLength(1);
    scope.turnoIds.push(turns[0].id);
    expect(await db.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, turns[0].id))).toHaveLength(1);
  });

  it("applica semantica rigorosa a mezzoId, fascia e mezzoAltro", async () => {
    const centre = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centre });
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const currentVehicle = await createMezzo(scope, { centroId: centre });
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato", mezzoId: currentVehicle });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));
    const app = makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre });
    const base = { indirizzoConsegna: "Via Validazione 4", dataPrevista: "2026-09-04", fasciaOraria: "Mattina" };

    expect((await request(app).post(`/bolle/${bolla}/converti-consegna`).send({ ...base, mezzoId: "abc" })).status).toBe(400);
    expect((await request(app).post(`/bolle/${bolla}/converti-consegna`).send({ ...base, fasciaOraria: "notte" })).status).toBe(400);
    expect((await request(app).post(`/bolle/${bolla}/converti-consegna`).send({ ...base, dataPrevista: "2026-02-30" })).status).toBe(400);
    expect((await request(app).post(`/bolle/${bolla}/converti-consegna`).send({ ...base, mezzoAltro: true })).status).toBe(400);

    const retainedBolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato", mezzoId: currentVehicle });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, retainedBolla));
    const retained = await request(app).post(`/bolle/${retainedBolla}/converti-consegna`).send(base);
    expect(retained.status).toBe(201);
    scope.consegnaIds.push(retained.body.consegnaId);
    expect((await db.select().from(consegneTable).where(eq(consegneTable.id, retained.body.consegnaId)))[0].mezzoId).toBe(currentVehicle);
    const retainedTurns = await db.select().from(turniTable).where(and(eq(turniTable.centroAscoltoId, centre), eq(turniTable.data, base.dataPrevista), eq(turniTable.fascia, "09-13")));
    scope.turnoIds.push(...retainedTurns.map((turno) => turno.id));

    const withoutVehicle = await request(app).post(`/bolle/${bolla}/converti-consegna`).send({ ...base, mezzoId: null });
    expect(withoutVehicle.status).toBe(201);
    scope.consegnaIds.push(withoutVehicle.body.consegnaId);
    expect((await db.select().from(consegneTable).where(eq(consegneTable.id, withoutVehicle.body.consegnaId)))[0].mezzoId).toBeNull();
  });

  it("rifiuta il conflitto di mezzo sullo stesso giorno e fascia", async () => {
    const centre = await createCentro(scope);
    const otherCentre = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centre });
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const vehicle = await createMezzo(scope, { centroId: centre });
    await insertTurno(scope, { centroAscoltoId: otherCentre, data: "2026-09-06", fascia: "09-13", mezzoId: vehicle });
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));

    const response = await request(makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre }))
      .post(`/bolle/${bolla}/converti-consegna`)
      .send({ indirizzoConsegna: "Via Conflitto 6", dataPrevista: "2026-09-06", fasciaOraria: "Mattina", mezzoId: vehicle });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("già assegnato");
    expect((await db.select().from(consegneTable).where(eq(consegneTable.beneficiarioId, beneficiary)))).toHaveLength(0);
  });

  it("rifiuta mezzo e volontario fuori dominio, fuori scope o oltre carico", async () => {
    const centre = await createCentro(scope);
    const otherCentre = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centre });
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const inactiveVolunteer = await createVolontario(scope, centre);
    const otherVolunteer = await createVolontario(scope, otherCentre);
    const otherVehicle = await createMezzo(scope, { centroId: otherCentre });
    await db.update(volontariTable).set({ attivo: false }).where(eq(volontariTable.id, inactiveVolunteer));
    await db.update(mezziTable).set({ stato: "manutenzione" }).where(eq(mezziTable.id, otherVehicle));
    const app = makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre });
    const base = { indirizzoConsegna: "Via Scope 5", dataPrevista: "2026-09-05", fasciaOraria: "Mattina" };

    for (const extra of [{ volontarioId: inactiveVolunteer }, { volontarioId: otherVolunteer }, { mezzoId: otherVehicle }]) {
      const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
      await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));
      expect((await request(app).post(`/bolle/${bolla}/converti-consegna`).send({ ...base, ...extra })).status).toBe(403);
    }

    const limited = await createVolontario(scope, centre);
    await db.update(volontariTable).set({ maxConsegneTurno: 1 }).where(eq(volontariTable.id, limited));
    const existing = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, dataPrevista: base.dataPrevista });
    await db.update(consegneTable).set({ volontarioId: limited }).where(eq(consegneTable.id, existing));
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));
    expect((await request(app).post(`/bolle/${bolla}/converti-consegna`).send({ ...base, volontarioId: limited })).status).toBe(400);
  });

  it("impedisce di aggirare la conversione associando genericamente una bolla non ritirata", async () => {
    const centre = await createCentro(scope);
    const operator = await createUtente(scope, { centroId: centre });
    const warehouse = await createMagazzino(scope, centre);
    const beneficiary = await createBeneficiario(scope, centre);
    const delivery = await insertConsegna(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse });
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));

    const response = await request(makeScopedApp(consegneRouter, { id: operator, centroAscoltoId: centre }))
      .post(`/consegne/${delivery}/associa-bolla`)
      .send({ bollaId: bolla });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("conversione in consegna domiciliare");
    const [unchanged] = await db.select().from(bolleTable).where(eq(bolleTable.id, bolla));
    expect(unchanged.consegnaId).toBeNull();
  });
});
