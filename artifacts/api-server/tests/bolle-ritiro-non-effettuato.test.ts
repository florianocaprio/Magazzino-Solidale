/* @vitest-environment node */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, beneficiariTable, bolleTable, consegneTable, prenotazioniMagazzinoTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bolleRouter from "../src/routes/bolle";
import consegneRouter from "../src/routes/consegne";
import {
  cleanup,
  createBeneficiario,
  createCentro,
  createMagazzino,
  createUtente,
  insertBolla,
  insertConsegna,
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
    const before = await db.select().from(prenotazioniMagazzinoTable).where(eq(prenotazioniMagazzinoTable.bollaId, bolla));
    const response = await request(makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre })).post(`/bolle/${bolla}/ritiro-non-effettuato`).send({ motivo: "Assente" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stato: "confermato", ritiroNonEffettuatoMotivo: "Assente", ritiroNonEffettuatoOperatoreId: operator });
    expect(response.body.ritiroNonEffettuatoAt).toBeTruthy();
    const after = await db.select().from(prenotazioniMagazzinoTable).where(eq(prenotazioniMagazzinoTable.bollaId, bolla));
    expect(after).toEqual(before);
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
    await db.update(beneficiariTable).set({ domicilio: "Via Domicilio Vecchio 1" }).where(eq(beneficiariTable.id, beneficiary));
    const bolla = await insertBolla(scope, { beneficiarioId: beneficiary, magazzinoId: warehouse, stato: "confermato" });
    await db.update(bolleTable).set({ ritiroNonEffettuatoAt: new Date(), ritiroNonEffettuatoOperatoreId: operator }).where(eq(bolleTable.id, bolla));
    const app = makeScopedApp(bolleRouter, { id: operator, centroAscoltoId: centre });
    const payload = { indirizzoConsegna: "Via Snapshot 9", dataPrevista: "2026-09-01", fasciaOraria: "Mattina" };
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
