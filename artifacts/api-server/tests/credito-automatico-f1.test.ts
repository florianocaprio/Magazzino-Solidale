import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  beneficiariTable,
  areeOperativeTable,
  centriAscoltoTable,
  emporioAbilitazioniTable,
  creditoSolidaleMovimentiTable as mov,
  creditoRicaricheMensiliTable as jobs,
  creditoRicaricheDestinatariTable as items,
  auditEventiTable,
  comandiOperativiTable,
  ruoliTable,
} from "@workspace/db";
import router from "../src/routes/credito-solidale";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import {
  calendarioCredito,
  eseguiRicaricaMensile,
  preparaRicaricaMensile,
} from "../src/lib/creditoMensile";
import { emporioActorFixture } from "./helpers/emporio-actor";
import { httpListeners } from "./helpers/http-listeners";

const target = new URL(process.env.DATABASE_URL!);
if (
  process.env.M62C_DISPOSABLE_DB !== "verified" ||
  target.hostname !== "127.0.0.1" ||
  target.pathname !== "/m62a"
)
  throw Error("F1 requires explicit disposable database");
const listeners = httpListeners({ diagnostics: "credito-automatico-f1" });
let actor: Awaited<ReturnType<typeof emporioActorFixture>>,
  area: number,
  center: number;
const created: number[] = [];
let month = 0;
let clock: Date;
const period = () => calendarioCredito(clock).periodo;
const balance = async (id: number) =>
  Number(
    (
      await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, id))
    )[0].creditoSolidaleSaldo,
  );
async function beneficiary(saldo = 210, quota = 12) {
  const [b] = await db
    .insert(beneficiariTable)
    .values({
      codice: "CF1-" + randomUUID().slice(0, 12),
      cognome: "Sintetico",
      nome: "F1",
      sesso: "M",
      areaOperativaId: area,
      centroAscoltoId: center,
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
      creditoSolidaleSaldo: String(saldo),
      creditoSolidaleMensileAssegnato: String(quota),
    })
    .returning();
  created.push(b.id);
  await db.insert(emporioAbilitazioniTable).values({
    beneficiarioId: b.id,
    areaOperativaId: area,
    operatoreId: actor.id,
    stato: "attivo",
    dataEffetto: new Date("2020-01-01"),
    motivo: "Fixture sintetica F1",
  });
  return b;
}
const app = () =>
  listeners.open(randomUUID(), () => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.user = actor;
      next();
    });
    a.use(router);
    a.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => res.status(500).json({ error: "Injected failure" }),
    );
    return a;
  });
const post = async (
  id: number,
  delta: unknown,
  key = randomUUID(),
  motivo = "Ridurre",
) =>
  request(await app())
    .post(`/credito-solidale/beneficiari/${id}/rettifica`)
    .send({ variazioneCredito: delta, idempotencyKey: key, motivo });
