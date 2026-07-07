import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { inArray } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  db,
  pool,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import authRouter from "../src/routes/auth";
import configurazioneAmbienteRouter from "../src/routes/configurazione-ambiente";
import superAdminRouter from "../src/routes/super-admin";
import { requireModulo } from "../src/lib/featureFlags";
import {
  ensureFase5Bootstrap,
  getConfigurazioneAmbiente,
  listModuliFunzionali,
  updateConfigurazioneAmbiente,
  updateModuloAmbiente,
  type ConfigurazioneAmbienteDto,
} from "../src/lib/configurazioneAmbiente";
import type { SessionUser } from "../src/middlewares/auth";

const rnd = () => Math.random().toString(36).slice(2, 8);

const createdRoleIds: number[] = [];
const createdUserIds: number[] = [];

let superUser: SessionUser;
let adminUser: SessionUser;
let originalConfig: ConfigurazioneAmbienteDto;
let originalPredittivoAttivo = true;

function appAs(user: SessionUser): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(configurazioneAmbienteRouter);
  app.use(superAdminRouter);
  app.get("/test-predittivo", requireModulo("PREDITTIVO"), (_req, res) => {
    res.status(204).send();
  });
  return app;
}

function authApp(sessionUserId: number): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: sessionUserId,
    };
    next();
  });
  app.use(authRouter);
  return app;
}

async function createAdminUser(isSuperAdmin: boolean): Promise<SessionUser> {
  const suffix = rnd();
  const ruoloNome = `Fase5 Admin ${suffix}`;
  const [role] = await db
    .insert(ruoliTable)
    .values({ nome: ruoloNome, isAdmin: true, aree: [] })
    .returning({ id: ruoliTable.id });
  createdRoleIds.push(role.id);

  const username = `fase5_${suffix}`;
  const [user] = await db
    .insert(utentiTable)
    .values({
      username,
      passwordHash: "test-hash",
      nome: "Fase5",
      cognome: "Admin",
      ruoloId: role.id,
      attivo: true,
      isSuperAdmin,
      mustChangePassword: false,
    })
    .returning({ id: utentiTable.id });
  createdUserIds.push(user.id);

  return {
    id: user.id,
    username,
    nome: "Fase5",
    cognome: "Admin",
    matricola: null,
    ruoloId: role.id,
    ruoloNome,
    centroAscoltoId: null,
    centroAscoltoNome: null,
    cittaId: null,
    cittaNome: null,
    zonaUdsId: null,
    zonaUdsNome: null,
    isSuperAdmin,
    isAdmin: true,
    aree: [],
    mustChangePassword: false,
  };
}

async function restoreConfig(): Promise<void> {
  await updateConfigurazioneAmbiente({
    codiceAmbiente: originalConfig.codiceAmbiente,
    nomeAmbiente: originalConfig.nomeAmbiente,
    nomeAssociazione: originalConfig.nomeAssociazione,
    descrizione: originalConfig.descrizione,
    indirizzo: originalConfig.indirizzo,
    comune: originalConfig.comune,
    provincia: originalConfig.provincia,
    codiceFiscale: originalConfig.codiceFiscale,
    partitaIva: originalConfig.partitaIva,
    email: originalConfig.email,
    telefono: originalConfig.telefono,
    sitoWeb: originalConfig.sitoWeb,
    logoDocumentiUrl: originalConfig.logoDocumentiUrl,
    logoTessereUrl: originalConfig.logoTessereUrl,
    footerDocumenti: originalConfig.footerDocumenti,
    noteLegali: originalConfig.noteLegali,
    privacyTestoBreve: originalConfig.privacyTestoBreve,
    attivo: originalConfig.attivo,
    aggiornatoDaId: null,
  });
}

