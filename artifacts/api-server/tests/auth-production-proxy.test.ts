import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, ruoliTable, utentiTable } from "@workspace/db";

const PUBLIC_ORIGIN = "https://magazzino.angeliinmoto.it";
const suffix = Math.random().toString(36).slice(2, 9);
const username = `auth_prod_${suffix}`;
const password = "Auth-Prod-01-Test!";

const previousEnv = {
  APP_ORIGINS: process.env.APP_ORIGINS,
  COOKIE_SECURE: process.env.COOKIE_SECURE,
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE,
};

let app: Express;
let roleId: number;
let userId: number;
let sessionCookie: string | undefined;

beforeAll(async () => {
  process.env.APP_ORIGINS = PUBLIC_ORIGIN;
  process.env.COOKIE_SECURE = "true";
  process.env.COOKIE_SAMESITE = "lax";

  app = (await import("../src/app")).default;

  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `BUG-PROD-01 Auth Admin ${suffix}`,
      aree: ["amministrazione"],
      isAdmin: true,
    })
    .returning({ id: ruoliTable.id });
  roleId = role.id;

  const [user] = await db
    .insert(utentiTable)
    .values({
      username,
      passwordHash: await bcrypt.hash(password, 4),
      nome: "Admin Auth Produzione",
      ruoloId: roleId,
      attivo: true,
    })
    .returning({ id: utentiTable.id });
  userId = user.id;
});

afterAll(async () => {
  if (sessionCookie) {
    await request(app)
      .post("/api/auth/logout")
      .set("Origin", PUBLIC_ORIGIN)
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", sessionCookie);
  }
  if (userId) await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  if (roleId) await db.delete(ruoliTable).where(eq(ruoliTable.id, roleId));

  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("BUG-PROD-01 - sessione dietro reverse proxy HTTPS", () => {
  it("preserva in nginx il protocollo ricevuto dal proxy pubblico", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const config = await readFile(resolve(here, "../../../nginx.conf"), "utf8");

    expect(config).toContain(
      "proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;",
    );
    expect(config).not.toContain("proxy_set_header X-Forwarded-Proto http;");
  });

  it("emette il cookie Secure e riconosce /auth/me via proxy HTTPS", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", PUBLIC_ORIGIN)
      .set("X-Forwarded-Proto", "https")
      .send({ username, password });

    expect(login.status).toBe(200);
    const rawCookie = login.headers["set-cookie"];
    const setCookie = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
    expect(setCookie).toContain("magazzino.sid=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    sessionCookie = setCookie?.split(";", 1)[0];

    const me = await request(app)
      .get("/api/auth/me")
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", sessionCookie!);

    expect(me.status).toBe(200);
    expect(me.body.username).toBe(username);
  });

  it("mantiene il 401 esplicito senza cookie di sessione", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("X-Forwarded-Proto", "https");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Non autenticato");
  });
});
