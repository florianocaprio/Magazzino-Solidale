import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, utentiTable, ruoliTable, cittaTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import utentiRouter from "../src/routes/utenti";

let app: Express;
let adminId: number;
let cittaId: number;
let ruoloId: number;
const createdUserIds: number[] = [];

/** Mounts the utenti router behind a stub session for the given admin user. */
function makeApp(sessionUserId: number): Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: sessionUserId,
    };
    next();
  });
  a.use(utentiRouter);
  return a;
}

/** Inserts a user directly in the DB (bypassing the API) and tracks cleanup. */
async function insertUser(values: {
  username: string;
  nome: string;
  cognome?: string | null;
  matricola?: string | null;
  cittaId?: number | null;
  dataCreazione?: Date;
}): Promise<number> {
  const [row] = await db
    .insert(utentiTable)
    .values({
      username: values.username,
      passwordHash: "x",
      nome: values.nome,
      cognome: values.cognome ?? null,
      matricola: values.matricola ?? null,
      ruoloId,
      cittaId: values.cittaId ?? null,
      attivo: true,
      ...(values.dataCreazione ? { dataCreazione: values.dataCreazione } : {}),
    })
    .returning({ id: utentiTable.id });
  createdUserIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  const suffix = Date.now();
  const [c] = await db
    .insert(cittaTable)
    .values({ nome: `Milano Test ${suffix}`, sigla: "MI" })
    .returning({ id: cittaTable.id });
  cittaId = c.id;

  const [r] = await db
    .insert(ruoliTable)
    .values({ nome: `Admin Test ${suffix}`, isAdmin: true, aree: [] })
    .returning({ id: ruoliTable.id });
  ruoloId = r.id;

  // Global admin caller (cittaId null → can edit users of any città).
  adminId = await insertUser({
    username: `admin-test-${suffix}`,
    nome: "Super",
    cognome: "Admin",
    cittaId: null,
  });

  app = makeApp(adminId);
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(utentiTable).where(inArray(utentiTable.id, createdUserIds));
  }
  await db.delete(ruoliTable).where(eq(ruoliTable.id, ruoloId));
  await db.delete(cittaTable).where(eq(cittaTable.id, cittaId));
  await pool.end();
});

describe("PATCH /utenti/:id — auto-generazione matricola in modifica", () => {
  it("genera la matricola quando l'utente non ne ha una (anno di creazione + sigla città)", async () => {
    const id = await insertUser({
      username: `mario-${Date.now()}`,
      nome: "Mario",
      cognome: "Rossi",
      matricola: null,
      cittaId,
      dataCreazione: new Date("2024-06-15T10:00:00Z"),
    });

    const res = await request(app).patch(`/utenti/${id}`).send({ nome: "Mario" });
    expect(res.status).toBe(200);
    // Iniziali MR, anno 2024 → "24", sigla "MI", coda di 6 caratteri.
    expect(res.body.matricola).toMatch(/^MR24-MI-[0-9A-Z][0-9]{5}$/);

    const [row] = await db
      .select({ matricola: utentiTable.matricola })
      .from(utentiTable)
      .where(eq(utentiTable.id, id));
    expect(row.matricola).toBe(res.body.matricola);
  });

  it("usa 'OO' come sigla per un utente senza città", async () => {
    const id = await insertUser({
      username: `luca-${Date.now()}`,
      nome: "Luca",
      cognome: "Bianchi",
      matricola: null,
      cittaId: null,
      dataCreazione: new Date("2025-03-01T10:00:00Z"),
    });

    const res = await request(app).patch(`/utenti/${id}`).send({ attivo: true });
    expect(res.status).toBe(200);
    expect(res.body.matricola).toMatch(/^LB25-OO-[0-9A-Z][0-9]{5}$/);
  });

  it("NON sovrascrive una matricola già presente", async () => {
    const id = await insertUser({
      username: `gia-${Date.now()}`,
      nome: "Anna",
      cognome: "Verdi",
      matricola: "CUSTOM-001",
      cittaId,
    });

    const res = await request(app).patch(`/utenti/${id}`).send({ nome: "Anna" });
    expect(res.status).toBe(200);
    expect(res.body.matricola).toBe("CUSTOM-001");
  });

  it("rispetta una matricola fornita esplicitamente nell'edit", async () => {
    const id = await insertUser({
      username: `expl-${Date.now()}`,
      nome: "Paolo",
      cognome: "Neri",
      matricola: null,
      cittaId,
    });

    const res = await request(app)
      .patch(`/utenti/${id}`)
      .send({ matricola: "MANUALE-9" });
    expect(res.status).toBe(200);
    expect(res.body.matricola).toBe("MANUALE-9");
  });
});
