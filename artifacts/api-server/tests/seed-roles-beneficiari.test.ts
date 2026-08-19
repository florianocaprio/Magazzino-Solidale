import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { areaGuard } from "../src/middlewares/auth";
import {
  defaultEmporioPermissions,
  roleAreasAfterEmporioSeed,
} from "../src/lib/seedRoles";

function appWithAreas(aree: string[]): Express {
  const app = express();
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      cittaId: 1,
      centroAscoltoId: 1,
      zonaUdsId: null,
      aree,
      permessi: ["credito.view", "emporio.access.view", "emporio.access.manage"],
      isAdmin: false,
      isSuperAdmin: false,
    } as NonNullable<typeof req.user>;
    next();
  });
  app.use(areaGuard);
  for (const path of [
    "/cassa-emporio/test",
    "/accessi-emporio/test",
    "/credito-solidale/test",
    "/spese-emporio/test",
    "/interventi/test",
  ]) {
    app.get(path, (_req, res) => res.status(204).send());
  }
  return app;
}

describe("permessi del ruolo Emporio standard", () => {
  it("usa le API dedicate senza ereditare beneficiari.view", () => {
    expect(defaultEmporioPermissions([
      "beneficiari.view",
      "permesso.custom",
    ])).toEqual(expect.arrayContaining([
      "credito.view",
      "emporio.access.view",
      "emporio.access.manage",
      "permesso.custom",
    ]));
    expect(defaultEmporioPermissions(["beneficiari.view"])).not.toContain("beneficiari.view");
  });

  it("rimuove Sociale dal ruolo standard senza modificare ruoli custom", () => {
    expect(roleAreasAfterEmporioSeed("Emporio", [
      "generale",
      "magazzino",
      "sociale",
    ])).toEqual(["generale", "magazzino", "emporio"]);
    expect(roleAreasAfterEmporioSeed("Emporio personalizzato", [
      "generale",
      "sociale",
    ])).toEqual(["generale", "sociale"]);
  });

  it.each([
    "/cassa-emporio/test",
    "/accessi-emporio/test",
    "/credito-solidale/test",
    "/spese-emporio/test",
  ])("mantiene accessibile il flusso Emporio %s senza area Sociale", async (path) => {
    expect((await request(appWithAreas(["generale", "magazzino", "emporio"])).get(path)).status).toBe(204);
  });

  it("nega gli Interventi Sociali al ruolo Emporio standard", async () => {
    expect((await request(appWithAreas(["generale", "magazzino", "emporio"])).get("/interventi/test")).status).toBe(403);
  });
});
