import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import {
  areeOperativeTable,
  beneficiariTable,
  centriAscoltoTable,
  db,
  magazziniTable,
  prodottiTable,
  lottiTable,
  speseEmporioTable,
  pool,
  ruoliTable,
  utentiTable,
  zoneUdsTable,
  emporioAbilitazioniTable,
} from "@workspace/db";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

const grants = [
  "emporio.access.view",
  "emporio.access.manage",
  "emporio.cassa.view",
  "emporio.cassa.operate",
  "emporio.cassa.force",
  "emporio.sales.view",
  "emporio.sales.manage",
  "emporio.sales.reverse",
  "credito.view",
  "credito.adjust",
  "credito.quota.manage",
  "credito.monthly.execute",
];
const rnd = () => Math.random().toString(36).slice(2, 10);
const fixtureAreas: number[] = [];
const fixtureUsers: number[] = [];
const fixtureRoles: number[] = [];
const fixtureProducts: number[] = [];
async function fixture() {
  const suffix = rnd();
  const [area] = await db
    .insert(areeOperativeTable)
    .values({ nome: `M62A ${suffix}` })
    .returning();
  fixtureAreas.push(area.id);
  const [center] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `M62A ${suffix}`, areaOperativaId: area.id })
    .returning();
  const [zone] = await db
    .insert(zoneUdsTable)
    .values({ nome: `M62A ${suffix}`, areaOperativaId: area.id })
    .returning();
  const [warehouse] = await db
    .insert(magazziniTable)
    .values({
      codice: `M62A-${suffix}`,
      nome: "Emporio sintetico",
      tipoMagazzino: "emporio",
      areaOperativaId: area.id,
      centroAscoltoId: center.id,
    })
    .returning();
  const [beneficiary] = await db
    .insert(beneficiariTable)
    .values({
      codice: `M62A-${suffix}`,
      nome: "Persona sintetica",
      cognome: "Test",
      uds: true,
      areaOperativaId: area.id,
      centroAscoltoId: center.id,
      zonaUdsId: zone.id,
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
      creditoSolidaleSaldo: "100.00",
      creditoSolidaleMensileAssegnato: "50.00",
      magazzinoEmporioPreferitoId: warehouse.id,
    })
    .returning();
  const [role] = await db
    .insert(ruoliTable)
    .values({ nome: `M62A-${suffix}`, aree: ["emporio"], permessi: grants })
    .returning();
  const password = `Synthetic-${suffix}-Password!`;
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `m62a_${suffix}`,
      nome: "Operatore sintetico",
      passwordHash: await bcrypt.hash(password, 4),
      ruoloId: role.id,
      areaOperativaId: area.id,
      centroAscoltoId: center.id,
    })
    .returning();
  const { default: app } = await import("../src/app");
  await db.insert(emporioAbilitazioniTable).values({
    beneficiarioId: beneficiary.id,
    areaOperativaId: area.id,
    operatoreId: user.id,
    stato: "attivo",
    motivo: "Diritto esplicito fixture positiva F1",
  });
  fixtureUsers.push(user.id);
  fixtureRoles.push(role.id);
  const agent = request.agent(app);
  expect(
    (
      await agent
        .post("/api/auth/login")
        .send({ username: user.username, password })
    ).status,
  ).toBe(200);
  return { area, center, zone, warehouse, beneficiary, role, user, agent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function access(f: Fixture, date = "2026-10-15T09:00:00Z") {
  const response = await f.agent.post("/api/accessi-emporio").send({
    beneficiarioId: f.beneficiary.id,
    magazzinoEmporioId: f.warehouse.id,
    dataOraInizio: date,
  });
  expect(response.status, response.text).toBe(201);
  return response.body;
}
async function open(f: Fixture) {
  const a = await access(f);
  const response = await f.agent
    .post(`/api/cassa-emporio/accessi/${a.id}/apri-sessione`)
    .send({});
  expect(response.status, response.text).toBe(201);
  return { access: a, session: response.body };
}
async function facts() {
  const result = await db.execute(sql`select
    (select count(*) from spese_emporio) as spese,
    (select count(*) from bolle) as bolle,
    (select count(*) from scarichi) as scarichi,
    (select count(*) from movimenti) as movimenti,
    (select count(*) from credito_solidale_movimenti) as crediti,
    (select coalesce(sum(quantita_residua),0)::text from lotti) as stock,
    (select coalesce(sum(credito_solidale_saldo),0)::text from beneficiari) as saldo`);
  return result.rows[0];
}
async function deniedFacts() {
  return {
    accounting: await facts(),
    audit: (
      await pool.query(
        "select (select count(*) from audit_configurazioni) as config, (select count(*) from audit_eventi) as events",
      )
    ).rows[0],
    sessions: (
      await pool.query(
        "select id, stato_sessione, versione from sessioni_cassa_emporio order by id",
      )
    ).rows,
    accesses: (
      await pool.query(
        "select id, stato_accesso_emporio from consegne where tipo_pianificazione='accesso_emporio' order by id",
      )
    ).rows,
  };
}
async function ready(f: Fixture) {
  const opened = await open(f);
  const [product] = await db
    .insert(prodottiTable)
    .values({
      codice: `M62P-${rnd()}`,
      nome: "Prodotto sintetico",
      tipoProdotto: "alimenti",
      unitaMisura: "pz",
      quantitaFrazionabile: false,
      abilitatoEmporio: true,
      creditoSolidaleValore: "2.00",
    })
    .returning();
  fixtureProducts.push(product.id);
  await db.insert(lottiTable).values({
    prodottoId: product.id,
    magazzinoId: f.warehouse.id,
    codiceLotto: `M62L-${rnd()}`,
    dataCarico: "2026-10-01",
    quantitaCaricata: "5",
    quantitaResidua: "5",
  });
  const added = await f.agent
    .post(`/api/cassa-emporio/sessioni/${opened.session.id}/righe`)
    .send({
      versione: opened.session.versione,
      prodottoId: product.id,
      quantita: 1,
    });
  expect(added.status, added.text).toBe(201);
  const current = await f.agent.get(
    `/api/cassa-emporio/sessioni/${opened.session.id}`,
  );
  const prepared = await f.agent
    .post(
      `/api/cassa-emporio/sessioni/${opened.session.id}/pronta-per-chiusura`,
    )
    .send({ versione: current.body.versione });
  expect(prepared.status, prepared.text).toBe(200);
  return prepared.body;
}
async function checkout(f: Fixture) {
  const s = await ready(f);
  const closed = await f.agent
    .post(`/api/cassa-emporio/sessioni/${s.id}/chiudi`)
    .send({ versione: s.versione });
  expect(closed.status, closed.text).toBe(200);
  return closed.body;
}
async function waitBlocked(blocker: number) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      "select pid from pg_stat_activity where $1::int=ANY(pg_blocking_pids(pid))",
      [blocker],
    );
    if (result.rows.length) return result.rows[0].pid as number;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Barriera PostgreSQL non osservata");
}
beforeAll(async () => {
  expect(process.env.M62A_DISPOSABLE_DB).toBe("verified");
  const url = new URL(process.env.DATABASE_URL!);
  expect([url.hostname, url.port, url.pathname]).toEqual([
    "127.0.0.1",
    "58621",
    "/m62a",
  ]);
  await updateModuloAmbiente("EMPORIO_SOLIDALE", true, null);
});
afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const areaIds = fixtureAreas;
    const beneficiaries = (
      await client.query(
        "select id from beneficiari where area_operativa_id=ANY($1::int[])",
        [areaIds],
      )
    ).rows.map((r) => r.id);
    await client.query(
      "delete from emporio_abilitazioni where beneficiario_id=ANY($1::int[])",
      [beneficiaries],
    );
    const warehouses = (
      await client.query(
        "select id from magazzini where area_operativa_id=ANY($1::int[])",
        [areaIds],
      )
    ).rows.map((r) => r.id);
    const expenses = (
      await client.query(
        "select id,bolla_id,scarico_id from spese_emporio where beneficiario_id=ANY($1::int[])",
        [beneficiaries],
      )
    ).rows;
    const expenseIds = expenses.map((r) => r.id),
      bollaIds = expenses.map((r) => r.bolla_id).filter(Boolean),
      scaricoIds = expenses.map((r) => r.scarico_id).filter(Boolean);
    await client.query(
      "delete from audit_configurazioni where utente_id=ANY($1::int[])",
      [fixtureUsers],
    );
    await client.query(
      "delete from spese_emporio_storni_righe where storno_id in (select id from spese_emporio_storni where spesa_emporio_id=ANY($1::int[]))",
      [expenseIds],
    );
    await client.query(
      "delete from spese_emporio_storni where spesa_emporio_id=ANY($1::int[])",
      [expenseIds],
    );
    await client.query(
      "delete from spese_emporio_righe where spesa_emporio_id=ANY($1::int[])",
      [expenseIds],
    );
    await client.query("delete from spese_emporio where id=ANY($1::int[])", [
      expenseIds,
    ]);
    await client.query(
      "delete from sessioni_cassa_emporio_righe where sessione_cassa_id in (select id from sessioni_cassa_emporio where beneficiario_id=ANY($1::int[]))",
      [beneficiaries],
    );
    await client.query(
      "delete from sessioni_cassa_emporio where beneficiario_id=ANY($1::int[])",
      [beneficiaries],
    );
    await client.query("delete from movimenti where bolla_id=ANY($1::int[])", [
      bollaIds,
    ]);
    await client.query(
      "delete from bolla_righe where bolla_id=ANY($1::int[])",
      [bollaIds],
    );
    await client.query(
      "delete from scarico_righe where scarico_id=ANY($1::int[])",
      [scaricoIds],
    );
    await client.query("delete from bolle where id=ANY($1::int[])", [bollaIds]);
    await client.query("delete from scarichi where id=ANY($1::int[])", [
      scaricoIds,
    ]);
    await client.query(
      "delete from credito_solidale_movimenti where beneficiario_id=ANY($1::int[])",
      [beneficiaries],
    );
    await client.query(
      "delete from consegne where beneficiario_id=ANY($1::int[])",
      [beneficiaries],
    );
    await client.query(
      "delete from operazioni_distribuzione_magazzino where magazzino_id=ANY($1::int[])",
      [warehouses],
    );
    await client.query("delete from lotti where prodotto_id=ANY($1::int[])", [
      fixtureProducts,
    ]);
    await client.query("delete from prodotti where id=ANY($1::int[])", [
      fixtureProducts,
    ]);
    await client.query("delete from beneficiari where id=ANY($1::int[])", [
      beneficiaries,
    ]);
    await client.query("delete from utenti where id=ANY($1::int[])", [
      fixtureUsers,
    ]);
    await client.query("delete from ruoli where id=ANY($1::int[])", [
      fixtureRoles,
    ]);
    await client.query("delete from magazzini where id=ANY($1::int[])", [
      warehouses,
    ]);
    await client.query(
      "delete from zone_uds where area_operativa_id=ANY($1::int[])",
      [areaIds],
    );
    await client.query(
      "delete from politiche_credito_solidale where area_operativa_id=ANY($1::int[])",
      [areaIds],
    );
    await client.query(
      "delete from centri_di_ascolto where area_operativa_id=ANY($1::int[])",
      [areaIds],
    );
    await client.query("delete from aree_operative where id=ANY($1::int[])", [
      areaIds,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});

