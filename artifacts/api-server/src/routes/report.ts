import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { callerCentroId, callerAreaOperativaId } from "../lib/centroScope";
import { requireAllModuli } from "../lib/featureFlags";
import { isUdsReportRequest, requirePermission } from "../middlewares/auth";
import { effectiveMezzoCentroSql } from "../lib/logisticaPolicy";

const router: IRouter = Router();

const requireReportCentro = requireAllModuli(["CENTRO_ASCOLTO", "REPORT"]);
const requireReportUds = requireAllModuli(["UDS", "REPORT"]);

router.use("/report", (req, res, next) => {
  const guard = isUdsReportRequest(req)
    ? requireReportUds
    : requireReportCentro;
  guard(req, res, next);
});
router.use("/report/uds", requirePermission("uds.reports.view"));

/**
 * Generic "own value OR shared/null" SQL fragment for a scoping column. Used for
 * both the centro axis and the area operativa axis (pass the relevant column + caller id).
 * Returns `undefined` for a global caller (no restriction on that axis).
 */
function ownOrNullSql(col: SQL, caller: number | null): SQL | undefined {
  if (caller == null) return undefined;
  return sql`(${col} = ${caller} OR ${col} IS NULL)`;
}

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
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

type DateRange =
  | { ok: true; da: string; a: string }
  | { ok: false; message: string };
function parseDateRange(req: { query: Record<string, unknown> }): DateRange {
  const anno = parseIntParam(req.query.anno) ?? new Date().getFullYear();
  const daRaw = req.query.da ? String(req.query.da) : "";
  const aRaw = req.query.a ? String(req.query.a) : "";
  if (daRaw && !isValidIsoDate(daRaw))
    return {
      ok: false,
      message: "Parametro 'da' non è una data valida (atteso YYYY-MM-DD).",
    };
  if (aRaw && !isValidIsoDate(aRaw))
    return {
      ok: false,
      message: "Parametro 'a' non è una data valida (atteso YYYY-MM-DD).",
    };
  const da = daRaw || `${anno}-01-01`;
  const a = aRaw || `${anno}-12-31`;
  if (da > a)
    return {
      ok: false,
      message: "L'intervallo di date non è valido: 'da' è successivo ad 'a'.",
    };
  return { ok: true, da, a };
}

router.get("/report/giacenze-per-magazzino", async (req, res) => {
  const magazzinoId = parseIntParam(req.query.magazzinoId);
  const caller = callerCentroId(req);
  const areaOperativa = callerAreaOperativaId(req);

  const conds: SQL[] = [];
  if (magazzinoId) conds.push(sql`mg.id = ${magazzinoId}`);
  const centroCond = ownOrNullSql(sql`mg.centro_ascolto_id`, caller);
  if (centroCond) conds.push(centroCond);
  const areaOperativaCond = ownOrNullSql(
    sql`mg.area_operativa_id`,
    areaOperativa,
  );
  if (areaOperativaCond) conds.push(areaOperativaCond);
  const qAreaOperativa = parseIntParam(req.query.areaOperativaId);
  if (qAreaOperativa) conds.push(sql`mg.area_operativa_id = ${qAreaOperativa}`);
  const where = conds.length
    ? sql`WHERE ${sql.join(conds, sql` AND `)}`
    : sql``;

  const result1 = await db.execute(sql`
    SELECT mg.nome as magazzino_nome,
           COUNT(DISTINCT l.prodotto_id) as tot_prodotti,
           COUNT(CASE WHEN l.quantita_residua::numeric <= p.scorta_minima::numeric THEN 1 END) as prodotti_sottoscorta,
           COUNT(CASE WHEN l.data_scadenza <= (NOW() + INTERVAL '30 days')::date THEN 1 END) as lotti_in_scadenza
    FROM magazzini mg
    LEFT JOIN lotti l ON l.magazzino_id = mg.id AND l.quantita_residua::numeric > 0
    LEFT JOIN prodotti p ON l.prodotto_id = p.id
    ${where}
    GROUP BY mg.id, mg.nome
    ORDER BY mg.nome
  `);
  const rows = result1.rows as Array<Record<string, unknown>>;

  res.json(
    rows.map((r: Record<string, unknown>) => ({
      magazzinoNome: r.magazzino_nome,
      totProdotti: Number(r.tot_prodotti),
      prodottiSottoscorta: Number(r.prodotti_sottoscorta),
      lottiInScadenza: Number(r.lotti_in_scadenza),
    })),
  );
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
  const caller = callerCentroId(req);
  const areaOperativa = callerAreaOperativaId(req);

  const conds = [sql`c.data_prevista::date BETWEEN ${da} AND ${a}`];
  if (magazzinoId) conds.push(sql`c.magazzino_id = ${magazzinoId}`);
  if (centroAscoltoId)
    conds.push(sql`be.centro_ascolto_id = ${centroAscoltoId}`);
  const centroCond = ownOrNullSql(sql`be.centro_ascolto_id`, caller);
  if (centroCond) conds.push(centroCond);
  const areaOperativaCond = ownOrNullSql(
    sql`be.area_operativa_id`,
    areaOperativa,
  );
  if (areaOperativaCond) conds.push(areaOperativaCond);
  const qAreaOperativa = parseIntParam(req.query.areaOperativaId);
  if (qAreaOperativa) conds.push(sql`be.area_operativa_id = ${qAreaOperativa}`);
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

  res.json(
    rows2.map((r: Record<string, unknown>) => ({
      mese: r.mese,
      totConsegne: Number(r.tot_consegne),
      consegneEffettuate: Number(r.consegne_effettuate),
      consegneMancate: Number(r.consegne_mancate),
    })),
  );
});

