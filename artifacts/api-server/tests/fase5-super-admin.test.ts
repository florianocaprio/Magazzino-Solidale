import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { auditConfigurazioniTable, db, pool, ruoliTable, systemLogsTable, utentiTable } from "@workspace/db";
import authRouter from "../src/routes/auth";
import configurazioneAmbienteRouter from "../src/routes/configurazione-ambiente";
import impostazioniModuliRouter from "../src/routes/impostazioni-moduli";
import superAdminRouter from "../src/routes/super-admin";
import utentiRouter from "../src/routes/utenti";
import { requireModulo } from "../src/lib/featureFlags";
import { ensureFase5Bootstrap, getConfigurazioneAmbiente, listModuliFunzionali, updateConfigurazioneAmbiente, updateModuloAmbiente, type ConfigurazioneAmbienteDto } from "../src/lib/configurazioneAmbiente";
import type { SessionUser } from "../src/middlewares/auth";
import { loadSessionUser } from "../src/middlewares/auth";
import { DEFAULT_SUPER_ADMIN_USERNAME } from "../src/lib/configurazioneAmbiente";

const rnd = () => Math.random().toString(36).slice(2, 8);

const createdRoleIds: number[] = [];
const createdUserIds: number[] = [];
const createdSystemLogIds: number[] = [];

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
  const [role] = await db.insert(ruoliTable).values({ nome: ruoloNome, isAdmin: true, aree: [] }).returning({ id: ruoliTable.id });
  createdRoleIds.push(role.id);

  const username = `fase5_${suffix}`;
  const email = `${username}@example.org`;
  const [user] = await db
    .insert(utentiTable)
    .values({
      username,
      email,
      emailDaAggiornare: false,
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
    email,
    emailDaAggiornare: false,
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

async function createSystemLog(
  values: Partial<typeof systemLogsTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(systemLogsTable)
    .values({
      evento: "LOGIN_SUCCESS",
      esito: "SUCCESS",
      actorUserId: superUser.id,
      targetUserId: adminUser.id,
      userEmail: `${rnd()}@fase5-log.example.org`,
      username: `fase5_log_${rnd()}`,
      ipAddress: "127.0.0.1",
      userAgent: "Vitest Browser",
      details: { operation: "test" },
      ...values,
    })
    .returning({ id: systemLogsTable.id });
  createdSystemLogIds.push(row.id);
  return row.id;
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
  const predittivo = (await listModuliFunzionali()).find((m) => m.codice === "PREDITTIVO");
  originalPredittivoAttivo = predittivo?.attivo ?? true;
  originalEmporioAttivo = (await listModuliFunzionali()).find((m) => m.codice === "EMPORIO_SOLIDALE")?.attivo ?? true;
  originalUdsAttivo = (await listModuliFunzionali()).find((m) => m.codice === "UDS")?.attivo ?? true;
  superUser = await createAdminUser(true);
  adminUser = await createAdminUser(false);
});

afterEach(async () => {
  await restoreConfig();
  await updateModuloAmbiente("PREDITTIVO", originalPredittivoAttivo, null);
  await updateModuloAmbiente("EMPORIO_SOLIDALE", originalEmporioAttivo, null);
  await updateModuloAmbiente("UDS", originalUdsAttivo, null);
  if (createdSystemLogIds.length > 0) {
    await db
      .delete(systemLogsTable)
      .where(inArray(systemLogsTable.id, createdSystemLogIds.splice(0)));
  }
  if (createdUserIds.length > 0) {
    await db.delete(auditConfigurazioniTable).where(inArray(auditConfigurazioniTable.utenteId, createdUserIds));
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

  it("non sovrascrive le credenziali di un eventuale SuperAdmin tecnico", async () => {
    const [before] = await db
      .select({
        id: utentiTable.id,
        username: utentiTable.username,
        passwordHash: utentiTable.passwordHash,
        isSuperAdmin: utentiTable.isSuperAdmin,
        centroAscoltoId: utentiTable.centroAscoltoId,
        cittaId: utentiTable.cittaId,
        zonaUdsId: utentiTable.zonaUdsId,
        ruoloNome: ruoliTable.nome,
        attivo: utentiTable.attivo,
        mustChangePassword: utentiTable.mustChangePassword,
      })
      .from(utentiTable)
      .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
      .where(eq(utentiTable.username, DEFAULT_SUPER_ADMIN_USERNAME));

    await ensureFase5Bootstrap();

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
        attivo: utentiTable.attivo,
        mustChangePassword: utentiTable.mustChangePassword,
      })
      .from(utentiTable)
      .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
      .where(eq(utentiTable.username, DEFAULT_SUPER_ADMIN_USERNAME));

    if (!before) {
      expect(seeded).toBeUndefined();
      return;
    }

    expect(seeded).toBeTruthy();
    expect(seeded.ruoloNome).toBe("SuperAdmin");
    expect(seeded.isSuperAdmin).toBe(true);
    expect(seeded.centroAscoltoId).toBeNull();
    expect(seeded.cittaId).toBeNull();
    expect(seeded.zonaUdsId).toBeNull();
    expect(seeded.passwordHash).toBe(before.passwordHash);
    expect(seeded.attivo).toBe(before.attivo);
    expect(seeded.mustChangePassword).toBe(before.mustChangePassword);

    const sessionUser = await loadSessionUser(seeded.id);
    expect(sessionUser?.isSuperAdmin).toBe(true);
    expect(sessionUser?.isAdmin).toBe(true);
  });

  it("riserva gli endpoint /super-admin ai soli Super Admin", async () => {
    const forbidden = await request(appAs(adminUser)).get("/super-admin/configurazione-ambiente");
    expect(forbidden.status).toBe(403);

    const allowed = await request(appAs(superUser)).get("/super-admin/configurazione-ambiente");
    expect(allowed.status).toBe(200);
    expect(allowed.body.id).toBe(1);
  });

  it("impedisce a un admin normale di modificare o resettare un SuperAdmin", async () => {
    const patch = await request(appAs(adminUser)).patch(`/utenti/${superUser.id}`).send({ nome: "Non autorizzato" });
    expect(patch.status).toBe(403);

    const reset = await request(appAs(adminUser)).post(`/utenti/${superUser.id}/reset-password`).send({ newPassword: "NuovaPassword1" });
    expect(reset.status).toBe(403);
  });

  it("aggiorna la configurazione ambiente e registra audit", async () => {
    const nomeAmbiente = `Ambiente ${rnd()}`;

    const patch = await request(appAs(superUser)).patch("/super-admin/configurazione-ambiente").send({ nomeAmbiente });

    expect(patch.status).toBe(200);
    expect(patch.body.nomeAmbiente).toBe(nomeAmbiente);
    expect(patch.body.aggiornatoDaId).toBe(superUser.id);

    const audit = await request(appAs(superUser)).get("/super-admin/audit-configurazioni").query({ limit: "20" });
    expect(audit.status).toBe(200);
    expect(audit.body.some((row: { area: string; chiave: string; utenteId: number | null }) => row.area === "configurazione_ambiente" && row.chiave === "singleton" && row.utenteId === superUser.id)).toBe(true);
  });

  it("gestisce catalogo moduli, toggle e blocco dei moduli core", async () => {
    const list = await request(appAs(superUser)).get("/super-admin/moduli");
    expect(list.status).toBe(200);
    expect(list.body.some((m: { codice: string }) => m.codice === "DASHBOARD")).toBe(true);
    expect(list.body.some((m: { codice: string }) => m.codice === "PREDITTIVO")).toBe(true);

    const disabled = await request(appAs(superUser)).patch("/super-admin/moduli/PREDITTIVO").send({ attivo: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.attivo).toBe(false);

    const publicConfig = await request(appAs(superUser)).get("/configurazione-ambiente");
    expect(publicConfig.status).toBe(200);
    expect(publicConfig.body.moduliAttivi).not.toContain("PREDITTIVO");

    const core = await request(appAs(superUser)).patch("/super-admin/moduli/DASHBOARD").send({ attivo: false });
    expect(core.status).toBe(400);
  });

  it("mantiene il PATCH legacy coerente, riservato al Super Admin e con audit", async () => {
    const forbidden = await request(appAs(adminUser)).patch("/impostazioni-moduli").send({ emporioAbilitato: !originalEmporioAttivo });
    expect(forbidden.status).toBe(403);

    const updated = await request(appAs(superUser)).patch("/impostazioni-moduli").send({
      emporioAbilitato: !originalEmporioAttivo,
      unitaStradaAbilitata: !originalUdsAttivo,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.emporioAbilitato).toBe(!originalEmporioAttivo);
    expect(updated.body.unitaStradaAbilitata).toBe(!originalUdsAttivo);

    const publicConfig = await request(appAs(superUser)).get("/configurazione-ambiente");
    expect(publicConfig.body.moduliAttivi.includes("EMPORIO_SOLIDALE")).toBe(!originalEmporioAttivo);
    expect(publicConfig.body.moduliAttivi.includes("UDS")).toBe(!originalUdsAttivo);

    const audit = await request(appAs(superUser)).get("/super-admin/audit-configurazioni").query({ limit: "20" });
    for (const codice of ["EMPORIO_SOLIDALE", "UDS"]) {
      expect(audit.body.some((row: { area: string; chiave: string; azione: string; utenteId: number | null }) => row.area === "moduli_funzionali" && row.chiave === codice && row.azione === "toggle" && row.utenteId === superUser.id)).toBe(true);
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
    expect(denied.body.error).toBe("Modulo NON_ESISTE non abilitato per questo ambiente");
  });

  it("consente al Super Admin di consultare i log di sistema", async () => {
    const logId = await createSystemLog({
      evento: "PASSWORD_RESET_REQUESTED",
      esito: "INFO",
      username: "fase5_log_consulta",
      userEmail: "consulta@fase5-log.example.org",
      details: { route: "/auth/forgot-password" },
    });

    const res = await request(appAs(superUser))
      .get("/super-admin/log-sistema")
      .query({ email: "consulta@fase5-log.example.org" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      id: logId,
      eventType: "PASSWORD_RESET_REQUESTED",
      eventStatus: "INFO",
      username: "fase5_log_consulta",
      userEmail: "consulta@fase5-log.example.org",
    });
  });

  it("nega i log di sistema a un admin non Super Admin", async () => {
    const res = await request(appAs(adminUser)).get("/super-admin/log-sistema");

    expect(res.status).toBe(403);
  });

  it("filtra i log di sistema per intervallo date", async () => {
    await createSystemLog({
      dataOra: new Date("2026-01-05T10:00:00.000Z"),
      userEmail: "date-old@fase5-log.example.org",
      username: "fase5_log_date_old",
    });
    const expectedId = await createSystemLog({
      dataOra: new Date("2026-02-05T10:00:00.000Z"),
      userEmail: "date-new@fase5-log.example.org",
      username: "fase5_log_date_new",
    });

    const res = await request(appAs(superUser))
      .get("/super-admin/log-sistema")
      .query({
        dateFrom: "2026-02-01",
        dateTo: "2026-02-28",
        search: "fase5_log_date",
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe(expectedId);
  });

  it("filtra i log di sistema per evento ed esito", async () => {
    await createSystemLog({
      evento: "LOGIN_SUCCESS",
      esito: "SUCCESS",
      userEmail: "evento-login@fase5-log.example.org",
      username: "fase5_log_evento",
    });
    const expectedId = await createSystemLog({
      evento: "LOGIN_FAILED",
      esito: "FAILED",
      userEmail: "evento-failed@fase5-log.example.org",
      username: "fase5_log_evento",
    });

    const res = await request(appAs(superUser))
      .get("/super-admin/log-sistema")
      .query({
        search: "fase5_log_evento",
        eventType: "LOGIN_FAILED",
        eventStatus: "FAILED",
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe(expectedId);
  });

  it("filtra i log di sistema per email, utente e ip", async () => {
    await createSystemLog({
      userEmail: "altro@fase5-log.example.org",
      username: "fase5_log_altro",
      ipAddress: "10.0.0.1",
    });
    const expectedId = await createSystemLog({
      userEmail: "utente-search@fase5-log.example.org",
      username: "fase5_log_utente_search",
      ipAddress: "10.0.0.99",
    });

    const res = await request(appAs(superUser))
      .get("/super-admin/log-sistema")
      .query({
        search: "utente_search",
        email: "utente-search@fase5-log.example.org",
        ipAddress: "10.0.0.99",
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe(expectedId);
  });

  it("pagina i log di sistema con total, limit e offset", async () => {
    await createSystemLog({
      dataOra: new Date("2026-03-01T10:00:00.000Z"),
      userEmail: "page@fase5-log.example.org",
      username: "fase5_log_page",
    });
    const expectedId = await createSystemLog({
      dataOra: new Date("2026-03-02T10:00:00.000Z"),
      userEmail: "page@fase5-log.example.org",
      username: "fase5_log_page",
    });
    await createSystemLog({
      dataOra: new Date("2026-03-03T10:00:00.000Z"),
      userEmail: "page@fase5-log.example.org",
      username: "fase5_log_page",
    });

    const res = await request(appAs(superUser))
      .get("/super-admin/log-sistema")
      .query({ email: "page@fase5-log.example.org", limit: "1", offset: "1" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.limit).toBe(1);
    expect(res.body.offset).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(expectedId);
  });

  it("sanitizza metadata sensibili nei log di sistema", async () => {
    const logId = await createSystemLog({
      userEmail: "safe-metadata@fase5-log.example.org",
      username: "fase5_log_safe_metadata",
      note: "resetUrl=https://example.org/reset?token=abc",
      details: {
        operation: "reset",
        route: "/auth/reset-password",
        token: "plain-token",
        tokenHash: "hash",
        resetUrl: "https://example.org/reset?token=abc",
        nested: {
          password: "secret",
          reason: "manuale",
        },
        values: ["ok", "https://example.org/reset?token=abc"],
      },
    });

    const res = await request(appAs(superUser))
      .get("/super-admin/log-sistema")
      .query({ email: "safe-metadata@fase5-log.example.org" });

    expect(res.status).toBe(200);
    const row = res.body.items.find((item: { id: number }) => item.id === logId);
    expect(row.details.operation).toBe("reset");
    expect(row.details.route).toBe("/auth/reset-password");
    expect(row.details.token).toBeUndefined();
    expect(row.details.tokenHash).toBeUndefined();
    expect(row.details.resetUrl).toBeUndefined();
    expect(row.details.nested.reason).toBe("manuale");
    expect(row.details.nested.password).toBeUndefined();
    expect(row.details.values[1]).toBe("[redacted-link]");
    expect(row.note).toBe("[redacted-link]");
  });
});
