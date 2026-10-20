import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  beneficiariTable as ben,
  areeOperativeTable,
  centriAscoltoTable,
  politicheCreditoSolidaleTable as policies,
  creditoSolidaleMovimentiTable as mov,
  comandiOperativiTable as commands,
  emporioAbilitazioniTable as rights,
  ruoliTable,
  auditConfigurazioniTable,
  creditoRicaricheDestinatariTable as items,
} from "@workspace/db";
import emporioRouter from "../src/routes/emporio-servizio";
import creditoRouter from "../src/routes/credito-solidale";
import beneficiariRouter from "../src/routes/beneficiari";
import {
  anteprimaAttivazioneEmporio,
  attivaEmporioCredito,
  esitoAttivazioneEmporio,
} from "../src/lib/emporioAttivazione";
import {
  eseguiRicaricaMensile,
  preparaRicaricaMensile,
  calendarioCredito,
} from "../src/lib/creditoMensile";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import { auditContextFromRequest } from "../src/lib/auditEvent";
import { emporioActorFixture } from "./helpers/emporio-actor";
import { httpListeners } from "./helpers/http-listeners";

const target = new URL(process.env.DATABASE_URL!);
if (
  process.env.M62C_DISPOSABLE_DB !== "verified" ||
  target.hostname !== "127.0.0.1" ||
  target.pathname !== "/m62a"
)
  throw Error("C2B requires runner disposable database");
const listeners = httpListeners({ diagnostics: "emporio-c2b" });
let actor: Awaited<ReturnType<typeof emporioActorFixture>>,
  area: number,
  center: number,
  policy: number;
let month = 0;
let clock: Date;
const ids: number[] = [];
const row = async (id: number) =>
  (await db.select().from(ben).where(eq(ben.id, id)))[0];
const movements = (id: number) =>
  db.select().from(mov).where(eq(mov.beneficiarioId, id));
async function beneficiary(extra: Partial<typeof ben.$inferInsert> = {}) {
  const [b] = await db
    .insert(ben)
    .values({
      codice: "C2B-" + randomUUID().slice(0, 12),
      nome: "Persona",
      cognome: "Sintetica",
      sesso: "M",
      areaOperativaId: area,
      centroAscoltoId: center,
      numComponenti: 1,
      ...extra,
    })
    .returning();
  ids.push(b.id);
  return b;
}
async function body(id: number, quota?: number) {
  const p = await anteprimaAttivazioneEmporio(id, actor.id);
  return {
    idempotencyKey: randomUUID(),
    versioneBeneficiario: p.versioneBeneficiario,
    calcoloToken: p.calcoloToken,
    motivo: "Accesso Emporio autorizzato",
    ...(quota === undefined
      ? {}
      : {
          quotaMensileAssegnata: quota,
          motivoModificaQuota: "Valutazione sociale motivata",
        }),
  };
}
async function activate(id: number, data?: Awaited<ReturnType<typeof body>>) {
  return attivaEmporioCredito({
    id,
    userId: actor.id,
    body: data ?? (await body(id)),
    now: clock,
    command: auditContextFromRequest({ user: actor } as express.Request),
  });
}
async function app() {
  return listeners.open("app", () => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.user = actor;
      next();
    });
    a.use(emporioRouter);
    a.use(creditoRouter);
    a.use(beneficiariRouter);
    return a;
  });
}
async function patch(id: number, fields: Record<string, unknown>) {
  return request(await app())
    .patch(`/beneficiari/${id}`)
    .send({ versione: (await row(id)).versione, ...fields });
}
beforeEach(async () => {
  await updateModuloAmbiente("EMPORIO_SOLIDALE", true);
  await updateModuloAmbiente("CREDITO_SOLIDALE", true);
  const [a] = await db
    .insert(areeOperativeTable)
    .values({ nome: "C2B " + randomUUID() })
    .returning();
  area = a.id;
  const [c] = await db
    .insert(centriAscoltoTable)
    .values({ nome: "C2B " + randomUUID(), areaOperativaId: area })
    .returning();
  center = c.id;
  const [p] = await db
    .insert(policies)
    .values({
      nome: "C2B 60",
      centroAscoltoId: center,
      areaOperativaId: area,
      creditoBaseNucleo: "50",
      creditoPerComponente: "10",
      bonusMinore: "5",
      bonusAnziano: "5",
      bonusDisabile: "10",
    })
    .returning();
  policy = p.id;
  actor = await emporioActorFixture({
    isAdmin: false,
    aree: ["sociale"],
    permessi: [
      "emporio.eligibility.manage",
      "credito.quota.manage",
      "credito.view",
      "beneficiari.view",
      "beneficiari.manage",
      "beneficiari.sensitive.view",
    ],
    areaOperativaId: area,
    centroAscoltoId: null,
  });
  clock = new Date(Date.UTC(2140, month++, 1, 8));
});
afterEach(async () => {
  await listeners.close();
  if (ids.length)
    await db
      .update(ben)
      .set({ creditoSolidaleAbilitato: false })
      .where(inArray(ben.id, ids.splice(0)));
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});