router.get("/report/consegne-per-centro", async (req, res) => {
  const range = parseDateRange(req);
  if (!range.ok) {
    res.status(400).json({ message: range.message });
    return;
  }
  const { da, a } = range;
  const caller = callerCentroId(req);
  const areaOperativa = callerAreaOperativaId(req);
  const scopeConds: SQL[] = [];
  const centroCond = ownOrNullSql(sql`be.centro_ascolto_id`, caller);
  if (centroCond) scopeConds.push(centroCond);
  const areaOperativaCond = ownOrNullSql(
    sql`be.area_operativa_id`,
    areaOperativa,
  );
  if (areaOperativaCond) scopeConds.push(areaOperativaCond);
  const qAreaOperativa = parseIntParam(req.query.areaOperativaId);
  if (qAreaOperativa)
    scopeConds.push(sql`be.area_operativa_id = ${qAreaOperativa}`);
  const extraCentro = scopeConds.length
    ? sql` AND ${sql.join(scopeConds, sql` AND `)}`
    : sql``;

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
      AND c.data_prevista::date BETWEEN ${da} AND ${a}${extraCentro}
    GROUP BY be.centro_ascolto_id, ca.nome
    ORDER BY totale DESC, centro_nome
  `);
  const rows = result.rows as Array<Record<string, unknown>>;

  res.json(
    rows.map((r: Record<string, unknown>) => ({
      centroId:
        r.centro_id === null || r.centro_id === undefined
          ? null
          : Number(r.centro_id),
      centroNome: r.centro_nome as string,
      dirette: Number(r.dirette),
      conVolontari: Number(r.con_volontari),
      totale: Number(r.totale),
    })),
  );
});

router.get("/report/allocazione-mezzi", async (req, res) => {
  const range = parseDateRange(req);
  if (!range.ok) {
    res.status(400).json({ message: range.message });
    return;
  }
  const { da, a } = range;
  const centroAscoltoId = parseIntParam(req.query.centroAscoltoId);
  const caller = callerCentroId(req);
  const areaOperativa = callerAreaOperativaId(req);
  const qAreaOperativa = parseIntParam(req.query.areaOperativaId);

  // ── Per-mezzo usage ──────────────────────────────────────────────────────
  // Scope mezzi by their own centro (own OR universal/NULL) and, for the area operativa
  // axis, by their centro's area operativa (derived via centri_di_ascolto; NULL = a
  // universal mezzo or a centro without area operativa, kept visible like magazzini).
  const mezzoConds: SQL[] = [];
  const effectiveMezzoCentro = effectiveMezzoCentroSql(
    sql`m.volontario_id`,
    sql`mv.centro_ascolto_id`,
    sql`m.centro_ascolto_id`,
  );
  if (centroAscoltoId)
    mezzoConds.push(sql`${effectiveMezzoCentro} = ${centroAscoltoId}`);
  const mCentroCond = ownOrNullSql(effectiveMezzoCentro, caller);
  if (mCentroCond) mezzoConds.push(mCentroCond);
  const mAreaOperativaCond = ownOrNullSql(
    sql`ca.area_operativa_id`,
    areaOperativa,
  );
  if (mAreaOperativaCond) mezzoConds.push(mAreaOperativaCond);
  if (qAreaOperativa)
    mezzoConds.push(sql`ca.area_operativa_id = ${qAreaOperativa}`);
  const mezzoWhere = mezzoConds.length
    ? sql`WHERE ${sql.join(mezzoConds, sql` AND `)}`
    : sql``;

  // Records counted per mezzo must respect the caller's perimeter too: otherwise
  // a visible mezzo (especially a universal one, centro_ascolto_id NULL) would
  // leak aggregate usage from centri/area operativa the caller can't see. consegne/bolle
  // scope via beneficiario (same as the other reports); turni scope via their
  // own centro_ascolto_id and that centro's area operativa.
  const beScopeConds: SQL[] = [];
  if (centroAscoltoId)
    beScopeConds.push(sql`be.centro_ascolto_id = ${centroAscoltoId}`);
  const beCentroCond = ownOrNullSql(sql`be.centro_ascolto_id`, caller);
  if (beCentroCond) beScopeConds.push(beCentroCond);
  const beAreaOperativaCond = ownOrNullSql(
    sql`be.area_operativa_id`,
    areaOperativa,
  );
  if (beAreaOperativaCond) beScopeConds.push(beAreaOperativaCond);
  if (qAreaOperativa)
    beScopeConds.push(sql`be.area_operativa_id = ${qAreaOperativa}`);
  const beScope = beScopeConds.length
    ? sql` AND ${sql.join(beScopeConds, sql` AND `)}`
    : sql``;

  const turniScopeConds: SQL[] = [];
  if (centroAscoltoId)
    turniScopeConds.push(sql`tu.centro_ascolto_id = ${centroAscoltoId}`);
  const tuCentroCond = ownOrNullSql(sql`tu.centro_ascolto_id`, caller);
  if (tuCentroCond) turniScopeConds.push(tuCentroCond);
  const tuAreaOperativaCond = ownOrNullSql(
    sql`tca.area_operativa_id`,
    areaOperativa,
  );
  if (tuAreaOperativaCond) turniScopeConds.push(tuAreaOperativaCond);
  if (qAreaOperativa)
    turniScopeConds.push(sql`tca.area_operativa_id = ${qAreaOperativa}`);
  const turniScope = turniScopeConds.length
    ? sql` AND ${sql.join(turniScopeConds, sql` AND `)}`
    : sql``;

  const mezziResult = await db.execute(sql`
    SELECT m.id as mezzo_id,
           m.codice as mezzo_codice,
           m.tipo as mezzo_tipo,
           ${effectiveMezzoCentro} as centro_id,
           ca.nome as centro_nome,
           (SELECT COUNT(*) FROM consegne c
              JOIN beneficiari be ON be.id = c.beneficiario_id
              WHERE c.mezzo_id = m.id
                AND c.data_prevista::date BETWEEN ${da} AND ${a}${beScope}) as consegne,
           (SELECT COUNT(*) FROM bolle b
              JOIN beneficiari be ON be.id = b.beneficiario_id
              WHERE b.mezzo_id = m.id
                AND b.data_bolla::date BETWEEN ${da} AND ${a}${beScope}) as bolle,
           (SELECT COUNT(*) FROM turni tu
              LEFT JOIN centri_di_ascolto tca ON tca.id = tu.centro_ascolto_id
              WHERE tu.mezzo_id = m.id
                AND tu.stato <> 'annullato'
                AND tu.data BETWEEN ${da} AND ${a}${turniScope}) as turni
    FROM mezzi m
    LEFT JOIN volontari mv ON mv.id = m.volontario_id
    LEFT JOIN centri_di_ascolto ca ON ca.id = ${effectiveMezzoCentro}
    ${mezzoWhere}
    ORDER BY m.codice
  `);
  const mezziRows = mezziResult.rows as Array<Record<string, unknown>>;

  // ── External transport ("altro") ─────────────────────────────────────────
  // Free-text/external transport (mezzo_altro flag) on consegne + bolle, scoped
  // via beneficiario (centro + area operativa) — reuses the per-record beScope above.
  const altroConsResult = await db.execute(sql`
    SELECT COUNT(*) as n
    FROM consegne c
    JOIN beneficiari be ON be.id = c.beneficiario_id
    WHERE c.mezzo_altro = true
      AND c.data_prevista::date BETWEEN ${da} AND ${a}${beScope}
  `);
  const altroBolleResult = await db.execute(sql`
    SELECT COUNT(*) as n
    FROM bolle b
    JOIN beneficiari be ON be.id = b.beneficiario_id
    WHERE b.mezzo_altro = true
      AND b.data_bolla::date BETWEEN ${da} AND ${a}${beScope}
  `);
  const altroConsegne = Number(
    (altroConsResult.rows as Array<Record<string, unknown>>)[0]?.n ?? 0,
  );
  const altroBolle = Number(
    (altroBolleResult.rows as Array<Record<string, unknown>>)[0]?.n ?? 0,
  );

  res.json({
    mezzi: mezziRows.map((r: Record<string, unknown>) => {
      const consegne = Number(r.consegne);
      const bolle = Number(r.bolle);
      const turni = Number(r.turni);
      return {
        mezzoId: Number(r.mezzo_id),
        mezzoCodice: r.mezzo_codice as string,
        mezzoTipo: (r.mezzo_tipo as string) ?? "",
        centroId:
          r.centro_id === null || r.centro_id === undefined
            ? null
            : Number(r.centro_id),
        centroNome: (r.centro_nome as string) ?? null,
        consegne,
        bolle,
        turni,
        totale: consegne + bolle + turni,
      };
    }),
    altro: { consegne: altroConsegne, bolle: altroBolle },
  });
});

router.get(
  "/report/fse-plus",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    res.setHeader("Deprecation", "true");
    res.setHeader(
      "Link",
      '</api/report/fse-plus/integrato>; rel="successor-version"',
    );
    const parsedAnno = req.query.anno
      ? parseInt(req.query.anno as string, 10)
      : new Date().getFullYear();
    if (Number.isNaN(parsedAnno) || parsedAnno < 2000 || parsedAnno > 2100) {
      res.status(400).json({ message: "Parametro 'anno' non valido." });
      return;
    }
    const anno = parsedAnno;
    const caller = callerCentroId(req);
    const areaOperativa = callerAreaOperativaId(req);
    const centroSub =
      caller == null
        ? sql``
        : sql` AND b.beneficiario_id IN (SELECT id FROM beneficiari WHERE centro_ascolto_id = ${caller} OR centro_ascolto_id IS NULL)`;
    const areaOperativaSub =
      areaOperativa == null
        ? sql``
        : sql` AND b.beneficiario_id IN (SELECT id FROM beneficiari WHERE area_operativa_id = ${areaOperativa} OR area_operativa_id IS NULL)`;
    const qAreaOperativa = parseIntParam(req.query.areaOperativaId);
    const areaOperativaQSub =
      qAreaOperativa == null
        ? sql``
        : sql` AND b.beneficiario_id IN (SELECT id FROM beneficiari WHERE area_operativa_id = ${qAreaOperativa})`;
    const centroCond = sql`${centroSub}${areaOperativaSub}${areaOperativaQSub}`;

    const prodRes = await db.execute(sql`
    SELECT p.id as prodotto_id,
           p.nome as prodotto_nome,
           p.unita_misura,
           SUM(abs(mv.quantita::numeric)) as quantita_totale,
           SUM(CASE WHEN p.unita_misura = 'kg' THEN abs(mv.quantita::numeric) ELSE 0 END) as peso_kg
    FROM bolle b
    JOIN bolla_righe br ON br.bolla_id = b.id
    JOIN movimenti mv ON mv.bolla_riga_id = br.id
    JOIN prodotti p ON br.prodotto_id = p.id
    WHERE mv.fondo_origine = 'FSE_PLUS'
      AND b.stato = 'consegnato'
      AND EXTRACT(YEAR FROM b.data_bolla) = ${anno}${centroCond}
    GROUP BY p.id, p.nome, p.unita_misura
    ORDER BY p.nome
  `);
    const prodRows = prodRes.rows as Array<Record<string, unknown>>;

    const famRes = await db.execute(sql`
    SELECT COUNT(DISTINCT b.beneficiario_id) as tot
    FROM bolle b
    JOIN bolla_righe br ON br.bolla_id = b.id
    JOIN movimenti mv ON mv.bolla_riga_id = br.id
    WHERE mv.fondo_origine = 'FSE_PLUS'
      AND b.stato = 'consegnato'
      AND EXTRACT(YEAR FROM b.data_bolla) = ${anno}${centroCond}
  `);
    const beneficiariTotali = Number(
      (famRes.rows[0] as Record<string, unknown>)?.tot ?? 0,
    );

    const persRes = await db.execute(sql`
    WITH famiglie AS (
      SELECT DISTINCT b.beneficiario_id
      FROM bolle b
      JOIN bolla_righe br ON br.bolla_id = b.id
      JOIN movimenti mv ON mv.bolla_riga_id = br.id
      WHERE mv.fondo_origine = 'FSE_PLUS'
        AND b.stato = 'consegnato'
        AND EXTRACT(YEAR FROM b.data_bolla) = ${anno}${centroCond}
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
             (data_nascita IS NOT NULL AND data_nascita <= (make_date(${anno}, 12, 31) - INTERVAL '18 years')) as adulto,
             (data_nascita IS NOT NULL AND data_nascita > (make_date(${anno}, 12, 31) - INTERVAL '18 years')) as minore
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
  },
);

/* ────────────────────────────────────────────────────────────────────────
 * UDS (Unità di Strada) reports. Street-outreach interventions / people.
 * Historical activity is classified exclusively by explicit UDS scope and the
 * immutable Area/Zona snapshots stored on each intervention. Current people
 * continue to use the Beneficiario's current territorial assignment.
 * ──────────────────────────────────────────────────────────────────────── */

function udsHistoricalScopeConds(
  req: { query: Record<string, unknown> },
  callerAreaOperativa: number | null,
): SQL[] {
  const conds: SQL[] = [sql`i.ambito = 'uds'`];
  if (callerAreaOperativa != null)
    conds.push(sql`i.area_operativa_id_snapshot = ${callerAreaOperativa}`);
  const qAreaOperativa = parseIntParam(req.query.areaOperativaId);
  if (qAreaOperativa)
    conds.push(sql`i.area_operativa_id_snapshot = ${qAreaOperativa}`);
  const zonaId = parseIntParam(req.query.zonaUdsId);
  if (zonaId) conds.push(sql`i.zona_uds_id_snapshot = ${zonaId}`);
  return conds;
}

function udsCurrentPeopleScopeConds(
  req: { query: Record<string, unknown> },
  callerAreaOperativa: number | null,
): SQL[] {
  const conds: SQL[] = [sql`be.uds = true`];
  if (callerAreaOperativa != null)
    conds.push(sql`be.area_operativa_id = ${callerAreaOperativa}`);
  const qAreaOperativa = parseIntParam(req.query.areaOperativaId);
  if (qAreaOperativa) conds.push(sql`be.area_operativa_id = ${qAreaOperativa}`);
  const zonaId = parseIntParam(req.query.zonaUdsId);
  if (zonaId) conds.push(sql`be.zona_uds_id = ${zonaId}`);
  return conds;
}

router.get("/report/uds/interventi-per-mese", async (req, res) => {
  const range = parseDateRange(req);
  if (!range.ok) {
    res.status(400).json({ message: range.message });
    return;
  }
  const { da, a } = range;
  const conds = udsHistoricalScopeConds(req, callerAreaOperativaId(req));
  conds.push(sql`i.data_intervento::date BETWEEN ${da} AND ${a}`);
  const where = sql.join(conds, sql` AND `);

  const result = await db.execute(sql`
    SELECT TO_CHAR(i.data_intervento::date, 'YYYY-MM') as mese,
           COUNT(*) as tot_interventi
    FROM interventi i
    JOIN beneficiari be ON be.id = i.beneficiario_id
    WHERE ${where}
    GROUP BY mese
    ORDER BY mese
  `);
  const rows = result.rows as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      mese: r.mese as string,
      totInterventi: Number(r.tot_interventi),
    })),
  );
});

