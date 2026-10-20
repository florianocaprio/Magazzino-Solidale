/* @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  db,
  pool,
  configurazioniCodiciBeneficiariTable as configs,
  progressiviCodiciBeneficiariTable as counters,
  beneficiariTable,
  areeOperativeTable,
  configurazioniMatricoleVolontariTable,
  auditConfigurazioniTable,
} from "@workspace/db";
import beneficiariRouter from "../src/routes/beneficiari";
import superAdminRouter from "../src/routes/super-admin";
import {
  cleanup,
  createAreaOperativa,
  createUtente,
  makeScopedApp,
  newScope,
} from "./scope-helpers";
import { allocateBeneficiaryCode } from "../src/lib/beneficiariCodice";

const scope = newScope();
let userId: number, areaA: number, areaB: number, firstVersion: number;
let volunteerBefore: unknown;
const endpoint = "/super-admin/configurazione-codici-beneficiari";
const config = {
  prefissoAssociazione: "QA",
  includiCodiceArea: true,
  segmentoFisso: "B",
  separatore: "-",
  cifreProgressivo: 3,
  numeroIniziale: 7,
  ambitoProgressivo: "PER_AREA",
};
const app = (superAdmin = true) =>
  makeScopedApp(superAdminRouter, {
    id: userId,
    centroAscoltoId: null,
    isSuperAdmin: superAdmin,
    isAdmin: true,
  });
const beneficiaries = () =>
  makeScopedApp(beneficiariRouter, {
    id: userId,
    centroAscoltoId: null,
    isAdmin: true,
  });
async function save(overrides = {}) {
  const response = await request(app())
    .put(endpoint)
    .send({ ...config, ...overrides });
  expect(response.status, response.text).toBe(200);
  return response.body;
}
async function create(area = areaA, codice?: string) {
  const response = await request(beneficiaries())
    .post("/beneficiari")
    .send({
      nome: "Test",
      cognome: "Codice",
      sesso: "M",
      statoAnagrafica: "provvisoria",
      areaOperativaId: area,
      ...(codice ? { codice } : {}),
    });
  if (response.status === 201) scope.beneficiarioIds.push(response.body.id);
  return response;
}
beforeAll(async () => {
  userId = await createUtente(scope);
  areaA = await createAreaOperativa(scope);
  areaB = await createAreaOperativa(scope);
  await db
    .update(areeOperativeTable)
    .set({ codiceMatricola: "QAA" })
    .where(eq(areeOperativeTable.id, areaA));
  await db
    .update(areeOperativeTable)
    .set({ codiceMatricola: "QAB" })
    .where(eq(areeOperativeTable.id, areaB));
  const [current] = await db
    .select()
    .from(configs)
    .where(eq(configs.attiva, true));
  firstVersion = current.versione;
  volunteerBefore = await db
    .select()
    .from(configurazioniMatricoleVolontariTable);
});
afterAll(async () => {
  await db.execute(
    sql`delete from progressivi_codici_beneficiari where configurazione_id in (select id from configurazioni_codici_beneficiari where versione > ${firstVersion})`,
  );
  await db.delete(configs).where(gt(configs.versione, firstVersion));
  await db
    .update(configs)
    .set({ attiva: true })
    .where(eq(configs.versione, firstVersion));
  await cleanup(scope);
  await pool.end();
});
describe("Codici beneficiari configurabili", () => {
  it("riserva lettura e modifica al Super Admin", async () => {
    expect((await request(app(false)).get(endpoint)).status).toBe(403);
    expect((await request(app(false)).put(endpoint).send(config)).status).toBe(
      403,
    );
  });
  it("salva una versione auditata, espone storico e lascia indipendenti le matricole volontari", async () => {
    const saved = await save();
    expect(saved.esempio).toBe("QA-RM-B-007");
    const response = await request(app()).get(endpoint);
    expect(response.body.storico).toHaveLength(2);
    expect(response.body.configurazione.versione).toBe(firstVersion + 1);
    const [audit] = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(
        and(
          eq(auditConfigurazioniTable.area, "codici_beneficiari"),
          eq(auditConfigurazioniTable.utenteId, userId),
        ),
      );
    expect(audit.valoreNuovo).toMatchObject({ versione: firstVersion + 1 });
    expect(
      await db.select().from(configurazioniMatricoleVolontariTable),
    ).toEqual(volunteerBefore);
  });
  it("alloca codici distinti e consecutivi in concorrenza e separa le Aree", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => create()),
    );
    for (const response of responses)
      expect(response.status, response.text).toBe(201);
    expect(responses.map((r) => r.body.codice).sort()).toEqual([
      "QA-QAA-B-007",
      "QA-QAA-B-008",
      "QA-QAA-B-009",
      "QA-QAA-B-010",
      "QA-QAA-B-011",
    ]);
    expect((await create(areaB)).body.codice).toBe("QA-QAB-B-007");
  });
  it("rifiuta configurazioni troppo lunghe, incoerenti e booleane malformate senza versioni nuove", async () => {
    const before = (await request(app()).get(endpoint)).body.storico.length;
    for (const overrides of [
      { prefissoAssociazione: "ABCDEFGHIJKL", segmentoFisso: "ABCDEFGH" },
      { cifreProgressivo: 2, numeroIniziale: 100 },
      { includiCodiceArea: "false" },
      { separatore: "#" },
    ]) {
      expect(
        (
          await request(app())
            .put(endpoint)
            .send({ ...config, ...overrides })
        ).status,
      ).toBe(400);
    }
    expect((await request(app()).get(endpoint)).body.storico).toHaveLength(
      before,
    );
  });
  it("conserva i codici esistenti e salta collisioni dopo una nuova versione della stessa regola", async () => {
    const [before] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, scope.beneficiarioIds[0]));
    await save();
    expect((await create()).body.codice).toBe("QA-QAA-B-012");
    const [after] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, before.id));
    expect(after).toEqual(before);
  });
  it("usa un progressivo globale e non consuma numeri per codici manuali o inserimenti falliti", async () => {
    await save({
      prefissoAssociazione: "QG",
      includiCodiceArea: false,
      segmentoFisso: null,
      numeroIniziale: 1,
      ambitoProgressivo: "GLOBALE",
    });
    expect((await create(areaA, "MANUALE-QA")).body.codice).toBe("MANUALE-QA");
    await expect(
      db.transaction(async (tx) => {
        expect(await allocateBeneficiaryCode(tx, areaA)).toBe("QG-001");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await create()).body.codice).toBe("QG-001");
    expect((await create(areaB)).body.codice).toBe("QG-002");
  });
  it("rifiuta l'esaurimento in modo controllato", async () => {
    await save({
      prefissoAssociazione: "QE",
      includiCodiceArea: false,
      segmentoFisso: null,
      cifreProgressivo: 2,
      numeroIniziale: 99,
      ambitoProgressivo: "GLOBALE",
    });
    expect((await create()).body.codice).toBe("QE-99");
    const exhausted = await create();
    expect(exhausted.status).toBe(409);
    expect(exhausted.body.error).toMatch(/esaurito/i);
    const active = (await request(app()).get(endpoint)).body.configurazione;
    expect(
      await db
        .select()
        .from(counters)
        .where(
          and(
            eq(counters.ultimoNumero, 99),
            eq(counters.configurazioneId, active.id),
          ),
        ),
    ).toHaveLength(1);
  });
});
