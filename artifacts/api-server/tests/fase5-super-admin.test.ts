import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  auditConfigurazioniTable,
  db,
  pool,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import authRouter from "../src/routes/auth";
import configurazioneAmbienteRouter from "../src/routes/configurazione-ambiente";
import impostazioniModuliRouter from "../src/routes/impostazioni-moduli";
import superAdminRouter from "../src/routes/super-admin";
import utentiRouter from "../src/routes/utenti";
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
import { loadSessionUser } from "../src/middlewares/auth";
import { DEFAULT_SUPER_ADMIN_USERNAME } from "../src/lib/configurazioneAmbiente";

const rnd = () => Math.random().toString(36).slice(2, 8);

const createdRoleIds: number[] = [];
const createdUserIds: number[] = [];

let superUser: SessionUser;
let adminUser: SessionUser;
let originalConfig: ConfigurazioneAmbienteDto;
let originalPredittivoAttivo = true;
let originalEmporioAttivo = true;
let originalUdsAttivo = true;

function appAs(user: SessionUser): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(configurazioneAmbienteRouter);
  app.use(impostazioniModuliRouter);
  app.use(superAdminRouter);
  app.use(utentiRouter);
  app.get("/test-predittivo", requireModulo("PREDITTIVO"), (_req, res) => {
    res.status(204).send();
  });
  app.get("/test-modulo-inesistente", requireModulo("NON_ESISTE"), (_req, res) => {
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
  originalEmporioAttivo =
    (await listModuliFunzionali()).find((m) => m.codice === "EMPORIO_SOLIDALE")
      ?.attivo ?? true;
  originalUdsAttivo =
    (await listModuliFunzionali()).find((m) => m.codice === "UDS")?.attivo ?? true;
  superUser = await createAdminUser(true);
  adminUser = await createAdminUser(false);
});

afterEach(async () => {
  await restoreConfig();
  await updateModuloAmbiente("PREDITTIVO", originalPredittivoAttivo, null);
  await updateModuloAmbiente("EMPORIO_SOLIDALE", originalEmporioAttivo, null);
  await updateModuloAmbiente("UDS", originalUdsAttivo, null);
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

  it("seeda l'utente tecnico sadmin come SuperAdmin globale", async () => {
    const [seeded] = await db
      .select({
        id: utentiTable.id,
        username: utentiTable.username,
        passwordHash: utentiTable.passwordHash,
        isSuperAdmin: utentiTable.isSuperAdmin,
        centroAscoltoId: utentiTable.centroAscoltoId,
        cittaId: utentiTable.cittaId,
        zonaUdsId: utentiTable.zonaUdsId,
        ruoloNome: ruoliTable.nome,
      })
      .from(utentiTable)
      .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
      .where(eq(utentiTable.username, DEFAULT_SUPER_ADMIN_USERNAME));

    expect(seeded).toBeTruthy();
    expect(seeded.ruoloNome).toBe("SuperAdmin");
    expect(seeded.isSuperAdmin).toBe(true);
    expect(seeded.centroAscoltoId).toBeNull();
    expect(seeded.cittaId).toBeNull();
    expect(seeded.zonaUdsId).toBeNull();
    expect(await bcrypt.compare("Apollo13!", seeded.passwordHash)).toBe(true);

    const sessionUser = await loadSessionUser(seeded.id);
    expect(sessionUser?.isSuperAdmin).toBe(true);
    expect(sessionUser?.isAdmin).toBe(true);
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

  it("impedisce a un admin normale di modificare o resettare un SuperAdmin", async () => {
    const [seeded] = await db
      .select({ id: utentiTable.id })
      .from(utentiTable)
      .where(eq(utentiTable.username, DEFAULT_SUPER_ADMIN_USERNAME));

    const patch = await request(appAs(adminUser))
      .patch(`/utenti/${seeded.id}`)
      .send({ nome: "Non autorizzato" });
    expect(patch.status).toBe(403);

    const reset = await request(appAs(adminUser))
      .post(`/utenti/${seeded.id}/reset-password`)
      .send({ newPassword: "NuovaPassword1" });
    expect(reset.status).toBe(403);
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

  it("mantiene il PATCH legacy coerente, riservato al Super Admin e con audit", async () => {
    const forbidden = await request(appAs(adminUser))
      .patch("/impostazioni-moduli")
      .send({ emporioAbilitato: !originalEmporioAttivo });
    expect(forbidden.status).toBe(403);

    const updated = await request(appAs(superUser))
      .patch("/impostazioni-moduli")
      .send({
        emporioAbilitato: !originalEmporioAttivo,
        unitaStradaAbilitata: !originalUdsAttivo,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.emporioAbilitato).toBe(!originalEmporioAttivo);
    expect(updated.body.unitaStradaAbilitata).toBe(!originalUdsAttivo);

    const publicConfig = await request(appAs(superUser)).get("/configurazione-ambiente");
    expect(publicConfig.body.moduliAttivi.includes("EMPORIO_SOLIDALE")).toBe(
      !originalEmporioAttivo,
    );
    expect(publicConfig.body.moduliAttivi.includes("UDS")).toBe(!originalUdsAttivo);

    const audit = await request(appAs(superUser))
      .get("/super-admin/audit-configurazioni")
      .query({ limit: "20" });
    for (const codice of ["EMPORIO_SOLIDALE", "UDS"]) {
      expect(
        audit.body.some(
          (row: {
            area: string;
            chiave: string;
            azione: string;
            utenteId: number | null;
          }) =>
            row.area === "moduli_funzionali" &&
            row.chiave === codice &&
            row.azione === "toggle" &&
            row.utenteId === superUser.id,
        ),
      ).toBe(true);
    }
  });

  it("requireModulo lascia passare il modulo attivo e blocca quello disabilitato", async () => {
    await updateModuloAmbiente("PREDITTIVO", false, superUser.id);

    const denied = await request(appAs(superUser)).get("/test-predittivo");
    expect(denied.status).toBe(403);

    await updateModuloAmbiente("PREDITTIVO", true, superUser.id);
    const allowed = await request(appAs(superUser)).get("/test-predittivo");
    expect(allowed.status).toBe(204);
  });

  it("requireModulo blocca in sicurezza un codice modulo inesistente", async () => {
    const denied = await request(appAs(superUser)).get("/test-modulo-inesistente");

    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe(
      "Modulo NON_ESISTE non abilitato per questo ambiente",
    );
  });
});
