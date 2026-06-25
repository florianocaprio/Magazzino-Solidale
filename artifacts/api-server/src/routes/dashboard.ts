import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  magazziniTable, prodottiTable, beneficiariTable, volontariTable,
  consegneTable, lottiTable, trasferimentiTable, interventiTable,
} from "@workspace/db";
import { eq, and, count, lte, gt, gte, sql, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  centroScopeFilter,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
  trasferimentoScopeFilter,
  andScoped,
} from "../lib/centroScope";

const router: IRouter = Router();

/** SQL scoping a beneficiario-keyed count to the caller's centro (own OR null). */
function benScopeSql(beneficiarioCol: SQL, caller: number | null): SQL | undefined {
  if (caller == null) return undefined;
  return sql`${beneficiarioCol} IN (SELECT id FROM beneficiari WHERE centro_ascolto_id = ${caller} OR centro_ascolto_id IS NULL)`;
}

router.get("/dashboard/stats", async (req, res) => {
  const oggi = new Date().toISOString().split("T")[0];
  const inizioMese = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30str = in30.toISOString().split("T")[0];

  const caller = callerCentroId(req);
  const magIds = await visibleMagazzinoIds(caller);

  const [magCount] = await db.select({ n: count() }).from(magazziniTable).where(andScoped(eq(magazziniTable.stato, "attivo"), centroScopeFilter(magazziniTable.centroAscoltoId, caller)));
  const [prodCount] = await db.select({ n: count() }).from(prodottiTable).where(eq(prodottiTable.attivo, true));
  const [benCount] = await db.select({ n: count() }).from(beneficiariTable).where(andScoped(eq(beneficiariTable.attivo, true), centroScopeFilter(beneficiariTable.centroAscoltoId, caller)));
  const [volCount] = await db.select({ n: count() }).from(volontariTable).where(andScoped(eq(volontariTable.attivo, true), centroScopeFilter(volontariTable.centroAscoltoId, caller)));
  const [consOggi] = await db.select({ n: count() }).from(consegneTable).where(andScoped(eq(consegneTable.dataPrevista, oggi), benScopeSql(sql`${consegneTable.beneficiarioId}`, caller)));
  const [consMese] = await db.select({ n: count() }).from(consegneTable).where(andScoped(gte(consegneTable.dataPrevista, inizioMese), benScopeSql(sql`${consegneTable.beneficiarioId}`, caller)));
  const [lottiScad] = await db.select({ n: count() }).from(lottiTable).where(andScoped(gt(lottiTable.quantitaResidua, "0"), lte(lottiTable.dataScadenza, in30str), magazzinoScopeFilter(lottiTable.magazzinoId, magIds)));
  const [trasCorso] = await db.select({ n: count() }).from(trasferimentiTable).where(andScoped(eq(trasferimentiTable.stato, "in_transito"), trasferimentoScopeFilter(trasferimentiTable.magazzinoOrigineId, trasferimentiTable.magazzinoDestinoId, magIds)));
  const [intMese] = await db.select({ n: count() }).from(interventiTable).where(andScoped(gte(interventiTable.dataIntervento, inizioMese), benScopeSql(sql`${interventiTable.beneficiarioId}`, caller)));

  res.json({
    totMagazzini: Number(magCount.n),
    totProdotti: Number(prodCount.n),
    totBeneficiari: Number(benCount.n),
    totVolontari: Number(volCount.n),
    consegneOggi: Number(consOggi.n),
    consegneMese: Number(consMese.n),
    lottiInScadenza: Number(lottiScad.n),
    prodottiSottoscorta: 0,
    trasferimentiInCorso: Number(trasCorso.n),
    interventiMese: Number(intMese.n),
  });
});

router.get("/dashboard/alerts", async (req, res) => {
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);
  const in7str = in7.toISOString().split("T")[0];
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30str = in30.toISOString().split("T")[0];

  const caller = callerCentroId(req);
  const magIds = await visibleMagazzinoIds(caller);

  const alerts: Array<{ id: number; tipo: string; livello: string; messaggio: string; dettaglio: string | null; data: string }> = [];
  let alertId = 1;
  const oggi = new Date().toISOString();

  const [scadImm] = await db.select({ n: count() }).from(lottiTable).where(andScoped(gt(lottiTable.quantitaResidua, "0"), lte(lottiTable.dataScadenza, in7str), magazzinoScopeFilter(lottiTable.magazzinoId, magIds)));
  if (Number(scadImm.n) > 0) {
    alerts.push({ id: alertId++, tipo: "lotti_scadenza", livello: "danger", messaggio: `${scadImm.n} lotti in scadenza entro 7 giorni`, dettaglio: null, data: oggi });
  }

  const [scad30] = await db.select({ n: count() }).from(lottiTable).where(andScoped(gt(lottiTable.quantitaResidua, "0"), lte(lottiTable.dataScadenza, in30str), magazzinoScopeFilter(lottiTable.magazzinoId, magIds)));
  if (Number(scad30.n) > Number(scadImm.n)) {
    alerts.push({ id: alertId++, tipo: "lotti_scadenza_30", livello: "warning", messaggio: `${Number(scad30.n) - Number(scadImm.n)} lotti in scadenza entro 30 giorni`, dettaglio: null, data: oggi });
  }

  const [trasCorso] = await db.select({ n: count() }).from(trasferimentiTable).where(andScoped(eq(trasferimentiTable.stato, "in_transito"), trasferimentoScopeFilter(trasferimentiTable.magazzinoOrigineId, trasferimentiTable.magazzinoDestinoId, magIds)));
  if (Number(trasCorso.n) > 0) {
    alerts.push({ id: alertId++, tipo: "trasferimenti", livello: "info", messaggio: `${trasCorso.n} trasferimenti in transito`, dettaglio: null, data: oggi });
  }

  res.json(alerts);
});

router.get("/dashboard/movimenti-recenti", async (req, res) => {
  const magIds = await visibleMagazzinoIds(callerCentroId(req));
  const magScope = magIds == null
    ? sql``
    : magIds.length === 0
      ? sql`WHERE false`
      : sql`WHERE m.magazzino_id IN (${sql.join(magIds.map((id) => sql`${id}`), sql`, `)})`;

  const result = await db.execute(sql`
    SELECT m.id, m.tipo_movimento, m.tipo_dettaglio, m.data_movimento, m.quantita, m.unita_misura,
           p.nome as prodotto_nome, mg.nome as magazzino_nome
    FROM movimenti m
    LEFT JOIN prodotti p ON m.prodotto_id = p.id
    LEFT JOIN magazzini mg ON m.magazzino_id = mg.id
    ${magScope}
    ORDER BY m.data_creazione DESC
    LIMIT 10
  `);
  const rows = result.rows as Array<Record<string, unknown>>;

  res.json(rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    tipo: r.tipo_movimento,
    tipoDettaglio: r.tipo_dettaglio,
    prodottoNome: r.prodotto_nome ?? "—",
    magazzinoNome: r.magazzino_nome ?? "—",
    quantita: parseFloat(r.quantita as string),
    unitaMisura: r.unita_misura,
    dataMovimento: r.data_movimento,
  })));
});

export default router;
