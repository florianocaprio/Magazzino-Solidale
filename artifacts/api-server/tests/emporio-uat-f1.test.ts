import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  beneficiariTable,
  areeOperativeTable,
  centriAscoltoTable,
  magazziniTable,
  ruoliTable,
  utentiTable,
  emporioAbilitazioniTable,
  tessereBeneficiariTable,
  menseTable,
  mensaAbilitazioniTable,
  prodottiTable,
  lottiTable,
} from "@workspace/db";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import {
  AREA_PERMISSION_MAP,
  ALL_PERMISSION_KEYS,
} from "../src/lib/permissions";
import { defaultSocialOperatorPermissions } from "../src/lib/seedRoles";

beforeAll(async () => {
  const u = new URL(process.env.DATABASE_URL!);
  if (
    process.env.M62A_F1_DISPOSABLE_DB !== "verified" ||
    u.hostname !== "127.0.0.1" ||
    u.port !== "58621" ||
    u.pathname !== "/m62a"
  )
    throw Error("F1 requires isolated disposable PostgreSQL");
  await updateModuloAmbiente("EMPORIO_SOLIDALE", true);
  await updateModuloAmbiente("CREDITO_SOLIDALE", true);
});
afterAll(async () => {
  await pool.end();
});
async function fixture() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [area] = await db
    .insert(areeOperativeTable)
    .values({ nome: `F1 ${suffix}` })
    .returning();
  const centers = await db
    .insert(centriAscoltoTable)
    .values(
      [1, 2, 3].map((n) => ({
        nome: `F1 C${n} ${suffix}`,
        areaOperativaId: area.id,
      })),
    )
    .returning();
  const warehouses = await db
    .insert(magazziniTable)
    .values(
      [1, 2].map((n) => ({
        codice: `F1-${n}-${suffix}`,
        nome: `F1 Emporio ${n}`,
        tipoMagazzino: "emporio",
        areaOperativaId: area.id,
        centroAscoltoId: centers[2].id,
      })),
    )
    .returning();
  const [beneficiary] = await db
    .insert(beneficiariTable)
    .values({
      codice: `F1-${suffix}`,
      nome: "Anna Maria",
      cognome: "Rossi",
      areaOperativaId: area.id,
      centroAscoltoId: centers[1].id,
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
      creditoSolidaleSaldo: "100.00",
      creditoSolidaleMensileAssegnato: "50.00",
      magazzinoEmporioPreferitoId: warehouses[0].id,
    })
    .returning();
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `F1-${suffix}`,
      aree: ["emporio", "sociale"],
      permessi: [
        "emporio.access.view",
        "emporio.access.manage",
        "emporio.cassa.view",
        "emporio.cassa.operate",
        "credito.view",
        "credito.adjust",
        "credito.quota.manage",
        "emporio.eligibility.manage",
      ],
    })
    .returning();
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `f1_${suffix}`,
      nome: "Operatore test F1",
      passwordHash: await bcrypt.hash("F1-Synthetic-password-only", 4),
      ruoloId: role.id,
      areaOperativaId: area.id,
      centroAscoltoId: centers[0].id,
    })
    .returning();
  const { default: app } = await import("../src/app");
  const agent = request.agent(app);
  expect(
    (
      await agent.post("/api/auth/login").send({
        username: user.username,
        password: "F1-Synthetic-password-only",
      })
    ).status,
  ).toBe(200);
  return { area, centers, warehouses, beneficiary, role, user, agent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function directoryActor(f: Fixture) {
  await db
    .update(ruoliTable)
    .set({ permessi: [...f.role.permessi, "beneficiari.view"] })
    .where(eq(ruoliTable.id, f.role.id));
  await db
    .update(utentiTable)
    .set({ centroAscoltoId: f.centers[1].id })
    .where(eq(utentiTable.id, f.user.id));
}
async function enable(f: Fixture, stato = "attivo") {
  // Il diritto è concesso dal Sociale nel suo Centro; poi il cassiere torna
  // al Centro 1, distinto sia dal beneficiario (2) sia dall'Emporio (3).
  await db
    .update(utentiTable)
    .set({ centroAscoltoId: f.centers[1].id })
    .where(eq(utentiTable.id, f.user.id));
  const r = await f.agent
    .post(`/api/emporio/beneficiari/${f.beneficiary.id}/abilitazione`)
    .send({ stato, motivo: `Decisione esplicita ${stato}` });
  expect(r.status, r.text).toBe(200);
  await db
    .update(utentiTable)
    .set({ centroAscoltoId: f.centers[0].id })
    .where(eq(utentiTable.id, f.user.id));
  return r;
}
const search = (f: Fixture, search: string, extra = {}) =>
  f.agent
    .get("/api/accessi-emporio/beneficiari/ricerca")
    .query({ search, magazzinoEmporioId: f.warehouses[1].id, ...extra });
const create = (f: Fixture, extra = {}) =>
  f.agent.post("/api/accessi-emporio").send({
    beneficiarioId: f.beneficiary.id,
    magazzinoEmporioId: f.warehouses[1].id,
    dataOraInizio: "2026-10-21T09:00:00Z",
    ...extra,
  });
async function facts() {
  return (
    await pool.query(
      "select (select count(*) from movimenti)::int movimenti,(select count(*) from bolle)::int bolle,(select count(*) from scarichi)::int scarichi,(select count(*) from spese_emporio)::int spese,(select count(*) from credito_solidale_movimenti)::int credito,(select coalesce(sum(quantita_residua),0)::text from lotti) stock",
    )
  ).rows[0];
}
describe("M6.2-A-F1 UAT", () => {
  it("F3: luca returns the actual matching IDs across Centers; ID lookup does not invent a name", async () => {
    const f = await fixture();
    await enable(f);
    await db
      .update(beneficiariTable)
      .set({ nome: "Luca", cognome: "Romano" })
      .where(eq(beneficiariTable.id, f.beneficiary.id));
    const [other] = await db
      .insert(beneficiariTable)
      .values({
        codice: `F3-${f.beneficiary.id}`,
        nome: "Simone",
        cognome: "De Luca",
        areaOperativaId: f.area.id,
        centroAscoltoId: f.centers[0].id,
        creditoSolidaleAbilitato: true,
        creditoSolidaleStato: "attivo",
      })
      .returning();
    await db.insert(emporioAbilitazioniTable).values({
      beneficiarioId: other.id,
      areaOperativaId: f.area.id,
      operatoreId: f.user.id,
      stato: "attivo",
      motivo: "Synthetic F3",
    });
    const found = await search(f, "luca", { includiNonPianificabili: true });
    expect(found.status, found.text).toBe(200);
    expect(
      found.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toEqual([other.id, f.beneficiary.id]);
    expect(
      found.body.every((b: { pianificabile: boolean }) => b.pianificabile),
    ).toBe(true);
    const deep = await f.agent
      .get("/api/accessi-emporio/beneficiari/ricerca")
      .query({
        beneficiarioId: other.id,
        magazzinoEmporioId: f.warehouses[1].id,
        includiNonPianificabili: true,
      });
    expect(deep.body).toEqual([
      expect.objectContaining({
        beneficiarioId: other.id,
        beneficiarioNome: "De Luca Simone",
      }),
    ]);
    expect((await create(f)).status).toBe(201);
    expect(
      (
        await db
          .select()
          .from(beneficiariTable)
          .where(eq(beneficiariTable.id, f.beneficiary.id))
      )[0].centroAscoltoId,
    ).toBe(f.centers[1].id);
  });

  it.each([
    "credito_non_abilitato",
    "credito_non_attivo",
    "emporio_non_abilitato",
    "emporio_sospeso",
    "emporio_revocato",
    "emporio_programmato",
    "centro_non_valido",
    "beneficiario_non_attivo",
  ])(
    "F3: diagnostic %s is found but POST still denied, no stock/credit changes",
    async (reason) => {
      const f = await fixture();
      if (reason !== "emporio_non_abilitato") await enable(f);
      if (reason === "credito_non_abilitato")
        await db
          .update(beneficiariTable)
          .set({ creditoSolidaleAbilitato: false })
          .where(eq(beneficiariTable.id, f.beneficiary.id));
      if (reason === "credito_non_attivo")
        await db
          .update(beneficiariTable)
          .set({ creditoSolidaleStato: "sospeso" })
          .where(eq(beneficiariTable.id, f.beneficiary.id));
      if (reason === "beneficiario_non_attivo")
        await db
          .update(beneficiariTable)
          .set({ attivo: false })
          .where(eq(beneficiariTable.id, f.beneficiary.id));
      if (reason === "centro_non_valido")
        await db
          .update(centriAscoltoTable)
          .set({ attivo: false })
          .where(eq(centriAscoltoTable.id, f.centers[1].id));
      if (["emporio_sospeso", "emporio_revocato"].includes(reason))
        await enable(f, reason.replace("emporio_", ""));
      if (reason === "emporio_programmato")
        await pool.query(
          "update emporio_abilitazioni set data_effetto=now()+interval '1 day' where beneficiario_id=$1",
          [f.beneficiary.id],
        );
      const found = await search(f, "Anna", { includiNonPianificabili: true });
      expect(found.status, found.text).toBe(200);
      expect(found.body).toEqual([
        expect.objectContaining({
          beneficiarioId: f.beneficiary.id,
          pianificabile: false,
          motiviNonPianificabile: [reason],
        }),
      ]);
      expect(found.body[0]).not.toHaveProperty("beneficiarioCodiceFiscale");
      expect((await search(f, "Anna")).body).toEqual([]);
      const before = await facts();
      const planned = await create(f);
      expect(planned.status, planned.text).toBe(400);
      expect(await facts()).toEqual(before);
      expect(
        (
          await pool.query(
            "select count(*)::int n from consegne where beneficiario_id=$1",
            [f.beneficiary.id],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );

  it("F3: diagnostic lookup cannot cross Area, bypass grants or disclose financial values without credito.view", async () => {
    const f = await fixture(),
      other = await fixture();
    await enable(f);
    await enable(other);
    const denied = await search(f, "Anna", {
      includiNonPianificabili: true,
      beneficiarioId: other.beneficiary.id,
    });
    expect(denied.status).toBe(200);
    expect(denied.body).toEqual([]);
    await db
      .update(ruoliTable)
      .set({ permessi: f.role.permessi.filter((p) => p !== "credito.view") })
      .where(eq(ruoliTable.id, f.role.id));
    const found = await search(f, "Anna", { includiNonPianificabili: true });
    expect(found.status).toBe(200);
    expect(found.body[0].saldoCreditoSolidale).toBeNull();
    expect(found.body[0].quotaMensileAssegnata).toBeNull();
    await db
      .update(ruoliTable)
      .set({ permessi: [] })
      .where(eq(ruoliTable.id, f.role.id));
    expect(
      (await search(f, "Anna", { includiNonPianificabili: true })).status,
    ).toBe(403);
  });
  it.each(["non_abilitato", "attivo", "sospeso", "revocato", "programmato"])(
    "F2 B01–B05/B14–B15: canonical effective state %s agrees across batch, detail, search and HTTP",
    async (state) => {
      const f = await fixture();
      if (state !== "non_abilitato") {
        await enable(f);
        if (["sospeso", "revocato"].includes(state)) await enable(f, state);
        if (state === "programmato")
          await pool.query(
            "update emporio_abilitazioni set data_effetto=now()+interval '1 day' where beneficiario_id=$1",
            [f.beneficiary.id],
          );
      }
      await directoryActor(f);
      const detail = await f.agent.get(
        `/api/emporio/beneficiari/${f.beneficiary.id}/abilitazione`,
      );
      expect(detail.status, detail.text).toBe(200);
      expect(detail.body.statoEffettivo).toBe(state);
      const batch = await f.agent
        .get("/api/emporio/abilitazioni/riepilogo-beneficiari")
        .query({ beneficiarioIds: String(f.beneficiary.id) });
      expect(batch.status, batch.text).toBe(200);
      expect(batch.body).toEqual([
        {
          beneficiarioId: f.beneficiary.id,
          areaOperativaId: f.area.id,
          stato: state,
        },
      ]);
      const found = await search(f, "Anna");
      expect(found.status, found.text).toBe(200);
      expect(
        found.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
      ).toEqual(state === "attivo" ? [f.beneficiary.id] : []);
      const cassa = await f.agent
        .get("/api/cassa-emporio/beneficiari/ricerca")
        .query({ magazzinoEmporioId: f.warehouses[1].id, q: "Anna" });
      expect(cassa.status, cassa.text).toBe(200);
      expect(
        cassa.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
      ).toEqual(state === "attivo" ? [f.beneficiary.id] : []);
      const before = await facts();
      const planned = await create(f);
      expect(planned.status, planned.text).toBe(state === "attivo" ? 201 : 400);
      expect(await facts()).toEqual(before);
      expect(
        (
          await pool.query(
            "select count(*)::int n from consegne where beneficiario_id=$1",
            [f.beneficiary.id],
          )
        ).rows[0].n,
      ).toBe(state === "attivo" ? 1 : 0);
    },
  );

  it("F2 B20: batch is bounded, scoped to the Social directory and exposes no credit or dossier", async () => {
    const f = await fixture(),
      other = await fixture();
    await directoryActor(f);
    const endpoint = "/api/emporio/abilitazioni/riepilogo-beneficiari";
    const result = await f.agent.get(endpoint).query({
      beneficiarioIds: [f.beneficiary.id, other.beneficiary.id].join(","),
    });
    expect(result.status, result.text).toBe(200);
    expect(result.body).toEqual([
      {
        beneficiarioId: f.beneficiary.id,
        areaOperativaId: f.area.id,
        stato: "non_abilitato",
      },
    ]);
    await db
      .update(utentiTable)
      .set({ centroAscoltoId: f.centers[0].id })
      .where(eq(utentiTable.id, f.user.id));
    expect(
      (
        await f.agent
          .get(endpoint)
          .query({ beneficiarioIds: String(f.beneficiary.id) })
      ).body,
    ).toEqual([]);
    expect(
      (await f.agent.get(endpoint).query({ beneficiarioIds: "1,bad" })).status,
    ).toBe(400);
    expect(
      (
        await f.agent.get(endpoint).query({
          beneficiarioIds: Array.from({ length: 101 }, (_, i) => i + 1).join(
            ",",
          ),
        })
      ).status,
    ).toBe(400);
  });

  it("F2 B10/B11: generic search only marks exact valid registered cards, never name matches", async () => {
    const f = await fixture();
    await enable(f);
    const code = `opaque-${f.beneficiary.id}`;
    await db
      .insert(tessereBeneficiariTable)
      .values({ beneficiarioId: f.beneficiary.id, codice: code });
    expect((await search(f, "Anna")).body[0].tesseraCorrispondente).toBe(false);
    expect((await search(f, code)).body[0].tesseraCorrispondente).toBe(true);
    await db
      .update(tessereBeneficiariTable)
      .set({ stato: "revocata", dataRevoca: new Date() })
      .where(eq(tessereBeneficiariTable.codice, code));
    expect((await search(f, code)).body).toEqual([]);
  });

  it("F2 B21: revocation preserves historical access and lawful cancellation, blocks editing and confirmation", async () => {
    const f = await fixture();
    await enable(f);
    const created = await create(f);
    expect(created.status, created.text).toBe(201);
    await enable(f, "revocato");
    const before = await facts();
    expect(
      (await f.agent.get(`/api/accessi-emporio/${created.body.id}`)).status,
    ).toBe(200);
    expect(
      (
        await f.agent
          .get("/api/accessi-emporio")
          .query({ beneficiarioId: f.beneficiary.id })
      ).body.map((a: { id: number }) => a.id),
    ).toContain(created.body.id);
    expect(
      (
        await f.agent.patch(`/api/accessi-emporio/${created.body.id}`).send({
          beneficiarioId: f.beneficiary.id,
          magazzinoEmporioId: f.warehouses[1].id,
          dataOraInizio: "2026-10-23T09:00:00Z",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.agent
          .patch(`/api/accessi-emporio/${created.body.id}/stato`)
          .send({ statoAccessoEmporio: "confermato" })
      ).status,
    ).toBe(400);
    const cancelled = await f.agent
      .patch(`/api/accessi-emporio/${created.body.id}/stato`)
      .send({
        statoAccessoEmporio: "annullato",
        motivoAnnullamento: "Revoca servizio",
      });
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(await facts()).toEqual(before);
  });
  it("dedicated grant is selectable explicitly, never added to ordinary Social defaults", () => {
    expect(ALL_PERMISSION_KEYS).toContain("emporio.eligibility.manage");
    expect(AREA_PERMISSION_MAP.sociale).toContain("emporio.eligibility.manage");
    expect(defaultSocialOperatorPermissions([])).not.toContain(
      "emporio.eligibility.manage",
    );
    expect(defaultSocialOperatorPermissions(["custom.permission"])).toContain(
      "custom.permission",
    );
  });
  it("SQL enforces unique current right, valid state/motive and actor FK", async () => {
    const f = await fixture();
    await enable(f);
    const insert = (
      beneficiary: number,
      state: string,
      actor: number,
      motive: string,
    ) =>
      pool.query(
        "insert into emporio_abilitazioni(beneficiario_id,area_operativa_id,stato,operatore_id,motivo) values($1,$2,$3,$4,$5)",
        [beneficiary, f.area.id, state, actor, motive],
      );
    await expect(
      insert(f.beneficiary.id, "attivo", f.user.id, "Duplicato"),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      insert(f.beneficiary.id, "inesistente", f.user.id, "Stato errato"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      insert(f.beneficiary.id, "attivo", f.user.id, " "),
    ).rejects.toMatchObject({ code: "23514" });
    // Remove this synthetic current right to isolate FK from uniqueness.
    await pool.query(
      "delete from emporio_abilitazioni where beneficiario_id=$1",
      [f.beneficiary.id],
    );
    await expect(
      pool.query(
        "insert into emporio_abilitazioni(beneficiario_id,area_operativa_id,stato,operatore_id,motivo) values($1,$2,'attivo',2147483647,'FK errata')",
        [f.beneficiary.id, f.centers[0].areaOperativaId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("T01/F1: operational Empori include other Centers of the same Area", async () => {
    const f = await fixture();
    const r = await f.agent.get("/api/emporio/magazzini");
    expect(r.status, r.text).toBe(200);
    expect(r.body.map((x: { id: number }) => x.id)).toEqual(
      expect.arrayContaining(f.warehouses.map((x) => x.id)),
    );
  });
  it("T04/T06/T16: cross-Center planning, preferred warehouse never overrides choice, no stock/credit", async () => {
    const f = await fixture();
    await enable(f);
    const r = await search(f, "Rossi Anna");
    expect(r.status, r.text).toBe(200);
    expect(
      r.body.map((b: { beneficiarioId: number }) => b.beneficiarioId),
    ).toEqual([f.beneficiary.id]);
    const before = await facts();
    const created = await create(f);
    expect(created.status, created.text).toBe(201);
    expect(created.body.magazzinoEmporioId).toBe(f.warehouses[1].id);
    expect(await facts()).toEqual(before);
    expect(
      (
        await db
          .select()
          .from(beneficiariTable)
          .where(eq(beneficiariTable.id, f.beneficiary.id))
      )[0].centroAscoltoId,
    ).toBe(f.centers[1].id);
  });
  it("T08/F3: explicit eligibility is audited and does not recharge", async () => {
    const f = await fixture();
    const before = await facts();
    const r = await enable(f);
    expect(r.body.stato).toBe("attivo");
    expect(await facts()).toEqual(before);
    expect(
      (
        await pool.query(
          "select count(*)::int n from audit_configurazioni where chiave=$1",
          [`emporio-abilitazione:${r.body.id}`],
        )
      ).rows[0].n,
    ).toBe(1);
    const [b] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, f.beneficiary.id));
    expect(b.creditoSolidaleSaldo).toBe("100.00");
  });
  it("T07/F4: legacy credit is not an implicit service right", async () => {
    const f = await fixture();
    await db
      .update(utentiTable)
      .set({ centroAscoltoId: f.centers[1].id })
      .where(eq(utentiTable.id, f.user.id));
    const before = await db.execute(
      sql`select count(*)::int n from credito_solidale_movimenti`,
    );
    const r = await f.agent
      .post(
        `/api/credito-solidale/beneficiari/${f.beneficiary.id}/ricarica-manuale`,
      )
      .send({ variazioneCredito: 10, motivo: "Prova negativa" });
    expect(r.status, r.text).toBe(400);
    const after = await db.execute(
      sql`select count(*)::int n from credito_solidale_movimenti`,
    );
    expect(after.rows).toEqual(before.rows);
  });
  it("T07/T18: valid card and legacy balance never grant access or Cassa", async () => {
    const f = await fixture();
    await db.insert(tessereBeneficiariTable).values({
      beneficiarioId: f.beneficiary.id,
      codice: `MS-${f.beneficiary.codice}`,
    });
    const before = await facts();
    expect((await search(f, f.beneficiary.codice)).body).toEqual([]);
    expect((await create(f)).status).toBe(400);
    const status = await f.agent.get(
      `/api/emporio/beneficiari/${f.beneficiary.id}/abilitazione`,
    );
    expect(status.body.stato).toBe("non_abilitato");
    expect(await facts()).toEqual(before);
  });
  it.each([
    "Anna",
    "Ros",
    "Rossi Anna",
    "Ann Ross",
    "Rossi Ann",
    "Anna Maria Rossi",
    "Rossi Anna Maria",
  ])("T11: prefixes and order-independent name %s", async (term) => {
    const f = await fixture();
    await enable(f);
    const r = await search(f, term);
    expect(r.status, r.text).toBe(200);
    expect(
      r.body.map((x: { beneficiarioId: number }) => x.beneficiarioId),
    ).toEqual([f.beneficiary.id]);
  });
  it.each([
    "attiva",
    "sospesa",
    "revocata",
    "scaduta",
    "expired",
    "missing",
    "legacy",
  ])("T12: registered card %s validity", async (state) => {
    const f = await fixture();
    await enable(f);
    const code =
      state === "legacy"
        ? `LEGACY-${f.beneficiary.id}`
        : `MS-${f.beneficiary.codice}`;
    if (state !== "missing")
      await db.insert(tessereBeneficiariTable).values({
        beneficiarioId: f.beneficiary.id,
        codice: code,
        stato: ["expired", "legacy"].includes(state) ? "attiva" : state,
        dataScadenza: state === "expired" ? "2020-01-01" : null,
      });
    const r = await search(f, "", { codiceTessera: code });
    expect(r.status, r.text).toBe(200);
    expect(
      r.body.map((x: { beneficiarioId: number }) => x.beneficiarioId),
    ).toEqual(["attiva", "legacy"].includes(state) ? [f.beneficiary.id] : []);
    const cassa = await f.agent
      .get("/api/cassa-emporio/beneficiari/ricerca")
      .query({ magazzinoEmporioId: f.warehouses[1].id, codiceTessera: code });
    expect(cassa.status, cassa.text).toBe(200);
    expect(
      cassa.body.map((x: { beneficiarioId: number }) => x.beneficiarioId),
    ).toEqual(["attiva", "legacy"].includes(state) ? [f.beneficiary.id] : []);
  });
  it("T05/T21: even global Admin cannot pair beneficiary A with warehouse B", async () => {
    const f = await fixture(),
      other = await fixture();
    await enable(f);
    await db
      .update(ruoliTable)
      .set({ isAdmin: true })
      .where(eq(ruoliTable.id, f.role.id));
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, f.user.id));
    const list = await f.agent.get("/api/emporio/magazzini");
    expect(list.body.map((w: { id: number }) => w.id)).toEqual(
      expect.arrayContaining([f.warehouses[0].id, other.warehouses[0].id]),
    );
    expect(
      (
        await search(f, f.beneficiary.codice, {
          magazzinoEmporioId: other.warehouses[0].id,
        })
      ).body,
    ).toEqual([]);
    expect(
      (await create(f, { magazzinoEmporioId: other.warehouses[0].id })).status,
    ).toBe(400);
  });
  it("T20: cashier sees minimal eligible data, no financial values/dossier/eligibility write", async () => {
    const f = await fixture();
    await enable(f);
    await db
      .update(ruoliTable)
      .set({
        aree: ["emporio"],
        permessi: [
          "emporio.access.view",
          "emporio.access.manage",
          "emporio.cassa.view",
          "emporio.cassa.operate",
        ],
      })
      .where(eq(ruoliTable.id, f.role.id));
    const r = await search(f, "Anna");
    expect(r.status, r.text).toBe(200);
    expect(r.body[0].beneficiarioId).toBe(f.beneficiary.id);
    expect(r.body[0]).not.toHaveProperty("beneficiarioCodiceFiscale");
    expect(r.body[0].saldoCreditoSolidale).toBeNull();
    expect(r.body[0].quotaMensileAssegnata).toBeNull();
    expect(
      (await f.agent.get(`/api/beneficiari/${f.beneficiary.id}`)).status,
    ).toBe(403);
    expect(
      (
        await f.agent
          .post(`/api/emporio/beneficiari/${f.beneficiary.id}/abilitazione`)
          .send({ stato: "revocato", motivo: "Non autorizzato" })
      ).status,
    ).toBe(403);
  });
  it.each(["sospeso", "revocato"])(
    "T09/T15: %s blocks open session and new credit, preserves history",
    async (stato) => {
      const f = await fixture();
      await enable(f);
      const a = await create(f);
      expect(a.status, a.text).toBe(201);
      const opened = await f.agent
        .post(`/api/cassa-emporio/accessi/${a.body.id}/apri-sessione`)
        .send({});
      expect(opened.status, opened.text).toBe(201);
      await enable(f, stato);
      const before = await facts();
      expect(
        (await create(f, { dataOraInizio: "2026-10-22T09:00:00Z" })).status,
      ).toBe(400);
      expect(
        (
          await f.agent
            .post(
              `/api/cassa-emporio/sessioni/${opened.body.id}/pronta-per-chiusura`,
            )
            .send({ versione: opened.body.versione })
        ).status,
      ).toBe(400);
      expect(
        (
          await f.agent
            .post(
              `/api/credito-solidale/beneficiari/${f.beneficiary.id}/ricarica-manuale`,
            )
            .send({ variazioneCredito: 10, motivo: "Negativa revoca" })
        ).status,
      ).toBe(400);
      expect(
        (
          await f.agent.get(
            `/api/credito-solidale/beneficiari/${f.beneficiary.id}/saldo`,
          )
        ).status,
      ).toBe(200);
      expect(await facts()).toEqual(before);
    },
  );
  it("T15: active service allows credit, reactivation never unsuspends credit", async () => {
    const f = await fixture();
    await enable(f);
    const r = await f.agent
      .post(
        `/api/credito-solidale/beneficiari/${f.beneficiary.id}/ricarica-manuale`,
      )
      .send({ variazioneCredito: 10, motivo: "Autorizzata" });
    expect(r.status, r.text).toBe(201);
    await db
      .update(beneficiariTable)
      .set({ creditoSolidaleStato: "sospeso" })
      .where(eq(beneficiariTable.id, f.beneficiary.id));
    await enable(f, "sospeso");
    await enable(f, "attivo");
    expect((await create(f)).status).toBe(400);
    expect(
      (
        await db
          .select()
          .from(beneficiariTable)
          .where(eq(beneficiariTable.id, f.beneficiary.id))
      )[0].creditoSolidaleStato,
    ).toBe("sospeso");
  });
  it("T17: changing beneficiary Area does not transfer eligibility", async () => {
    const f = await fixture(),
      other = await fixture();
    await enable(f);
    await db
      .update(beneficiariTable)
      .set({
        areaOperativaId: other.area.id,
        centroAscoltoId: other.centers[1].id,
      })
      .where(eq(beneficiariTable.id, f.beneficiary.id));
    expect((await search(other, f.beneficiary.codice)).body).toEqual([]);
    expect(
      (await create(other, { beneficiarioId: f.beneficiary.id })).status,
    ).toBe(400);
    expect(
      (
        await db
          .select()
          .from(emporioAbilitazioniTable)
          .where(eq(emporioAbilitazioniTable.beneficiarioId, f.beneficiary.id))
      )[0].areaOperativaId,
    ).toBe(f.area.id);
  });
  it("T10: Mensa eligibility is independent", async () => {
    const f = await fixture();
    const [m] = await db
      .insert(menseTable)
      .values({
        codice: `F1M-${f.beneficiary.id}`,
        nome: "Mensa F1",
        areaOperativaId: f.area.id,
        magazzinoId: f.warehouses[0].id,
      })
      .returning();
    await db.insert(mensaAbilitazioniTable).values({
      beneficiarioId: f.beneficiary.id,
      mensaId: m.id,
      dataInizio: "2026-01-01",
    });
    expect((await create(f)).status).toBe(400);
    expect(
      (
        await db
          .select()
          .from(mensaAbilitazioniTable)
          .where(eq(mensaAbilitazioniTable.beneficiarioId, f.beneficiary.id))
      )[0].stato,
    ).toBe("attiva");
  });
  it("T14: committed revocation wins against blocked planning (observed PG barrier)", async () => {
    const f = await fixture();
    await enable(f);
    const conn = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await conn.query("BEGIN");
      await conn.query(
        "update emporio_abilitazioni set stato='revocato' where beneficiario_id=$1",
        [f.beneficiary.id],
      );
      const pid = (await conn.query("select pg_backend_pid() pid")).rows[0].pid;
      pending = create(f).then((r) => r);
      const deadline = Date.now() + 8000;
      let observed = false;
      while (Date.now() < deadline) {
        if (
          (
            await pool.query(
              "select pid from pg_stat_activity where $1::int=ANY(pg_blocking_pids(pid))",
              [pid],
            )
          ).rows.length
        ) {
          observed = true;
          break;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(observed).toBe(true);
      await conn.query("COMMIT");
      const r = await pending;
      expect(r.status, r.text).toBe(400);
      expect(
        (
          await pool.query(
            "select count(*)::int n from consegne where beneficiario_id=$1",
            [f.beneficiary.id],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await conn.query("ROLLBACK");
      conn.release();
      await pending;
    }
  });
  it("T19: cross-Center checkout uses existing M4 once, replay does not double debit/stock", async () => {
    const f = await fixture();
    await enable(f);
    const a = await create(f);
    expect(a.status, a.text).toBe(201);
    const opened = await f.agent
      .post(`/api/cassa-emporio/accessi/${a.body.id}/apri-sessione`)
      .send({});
    expect(opened.status, opened.text).toBe(201);
    const [p] = await db
      .insert(prodottiTable)
      .values({
        codice: `F1P-${f.beneficiary.id}`,
        nome: "Prodotto F1",
        tipoProdotto: "alimenti",
        unitaMisura: "pz",
        abilitatoEmporio: true,
        creditoSolidaleValore: "2.00",
      })
      .returning();
    const [l] = await db
      .insert(lottiTable)
      .values({
        prodottoId: p.id,
        magazzinoId: f.warehouses[1].id,
        codiceLotto: `F1L-${p.id}`,
        dataCarico: "2026-10-01",
        quantitaCaricata: "5",
        quantitaResidua: "5",
      })
      .returning();
    const added = await f.agent
      .post(`/api/cassa-emporio/sessioni/${opened.body.id}/righe`)
      .send({ versione: opened.body.versione, prodottoId: p.id, quantita: 1 });
    expect(added.status, added.text).toBe(201);
    const current = await f.agent.get(
      `/api/cassa-emporio/sessioni/${opened.body.id}`,
    );
    const ready = await f.agent
      .post(`/api/cassa-emporio/sessioni/${opened.body.id}/pronta-per-chiusura`)
      .send({ versione: current.body.versione });
    expect(ready.status, ready.text).toBe(200);
    const closed = await f.agent
      .post(`/api/cassa-emporio/sessioni/${opened.body.id}/chiudi`)
      .send({ versione: ready.body.versione });
    expect(closed.status, closed.text).toBe(200);
    const before = await facts();
    const replay = await f.agent
      .post(`/api/cassa-emporio/sessioni/${opened.body.id}/chiudi`)
      .send({ versione: ready.body.versione });
    expect(replay.status, replay.text).toBe(409);
    expect(await facts()).toEqual(before);
    const [b] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, f.beneficiary.id));
    expect(b.creditoSolidaleSaldo).toBe("98.00");
    expect(b.centroAscoltoId).toBe(f.centers[1].id);
    expect(
      Number(
        (await db.select().from(lottiTable).where(eq(lottiTable.id, l.id)))[0]
          .quantitaResidua,
      ),
    ).toBe(4);
  });
});
