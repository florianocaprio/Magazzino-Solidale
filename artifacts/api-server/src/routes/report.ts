import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

function parseIntParam(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map((p) => parseInt(p, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

type DateRange = { ok: true; da: string; a: string } | { ok: false; message: string };
function parseDateRange(req: { query: Record<string, unknown> }): DateRange {
  const anno = parseIntParam(req.query.anno) ?? new Date().getFullYear();
  const daRaw = req.query.da ? String(req.query.da) : "";
  const aRaw = req.query.a ? String(req.query.a) : "";
  if (daRaw && !isValidIsoDate(daRaw)) return { ok: false, message: "Parametro 'da' non è una data valida (atteso YYYY-MM-DD)." };
  if (aRaw && !isValidIsoDate(aRaw)) return { ok: false, message: "Parametro 'a' non è una data valida (atteso YYYY-MM-DD)." };
  const da = daRaw || `${anno}-01-01`;
  const a = aRaw || `${anno}-12-31`;
  if (da > a) return { ok: false, message: "L'intervallo di date non è valido: 'da' è successivo ad 'a'." };
  return { ok: true, da, a };
}

router.get("/report/giacenze-per-magazzino", async (req, res) => {
  const magazzinoId = parseIntParam(req.query.magazzinoId);

  const result1 = await db.execute(sql`
    SELECT mg.nome as magazzino_nome,
           COUNT(DISTINCT l.prodotto_id) as tot_prodotti,
           COUNT(CASE WHEN l.quantita_residua::numeric <= p.scorta_minima::numeric THEN 1 END) as prodotti_sottoscorta,
           COUNT(CASE WHEN l.data_scadenza <= (NOW() + INTERVAL '30 days')::date THEN 1 END) as lotti_in_scadenza
    FROM magazzini mg
    LEFT JOIN lotti l ON l.magazzino_id = mg.id AND l.quantita_residua::numeric > 0
    LEFT JOIN prodotti p ON l.prodotto_id = p.id
    ${magazzinoId ? sql`WHERE mg.id = ${magazzinoId}` : sql``}
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
  const range = parseDateRange(req);
  if (!range.ok) {
    res.status(400).json({ message: range.message });
    return;
  }
  const { da, a } = range;
  const magazzinoId = parseIntParam(req.query.magazzinoId);
  const centroAscoltoId = parseIntParam(req.query.centroAscoltoId);

  const conds = [sql`c.data_prevista::date BETWEEN ${da} AND ${a}`];
  if (magazzinoId) conds.push(sql`c.magazzino_id = ${magazzinoId}`);
  if (centroAscoltoId) conds.push(sql`be.centro_ascolto_id = ${centroAscoltoId}`);
  const where = sql.join(conds, sql` AND `);

  const result2 = await db.execute(sql`
    SELECT TO_CHAR(c.data_prevista::date, 'YYYY-MM') as mese,
           COUNT(*) as tot_consegne,
           COUNT(*) FILTER (WHERE c.stato = 'effettuata') as consegne_effettuate,
           COUNT(*) FILTER (WHERE c.stato = 'mancata') as consegne_mancate
    FROM consegne c
    JOIN beneficiari be ON be.id = c.beneficiario_id
    WHERE ${where}
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

router.get("/report/consegne-per-centro", async (req, res) => {
  const range = parseDateRange(req);
  if (!range.ok) {
    res.status(400).json({ message: range.message });
    return;
  }
  const { da, a } = range;

  const result = await db.execute(sql`
    SELECT be.centro_ascolto_id as centro_id,
           COALESCE(ca.nome, 'Senza centro di ascolto') as centro_nome,
           COUNT(*) FILTER (WHERE c.volontario_id IS NULL) as dirette,
           COUNT(*) FILTER (WHERE c.volontario_id IS NOT NULL) as con_volontari,
           COUNT(*) as totale
    FROM consegne c
    JOIN beneficiari be ON be.id = c.beneficiario_id
    LEFT JOIN centri_di_ascolto ca ON ca.id = be.centro_ascolto_id
    WHERE c.stato = 'effettuata'
      AND c.data_prevista::date BETWEEN ${da} AND ${a}
    GROUP BY be.centro_ascolto_id, ca.nome
    ORDER BY totale DESC, centro_nome
  `);
  const rows = result.rows as Array<Record<string, unknown>>;

  res.json(rows.map((r: Record<string, unknown>) => ({
    centroId: r.centro_id === null || r.centro_id === undefined ? null : Number(r.centro_id),
    centroNome: r.centro_nome as string,
    dirette: Number(r.dirette),
    conVolontari: Number(r.con_volontari),
    totale: Number(r.totale),
  })));
});

router.get("/report/fse-plus", async (req, res) => {
  const parsedAnno = req.query.anno ? parseInt(req.query.anno as string, 10) : new Date().getFullYear();
  if (Number.isNaN(parsedAnno) || parsedAnno < 2000 || parsedAnno > 2100) {
    res.status(400).json({ message: "Parametro 'anno' non valido." });
    return;
  }
  const anno = parsedAnno;

  const prodRes = await db.execute(sql`
    SELECT p.id as prodotto_id,
           p.nome as prodotto_nome,
           p.unita_misura,
           SUM(br.quantita::numeric) as quantita_totale,
           SUM(CASE WHEN p.unita_misura = 'kg' THEN br.quantita::numeric ELSE 0 END) as peso_kg
    FROM bolle b
    JOIN bolla_righe br ON br.bolla_id = b.id
    JOIN lotti l ON br.lotto_id = l.id
    JOIN prodotti p ON br.prodotto_id = p.id
    WHERE l.fse_plus = true
      AND b.stato IN ('confermata', 'consegnata')
      AND EXTRACT(YEAR FROM b.data_bolla) = ${anno}
    GROUP BY p.id, p.nome, p.unita_misura
    ORDER BY p.nome
  `);
  const prodRows = prodRes.rows as Array<Record<string, unknown>>;

  const famRes = await db.execute(sql`
    SELECT COUNT(DISTINCT b.beneficiario_id) as tot
    FROM bolle b
    JOIN bolla_righe br ON br.bolla_id = b.id
    JOIN lotti l ON br.lotto_id = l.id
    WHERE l.fse_plus = true
      AND b.stato IN ('confermata', 'consegnata')
      AND EXTRACT(YEAR FROM b.data_bolla) = ${anno}
  `);
  const beneficiariTotali = Number((famRes.rows[0] as Record<string, unknown>)?.tot ?? 0);

  const persRes = await db.execute(sql`
    WITH famiglie AS (
      SELECT DISTINCT b.beneficiario_id
      FROM bolle b
      JOIN bolla_righe br ON br.bolla_id = b.id
      JOIN lotti l ON br.lotto_id = l.id
      WHERE l.fse_plus = true
        AND b.stato IN ('confermata', 'consegnata')
        AND EXTRACT(YEAR FROM b.data_bolla) = ${anno}
    ),
    persone AS (
      SELECT be.sesso, be.data_nascita, be.area_provenienza
      FROM beneficiari be
      JOIN famiglie f ON f.beneficiario_id = be.id
      UNION ALL
      SELECT n.sesso, n.data_nascita, be.area_provenienza
      FROM nucleo_familiare n
      JOIN famiglie f ON f.beneficiario_id = n.beneficiario_id
      JOIN beneficiari be ON be.id = n.beneficiario_id
    ),
    classificate AS (
      SELECT sesso,
             area_provenienza,
             (data_nascita IS NOT NULL AND data_nascita <= (CURRENT_DATE - INTERVAL '18 years')) as adulto,
             (data_nascita IS NOT NULL AND data_nascita > (CURRENT_DATE - INTERVAL '18 years')) as minore
      FROM persone
    )
    SELECT
      COUNT(*) as totale,
      COUNT(*) FILTER (WHERE sesso = 'M') as maschi,
      COUNT(*) FILTER (WHERE sesso = 'F') as femmine,
      COUNT(*) FILTER (WHERE area_provenienza = 'UE') as ue,
      COUNT(*) FILTER (WHERE area_provenienza = 'Extra-UE') as extra_ue,
      COUNT(*) FILTER (WHERE sesso = 'M' AND adulto) as maschi_adulti,
      COUNT(*) FILTER (WHERE sesso = 'M' AND minore) as maschi_minori,
      COUNT(*) FILTER (WHERE sesso = 'F' AND adulto) as femmine_adulte,
      COUNT(*) FILTER (WHERE sesso = 'F' AND minore) as femmine_minori,
      COUNT(*) FILTER (WHERE area_provenienza = 'UE' AND sesso = 'M') as ue_maschi,
      COUNT(*) FILTER (WHERE area_provenienza = 'UE' AND sesso = 'F') as ue_femmine,
      COUNT(*) FILTER (WHERE area_provenienza = 'Extra-UE' AND sesso = 'M') as extra_ue_maschi,
      COUNT(*) FILTER (WHERE area_provenienza = 'Extra-UE' AND sesso = 'F') as extra_ue_femmine
    FROM classificate
  `);
  const p = (persRes.rows[0] ?? {}) as Record<string, unknown>;

  const prodotti = prodRows.map((r) => ({
    prodottoId: Number(r.prodotto_id),
    prodottoNome: r.prodotto_nome as string,
    unitaMisura: r.unita_misura as string,
    quantitaTotale: parseFloat(String(r.quantita_totale ?? 0)),
    pesoKg: parseFloat(String(r.peso_kg ?? 0)),
  }));

  const pesoTotaleKg = prodotti.reduce((acc, x) => acc + x.pesoKg, 0);

  res.json({
    anno,
    pesoTotaleKg,
    beneficiariTotali,
    personeTotali: Number(p.totale ?? 0),
    prodotti,
    persone: {
      maschi: Number(p.maschi ?? 0),
      femmine: Number(p.femmine ?? 0),
      ue: Number(p.ue ?? 0),
      extraUe: Number(p.extra_ue ?? 0),
      maschiAdulti: Number(p.maschi_adulti ?? 0),
      maschiMinori: Number(p.maschi_minori ?? 0),
      femmineAdulte: Number(p.femmine_adulte ?? 0),
      femmineMinori: Number(p.femmine_minori ?? 0),
      ueMaschi: Number(p.ue_maschi ?? 0),
      ueFemmine: Number(p.ue_femmine ?? 0),
      extraUeMaschi: Number(p.extra_ue_maschi ?? 0),
      extraUeFemmine: Number(p.extra_ue_femmine ?? 0),
    },
  });
});

export default router;