/**
 * Street-activity report over a day or date range: every UDS intervention in
 * [da, a] (a defaults to da → single day), with the per-person chronological
 * sequence number (numeroIntervento). The window runs over ALL of a person's
 * interventions ordered by date+id, then we keep only the rows landing in the
 * range — so numeroIntervento=1 means it is that person's first-ever intervention
 * (primoIntervento, highlighted in red on the FE/PDF).
 */
router.get("/report/uds/interventi-giornalieri", async (req, res) => {
  const da = String(req.query.da ?? "");
  if (!isValidIsoDate(da)) {
    res
      .status(400)
      .json({ message: "Parametro 'da' obbligatorio (YYYY-MM-DD)" });
    return;
  }
  const aRaw =
    req.query.a == null || req.query.a === "" ? da : String(req.query.a);
  if (!isValidIsoDate(aRaw)) {
    res.status(400).json({ message: "Parametro 'a' non valido (YYYY-MM-DD)" });
    return;
  }
  // Normalize so callers can pass the range in either order.
  const from = da <= aRaw ? da : aRaw;
  const to = da <= aRaw ? aRaw : da;
  const conds = udsHistoricalScopeConds(req, callerAreaOperativaId(req));
  const where = sql.join(conds, sql` AND `);

  const result = await db.execute(sql`
    WITH sequenza_uds AS (
      SELECT i.*,
             ROW_NUMBER() OVER (
               PARTITION BY i.beneficiario_id
               ORDER BY i.data_intervento ASC, i.id ASC
             ) AS numero
      FROM interventi i
      WHERE i.ambito = 'uds'
    )
    SELECT * FROM (
      SELECT i.id,
             i.beneficiario_id,
             be.cognome,
             be.nome,
             be.soprannome,
             i.zona_uds_id_snapshot,
             z.nome AS zona_nome,
             i.data_intervento::text AS data_intervento,
             i.tipo_intervento,
             i.descrizione,
             i.note,
             i.note_uds,
             u.matricola AS operatore_matricola,
             u.username AS operatore_username,
             i.numero
      FROM sequenza_uds i
      JOIN beneficiari be ON be.id = i.beneficiario_id
      LEFT JOIN zone_uds z ON z.id = i.zona_uds_id_snapshot
      LEFT JOIN utenti u ON u.id = i.operatore_id
      WHERE ${where}
    ) s
    WHERE s.data_intervento::date BETWEEN ${from} AND ${to}
    ORDER BY s.data_intervento ASC, s.zona_nome NULLS LAST, s.cognome, s.nome, s.id
  `);
  const rows = result.rows as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => {
      const numero = Number(r.numero);
      const cognome = r.cognome as string | null;
      const nome = r.nome as string | null;
      return {
        id: Number(r.id),
        beneficiarioId: Number(r.beneficiario_id),
        beneficiarioNome:
          cognome && nome ? `${cognome} ${nome}` : (cognome ?? nome ?? null),
        soprannome: (r.soprannome as string | null) ?? null,
        zonaUdsId:
          r.zona_uds_id_snapshot === null ||
          r.zona_uds_id_snapshot === undefined
            ? null
            : Number(r.zona_uds_id_snapshot),
        zonaNome: (r.zona_nome as string | null) ?? null,
        dataIntervento: r.data_intervento as string,
        tipoIntervento: r.tipo_intervento as string,
        descrizione: (r.descrizione as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        noteUds: (r.note_uds as string | null) ?? null,
        operatoreCodice:
          (r.operatore_matricola as string | null) ??
          (r.operatore_username as string | null) ??
          null,
        numeroIntervento: numero,
        primoIntervento: numero === 1,
      };
    }),
  );
});

