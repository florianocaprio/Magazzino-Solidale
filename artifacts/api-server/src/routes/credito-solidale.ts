import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { beneficiariTable, db, politicheCreditoSolidaleTable } from "@workspace/db";
import {
  callerCentroId,
  callerCittaId,
  callerZonaUdsId,
  canAccessCentro,
  canAccessCitta,
  canAccessZonaUds,
} from "../lib/centroScope";

const router: IRouter = Router();

const BENEFICIARIO_NOT_FOUND_MSG = "Beneficiario non trovato.";

const DEFAULT_POLICY = {
  id: null as number | null,
  nome: "Politica predefinita",
  creditoBaseNucleo: "50.00",
  creditoPerComponente: "10.00",
  bonusMinore: "5.00",
  bonusAnziano: "5.00",
  bonusDisabile: "10.00",
  creditoMinimoMensile: "0.00",
  creditoMassimoMensile: null as string | null,
  giornoRicaricaMensile: 1,
  ricaricaAutomaticaAbilitata: false,
  arrotondamento: "nessuno",
};

type PoliticaCalcolo = typeof DEFAULT_POLICY;
type PoliticaOrigine = "centro" | "citta" | "globale" | "default";

const toNumber = (v: string | number | null | undefined): number => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function applyRounding(value: number, mode: string): number {
  switch (mode) {
    case "intero_superiore":
      return Math.ceil(value);
    case "intero_inferiore":
      return Math.floor(value);
    case "intero_piu_vicino":
      return Math.round(value);
    default:
      return value;
  }
}

async function findPolicyByBeneficiario(
  beneficiario: typeof beneficiariTable.$inferSelect,
): Promise<{ politica: PoliticaCalcolo; origine: PoliticaOrigine }> {
  if (beneficiario.centroAscoltoId != null) {
    const [row] = await db
      .select()
      .from(politicheCreditoSolidaleTable)
      .where(and(
        eq(politicheCreditoSolidaleTable.attiva, true),
        eq(politicheCreditoSolidaleTable.centroAscoltoId, beneficiario.centroAscoltoId),
      ))
      .orderBy(desc(politicheCreditoSolidaleTable.id))
      .limit(1);
    if (row) return { politica: row, origine: "centro" };
  }

  if (beneficiario.cittaId != null) {
    const [row] = await db
      .select()
      .from(politicheCreditoSolidaleTable)
      .where(and(
        eq(politicheCreditoSolidaleTable.attiva, true),
        isNull(politicheCreditoSolidaleTable.centroAscoltoId),
        eq(politicheCreditoSolidaleTable.cittaId, beneficiario.cittaId),
      ))
      .orderBy(desc(politicheCreditoSolidaleTable.id))
      .limit(1);
    if (row) return { politica: row, origine: "citta" };
  }

  const [globalPolicy] = await db
    .select()
    .from(politicheCreditoSolidaleTable)
    .where(and(
      eq(politicheCreditoSolidaleTable.attiva, true),
      isNull(politicheCreditoSolidaleTable.centroAscoltoId),
      isNull(politicheCreditoSolidaleTable.cittaId),
    ))
    .orderBy(desc(politicheCreditoSolidaleTable.id))
    .limit(1);

  if (globalPolicy) return { politica: globalPolicy, origine: "globale" };
  return { politica: DEFAULT_POLICY, origine: "default" };
}

function calculate(
  beneficiario: typeof beneficiariTable.$inferSelect,
  politica: PoliticaCalcolo,
) {
  const creditoBaseNucleo = toNumber(politica.creditoBaseNucleo);
  const quotaComponenti = (beneficiario.numComponenti ?? 0) * toNumber(politica.creditoPerComponente);
  const quotaMinori = (beneficiario.numMinori ?? 0) * toNumber(politica.bonusMinore);
  const quotaAnziani = (beneficiario.numAnziani ?? 0) * toNumber(politica.bonusAnziano);
  const quotaDisabili = (beneficiario.numDisabili ?? 0) * toNumber(politica.bonusDisabile);
  const totalePrimaDeiLimiti = creditoBaseNucleo + quotaComponenti + quotaMinori + quotaAnziani + quotaDisabili;

  const minimo = toNumber(politica.creditoMinimoMensile);
  const massimo = politica.creditoMassimoMensile == null ? null : toNumber(politica.creditoMassimoMensile);
  let totaleLimitato = totalePrimaDeiLimiti;
  let creditoMinimoApplicato: number | null = null;
  let creditoMassimoApplicato: number | null = null;

  if (totaleLimitato < minimo) {
    totaleLimitato = minimo;
    creditoMinimoApplicato = minimo;
  }
  if (massimo != null && totaleLimitato > massimo) {
    totaleLimitato = massimo;
    creditoMassimoApplicato = massimo;
  }

  const totaleSuggerito = round2(applyRounding(totaleLimitato, politica.arrotondamento));
  return {
    creditoBaseNucleo: round2(creditoBaseNucleo),
    quotaComponenti: round2(quotaComponenti),
    quotaMinori: round2(quotaMinori),
    quotaAnziani: round2(quotaAnziani),
    quotaDisabili: round2(quotaDisabili),
    totalePrimaDeiLimiti: round2(totalePrimaDeiLimiti),
    creditoMinimoApplicato: creditoMinimoApplicato == null ? null : round2(creditoMinimoApplicato),
    creditoMassimoApplicato: creditoMassimoApplicato == null ? null : round2(creditoMassimoApplicato),
    arrotondamentoApplicato: politica.arrotondamento,
    totaleSuggerito,
  };
}

router.get("/credito-solidale/calcola-beneficiario/:beneficiarioId", async (req, res) => {
  const beneficiarioId = Number(req.params.beneficiarioId);
  if (!Number.isInteger(beneficiarioId)) {
    res.status(404).json({ error: BENEFICIARIO_NOT_FOUND_MSG });
    return;
  }

  const [beneficiario] = await db
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  if (!beneficiario) {
    res.status(404).json({ error: BENEFICIARIO_NOT_FOUND_MSG });
    return;
  }

  if (
    !canAccessCentro(beneficiario.centroAscoltoId, callerCentroId(req)) ||
    !canAccessCitta(beneficiario.cittaId, callerCittaId(req)) ||
    !canAccessZonaUds(beneficiario.zonaUdsId, callerZonaUdsId(req))
  ) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo profilo" });
    return;
  }

  const { politica, origine } = await findPolicyByBeneficiario(beneficiario);
  const dettaglio = calculate(beneficiario, politica);
  res.json({
    beneficiarioId: beneficiario.id,
    politicaId: politica.id,
    politicaNome: politica.nome,
    politicaOrigine: origine,
    giornoRicaricaMensile: politica.giornoRicaricaMensile,
    ricaricaAutomaticaAbilitata: politica.ricaricaAutomaticaAbilitata,
    totaleSuggerito: dettaglio.totaleSuggerito,
    dettaglio,
  });
});

export default router;
