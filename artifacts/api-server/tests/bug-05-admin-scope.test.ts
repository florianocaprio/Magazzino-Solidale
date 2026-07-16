import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { db, pool, cittaTable, ruoliTable, utentiTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import utentiRouter from "../src/routes/utenti";
import ruoliRouter from "../src/routes/ruoli";

const ids = { utenti: [] as number[], ruoli: [] as number[], citta: [] as number[] };
let areaA: number;
let areaB: number;
let limitedRole: number;
let widerRole: number;
let limitedAdmin: number;
let otherUser: number;

function appAs(user: { id: number; cittaId: number | null; isSuperAdmin?: boolean; aree: string[]; ruoloId: number }): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: user.id,
      username: `test-${user.id}`,
      nome: "Test",
      cognome: "Admin",
      ruoloId: user.ruoloId,
      ruoloNome: "Test role",
      centroAscoltoId: null,
      cittaId: user.cittaId,
      zonaUdsId: null,
      isSuperAdmin: user.isSuperAdmin ?? false,
      isAdmin: true,
      aree: user.aree,
      mustChangePassword: false,
    };
    next();
  });
  app.use(utentiRouter);
  app.use(ruoliRouter);
  return app;
}

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [a, b] = await db.insert(cittaTable).values([{ nome: `Area A ${suffix}` }, { nome: `Area B ${suffix}` }]).returning({ id: cittaTable.id });
  areaA = a.id; areaB = b.id; ids.citta.push(areaA, areaB);
  const [limited, wider] = await db.insert(ruoliTable).values([
    { nome: `Admin limitato ${suffix}`, isAdmin: true, aree: ["sociale"] },
    { nome: `Admin ampio ${suffix}`, isAdmin: true, aree: ["sociale", "amministrazione"] },
  ]).returning({ id: ruoliTable.id });
  limitedRole = limited.id; widerRole = wider.id; ids.ruoli.push(limitedRole, widerRole);
  const [admin, other] = await db.insert(utentiTable).values([
    { username: `limited_${suffix}`, passwordHash: "x", nome: "Admin", cognome: "Limitato", ruoloId: limitedRole, cittaId: areaA, matricola: `LIM-${suffix}` },
    { username: `other_${suffix}`, passwordHash: "x", nome: "Altro", cognome: "Utente", ruoloId: limitedRole, cittaId: areaA, matricola: `OTH-${suffix}` },
  ]).returning({ id: utentiTable.id });
  limitedAdmin = admin.id; otherUser = other.id; ids.utenti.push(limitedAdmin, otherUser);
});

afterEach(async () => {
  if (ids.utenti.length) await db.delete(utentiTable).where(inArray(utentiTable.id, ids.utenti.splice(0)));
  if (ids.ruoli.length) await db.delete(ruoliTable).where(inArray(ruoliTable.id, ids.ruoli.splice(0)));
  if (ids.citta.length) await db.delete(cittaTable).where(inArray(cittaTable.id, ids.citta.splice(0)));
});

afterAll(async () => { await pool.end(); });

describe("BUG 5.7 - amministratore territorialmente limitato", () => {
  const limitedApp = () => appAs({ id: limitedAdmin, cittaId: areaA, ruoloId: limitedRole, aree: ["sociale"] });

  it("mantiene la propria Area A", async () => {
    const response = await request(limitedApp()).patch(`/utenti/${limitedAdmin}`).send({ cittaId: areaA, nome: "Admin aggiornato" });
    expect(response.status).toBe(200);
    expect(response.body.cittaId).toBe(areaA);
  });

  it("rifiuta Area B e accesso globale sul proprio profilo senza aggiornamenti parziali", async () => {
    const areaBResponse = await request(limitedApp()).patch(`/utenti/${limitedAdmin}`).send({ cittaId: areaB, nome: "Non applicare" });
    expect(areaBResponse.status).toBe(403);
    const globalResponse = await request(limitedApp()).patch(`/utenti/${limitedAdmin}`).send({ cittaId: null });
    expect(globalResponse.status).toBe(403);
    const [stored] = await db.select().from(utentiTable).where(inArray(utentiTable.id, [limitedAdmin]));
    expect(stored.cittaId).toBe(areaA);
    expect(stored.nome).toBe("Admin");
  });

  it("rifiuta Area B su un altro utente e un ruolo funzionale più ampio", async () => {
    expect((await request(limitedApp()).patch(`/utenti/${otherUser}`).send({ cittaId: areaB })).status).toBe(403);
    expect((await request(limitedApp()).patch(`/utenti/${otherUser}`).send({ ruoloId: widerRole })).status).toBe(403);
  });

  it("rifiuta la modifica dei ruoli condivisi", async () => {
    expect((await request(limitedApp()).patch(`/ruoli/${limitedRole}`).send({ aree: ["sociale", "amministrazione"] })).status).toBe(403);
  });

  it("consente al Super Admin di assegnare Area B", async () => {
    const superApp = appAs({ id: 999999, cittaId: null, ruoloId: widerRole, aree: ["sociale", "amministrazione"], isSuperAdmin: true });
    const response = await request(superApp).patch(`/utenti/${otherUser}`).send({ cittaId: areaB });
    expect(response.status).toBe(200);
    expect(response.body.cittaId).toBe(areaB);
  });

  it("rifiuta un'area inesistente", async () => {
    const superApp = appAs({ id: 999999, cittaId: null, ruoloId: widerRole, aree: ["sociale", "amministrazione"], isSuperAdmin: true });
    expect((await request(superApp).patch(`/utenti/${otherUser}`).send({ cittaId: 2_000_000_000 })).status).toBe(400);
  });
});
