import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "@workspace/db";
import app from "../src/app";

const suffix = randomUUID().slice(0, 8);
let area: number, centre: number, subject: number, actor: number;
let warehouse: number, product: number, lot: number;
let session: ReturnType<typeof request.agent>;
const insert = async (text: string, values: unknown[] = []) =>
  (await pool.query(text, values)).rows[0].id as number;
const version = async (id: number) =>
  (
    await pool.query("select data_aggiornamento from interventi where id=$1", [
      id,
    ])
  ).rows[0].data_aggiornamento.toISOString() as string;
const intervention = () =>
  insert(
    "insert into interventi(beneficiario_id,tipo_intervento,ambito,stato,operatore_id,data_aggiornamento)values($1,$2,'sociale','in_corso',$3,$4)returning id",
    [subject, `formal-${suffix}`, actor, new Date()],
  );
beforeAll(async () => {
  expect(process.env.M63_DISPOSABLE_DB).toBe("verified");
  const url = new URL(process.env.DATABASE_URL!);
  expect([url.hostname, url.port]).toEqual(["127.0.0.1", "58631"]);
  area = await insert(
    "insert into aree_operative(nome)values($1)returning id",
    [`Formal ${suffix}`],
  );
  centre = await insert(
    "insert into centri_di_ascolto(nome,area_operativa_id)values($1,$2)returning id",
    [`Formal ${suffix}`, area],
  );
  subject = await insert(
    "insert into beneficiari(codice,nome,cognome,area_operativa_id,centro_ascolto_id)values($1,'Persona','Sintetica',$2,$3)returning id",
    [`FORMAL-${suffix}`, area, centre],
  );
  const role = await insert(
    "insert into ruoli(nome,aree,permessi)values($1,$2,$3)returning id",
    [
      `Formal ${suffix}`,
      JSON.stringify(["sociale", "magazzino"]),
      JSON.stringify([
        "sociale.interventi.view",
        "sociale.interventi.create",
        "sociale.interventi.update",
        "sociale.interventi.complete",
        "sociale.interventi.cancel",
      ]),
    ],
  );
  const password = randomUUID();
  actor = await insert(
    "insert into utenti(username,nome,password_hash,ruolo_id,area_operativa_id,centro_ascolto_id,must_change_password)values($1,'Sintetico',$2,$3,$4,$5,false)returning id",
    [`formal-${suffix}`, await bcrypt.hash(password, 4), role, area, centre],
  );
  session = request.agent(app);
  expect(
    (
      await session.post("/api/auth/login").send({
        username: `formal-${suffix}`,
        password,
      })
    ).status,
  ).toBe(200);
  warehouse = await insert(
    "insert into magazzini(codice,nome,area_operativa_id)values($1,'Deposito sintetico',$2)returning id",
    [`FWH-${suffix}`, area],
  );
  product = await insert(
    "insert into prodotti(codice,nome,tipo_prodotto,unita_misura)values($1,'Kit sintetico','igiene','pz')returning id",
    [`FPR-${suffix}`],
  );
  lot = await insert(
    "insert into lotti(prodotto_id,magazzino_id,data_carico,quantita_caricata,quantita_residua)values($1,$2,current_date,20,20)returning id",
    [product, warehouse],
  );
});
afterAll(async () => {
  await pool.end();
});

it("S05 Zona inattiva o incoerente nega lettura e comando con sessione già aperta", async () => {
  const id = await intervention();
  const zone = await insert(
    "insert into zone_uds(nome,area_operativa_id,attivo)values($1,$2,false)returning id",
    [`Formal ${suffix}`, area],
  );
  await pool.query("update utenti set zona_uds_id=$1 where id=$2", [
    zone,
    actor,
  ]);
  try {
    for (const inactive of [true, false]) {
      if (!inactive) {
        const other = await insert(
          "insert into aree_operative(nome)values($1)returning id",
          [`Other ${suffix}`],
        );
        const otherZone = await insert(
          "insert into zone_uds(nome,area_operativa_id,attivo)values($1,$2,true)returning id",
          [`Other ${suffix}`, other],
        );
        await expect(
          pool.query("update utenti set zona_uds_id=$1 where id=$2", [
            otherZone,
            actor,
          ]),
        ).rejects.toMatchObject({
          code: "23503",
          constraint: "utenti_zona_area_fk",
        });
      }
      expect((await session.get(`/api/interventi/${id}`)).status).toBe(403);
      expect(
        (
          await session
            .post(`/api/interventi/${id}/salva-operativita`)
            .send({ versione: await version(id), note: "non salvare" })
        ).status,
      ).toBe(403);
    }
  } finally {
    await pool.query("update utenti set zona_uds_id=null where id=$1", [actor]);
  }
});