it.each([undefined, 80, 0])(
  "prima quota totale %s, ricevuta e ripetizione senza doppio accredito",
  async (quota) => {
    const b = await beneficiary({ creditoSolidaleSaldo: "7" });
    const data = await body(b.id, quota);
    expect(
      (await anteprimaAttivazioneEmporio(b.id, actor.id)).totaleSuggerito,
    ).toBe(60);
    expect(await movements(b.id)).toHaveLength(0);
    const result = await activate(b.id, data);
    expect(result.quotaAccreditata).toBe(quota ?? 60);
    expect(Number((await row(b.id)).creditoSolidaleSaldo)).toBe(
      7 + (quota ?? 60),
    );
    expect(await activate(b.id, data)).toEqual(result);
    expect(
      await esitoAttivazioneEmporio(b.id, actor.id, data.idempotencyKey),
    ).toEqual(result);
    await expect(
      activate(b.id, { ...data, motivo: "Contenuto diverso" }),
    ).rejects.toMatchObject({ status: 409 });
    const again = await activate(b.id, await body(b.id, 90));
    expect(again.quotaAccreditata).toBe(0);
    const history = await movements(b.id);
    expect(history).toHaveLength(quota === 0 ? 0 : 1);
    if (history[0])
      expect(history[0]).toMatchObject({
        origine: "attivazione_emporio",
        operatoreId: actor.id,
      });
    expect(
      await db.select().from(rights).where(eq(rights.beneficiarioId, b.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(commands)
        .where(
          and(
            eq(commands.tipoComando, "credito.quota.periodo"),
            eq(commands.aggregatoId, b.id),
          ),
        ),
    ).toHaveLength(1);
  },
);
it("due conferme concorrenti con stessa chiave hanno un solo esito", async () => {
  const b = await beneficiary();
  const data = await body(b.id, 80);
  const [a, c] = await Promise.all([
    activate(b.id, data),
    activate(b.id, data),
  ]);
  expect(a).toEqual(c);
  expect(await movements(b.id)).toHaveLength(1);
});
it("deroga senza motivo e quota frazionaria rifiutate server senza effetti", async () => {
  const b = await beneficiary();
  const data = await body(b.id, 80);
  await expect(
    activate(b.id, { ...data, motivoModificaQuota: " " }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    activate(b.id, { ...data, quotaMensileAssegnata: 1.5 }),
  ).rejects.toMatchObject({ status: 400 });
  expect((await row(b.id)).creditoSolidaleAbilitato).toBe(false);
  expect(await movements(b.id)).toHaveLength(0);
});
it("diritto già attivo e credito senza quota: completa senza duplicare il diritto", async () => {
  const b = await beneficiary({
    creditoSolidaleAbilitato: true,
    creditoSolidaleStato: "attivo",
  });
  const [r] = await db
    .insert(rights)
    .values({
      beneficiarioId: b.id,
      areaOperativaId: area,
      operatoreId: actor.id,
      stato: "attivo",
      motivo: "Preesistente",
      dataEffetto: new Date("2020-01-01"),
    })
    .returning();
  expect((await activate(b.id)).quotaAccreditata).toBe(60);
  expect(
    (await db.select().from(rights).where(eq(rights.id, r.id)))[0].motivo,
  ).toBe("Preesistente");
});
it.each(["quota_storica", "movimento_stornato", "saldo_speso"])(
  "%s non è una prima attivazione anche con saldo zero",
  async (kind) => {
    const b = await beneficiary(
      kind === "quota_storica" ? { creditoSolidaleMensileAssegnato: "0" } : {},
    );
    if (kind !== "quota_storica")
      await db
        .insert(mov)
        .values({
          beneficiarioId: b.id,
          tipoMovimento:
            kind === "saldo_speso" ? "addebito_emporio" : "ricarica_iniziale",
          variazioneCredito: kind === "saldo_speso" ? "-60" : "60",
          saldoPrima: "60",
          saldoDopo: "0",
          annullato: kind === "movimento_stornato",
          origine: "legacy",
        });
    expect((await activate(b.id)).quotaAccreditata).toBe(0);
    expect(Number((await row(b.id)).creditoSolidaleSaldo)).toBe(0);
  },
);
it("revoca grant impedisce replay e recupero anche con sessione precedente", async () => {
  const b = await beneficiary();
  const data = await body(b.id);
  await activate(b.id, data);
  await db
    .update(ruoliTable)
    .set({ permessi: ["emporio.eligibility.manage"] })
    .where(eq(ruoliTable.id, actor.ruoloId!));
  await expect(activate(b.id, data)).rejects.toMatchObject({ status: 403 });
  await expect(
    esitoAttivazioneEmporio(b.id, actor.id, data.idempotencyKey),
  ).rejects.toMatchObject({ status: 403 });
});
it("errore audit annulla diritto, quota, saldo e ricevute; retry riprende", async () => {
  const b = await beneficiary();
  const data = await body(b.id);
  await pool.query(
    `CREATE FUNCTION c2b_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.chiave='beneficiario:${b.id}:credito-solidale' THEN RAISE EXCEPTION 'C2B_FAULT'; END IF; RETURN NEW; END $$; CREATE TRIGGER c2b_fault BEFORE INSERT ON audit_configurazioni FOR EACH ROW EXECUTE FUNCTION c2b_fault()`,
  );
  try {
    await expect(activate(b.id, data)).rejects.toThrow();
  } finally {
    await pool.query(
      "DROP TRIGGER c2b_fault ON audit_configurazioni; DROP FUNCTION c2b_fault()",
    );
  }
  expect((await row(b.id)).creditoSolidaleAbilitato).toBe(false);
  expect(await movements(b.id)).toHaveLength(0);
  expect(
    await db.select().from(rights).where(eq(rights.beneficiarioId, b.id)),
  ).toHaveLength(0);
  expect(
    await db.select().from(commands).where(eq(commands.aggregatoId, b.id)),
  ).toHaveLength(0);
  expect((await activate(b.id, data)).quotaAccreditata).toBe(60);
});
it.each(["prima", "scheduler", "concorrente"])(
  "prima quota e scheduler %s condividono il periodo",
  async (order) => {
    const b = await beneficiary({
      creditoSolidaleAbilitato: true,
      creditoSolidaleStato: "attivo",
    });
    await db
      .insert(rights)
      .values({
        beneficiarioId: b.id,
        areaOperativaId: area,
        operatoreId: actor.id,
        stato: "attivo",
        motivo: "Prima del congelamento",
        dataEffetto: new Date("2020-01-01"),
      });
    await preparaRicaricaMensile(clock);
    const data = await body(b.id);
    if (order === "prima") {
      await activate(b.id, data);
      await eseguiRicaricaMensile(clock);
    } else if (order === "scheduler") {
      await eseguiRicaricaMensile(clock);
      await activate(b.id);
    } else {
      await Promise.allSettled([
        activate(b.id, data),
        eseguiRicaricaMensile(clock),
      ]);
      await eseguiRicaricaMensile(clock);
    }
    expect(Number((await row(b.id)).creditoSolidaleSaldo)).toBe(60);
    expect(await movements(b.id)).toHaveLength(1);
  },
);
it("attivazione dopo congelamento non allarga la coorte e quota zero è terminale", async () => {
  await preparaRicaricaMensile(clock);
  const b = await beneficiary();
  await activate(b.id, await body(b.id, 0));
  await eseguiRicaricaMensile(clock);
  expect(
    await db.select().from(items).where(eq(items.beneficiarioId, b.id)),
  ).toHaveLength(0);
  await activate(b.id, await body(b.id, 80));
  expect(await movements(b.id)).toHaveLength(0);
});
it("mensilità automatica ricalcola la politica corrente, manuale conserva il totale", async () => {
  const auto = await beneficiary(),
    manual = await beneficiary();
  await activate(auto.id);
  await activate(manual.id, await body(manual.id, 80));
  await db
    .update(policies)
    .set({ creditoBaseNucleo: "20" })
    .where(eq(policies.id, policy));
  const next = new Date(clock);
  next.setUTCMonth(next.getUTCMonth() + 1);
  await eseguiRicaricaMensile(next);
  expect(Number((await row(auto.id)).creditoSolidaleSaldo)).toBe(90);
  expect(Number((await row(manual.id)).creditoSolidaleSaldo)).toBe(160);
});
it("PATCH identico/note conserva deroga; aumento e diminuzione resettano senza toccare saldo", async () => {
  const b = await beneficiary();
  await activate(b.id, await body(b.id, 80));
  expect(
    (await patch(b.id, { numComponenti: 1, noteInterne: "Nota" })).status,
  ).toBe(200);
  expect((await row(b.id)).creditoSolidaleMensileManuale).toBe(true);
  const oldVersion = (await row(b.id)).versione;
  const increase = await patch(b.id, { numComponenti: 3, numMinori: 1 });
  expect(increase.status, increase.text).toBe(200);
  expect(await row(b.id)).toMatchObject({
    creditoSolidaleMensileManuale: false,
    creditoSolidaleMotivoModifica: null,
  });
  expect(Number((await row(b.id)).creditoSolidaleMensileAssegnato)).toBe(85);
  const stale = await request(await app())
    .patch(`/credito-solidale/beneficiari/${b.id}/configurazione`)
    .send({
      versioneBeneficiario: oldVersion,
      creditoSolidaleMensileAssegnato: 80,
      creditoSolidaleMotivoModifica: "Vecchio form",
    });
  expect(stale.status).toBe(409);
  const decrease = await patch(b.id, { numComponenti: 1, numMinori: 0 });
  expect(decrease.status, decrease.text).toBe(200);
  expect(Number((await row(b.id)).creditoSolidaleMensileAssegnato)).toBe(60);
  expect(Number((await row(b.id)).creditoSolidaleSaldo)).toBe(80);
  const history = await db
    .select()
    .from(auditConfigurazioniTable)
    .where(
      eq(auditConfigurazioniTable.azione, "ricalcolo-quota-cambio-nucleo"),
    );
  expect(
    history.some(
      (x) =>
        (x.valorePrecedente as { motivo?: string })?.motivo ===
        "Valutazione sociale motivata",
    ),
  ).toBe(true);
});
it("cambio nucleo interrompe deroga anche quando il massimo lascia invariata la quota", async () => {
  await db
    .update(policies)
    .set({ creditoMassimoMensile: "60" })
    .where(eq(policies.id, policy));
  const b = await beneficiary();
  await activate(b.id, await body(b.id, 80));
  expect((await patch(b.id, { numComponenti: 2 })).status).toBe(200);
  expect((await row(b.id)).creditoSolidaleMensileManuale).toBe(false);
  expect(Number((await row(b.id)).creditoSolidaleMensileAssegnato)).toBe(60);
});
it("componenti dettagliati: note/identico conservano, composizione cambia senza inventare contatori", async () => {
  const b = await beneficiary();
  await activate(b.id, await body(b.id, 80));
  const server = await app();
  const added = await request(server)
    .post(`/beneficiari/${b.id}/nucleo`)
    .send({
      nome: "Figlio",
      cognome: "Sintetico",
      relazione: "figlio",
      dataNascita: "2015-01-01",
      sesso: "M",
    });
  expect(added.status, added.text).toBe(201);
  expect((await row(b.id)).numComponenti).toBe(1);
  expect((await row(b.id)).creditoSolidaleMensileManuale).toBe(false);
  await activate(b.id, await body(b.id, 80));
  const changed = await request(server)
    .patch(`/beneficiari/${b.id}/nucleo/${added.body.id}`)
    .send({ note: "Solo nota" });
  expect(changed.status, changed.text).toBe(200);
  expect((await row(b.id)).creditoSolidaleMensileManuale).toBe(true);
  const removed = await request(server).delete(
    `/beneficiari/${b.id}/nucleo/${added.body.id}`,
  );
  expect(removed.status, removed.text).toBe(204);
  expect((await row(b.id)).creditoSolidaleMensileManuale).toBe(false);
  expect(Number((await row(b.id)).creditoSolidaleSaldo)).toBe(80);
});
it("PATCH quota usa il motore server e richiede versione e motivo", async () => {
  clock = new Date();
  const b = await beneficiary();
  await activate(b.id);
  const server = await app();
  const send = (fields: Record<string, unknown>) =>
    request(server)
      .patch(`/credito-solidale/beneficiari/${b.id}/configurazione`)
      .send(fields);
  expect(
    (
      await send({
        creditoSolidaleMensileAssegnato: 80,
        creditoSolidaleMotivoModifica: "Deroga",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await send({
        versioneBeneficiario: (await row(b.id)).versione,
        creditoSolidaleMensileAssegnato: 80,
        creditoSolidaleMensileSuggerito: 80,
      })
    ).status,
  ).toBe(400);
  const ok = await send({
    versioneBeneficiario: (await row(b.id)).versione,
    creditoSolidaleMensileAssegnato: 80,
    creditoSolidaleMensileSuggerito: 80,
    creditoSolidaleMotivoModifica: "Totale",
  });
  expect(ok.status, ok.text).toBe(200);
  expect((await row(b.id)).creditoSolidaleMensileManuale).toBe(true);
  expect(Number((await row(b.id)).creditoSolidaleSaldo)).toBe(60);
});
it("GET HTTP e anteprima non attivano diritti o accrediti", async () => {
  const b = await beneficiary();
  const server = await app();
  const preview = await request(server).get(
    `/emporio/beneficiari/${b.id}/attivazione-credito`,
  );
  expect(preview.status, preview.text).toBe(200);
  expect(await movements(b.id)).toHaveLength(0);
  expect((await row(b.id)).creditoSolidaleAbilitato).toBe(false);
});

it("riattivazione di un diritto storico revocato non inventa la prima quota",async()=>{
  const b=await beneficiary();await db.insert(rights).values({beneficiarioId:b.id,areaOperativaId:area,operatoreId:actor.id,stato:"revocato",motivo:"Storico",dataEffetto:new Date("2020-01-01")});
  expect((await activate(b.id)).quotaAccreditata).toBe(0);expect(await movements(b.id)).toHaveLength(0);
});

it.each(["senza_quota","altro_territorio","modulo_spento"])("comando composto nega %s senza diritto o movimento",async condition=>{
  const b=await beneficiary();const data=await body(b.id);
  if(condition==="senza_quota")await db.update(ruoliTable).set({permessi:["emporio.eligibility.manage"]}).where(eq(ruoliTable.id,actor.ruoloId!));
  if(condition==="altro_territorio")await db.update(ben).set({areaOperativaId:null}).where(eq(ben.id,b.id));
  if(condition==="modulo_spento")await updateModuloAmbiente("CREDITO_SOLIDALE",false);
  await expect(activate(b.id,data)).rejects.toMatchObject({status:403});expect(await movements(b.id)).toHaveLength(0);
  expect(await db.select().from(rights).where(eq(rights.beneficiarioId,b.id))).toHaveLength(0);
});

it("R1 sceglie la politica alla prima conferma: anteprima senza scritture, calcolo e salvataggio atomici",async()=>{
  const b=await beneficiary();
  const [other]=await db.insert(policies).values({nome:"Politica alternativa",areaOperativaId:area,creditoBaseNucleo:"20",creditoPerComponente:"5"}).returning();
  const p=await anteprimaAttivazioneEmporio(b.id,actor.id,other.id);
  expect(p).toMatchObject({politicaNome:"Politica alternativa",politicaCreditoSolidaleId:other.id,totaleSuggerito:25});
  expect(p.politicheDisponibili.map(x=>x.id)).toEqual(expect.arrayContaining([policy,other.id]));
  expect((await row(b.id)).politicaCreditoSolidaleId).toBeNull();expect(await movements(b.id)).toHaveLength(0);
  const data={...await body(b.id),politicaCreditoSolidaleId:other.id,calcoloToken:p.calcoloToken};
  const result=await activate(b.id,data);expect(result).toMatchObject({politicaNome:"Politica alternativa",quotaAccreditata:25});
  expect((await row(b.id)).politicaCreditoSolidaleId).toBe(other.id);expect(Number((await row(b.id)).creditoSolidaleSaldo)).toBe(25);
  expect((await movements(b.id))[0].politicaCreditoSolidaleId).toBe(other.id);
  expect(await activate(b.id,data)).toEqual(result);expect(await movements(b.id)).toHaveLength(1);
});
it("R1 policy estranee/disattivate e cambio non anticipato sono rifiutati senza effetti",async()=>{
  const b=await beneficiary();
  const [a]=await db.insert(areeOperativeTable).values({nome:"Altra Area "+randomUUID()}).returning();
  const [foreign]=await db.insert(policies).values({nome:"Esterna",areaOperativaId:a.id}).returning();
  const data=await body(b.id);
  await expect(anteprimaAttivazioneEmporio(b.id,actor.id,foreign.id)).rejects.toMatchObject({status:400});
  expect((await anteprimaAttivazioneEmporio(b.id,actor.id)).politicheDisponibili.some(p=>p.id===foreign.id)).toBe(false);
  await expect(activate(b.id,{...data,politicaCreditoSolidaleId:foreign.id})).rejects.toMatchObject({status:400});
  await expect(activate(b.id,{...data,politicaCreditoSolidaleId:policy})).rejects.toMatchObject({status:409});
  expect(await movements(b.id)).toHaveLength(0);expect((await row(b.id)).creditoSolidaleAbilitato).toBe(false);
});