router.get("/report/uds/interventi-per-tipo", async (req, res) => {
  const range = parseDateRange(req);
  if (!range.ok) {
    res.status(400).json({ message: range.message });
    return;
  }
  const { da, a } = range;
  const conds = udsHistoricalScopeConds(req, callerAreaOperativaId(req));
  conds.push(sql`i.data_intervento::date BETWEEN ${da} AND ${a}`);
  const where = sql.join(conds, sql` AND `);

  const result = await db.execute(sql`
    SELECT COALESCE(NULLIF(TRIM(i.tipo_intervento), ''), 'altro') as tipo,
           COUNT(*) as tot_interventi
    FROM interventi i
    JOIN beneficiari be ON be.id = i.beneficiario_id
    WHERE ${where}
    GROUP BY tipo
    ORDER BY tot_interventi DESC, tipo
  `);
  const rows = result.rows as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      tipo: r.tipo as string,
      totInterventi: Number(r.tot_interventi),
    })),
  );
});

router.get("/report/uds/interventi-per-zona", async (req, res) => {
  const range = parseDateRange(req);
  if (!range.ok) {
    res.status(400).json({ message: range.message });
    return;
  }
  const { da, a } = range;
  const conds = udsHistoricalScopeConds(req, callerAreaOperativaId(req));
  conds.push(sql`i.data_intervento::date BETWEEN ${da} AND ${a}`);
  const where = sql.join(conds, sql` AND `);

  const result = await db.execute(sql`
    SELECT i.zona_uds_id_snapshot as zona_id,
           COALESCE(z.nome, 'Senza zona') as zona_nome,
           COUNT(*) as tot_interventi
    FROM interventi i
    JOIN beneficiari be ON be.id = i.beneficiario_id
    LEFT JOIN zone_uds z ON z.id = i.zona_uds_id_snapshot
    WHERE ${where}
    GROUP BY i.zona_uds_id_snapshot, z.nome
    ORDER BY tot_interventi DESC, zona_nome
  `);
  const rows = result.rows as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      zonaId:
        r.zona_id === null || r.zona_id === undefined
          ? null
          : Number(r.zona_id),
      zonaNome: r.zona_nome as string,
      totInterventi: Number(r.tot_interventi),
    })),
  );
});

router.get("/report/uds/persone-per-zona", async (req, res) => {
  const conds = udsCurrentPeopleScopeConds(req, callerAreaOperativaId(req));
  const where = sql.join(conds, sql` AND `);

  const result = await db.execute(sql`
    SELECT be.zona_uds_id as zona_id,
           COALESCE(z.nome, 'Senza zona') as zona_nome,
           COUNT(*) as totale,
           COUNT(*) FILTER (WHERE be.centro_ascolto_id IS NULL) as solo_uds,
           COUNT(*) FILTER (WHERE be.centro_ascolto_id IS NOT NULL) as uds_con_centro
    FROM beneficiari be
    LEFT JOIN zone_uds z ON z.id = be.zona_uds_id
    WHERE ${where}
    GROUP BY be.zona_uds_id, z.nome
    ORDER BY totale DESC, zona_nome
  `);
  const rows = result.rows as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      zonaId:
        r.zona_id === null || r.zona_id === undefined
          ? null
          : Number(r.zona_id),
      zonaNome: r.zona_nome as string,
      totale: Number(r.totale),
      soloUds: Number(r.solo_uds),
      udsConCentro: Number(r.uds_con_centro),
    })),
  );
});

export default router;
