import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, centriAscoltoTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import centriAscoltoRouter from "../src/routes/centri-ascolto";

let app: Express;
let uploadDir: string;
const centroIds: number[] = [];

function auth(isAdmin = true) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 900001, isAdmin, isSuperAdmin: false, cittaId: null } as NonNullable<typeof req.user>;
    next();
  };
}

async function createCentro(): Promise<number> {
  const [centro] = await db.insert(centriAscoltoTable).values({ nome: `Centro logo ${Date.now()}` }).returning({ id: centriAscoltoTable.id });
  centroIds.push(centro.id);
  return centro.id;
}

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), "bug-05-upload-"));
  process.env.UPLOAD_DIR = uploadDir;
  app = express();
  app.use(express.json());
  app.use(auth());
  app.use("/uploads", express.static(uploadDir, { fallthrough: false, index: false }));
  app.use(centriAscoltoRouter);
});

afterEach(async () => {
  if (centroIds.length) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds));
    centroIds.length = 0;
  }
});

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

describe("logo Centro di Ascolto", () => {
  it("salva un PNG, persiste il riferimento e lo serve dall'URL pubblico", async () => {
    const id = await createCentro();
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const uploaded = await request(app).post(`/centri-ascolto/${id}/logo`).set("Content-Type", "image/png").send(png);

    expect(uploaded.status).toBe(200);
    expect(uploaded.body.logoUrl).toMatch(new RegExp(`^/uploads/centri/${id}/`));
    const [stored] = await db.select({ logoUrl: centriAscoltoTable.logoUrl }).from(centriAscoltoTable).where(inArray(centriAscoltoTable.id, [id]));
    expect(stored.logoUrl).toBe(uploaded.body.logoUrl);

    const image = await request(app).get(uploaded.body.logoUrl);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toMatch(/^image\/png/);
    expect((await request(app).get(`/uploads/centri/${id}/inesistente.png`)).status).toBe(404);
    expect((await request(app).get("/uploads/%2e%2e/package.json")).status).toBe(404);
  });

  it("rifiuta tipo non valido e dimensione oltre 2 MB", async () => {
    const id = await createCentro();
    expect((await request(app).post(`/centri-ascolto/${id}/logo`).set("Content-Type", "application/x-sh").send("echo no")).status).toBe(400);
    expect((await request(app).post(`/centri-ascolto/${id}/logo`).set("Content-Type", "image/png").send(Buffer.alloc(2 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it("richiede un amministratore", async () => {
    const id = await createCentro();
    const limited = express();
    limited.use(auth(false));
    limited.use(centriAscoltoRouter);
    expect((await request(limited).post(`/centri-ascolto/${id}/logo`).set("Content-Type", "image/png").send(Buffer.from("png"))).status).toBe(403);
  });
});