describe("M6.2-A — autorità corrente con cookie reale", () => {
  it("A01/A25: Accesso distinto da Consegna, apertura registra presenza ma zero stock/credito", async () => {
    const f = await fixture(),
      before = await facts();
    const { access: a, session: s } = await open(f);
    expect(s.accessoEmporioId).toBe(a.id);
    const audit = await pool.query(
      "select utente_id,chiave from audit_configurazioni where area='emporio' and chiave=ANY($1::text[])",
      [[`emporio-accesso:${a.id}`, `emporio-sessione:${s.id}`]],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
    expect(audit.rows.every((r) => r.utente_id === f.user.id)).toBe(true);
    expect(
      (await f.agent.get(`/api/accessi-emporio/${a.id}`)).body
        .statoAccessoEmporio,
    ).toBe("effettuato");
    expect(await facts()).toEqual(before);
  });
  it("A02/A14: rimuovere Area e Centro nella stessa sessione non concede globalità", async () => {
    const f = await fixture(),
      { access: a, session: s } = await open(f),
      before = await deniedFacts();
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, f.user.id));
    for (const path of [
      "/accessi-emporio",
      "/cassa-emporio/sessioni",
      "/spese-emporio",
      "/credito-solidale/beneficiari",
      `/accessi-emporio/${a.id}`,
      `/cassa-emporio/sessioni/${s.id}`,
    ])
      expect((await f.agent.get(`/api${path}`)).status, path).toBe(403);
    expect(
      (
        await f.agent
          .post(`/api/cassa-emporio/sessioni/${s.id}/sospendi`)
          .send({ versione: s.versione })
      ).status,
    ).toBe(403);
    expect(await deniedFacts()).toEqual(before);
  });
  it("A13: grant revocato sul ruolo corrente, stessa sessione, zero effetti", async () => {
    const f = await fixture(),
      { session: s } = await open(f),
      before = await deniedFacts();
    await db
      .update(ruoliTable)
      .set({ permessi: grants.filter((g) => g !== "emporio.cassa.operate") })
      .where(eq(ruoliTable.id, f.role.id));
    expect(
      (
        await f.agent
          .post(`/api/cassa-emporio/sessioni/${s.id}/sospendi`)
          .send({ versione: s.versione })
      ).status,
    ).toBe(403);
    expect(
      (await f.agent.get(`/api/cassa-emporio/sessioni/${s.id}`)).status,
    ).toBe(200);
    expect(await deniedFacts()).toEqual(before);
  });
  it("A17: annullamento Sessione non cancella presenza; nuova apertura stesso Accesso", async () => {
    const f = await fixture(),
      { access: a, session: s } = await open(f),
      before = await facts();
    const canceled = await f.agent
      .post(`/api/cassa-emporio/sessioni/${s.id}/annulla`)
      .send({
        versione: s.versione,
        motivoAnnullamento: "Annullamento sintetico",
      });
    expect(canceled.status, canceled.text).toBe(200);
    const reopened = await f.agent
      .post(`/api/cassa-emporio/accessi/${a.id}/apri-sessione`)
      .send({});
    expect(reopened.status, reopened.text).toBe(201);
    expect(reopened.body.id).not.toBe(s.id);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from sessioni_cassa_emporio where accesso_emporio_id=$1",
          [a.id],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (await f.agent.get(`/api/cassa-emporio/sessioni/${s.id}`)).body
        .statoSessione,
    ).toBe("annullata");
    expect(
      (await f.agent.get(`/api/accessi-emporio/${a.id}`)).body
        .statoAccessoEmporio,
    ).toBe("effettuato");
    expect(await facts()).toEqual(before);
  });
});

