/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, pool, ruoliTable } from "@workspace/db";
import { areaGuard } from "../src/middlewares/auth";
import {
  ADMIN_ROLE_NAME,
  LOGISTICA_ROLE_NAME,
  OPERATOR_ROLE_NAME,
  SUPER_ADMIN_ROLE_NAME,
  VOLUNTEER_ROLE_NAME,
  seedRoles,
} from "../src/lib/seedRoles";
import turniRouter from "../src/routes/turni";
import { makeScopedApp } from "./scope-helpers";

type Role = typeof ruoliTable.$inferSelect;
const roleNames = [
  SUPER_ADMIN_ROLE_NAME,
  ADMIN_ROLE_NAME,
  OPERATOR_ROLE_NAME,
  LOGISTICA_ROLE_NAME,
  VOLUNTEER_ROLE_NAME,
];
const roles = new Map<string, Role>();

beforeAll(async () => {
  await seedRoles();
  const seeded = await db
    .select()
    .from(ruoliTable)
    .where(inArray(ruoliTable.nome, roleNames));
  for (const role of seeded) roles.set(role.nome, role);
});

afterAll(async () => {
  await pool.end();
});

function appFor(role: Role, override?: Partial<Role>) {
  const value = { ...role, ...override };
  return makeScopedApp(
    turniRouter,
    {
      id: 900001,
      centroAscoltoId: null,
      areaOperativaId: null,
      aree: value.aree,
      permessi: value.permessi,
      isAdmin: value.isAdmin,
      isSuperAdmin: value.nome === SUPER_ADMIN_ROLE_NAME,
    },
    [areaGuard],
  );
}

describe("RBAC Turni sui ruoli seed reali", () => {
  it("A-B ripristina GET e PUT/PATCH per l'Operatore Sociale standard", async () => {
    const operatore = roles.get(OPERATOR_ROLE_NAME)!;
    expect(operatore.aree).toContain("sociale");
    expect(operatore.permessi).toEqual(
      expect.arrayContaining([
        "logistica.turni.view",
        "logistica.turni.manage",
      ]),
    );
    expect((await request(appFor(operatore)).get("/turni")).status).toBe(200);
    expect(
      (await request(appFor(operatore)).put("/turni").send({})).status,
    ).toBe(400);
    expect(
      (await request(appFor(operatore)).patch("/turni/1/stato").send({}))
        .status,
    ).toBe(400);
  });

  it("C nega il permesso Turni quando manca l'Area Sociale", async () => {
    const logistica = roles.get(LOGISTICA_ROLE_NAME)!;
    expect(logistica.aree).not.toContain("sociale");
    expect(logistica.permessi).toContain("logistica.turni.view");
    expect((await request(appFor(logistica)).get("/turni")).status).toBe(403);
  });

  it("D nega l'Area Sociale quando manca il permesso Turni", async () => {
    const operatore = roles.get(OPERATOR_ROLE_NAME)!;
    const withoutTurni = operatore.permessi.filter(
      (permission) => !permission.startsWith("logistica.turni."),
    );
    expect(
      (
        await request(appFor(operatore, { permessi: withoutTurni })).get(
          "/turni",
        )
      ).status,
    ).toBe(403);
  });

  it("E consente Admin e SuperAdmin e non concede Turni al Volontario", async () => {
    expect(
      (await request(appFor(roles.get(ADMIN_ROLE_NAME)!)).get("/turni")).status,
    ).toBe(200);
    expect(
      (await request(appFor(roles.get(SUPER_ADMIN_ROLE_NAME)!)).get("/turni"))
        .status,
    ).toBe(200);
    const volontario = roles.get(VOLUNTEER_ROLE_NAME)!;
    expect(volontario.permessi).not.toEqual(
      expect.arrayContaining([
        "logistica.turni.view",
        "logistica.turni.manage",
      ]),
    );
    expect((await request(appFor(volontario)).get("/turni")).status).toBe(403);
  });
});
