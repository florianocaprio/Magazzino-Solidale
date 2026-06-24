import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/report/giacenze-per-magazzino", async (_req, res) => {
  const result1 = await db.execute(sql`
    SELECT mg.nome as magazzino_nome,
           COUNT(DISTINCT l.prodotto_id) as tot_prodotti,
           COUNT(CASE WHEN l.quantita_residua::numeric <= p.scorta_minima::numeric THEN 1 END) as prodotti_sottoscorta,
           COUNT(CASE WHEN l.data_scadenza <= (NOW() + INTERVAL '30 days')::date THEN 1 END) as lotti_in_scadenza
    FROM magazzini mg
    LEFT JOIN lotti l ON l.magazzino_id = mg.id AND l.quantita_residua::numeric > 0
    LEFT JOIN prodotti p ON l.prodotto_id = p.id
    GROUP BY mg.id, mg.nome
    ORDER BY mg.nome
  `);
  const rows = result1.rows as Array<Record<string, unknown>>;

  res.json(rows.map((r: Record<string, unknown>) => ({
    magazzinoNome: r.magazzino_nome,
    totProdotti: Number(r.tot_prodotti),
    prodottiSottoscorta: Number(r.prodotti_sottoscorta),
    lottiInScadenza: Number(r.lotti_in_scadenza),
  })));
});

router.get("/report/consegne-per-mese", async (req, res) => {
  const anno = req.query.anno ? parseInt(req.query.anno as string) : new Date().getFullYear();

  const result2 = await db.execute(sql`
    SELECT TO_CHAR(data_prevista::date, 'YYYY-MM') as mese,
           COUNT(*) as tot_consegne,
           COUNT(CASE WHEN stato = 'effettuata' THEN 1 END) as consegne_effettuate,
           COUNT(CASE WHEN stato = 'mancata' THEN 1 END) as consegne_mancate
    FROM consegne
    WHERE EXTRACT(YEAR FROM data_prevista::date) = ${anno}
    GROUP BY mese
    ORDER BY mese
  `);
  const rows2 = result2.rows as Array<Record<string, unknown>>;

  res.json(rows2.map((r: Record<string, unknown>) => ({
    mese: r.mese,
    totConsegne: Number(r.tot_consegne),
    consegneEffettuate: Number(r.consegne_effettuate),
    consegneMancate: Number(r.consegne_mancate),
  })));
});

router.get("/report/beneficiari-per-zona", async (_req, res) => {
  const result3 = await db.execute(sql`
    SELECT COALESCE(zona_municipio, 'Non specificato') as zona,
           COUNT(*) as tot_beneficiari,
           COUNT(CASE WHEN attivo = true THEN 1 END) as attivi,
           COUNT(CASE WHEN consegna_domicilio = true THEN 1 END) as consegne_domicilio
    FROM beneficiari
    GROUP BY zona_municipio
    ORDER BY tot_beneficiari DESC
  `);
  const rows3 = result3.rows as Array<Record<string, unknown>>;

  res.json(rows3.map((r: Record<string, unknown>) => ({
    zona: r.zona,
    totBeneficiari: Number(r.tot_beneficiari),
    attivi: Number(r.attivi),
    consegneDomicilio: Number(r.consegne_domicilio),
  })));
});

export default router;