async function effects(id: number) {
  const [stock] = (await pool.query("select count(*)::int n from movimenti"))
    .rows;
  return {
    saldo: await balance(id),
    movements: await db.select().from(mov).where(eq(mov.beneficiarioId, id)),
    audits: await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.areaOperativaIdSnapshot, area)),
    receipts: await db
      .select()
      .from(comandiOperativiTable)
      .where(
        and(
          eq(comandiOperativiTable.tipoComando, "credito.saldo.rettifica"),
          eq(comandiOperativiTable.aggregatoId, id),
        ),
      ),
    stock: stock.n,
  };
}
beforeEach(async () => {
  await updateModuloAmbiente("EMPORIO_SOLIDALE", true, null);
  await updateModuloAmbiente("CREDITO_SOLIDALE", true, null);
  [area, center] = await db.transaction(async (tx) => {
    const [a] = await tx
      .insert(areeOperativeTable)
      .values({ nome: "F1 " + randomUUID() })
      .returning();
    const [c] = await tx
      .insert(centriAscoltoTable)
      .values({ nome: "F1 " + randomUUID(), areaOperativaId: a.id })
      .returning();
    return [a.id, c.id];
  });
  actor = await emporioActorFixture({
    isAdmin: true,
    aree: ["emporio"],
    permessi: [],
    areaOperativaId: null,
    centroAscoltoId: null,
  });
  clock = new Date(Date.UTC(2090, month++, 1, 0, 15));
});
afterEach(async () => {
  await listeners.close();
  if (created.length)
    await db
      .update(beneficiariTable)
      .set({ creditoSolidaleAbilitato: false })
      .where(inArray(beneficiariTable.id, created.splice(0)));
  await db.delete(items).where(eq(items.periodo, period()));
  await db.delete(jobs).where(eq(jobs.periodo, period()));
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

describe("F1 rettifica autonoma e sicurezza", () => {
  it.each([
    [12, 222, "rettifica_positiva"],
    [-12, 198, "rettifica_negativa"],
    [-210, 0, "rettifica_negativa"],
  ] as const)(
    "R02/R03/R04/R05/R10 delta %s, motivo non determina il segno",
    async (delta, after, tipo) => {
      const b = await beneficiary();
      const before = await effects(b.id);
      const result = await post(b.id, delta);
      expect(result.status, result.text).toBe(201);
      expect(result.body).toMatchObject({
        saldoPrima: 210,
        saldoDopo: after,
        variazioneCredito: delta,
        tipoMovimento: tipo,
      });
      const e = await effects(b.id);
      expect(e.saldo).toBe(after);
      expect(e.movements).toHaveLength(1);
      expect(e.audits).toHaveLength(1);
      expect(e.receipts).toHaveLength(1);
      expect(e.stock).toBe(before.stock);
      expect(e.audits[0]).toMatchObject({
        actorType: "user",
        actorUserId: actor.id,
      });
    },
  );
  it("R05/R06 limite esatto 10 e diniego oltre saldo atomico", async () => {
    const b = await beneficiary(10);
    const before = await effects(b.id);
    expect((await post(b.id, -11)).status).toBe(400);
    expect(await effects(b.id)).toEqual(before);
    expect((await post(b.id, -10)).body.saldoDopo).toBe(0);
  });
  it.each([0, 1.5, -1.5, 100000000, "", null, "3.01"])(
    "R07 rifiuta %s senza effetti",
    async (value) => {
      const b = await beneficiary();
      const before = await effects(b.id);
      expect((await post(b.id, value)).status).toBe(400);
      expect(await effects(b.id)).toEqual(before);
    },
  );
  it("R07 motivo whitespace obbligatorio, errore contestuale", async () => {
    const b = await beneficiary();
    const r = await post(b.id, 12, randomUUID(), "  ");
    expect(r.status).toBe(400);
    expect(r.body.fieldErrors.motivo).toBe("Campo obbligatorio");
    expect(await balance(b.id)).toBe(210);
  });
  it("R08 doppio click, replay esatto, GET risposta persa e conflitto payload", async () => {
    const b = await beneficiary(),
      key = randomUUID();
    const [a, c] = await Promise.all([
      post(b.id, -12, key),
      post(b.id, -12, key),
    ]);
    expect([a.status, c.status]).toEqual([201, 201]);
    expect(c.body).toEqual(a.body);
    const recovered = await request(await app()).get(
      `/credito-solidale/beneficiari/${b.id}/rettifiche/${key}/esito`,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual(a.body);
    expect((await post(b.id, 12, key)).status).toBe(409);
    const e = await effects(b.id);
    expect(e.saldo).toBe(198);
    expect(e.movements).toHaveLength(1);
    expect(e.audits).toHaveLength(1);
  });
  it("R09 riduzioni concorrenti serializzate", async () => {
    const b = await beneficiary(10);
    const r = await Promise.all([post(b.id, -7), post(b.id, -7)]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 400]);
    expect(await balance(b.id)).toBe(3);
    expect((await effects(b.id)).movements).toHaveLength(1);
  });
  it.each(["audit_eventi", "comandi_operativi"])(
    "rettifica: fault %s annulla saldo, movimento, audit e ricevuta",
    async (table) => {
      const b = await beneficiary(),
        before = await effects(b.id);
      await pool.query(
        `CREATE FUNCTION cf1_manual_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CF1_MANUAL_FAULT'; END $$; CREATE TRIGGER cf1_manual_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION cf1_manual_fault()`,
      );
      try {
        expect((await post(b.id, 12)).status).toBe(500);
      } finally {
        await pool.query(
          `DROP TRIGGER cf1_manual_fault ON ${table}; DROP FUNCTION cf1_manual_fault()`,
        );
      }
      expect(await effects(b.id)).toEqual(before);
    },
  );
  it("replay e GET negati dopo revoca grant corrente", async () => {
    const b = await beneficiary();
    actor = await emporioActorFixture({
      isAdmin: false,
      aree: ["emporio"],
      permessi: ["credito.adjust"],
      areaOperativaId: area,
      centroAscoltoId: center,
    });
    const key = randomUUID();
    expect((await post(b.id, 12, key)).status).toBe(201);
    await db
      .update(ruoliTable)
      .set({ permessi: [] })
      .where(eq(ruoliTable.id, actor.ruoloId!));
    expect((await post(b.id, 12, key)).status).toBe(403);
    expect(
      (
        await request(await app()).get(
          `/credito-solidale/beneficiari/${b.id}/rettifiche/${key}/esito`,
        )
      ).status,
    ).toBe(403);
    expect(await balance(b.id)).toBe(222);
  });
});

describe("F1 scheduler backend", () => {
  it("M01/M03/M12 due worker, quota sommata una sola volta e rettifica non riapre ricevuta", async () => {
    const b = await beneficiary();
    await Promise.all([
      eseguiRicaricaMensile(clock),
      eseguiRicaricaMensile(clock),
    ]);
    expect(await balance(b.id)).toBe(222);
    const e = await effects(b.id);
    expect(e.movements).toHaveLength(1);
    expect(e.audits).toHaveLength(1);
    expect(e.audits[0]).toMatchObject({
      actorType: "system",
      actorUserId: null,
      actorCodeSnapshot: "credito-mensile",
    });
    expect((await post(b.id, -12)).status).toBe(201);
    await eseguiRicaricaMensile(clock);
    expect(await balance(b.id)).toBe(210);
    expect(
      (
        await db
          .select()
          .from(items)
          .where(
            and(eq(items.periodo, period()), eq(items.beneficiarioId, b.id)),
          )
      )[0].stato,
    ).toBe("elaborato");
  });
  it("M02 calendario Rome fine anno e DST indipendente da UTC", () => {
    expect(calendarioCredito(new Date("2026-12-31T23:01:00Z"))).toEqual({
      periodo: "2027-01",
      primoDelMese: true,
    });
    expect(calendarioCredito(new Date("2026-06-30T22:01:00Z"))).toEqual({
      periodo: "2026-07",
      primoDelMese: true,
    });
    expect(calendarioCredito(new Date("2026-06-30T21:59:00Z"))).toEqual({
      periodo: "2026-06",
      primoDelMese: false,
    });
    expect(
      readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"),
    ).toContain("scheduleMonthlyCredit();");
  });
  it("M04 riprende gruppo persistito senza ampliare destinatari", async () => {
    const b = await beneficiary();
    await preparaRicaricaMensile(clock);
    const later = await beneficiary();
    clock.setUTCDate(10);
    await eseguiRicaricaMensile(clock);
    expect(await balance(b.id)).toBe(222);
    expect(await balance(later.id)).toBe(210);
    await eseguiRicaricaMensile(clock);
    expect(await balance(b.id)).toBe(222);
  });
  it("M05 storico mensile stornato resta già eseguito", async () => {
    const b = await beneficiary();
    const [m] = await db
      .insert(mov)
      .values({
        beneficiarioId: b.id,
        tipoMovimento: "ricarica_mensile",
        variazioneCredito: "12",
        saldoPrima: "198",
        saldoDopo: "210",
        periodoRiferimento: period(),
        annullato: true,
        origine: "legacy",
      })
      .returning();
    await eseguiRicaricaMensile(clock);
    expect(await balance(b.id)).toBe(210);
    const [item] = await db
      .select()
      .from(items)
      .where(eq(items.beneficiarioId, b.id));
    expect(item).toMatchObject({ stato: "gia_elaborato", movimentoId: m.id });
    expect((await effects(b.id)).movements).toHaveLength(1);
  });
  it.each([
    "sospeso",
    "inattivo",
    "senza_diritto",
    "quota_zero",
    "territorio",
    "saldo_frazionario",
  ])("M06 esclusione %s senza effetti", async (reason) => {
    const b = await beneficiary();
    if (reason === "sospeso")
      await db
        .update(beneficiariTable)
        .set({ creditoSolidaleStato: "sospeso" })
        .where(eq(beneficiariTable.id, b.id));
    if (reason === "inattivo")
      await db
        .update(beneficiariTable)
        .set({ attivo: false })
        .where(eq(beneficiariTable.id, b.id));
    if (reason === "senza_diritto")
      await db
        .update(emporioAbilitazioniTable)
        .set({ stato: "revocato" })
        .where(eq(emporioAbilitazioniTable.beneficiarioId, b.id));
    if (reason === "quota_zero")
      await db
        .update(beneficiariTable)
        .set({ creditoSolidaleMensileAssegnato: "0" })
        .where(eq(beneficiariTable.id, b.id));
    if (reason === "territorio")
      await db
        .update(centriAscoltoTable)
        .set({ attivo: false })
        .where(eq(centriAscoltoTable.id, center));
    if (reason === "saldo_frazionario") {
      // Simula esclusivamente un record legacy pre-49. Il bypass è locale alla
      // transazione di fixture sul disposable; la procedura gira con tutti i vincoli.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        await tx
          .update(beneficiariTable)
          .set({ creditoSolidaleSaldo: "210.50" })
          .where(eq(beneficiariTable.id, b.id));
      });
    }
    const before = await balance(b.id);
    await eseguiRicaricaMensile(clock);
    expect(await balance(b.id)).toBe(before);
    expect((await effects(b.id)).movements).toHaveLength(0);
    expect(
      (await db.select().from(items).where(eq(items.beneficiarioId, b.id)))[0]
        .stato,
    ).toBe("escluso");
  });
  it.each([
    "credito_solidale_movimenti",
    "audit_eventi",
    "credito_ricariche_destinatari",
  ])(
    "M07/M08 rollback su %s, altri beneficiari completati e retry tecnico",
    async (table) => {
      const b = await beneficiary(),
        other = await beneficiary();
      const before = await effects(b.id);
      const condition =
        table === "audit_eventi"
          ? `NEW.entita_id IN (SELECT id FROM credito_solidale_movimenti WHERE beneficiario_id=${b.id}) AND NEW.azione='CREDITO_RICARICA_MENSILE'`
          : table === "credito_ricariche_destinatari"
            ? `NEW.beneficiario_id=${b.id} AND NEW.stato='elaborato'`
            : `NEW.beneficiario_id=${b.id}`;
      await pool.query(
        `CREATE FUNCTION cf1_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'CF1_SYNTHETIC_FAULT'; END IF; RETURN NEW; END $$; CREATE TRIGGER cf1_fault BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION cf1_fault()`,
      );
      try {
        await eseguiRicaricaMensile(clock);
      } finally {
        await pool.query(
          `DROP TRIGGER cf1_fault ON ${table}; DROP FUNCTION cf1_fault()`,
        );
      }
      expect(await balance(b.id)).toBe(210);
      expect(await balance(other.id)).toBe(222);
      const e = await effects(b.id);
      expect(e.movements).toEqual(before.movements);
      expect(e.receipts).toEqual(before.receipts);
      const successful = await effects(other.id);
      expect(successful.movements).toHaveLength(1);
      expect(e.audits).toHaveLength(1);
      expect(e.audits[0].entitaId).toBe(successful.movements[0].id);
      expect(
        (await db.select().from(items).where(eq(items.beneficiarioId, b.id)))[0]
          .stato,
      ).toBe("errore");
      clock.setUTCDate(10);
      await eseguiRicaricaMensile(clock);
      expect(await balance(b.id)).toBe(222);
      expect(await balance(other.id)).toBe(222);
    },
  );
  it.each([false, true])(
    "M09 tutti gli ingressi pubblici dismessi anche SuperAdmin=%s",
    async (isSuperAdmin) => {
      actor = await emporioActorFixture({
        isAdmin: true,
        isSuperAdmin,
        aree: ["emporio"],
        permessi: [],
        areaOperativaId: null,
        centroAscoltoId: null,
      });
      const b = await beneficiary();
      const before = await effects(b.id);
      for (const url of [
        `/credito-solidale/beneficiari/${b.id}/ricarica-manuale`,
        `/credito-solidale/beneficiari/${b.id}/refresh-credito`,
        "/credito-solidale/ricariche-mensili/esegui",
      ])
        expect(
          (
            await request(await app())
              .post(url)
              .send({
                variazioneCredito: 12,
                periodoRiferimento: period(),
                force: true,
              })
          ).status,
        ).toBe(410);
      expect(await effects(b.id)).toEqual(before);
    },
  );
  it("M10/M11 letture non accreditano; recupero corrente al primo avvio tardivo una sola volta", async () => {
    const b = await beneficiary();
    clock.setUTCDate(10);
    for (const url of [
      `/credito-solidale/beneficiari/${b.id}/saldo`,
      "/credito-solidale/ricariche-mensili/stato",
    ]) {
      const response = await request(await app()).get(url);
      expect(response.status).toBe(200);
      if (url.endsWith("/stato")) {
        expect(response.body.recuperoDaDecidere).toBe(false);
        expect(response.body.calendario).toContain(
          "recupero automatico della sola mensilità corrente",
        );
      }
    }
    expect(await balance(b.id)).toBe(210);
    expect(
      await db.select().from(jobs).where(eq(jobs.periodo, period())),
    ).toHaveLength(0);
    await Promise.all([
      eseguiRicaricaMensile(clock),
      eseguiRicaricaMensile(clock),
    ]);
    expect(await balance(b.id)).toBe(222);
    expect(
      await db.select().from(jobs).where(eq(jobs.periodo, period())),
    ).toHaveLength(1);
    expect(
      (await effects(b.id)).movements.filter(
        (m) => m.tipoMovimento === "ricarica_mensile",
      ),
    ).toHaveLength(1);
    await eseguiRicaricaMensile(clock);
    expect(await balance(b.id)).toBe(222);
  });

  it("D67-01 non recupera mesi precedenti neppure con un gruppo pendente", async () => {
    const b = await beneficiary();
    const previous = new Date(clock);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    const previousPeriod = calendarioCredito(previous).periodo;
    try {
      await preparaRicaricaMensile(previous);
      clock.setUTCDate(15);
      await eseguiRicaricaMensile(clock);
      expect(await balance(b.id)).toBe(222);
      const credits = (await effects(b.id)).movements.filter(
        (m) => m.tipoMovimento === "ricarica_mensile",
      );
      expect(credits).toHaveLength(1);
      expect(credits[0].periodoRiferimento).toBe(period());
      const old = await db
        .select()
        .from(jobs)
        .where(eq(jobs.periodo, previousPeriod));
      expect(old[0].completataAt).toBeNull();
      const oldItems = await db
        .select()
        .from(items)
        .where(eq(items.periodo, previousPeriod));
      expect(oldItems.find((i) => i.beneficiarioId === b.id)?.stato).toBe(
        "pendente",
      );
    } finally {
      await db.delete(items).where(eq(items.periodo, previousPeriod));
      await db.delete(jobs).where(eq(jobs.periodo, previousPeriod));
    }
  });

  it("D67-01 recupero tardivo verifica diritto corrente e non amplia il gruppo ai tick successivi", async () => {
    clock.setUTCDate(12);
    const eligible = await beneficiary();
    const revoked = await beneficiary();
    await db
      .update(emporioAbilitazioniTable)
      .set({ stato: "revocato" })
      .where(eq(emporioAbilitazioniTable.beneficiarioId, revoked.id));
    await preparaRicaricaMensile(clock);
    const later = await beneficiary();
    await eseguiRicaricaMensile(clock);
    expect(await balance(eligible.id)).toBe(222);
    expect(await balance(revoked.id)).toBe(210);
    expect(await balance(later.id)).toBe(210);
    await eseguiRicaricaMensile(clock);
    expect(await balance(later.id)).toBe(210);
  });
});