describe("M6.2-A — confini, replay e transazioni", () => {
  it("A03/A13: Politiche mantengono il perimetro Admin e rivalidano ruolo corrente", async () => {
    const f = await fixture(),
      other = await fixture();
    await db
      .update(ruoliTable)
      .set({ isAdmin: true })
      .where(eq(ruoliTable.id, f.role.id));
    const created = await f.agent.post("/api/politiche-credito-solidale").send({
      nome: `M62Policy-${rnd()}`,
      areaOperativaId: f.area.id,
      centroAscoltoId: f.center.id,
    });
    expect(created.status, created.text).toBe(201);
    const before = await deniedFacts();
    expect(
      (
        await f.agent.post("/api/politiche-credito-solidale").send({
          nome: "Fuori Area",
          areaOperativaId: other.area.id,
          centroAscoltoId: other.center.id,
        })
      ).status,
    ).toBe(403);
    await db
      .update(ruoliTable)
      .set({ isAdmin: false })
      .where(eq(ruoliTable.id, f.role.id));
    expect(
      (
        await f.agent
          .patch(`/api/politiche-credito-solidale/${created.body.id}`)
          .send({ nome: "Non autorizzata" })
      ).status,
    ).toBe(403);
    expect(await deniedFacts()).toEqual(before);
  });
  it("A17: Sessione chiusa recupera ricevuta esistente senza nuovo checkout", async () => {
    const f = await fixture(),
      closed = await checkout(f),
      before = await deniedFacts();
    const recovered = await f.agent
      .post(
        `/api/cassa-emporio/accessi/${closed.sessione.accessoEmporioId}/apri-sessione`,
      )
      .send({});
    expect(recovered.status, recovered.text).toBe(200);
    expect(recovered.body.id).toBe(closed.sessione.id);
    expect(recovered.body.statoSessione).toBe("chiusa");
    expect(recovered.body.spesaEmporioId).toBe(closed.spesa.id);
    expect(
      (await f.agent.get(`/api/spese-emporio/${closed.spesa.id}/bolla-stampa`))
        .status,
    ).toBe(200);
    const replay = await f.agent
      .post(`/api/cassa-emporio/sessioni/${closed.sessione.id}/chiudi`)
      .send({ versione: closed.sessione.versione });
    expect(replay.status, replay.text).toBe(400);
    expect(replay.body.error).toContain("già chiusa");
    expect(await deniedFacts()).toEqual(before);
  });
  it.each(["utente", "area", "zona"])(
    "A02/A06/A07: revoca corrente %s non usa il cookie come autorità",
    async (kind) => {
      const f = await fixture(),
        { session: s } = await open(f);
      if (kind === "utente")
        await db
          .update(utentiTable)
          .set({ attivo: false })
          .where(eq(utentiTable.id, f.user.id));
      if (kind === "area")
        await db
          .update(areeOperativeTable)
          .set({ attivo: false })
          .where(eq(areeOperativeTable.id, f.area.id));
      if (kind === "zona") {
        await db
          .update(utentiTable)
          .set({ zonaUdsId: f.zone.id })
          .where(eq(utentiTable.id, f.user.id));
        await db
          .update(zoneUdsTable)
          .set({ attivo: false })
          .where(eq(zoneUdsTable.id, f.zone.id));
      }
      const before = await deniedFacts(),
        response = await f.agent
          .post(`/api/cassa-emporio/sessioni/${s.id}/sospendi`)
          .send({ versione: s.versione });
      expect(response.status).toBe(kind === "utente" ? 401 : 403);
      expect(await deniedFacts()).toEqual(before);
    },
  );
  it("A07/A12/A29: batch Zona non ricarica altri beneficiari e replay dopo revoca è negato", async () => {
    const f = await fixture();
    const [other] = await db
      .insert(beneficiariTable)
      .values({
        codice: `M62B-${rnd()}`,
        nome: "Altra zona sintetica",
        cognome: "Test",
        areaOperativaId: f.area.id,
        centroAscoltoId: f.center.id,
        creditoSolidaleAbilitato: true,
        creditoSolidaleStato: "attivo",
        creditoSolidaleSaldo: "33.00",
        creditoSolidaleMensileAssegnato: "10.00",
      })
      .returning();
    await db
      .update(utentiTable)
      .set({ zonaUdsId: f.zone.id })
      .where(eq(utentiTable.id, f.user.id));
    const response = await f.agent
      .post("/api/credito-solidale/ricariche-mensili/esegui")
      .send({ periodoRiferimento: "2026-12" });
    expect(response.status, response.text).toBe(200);
    expect(response.body.creati).toBe(1);
    expect(
      response.body.movimentiCreati.map(
        (m: { beneficiarioId: number }) => m.beneficiarioId,
      ),
    ).toEqual([f.beneficiary.id]);
    expect(
      (
        await db
          .select()
          .from(beneficiariTable)
          .where(eq(beneficiariTable.id, other.id))
      )[0].creditoSolidaleSaldo,
    ).toBe("33.00");
    await db
      .update(ruoliTable)
      .set({ permessi: grants.filter((g) => g !== "credito.monthly.execute") })
      .where(eq(ruoliTable.id, f.role.id));
    const before = await deniedFacts();
    expect(
      (
        await f.agent
          .post("/api/credito-solidale/ricariche-mensili/esegui")
          .send({ periodoRiferimento: "2026-12" })
      ).status,
    ).toBe(403);
    expect(await deniedFacts()).toEqual(before);
  });
  it("A03: solo is_admin abilita il caso amministrativo globale, territorio nullo legittimo", async () => {
    const f = await fixture(),
      other = await fixture();
    await access(other);
    await db
      .update(ruoliTable)
      .set({ isAdmin: true, permessi: [] })
      .where(eq(ruoliTable.id, f.role.id));
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, f.user.id));
    const list = await f.agent
      .get("/api/accessi-emporio")
      .query({ beneficiarioId: other.beneficiary.id });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });
  it("A04: ruolo custom, soli grant e nessun territorio è negato", async () => {
    const f = await fixture();
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, f.user.id));
    expect(
      (await f.agent.get("/api/credito-solidale/beneficiari")).status,
    ).toBe(403);
  });
  it("A05/A11: Area senza Centro resta limitata, filtri client non ampliano", async () => {
    const f = await fixture(),
      other = await fixture();
    await db
      .update(utentiTable)
      .set({ centroAscoltoId: null })
      .where(eq(utentiTable.id, f.user.id));
    const own = await f.agent
      .get("/api/cassa-emporio/beneficiari/ricerca")
      .query({
        search: f.beneficiary.codice,
        magazzinoEmporioId: f.warehouse.id,
      });
    expect(own.status).toBe(200);
    expect(
      own.body.map((r: { beneficiarioId: number }) => r.beneficiarioId),
    ).toContain(f.beneficiary.id);
    const foreign = await f.agent
      .get("/api/cassa-emporio/beneficiari/ricerca")
      .query({
        search: other.beneficiary.codice,
        areaOperativaId: other.area.id,
        magazzinoEmporioId: f.warehouse.id,
      });
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual([]);
    const wh = await f.agent
      .get("/api/cassa-emporio/beneficiari/ricerca")
      .query({
        search: other.beneficiary.codice,
        magazzinoEmporioId: other.warehouse.id,
      });
    expect(wh.status).toBe(403);
  });
  it.each(["inattivo", "incoerente", "senza_area"])(
    "A06: Centro %s nega senza ampliamento",
    async (variant) => {
      const f = await fixture();
      if (variant === "inattivo")
        await db
          .update(centriAscoltoTable)
          .set({ attivo: false })
          .where(eq(centriAscoltoTable.id, f.center.id));
      if (variant === "incoerente") {
        const other = await fixture();
        await db
          .update(utentiTable)
          .set({ centroAscoltoId: other.center.id })
          .where(eq(utentiTable.id, f.user.id));
      }
      if (variant === "senza_area")
        await db
          .update(utentiTable)
          .set({ areaOperativaId: null })
          .where(eq(utentiTable.id, f.user.id));
      expect((await f.agent.get("/api/accessi-emporio")).status).toBe(403);
    },
  );
  it("A07/A12/F1: Emporio usa Area, non Zona; storico leggibile ma batch richiede diritto esplicito", async () => {
    const f = await fixture();
    const [zone] = await db
      .insert(zoneUdsTable)
      .values({ nome: `Altra ${rnd()}`, areaOperativaId: f.area.id })
      .returning();
    const [other] = await db
      .insert(beneficiariTable)
      .values({
        codice: `M62B-${rnd()}`,
        nome: "Fuori zona",
        cognome: "Test",
        uds: true,
        zonaUdsId: zone.id,
        areaOperativaId: f.area.id,
        centroAscoltoId: f.center.id,
        creditoSolidaleAbilitato: true,
        creditoSolidaleStato: "attivo",
        creditoSolidaleMensileAssegnato: "10.00",
      })
      .returning();
    await db
      .update(utentiTable)
      .set({ zonaUdsId: f.zone.id })
      .where(eq(utentiTable.id, f.user.id));
    const list = await f.agent.get("/api/credito-solidale/beneficiari");
    expect(list.status).toBe(200);
    expect(
      list.body
        .map((r: { id: number }) => r.id)
        .sort((a: number, b: number) => a - b),
    ).toEqual([f.beneficiary.id, other.id].sort((a, b) => a - b));
    expect(list.headers["x-total-count"]).toBe("2");
    const preview = await f.agent
      .post("/api/credito-solidale/ricariche-mensili/preview")
      .send({ periodoRiferimento: "2026-11" });
    expect(preview.status).toBe(200);
    expect(
      preview.body.righe.map(
        (r: { beneficiarioId: number }) => r.beneficiarioId,
      ),
    ).toEqual([f.beneficiary.id]);
    for (const suffix of ["saldo", "movimenti"])
      expect(
        (
          await f.agent.get(
            `/api/credito-solidale/beneficiari/${other.id}/${suffix}`,
          )
        ).status,
      ).toBe(200);
    const movements = await f.agent
      .get("/api/credito-solidale/movimenti")
      .query({ beneficiarioId: other.id });
    expect(movements.status).toBe(200);
    expect(movements.body).toEqual([]);
  });
  it("A08/F1: altro Centro stessa Area consentito; altra Area resta negata", async () => {
    const f = await fixture();
    const [center] = await db
      .insert(centriAscoltoTable)
      .values({ nome: `Altro ${rnd()}`, areaOperativaId: f.area.id })
      .returning();
    const [wh] = await db
      .insert(magazziniTable)
      .values({
        nome: "Altro Emporio",
        codice: `M62W-${rnd()}`,
        tipoMagazzino: "emporio",
        areaOperativaId: f.area.id,
        centroAscoltoId: center.id,
      })
      .returning();
    const before = await facts();
    expect(
      (
        await f.agent.post("/api/accessi-emporio").send({
          beneficiarioId: f.beneficiary.id,
          magazzinoEmporioId: wh.id,
          dataOraInizio: "2026-10-21T10:00:00Z",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await f.agent
          .get("/api/cassa-emporio/prodotti/ricerca")
          .query({ search: "x", magazzinoEmporioId: wh.id })
      ).status,
    ).toBe(200);
    expect(await facts()).toEqual(before);
    const foreign = await fixture();
    expect(
      (
        await f.agent.post("/api/accessi-emporio").send({
          beneficiarioId: f.beneficiary.id,
          magazzinoEmporioId: foreign.warehouse.id,
          dataOraInizio: "2026-10-22T10:00:00Z",
        })
      ).status,
    ).toBe(403);
  });
  it("A09: Spesa segue autorizzazione del Beneficiario corrente, snapshot storico intatto", async () => {
    const f = await fixture(),
      other = await fixture(),
      closed = await checkout(f);
    const [before] = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.id, closed.spesa.id));
    await db
      .update(beneficiariTable)
      .set({
        areaOperativaId: other.area.id,
        centroAscoltoId: other.center.id,
        zonaUdsId: null,
      })
      .where(eq(beneficiariTable.id, f.beneficiary.id));
    const list = await f.agent
      .get("/api/spese-emporio")
      .query({ beneficiarioId: f.beneficiary.id });
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
    expect(list.headers["x-total-count"]).toBe("0");
    for (const suffix of ["", "/bolla-stampa"])
      expect(
        (await f.agent.get(`/api/spese-emporio/${closed.spesa.id}${suffix}`))
          .status,
      ).toBe(403);
    const [after] = await db
      .select()
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.id, closed.spesa.id));
    expect(after).toEqual(before);
  });
  it("A10: scope applicato prima di totale/paginazione Accessi e Sessioni", async () => {
    const f = await fixture(),
      other = await fixture();
    const own = await open(f);
    await open(other);
    for (const [path, id] of [
      ["accessi-emporio", own.access.id],
      ["cassa-emporio/sessioni", own.session.id],
    ] as const) {
      const list = await f.agent
        .get(`/api/${path}`)
        .query({ page: 1, limit: 1 });
      expect(list.status).toBe(200);
      expect(list.headers["x-total-count"]).toBe("1");
      expect(list.body[0].id).toBe(id);
      const empty = await f.agent
        .get(`/api/${path}`)
        .query({ page: 2, limit: 1 });
      expect(empty.body).toEqual([]);
      expect(empty.headers["x-total-count"]).toBe("1");
    }
  });
  it("A16: due aperture reali contemporanee producono una Sessione", async () => {
    const f = await fixture(),
      a = await access(f),
      before = await facts();
    const responses = await Promise.all(
      [1, 2].map(() =>
        f.agent
          .post(`/api/cassa-emporio/accessi/${a.id}/apri-sessione`)
          .send({}),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from sessioni_cassa_emporio where accesso_emporio_id=$1",
          [a.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await facts()).toEqual(before);
  });
  it("A18: sospensione/ripresa preservano versioni, stale 409, stock/credito zero", async () => {
    const f = await fixture(),
      { session: s } = await open(f),
      before = await facts();
    const suspended = await f.agent
      .post(`/api/cassa-emporio/sessioni/${s.id}/sospendi`)
      .send({ versione: s.versione });
    expect(suspended.status).toBe(200);
    expect(suspended.body.statoSessione).toBe("sospesa");
    expect(
      (
        await f.agent
          .post(`/api/cassa-emporio/sessioni/${s.id}/riprendi`)
          .send({ versione: s.versione })
      ).status,
    ).toBe(409);
    const resumed = await f.agent
      .post(`/api/cassa-emporio/sessioni/${s.id}/riprendi`)
      .send({ versione: suspended.body.versione });
    expect(resumed.status).toBe(200);
    expect(resumed.body.statoSessione).toBe("aperta");
    expect(await facts()).toEqual(before);
  });
  it("A19: terminale non può essere riattivato", async () => {
    const f = await fixture(),
      a = await access(f),
      before = await facts();
    expect(
      (
        await f.agent.patch(`/api/accessi-emporio/${a.id}/stato`).send({
          statoAccessoEmporio: "annullato",
          motivoAnnullamento: "Test",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.agent
          .patch(`/api/accessi-emporio/${a.id}/stato`)
          .send({ statoAccessoEmporio: "pianificato" })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.agent
          .post(`/api/cassa-emporio/accessi/${a.id}/apri-sessione`)
          .send({})
      ).status,
    ).toBe(400);
    expect(await facts()).toEqual(before);
  });
  it("A20: forzatura senza motivo o senza grant non genera fatti", async () => {
    const f = await fixture(),
      before = await deniedFacts(),
      body = {
        beneficiarioId: f.beneficiary.id,
        magazzinoEmporioId: f.warehouse.id,
      };
    expect(
      (await f.agent.post("/api/cassa-emporio/accessi/forza").send(body))
        .status,
    ).toBe(400);
    await db
      .update(ruoliTable)
      .set({ permessi: grants.filter((g) => g !== "emporio.cassa.force") })
      .where(eq(ruoliTable.id, f.role.id));
    expect(
      (
        await f.agent
          .post("/api/cassa-emporio/accessi/forza")
          .send({ ...body, motivoAccessoForzato: "Test" })
      ).status,
    ).toBe(403);
    expect(await deniedFacts()).toEqual(before);
  });
  it.each(["beneficiario", "magazzino", "tipo_magazzino"])(
    "A21: %s non disponibile dopo apertura, mutazione bloccata",
    async (variant) => {
      const f = await fixture(),
        { session: s } = await open(f);
      if (variant === "beneficiario")
        await db
          .update(beneficiariTable)
          .set({ attivo: false })
          .where(eq(beneficiariTable.id, f.beneficiary.id));
      else
        await db
          .update(magazziniTable)
          .set(
            variant === "magazzino"
              ? { stato: "inattivo" }
              : { tipoMagazzino: "logistico" },
          )
          .where(eq(magazziniTable.id, f.warehouse.id));
      const before = await deniedFacts();
      expect(
        (
          await f.agent
            .post(`/api/cassa-emporio/sessioni/${s.id}/sospendi`)
            .send({ versione: s.versione })
        ).status,
      ).toBe(400);
      expect(await deniedFacts()).toEqual(before);
      expect(
        (await f.agent.get(`/api/cassa-emporio/sessioni/${s.id}`)).status,
      ).toBe(200);
    },
  );
  it("A22: checkout dopo revoca senza nuovi documenti/stock/credito", async () => {
    const f = await fixture(),
      s = await ready(f),
      before = await deniedFacts();
    await db
      .update(ruoliTable)
      .set({ permessi: grants.filter((g) => g !== "emporio.cassa.operate") })
      .where(eq(ruoliTable.id, f.role.id));
    expect(
      (
        await f.agent
          .post(`/api/cassa-emporio/sessioni/${s.id}/chiudi`)
          .send({ versione: s.versione })
      ).status,
    ).toBe(403);
    expect(await deniedFacts()).toEqual(before);
  });
  it("A23/A29: storno riuscito, revoca, replay non recupera risultato o compensazioni", async () => {
    const f = await fixture(),
      closed = await checkout(f),
      body = { motivo: "Test", idempotencyKey: `m62-${rnd()}` };
    const reversed = await f.agent
      .post(`/api/spese-emporio/${closed.spesa.id}/storna`)
      .send(body);
    expect(reversed.status, reversed.text).toBe(201);
    await db
      .update(ruoliTable)
      .set({ permessi: grants.filter((g) => g !== "emporio.sales.reverse") })
      .where(eq(ruoliTable.id, f.role.id));
    const before = await deniedFacts();
    expect(
      (
        await f.agent
          .post(`/api/spese-emporio/${closed.spesa.id}/storna`)
          .send(body)
      ).status,
    ).toBe(403);
    expect(await deniedFacts()).toEqual(before);
  });
  it("A26: feature flag disabilitato mantiene il contratto storico di diniego", async () => {
    const f = await fixture(),
      { access: a } = await open(f),
      before = await deniedFacts();
    await updateModuloAmbiente("EMPORIO_SOLIDALE", false, null);
    try {
      expect((await f.agent.get(`/api/accessi-emporio/${a.id}`)).status).toBe(
        403,
      );
      expect(
        (
          await f.agent
            .post(`/api/cassa-emporio/accessi/${a.id}/apri-sessione`)
            .send({})
        ).status,
      ).toBe(403);
      expect(await deniedFacts()).toEqual(before);
    } finally {
      await updateModuloAmbiente("EMPORIO_SOLIDALE", true, null);
    }
  });
  it.each(["sociale", "uds", "emporio"])(
    "A27: area applicativa %s non concede grant aggiuntivi",
    async (area) => {
      const f = await fixture();
      await db
        .update(ruoliTable)
        .set({
          aree: [area],
          permessi: [
            "emporio.access.view",
            "emporio.access.manage",
            "credito.view",
          ],
        })
        .where(eq(ruoliTable.id, f.role.id));
      await access(f);
      expect((await f.agent.get("/api/accessi-emporio")).status).toBe(200);
      expect((await f.agent.get("/api/cassa-emporio/sessioni")).status).toBe(
        403,
      );
    },
  );
  it("A28: identità Accesso protetta quando ha una Sessione", async () => {
    const f = await fixture(),
      { access: a } = await open(f),
      before = await deniedFacts();
    expect(
      (
        await f.agent
          .patch(`/api/accessi-emporio/${a.id}`)
          .send({ dataOraInizio: "2026-10-16T09:00:00Z" })
      ).status,
    ).toBe(409);
    expect(await deniedFacts()).toEqual(before);
  });
  it("A30: fault audit annulla Accesso e ogni effetto nello stesso TX", async () => {
    const f = await fixture(),
      before = await deniedFacts();
    const oldCount = (
      await pool.query(
        "select count(*)::int as n from consegne where beneficiario_id=$1",
        [f.beneficiary.id],
      )
    ).rows[0].n;
    await pool.query(
      `CREATE FUNCTION m62a_fault_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.utente_id=${f.user.id} THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER m62a_fault_audit BEFORE INSERT ON audit_configurazioni FOR EACH ROW EXECUTE FUNCTION m62a_fault_audit()`,
    );
    try {
      const result = await f.agent.post("/api/accessi-emporio").send({
        beneficiarioId: f.beneficiary.id,
        magazzinoEmporioId: f.warehouse.id,
        dataOraInizio: "2026-10-30T09:00:00Z",
      });
      expect(result.status).toBe(500);
      expect(await deniedFacts()).toEqual(before);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from consegne where beneficiario_id=$1",
            [f.beneficiary.id],
          )
        ).rows[0].n,
      ).toBe(oldCount);
    } finally {
      await pool.query(
        "DROP TRIGGER m62a_fault_audit ON audit_configurazioni; DROP FUNCTION m62a_fault_audit()",
      );
    }
  });
  it("A15a: revoca commit mentre comando attende aggregato → diniego corrente", async () => {
    const f = await fixture(),
      { session: s } = await open(f),
      before = await deniedFacts(),
      blocker = await pool.connect();
    let pending: PromiseLike<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "select id from sessioni_cassa_emporio where id=$1 for update",
        [s.id],
      );
      const pid = (await blocker.query("select pg_backend_pid() as pid"))
        .rows[0].pid;
      pending = f.agent
        .post(`/api/cassa-emporio/sessioni/${s.id}/sospendi`)
        .send({ versione: s.versione })
        .then((r) => r);
      await waitBlocked(pid);
      await db
        .update(ruoliTable)
        .set({ permessi: grants.filter((g) => g !== "emporio.cassa.operate") })
        .where(eq(ruoliTable.id, f.role.id));
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(403);
      expect(await deniedFacts()).toEqual(before);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
    }
  });
  it("A15b: comando HTTP autorizzato precede la revoca concorrente", async () => {
    const f = await fixture(),
      { session: s } = await open(f),
      before = await facts(),
      revoker = await pool.connect(),
      blocker = await pool.connect();
    let revoke: Promise<unknown> | undefined,
      pending: PromiseLike<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("select id from beneficiari where id=$1 for update", [
        f.beneficiary.id,
      ]);
      const pid = (await blocker.query("select pg_backend_pid() as pid"))
        .rows[0].pid;
      pending = f.agent
        .post(`/api/cassa-emporio/sessioni/${s.id}/sospendi`)
        .send({ versione: s.versione })
        .then((r) => r);
      const commandPid = await waitBlocked(pid);
      revoke = revoker.query(
        "update utenti set area_operativa_id=null,centro_ascolto_id=null where id=$1",
        [f.user.id],
      );
      await waitBlocked(commandPid);
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(200);
      await revoke;
      expect((await f.agent.get("/api/accessi-emporio")).status).toBe(403);
      expect(await facts()).toEqual(before);
      expect(
        (
          await pool.query(
            "select stato_sessione from sessioni_cassa_emporio where id=$1",
            [s.id],
          )
        ).rows[0].stato_sessione,
      ).toBe("sospesa");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
      if (revoke) await revoke;
      revoker.release();
    }
  });
});