beforeEach(async () => {
  await ensureFase5Bootstrap();
  originalConfig = await getConfigurazioneAmbiente();
  const predittivo = (await listModuliFunzionali()).find(
    (m) => m.codice === "PREDITTIVO",
  );
  originalPredittivoAttivo = predittivo?.attivo ?? true;
  superUser = await createAdminUser(true);
  adminUser = await createAdminUser(false);
});

afterEach(async () => {
  await restoreConfig();
  await updateModuloAmbiente("PREDITTIVO", originalPredittivoAttivo, null);
  if (createdUserIds.length > 0) {
    await db
      .delete(auditConfigurazioniTable)
      .where(inArray(auditConfigurazioniTable.utenteId, createdUserIds));
    await db.delete(utentiTable).where(inArray(utentiTable.id, createdUserIds.splice(0)));
  }
  if (createdRoleIds.length > 0) {
    await db.delete(ruoliTable).where(inArray(ruoliTable.id, createdRoleIds.splice(0)));
  }
});

afterAll(async () => {
  await pool.end();
});

describe("Fase 5.2 Super Admin e feature flags", () => {
  it("espone isSuperAdmin nella sessione /auth/me", async () => {
    const res = await request(authApp(superUser.id)).get("/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.isSuperAdmin).toBe(true);
    expect(res.body.isAdmin).toBe(true);
  });

  it("riserva gli endpoint /super-admin ai soli Super Admin", async () => {
    const forbidden = await request(appAs(adminUser)).get(
      "/super-admin/configurazione-ambiente",
    );
    expect(forbidden.status).toBe(403);

    const allowed = await request(appAs(superUser)).get(
      "/super-admin/configurazione-ambiente",
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.id).toBe(1);
  });

  it("aggiorna la configurazione ambiente e registra audit", async () => {
    const nomeAmbiente = `Ambiente ${rnd()}`;

    const patch = await request(appAs(superUser))
      .patch("/super-admin/configurazione-ambiente")
      .send({ nomeAmbiente });

    expect(patch.status).toBe(200);
    expect(patch.body.nomeAmbiente).toBe(nomeAmbiente);
    expect(patch.body.aggiornatoDaId).toBe(superUser.id);

    const audit = await request(appAs(superUser))
      .get("/super-admin/audit-configurazioni")
      .query({ limit: "20" });
    expect(audit.status).toBe(200);
    expect(
      audit.body.some(
        (row: { area: string; chiave: string; utenteId: number | null }) =>
          row.area === "configurazione_ambiente" &&
          row.chiave === "singleton" &&
          row.utenteId === superUser.id,
      ),
    ).toBe(true);
  });

  it("gestisce catalogo moduli, toggle e blocco dei moduli core", async () => {
    const list = await request(appAs(superUser)).get("/super-admin/moduli");
    expect(list.status).toBe(200);
    expect(list.body.some((m: { codice: string }) => m.codice === "DASHBOARD")).toBe(true);
    expect(list.body.some((m: { codice: string }) => m.codice === "PREDITTIVO")).toBe(true);

    const disabled = await request(appAs(superUser))
      .patch("/super-admin/moduli/PREDITTIVO")
      .send({ attivo: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.attivo).toBe(false);

    const publicConfig = await request(appAs(superUser)).get("/configurazione-ambiente");
    expect(publicConfig.status).toBe(200);
    expect(publicConfig.body.moduliAttivi).not.toContain("PREDITTIVO");

    const core = await request(appAs(superUser))
      .patch("/super-admin/moduli/DASHBOARD")
      .send({ attivo: false });
    expect(core.status).toBe(400);
  });

  it("requireModulo blocca una route quando il modulo è disabilitato", async () => {
    await updateModuloAmbiente("PREDITTIVO", false, superUser.id);

    const denied = await request(appAs(superUser)).get("/test-predittivo");
    expect(denied.status).toBe(403);

    await updateModuloAmbiente("PREDITTIVO", true, superUser.id);
    const allowed = await request(appAs(superUser)).get("/test-predittivo");
    expect(allowed.status).toBe(204);
  });
});