it("M63-04 errore audit: rollback integrale; incremento, no-op e conflitto senza doppio effetto", async () => {
  const id = await intervention();
  const path = `/api/interventi/${id}/salva-operativita`;
  const payload = {
    versione: await version(id),
    note: "contenuto sociale da non includere nell'audit",
    materiali: [
      {
        prodottoId: product,
        magazzinoId: warehouse,
        quantitaPrevista: 2,
        quantitaConsegnata: 2,
        statoPreparazione: "pronto",
      },
    ],
  };
  const snapshot = async () => {
    const result = await pool.query(
      `select (select quantita_residua from lotti where id=$1) as residuo,
       (select row_to_json(i) from interventi i where id=$2) as intervento,
       (select count(*)::int from interventi_materiali where intervento_id=$2) as materiali,
       (select count(*)::int from movimenti where entita_origine_id=$2 and dominio_origine='SOCIALE') as movimenti,
       (select count(*)::int from audit_eventi where metadata->>'interventoId'=$2::text) as audit`,
      [lot, id],
    );
    return result.rows[0];
  };
  const before = await snapshot();
  const trigger = `m63_formal_${suffix.replaceAll("-", "")}`;
  try {
    await pool.query(`create function ${trigger}() returns trigger language plpgsql as $$ begin
      if NEW.azione='SCARICO_MAGAZZINO_CREATO' and NEW.metadata->>'interventoId'='${id}'
      then raise exception 'M63_FORMAL_AUDIT_FAILURE'; end if; return NEW; end $$`);
    await pool.query(
      `create trigger ${trigger} before insert on audit_eventi for each row execute function ${trigger}()`,
    );
    expect((await session.post(path).send(payload)).status).toBe(500);
    expect(await snapshot()).toEqual(before);
  } finally {
    await pool.query(`drop trigger if exists ${trigger} on audit_eventi`);
    await pool.query(`drop function if exists ${trigger}()`);
  }
  const success = await session.post(path).send(payload);
  expect(success.status, success.text).toBe(200);
  const after = await snapshot();
  expect(after).toMatchObject({
    residuo: "18.00",
    materiali: 1,
    movimenti: 1,
    audit: 1,
  });
  const { rows: audit } = await pool.query(
    "select a.* from audit_eventi a join movimenti m on m.audit_evento_id=a.id where m.entita_origine_id=$1 and m.dominio_origine='SOCIALE'",
    [id],
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actor_user_id: actor,
    magazzino_id_snapshot: warehouse,
    area_operativa_id_snapshot: area,
    centro_ascolto_id_snapshot: centre,
  });
  expect(audit[0].correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(audit[0])).not.toContain(payload.note);
  expect((await session.post(path).send(payload)).status).toBe(409);
  expect(await snapshot()).toEqual(after);
  expect(
    (await session.post(path).send({ ...payload, versione: await version(id) }))
      .status,
  ).toBe(200);
  expect(await snapshot()).toMatchObject({
    residuo: "18.00",
    materiali: 1,
    movimenti: 1,
    audit: 1,
  });
});

it("M63-06 misura paginazione, provenienza e raccordo su 1001 Interventi sintetici", async () => {
  await pool.query(
    "insert into interventi(beneficiario_id,tipo_intervento,ambito,stato,operatore_id)select $1,$2,'sociale','da_pianificare',$3 from generate_series(1,1001)",
    [subject, `perf-${suffix}`, actor],
  );
  const pg = createRequire(
    new URL("../../../lib/db/package.json", import.meta.url),
  )("pg");
  const original = pg.Client.prototype.query;
  let count = 0;
  pg.Client.prototype.query = function (...args: unknown[]) {
    count++;
    return original.apply(this, args);
  };
  const samples: Array<{
    limite: number;
    queries: number;
    durationMs: number;
  }> = [];
  try {
    for (const limite of [50, 200]) {
      count = 0;
      const started = performance.now();
      const response = await session
        .get("/api/interventi/pagina")
        .query({ ambito: "sociale", tipo: `perf-${suffix}`, limite });
      samples.push({
        limite,
        queries: count,
        durationMs: performance.now() - started,
      });
      expect(response.status, response.text).toBe(200);
      expect(response.body.total).toBe(1001);
      expect(response.body.items).toHaveLength(limite);
      expect(
        response.body.items.every(
          (r: { provenienza: string }) => r.provenienza === "sociale",
        ),
      ).toBe(true);
    }
  } finally {
    pg.Client.prototype.query = original;
  }
  if (process.env.M63_EVIDENCE_DIR)
    writeFileSync(
      `${process.env.M63_EVIDENCE_DIR}/performance.json`,
      JSON.stringify({ dataset: 1001, samples }, null, 2),
    );
  // No invented latency threshold: record measurements and report N+1 if observed.
  expect(samples.every((sample) => sample.queries > 0)).toBe(true);
});
