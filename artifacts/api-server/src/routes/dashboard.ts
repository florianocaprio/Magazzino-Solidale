import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  magazziniTable, prodottiTable, beneficiariTable, volontariTable,
  consegneTable, lottiTable, trasferimentiTable, interventiTable,
} from "@workspace/db";
import { eq, and, count, lte, gt, gte, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res) => {
  const oggi = new Date().toISOString().split("T")[0];
  const inizioMese = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30str = in30.toISOString().split("T")[0];

  const [magCount] = await db.select({ n: count() }).from(magazziniTable).where(eq(magazziniTable.stato, "attivo"));
  const [prodCount] = await db.select({ n: count() }).from(prodottiTable).where(eq(prodottiTable.attivo, true));
  const [benCount] = await db.select({ n: count() }).from(beneficiariTable).where(eq(beneficiariTable.attivo, true));
  const [volCount] = await db.select({ n: count() }).from(volontariTable).where(eq(volontariTable.attivo, true));
  const [consOggi] = await db.select({ n: count() }).from(consegneTable).where(eq(consegneTable.dataPrevista, oggi));
  const [consMese] = await db.select({ n: count() }).from(consegneTable).where(gte(consegneTable.dataPrevista, inizioMese));
  const [lottiScad] = await db.select({ n: count() }).from(lottiTable).where(and(gt(lottiTable.quantitaResidua, "0"), lte(lottiTable.dataScadenza, in30str)));
  const [trasCorso] = await db.select({ n: count() }).from(trasferimentiTable).where(eq(trasferimentiTable.stato, "in_transito"));
  const [intMese] = await db.select({ n: count() }).from(interventiTable).where(gte(interventiTable.dataIntervento, inizioMese));

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

router.get("/dashboard/alerts", async (_req, res) => {
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);
  const in7str = in7.toISOString().split("T")[0];
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30str = in30.toISOString().split("T")[0];

  const alerts: Array<{ id: number; tipo: string; livello: string; messaggio: string; dettaglio: string | null; data: string }> = [];
  let alertId = 1;
  const oggi = new Date().toISOString();

  const [scadImm] = await db.select({ n: count() }).from(lottiTable).where(and(gt(lottiTable.quantitaResidua, "0"), lte(lottiTable.dataScadenza, in7str)));
  if (Number(scadImm.n) > 0) {
    alerts.push({ id: alertId++, tipo: "lotti_scadenza", livello: "danger", messaggio: `${scadImm.n} lotti in scadenza entro 7 giorni`, dettaglio: null, data: oggi });
  }

  const [scad30] = await db.select({ n: count() }).from(lottiTable).where(and(gt(lottiTable.quantitaResidua, "0"), lte(lottiTable.dataScadenza, in30str)));
  if (Number(scad30.n) > Number(scadImm.n)) {
    alerts.push({ id: alertId++, tipo: "lotti_scadenza_30", livello: "warning", messaggio: `${Number(scad30.n) - Number(scadImm.n)} lotti in scadenza entro 30 giorni`, dettaglio: null, data: oggi });
  }

  const [trasCorso] = await db.select({ n: count() }).from(trasferimentiTable).where(eq(trasferimentiTable.stato, "in_transito"));
  if (Number(trasCorso.n) > 0) {
    alerts.push({ id: alertId++, tipo: "trasferimenti", livello: "info", messaggio: `${trasCorso.n} trasferimenti in transito`, dettaglio: null, data: oggi });
  }

  res.json(alerts);
});

router.get("/dashboard/movimenti-recenti", async (_req, res) => {
  const result = await db.execute(sql`
    SELECT m.id, m.tipo_movimento, m.tipo_dettaglio, m.data_movimento, m.quantita, m.unita_misura,
           p.nome as prodotto_nome, mg.nome as magazzino_nome
    FROM movimenti m
    LEFT JOIN prodotti p ON m.prodotto_id = p.id
    LEFT JOIN magazzini mg ON m.magazzino_id = mg.id
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
