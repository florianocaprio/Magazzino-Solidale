import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  beneficiariTable,
  politicheCreditoSolidaleTable,
  auditConfigurazioniTable,
} from "@workspace/db";
import { creditoPolicyApplicable } from "./creditoPolicyScope";
import { EmporioScopeError } from "./emporioScope";
import { creditoIntero } from "./creditoIntero";
import type { InventoryTransaction as Tx } from "./scaricoInventory";
const toNumber = (v: string | number | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => creditoIntero(n, { signed: true });
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
type PoliticaOrigine = "centro" | "areaOperativa" | "globale" | "default";

function applyRounding(value: number, mode: string): number {
  // Validate BEFORE the historical policy: no mode may legalize a fraction.
  creditoIntero(value);
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

export async function findPolicyByBeneficiario(
  beneficiario: typeof beneficiariTable.$inferSelect,
  executor: Pick<typeof db, "select"> = db,
): Promise<{ politica: PoliticaCalcolo; origine: PoliticaOrigine }> {
  if (beneficiario.politicaCreditoSolidaleId != null) {
    const [selected] = await executor
      .select()
      .from(politicheCreditoSolidaleTable)
      .where(
        eq(
          politicheCreditoSolidaleTable.id,
          beneficiario.politicaCreditoSolidaleId,
        ),
      );
    if (!selected || !creditoPolicyApplicable(selected, beneficiario))
      throw new EmporioScopeError(
        409,
        "La politica scelta non è attiva o non è applicabile al territorio del beneficiario.",
      );
    return {
      politica: selected,
      origine:
        selected.centroAscoltoId != null
          ? "centro"
          : selected.areaOperativaId != null
            ? "areaOperativa"
            : "globale",
    };
  }
  if (beneficiario.centroAscoltoId != null) {
    const [row] = await executor
      .select()
      .from(politicheCreditoSolidaleTable)
      .where(
        and(
          eq(politicheCreditoSolidaleTable.attiva, true),
          eq(
            politicheCreditoSolidaleTable.centroAscoltoId,
            beneficiario.centroAscoltoId,
          ),
        ),
      )
      .orderBy(desc(politicheCreditoSolidaleTable.id))
      .limit(1);
    if (row) return { politica: row, origine: "centro" };
  }

  if (beneficiario.areaOperativaId != null) {
    const [row] = await executor
      .select()
      .from(politicheCreditoSolidaleTable)
      .where(
        and(
          eq(politicheCreditoSolidaleTable.attiva, true),
          isNull(politicheCreditoSolidaleTable.centroAscoltoId),
          eq(
            politicheCreditoSolidaleTable.areaOperativaId,
            beneficiario.areaOperativaId,
          ),
        ),
      )
      .orderBy(desc(politicheCreditoSolidaleTable.id))
      .limit(1);
    if (row) return { politica: row, origine: "areaOperativa" };
  }

  const [globalPolicy] = await executor
    .select()
    .from(politicheCreditoSolidaleTable)
    .where(
      and(
        eq(politicheCreditoSolidaleTable.attiva, true),
        isNull(politicheCreditoSolidaleTable.centroAscoltoId),
        isNull(politicheCreditoSolidaleTable.areaOperativaId),
      ),
    )
    .orderBy(desc(politicheCreditoSolidaleTable.id))
    .limit(1);

  if (globalPolicy) return { politica: globalPolicy, origine: "globale" };
  return { politica: DEFAULT_POLICY, origine: "default" };
}

export function calculate(
  beneficiario: typeof beneficiariTable.$inferSelect,
  politica: PoliticaCalcolo,
) {
  const creditoBaseNucleo = toNumber(politica.creditoBaseNucleo);
  const quotaComponenti =
    (beneficiario.numComponenti ?? 0) * toNumber(politica.creditoPerComponente);
  const quotaMinori =
    (beneficiario.numMinori ?? 0) * toNumber(politica.bonusMinore);
  const quotaAnziani =
    (beneficiario.numAnziani ?? 0) * toNumber(politica.bonusAnziano);
  const quotaDisabili =
    (beneficiario.numDisabili ?? 0) * toNumber(politica.bonusDisabile);
  const totalePrimaDeiLimiti =
    creditoBaseNucleo +
    quotaComponenti +
    quotaMinori +
    quotaAnziani +
    quotaDisabili;

  const minimo = toNumber(politica.creditoMinimoMensile);
  const massimo =
    politica.creditoMassimoMensile == null
      ? null
      : toNumber(politica.creditoMassimoMensile);
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

  const totaleSuggerito = round2(
    applyRounding(totaleLimitato, politica.arrotondamento),
  );
  return {
    creditoBaseNucleo: round2(creditoBaseNucleo),
    quotaComponenti: round2(quotaComponenti),
    quotaMinori: round2(quotaMinori),
    quotaAnziani: round2(quotaAnziani),
    quotaDisabili: round2(quotaDisabili),
    totalePrimaDeiLimiti: round2(totalePrimaDeiLimiti),
    creditoMinimoApplicato:
      creditoMinimoApplicato == null ? null : round2(creditoMinimoApplicato),
    creditoMassimoApplicato:
      creditoMassimoApplicato == null ? null : round2(creditoMassimoApplicato),
    arrotondamentoApplicato: politica.arrotondamento,
    totaleSuggerito,
  };
}

export async function calcolaQuotaTx(
  tx: Pick<typeof db, "select">,
  b: typeof beneficiariTable.$inferSelect,
) {
  const { politica, origine } = await findPolicyByBeneficiario(b, tx);
  return { politica, origine, dettaglio: calculate(b, politica) };
}

/** Quota totale: il suggerito del client non è un'autorità economica. */
export async function configuraQuotaTx(
  tx: Tx,
  b: typeof beneficiariTable.$inferSelect,
  input: { assegnato?: number | null; motivo?: string | null },
  now = new Date(),
) {
  const calcolo = await calcolaQuotaTx(tx, b);
  const suggested = calcolo.dettaglio.totaleSuggerito;
  const assigned =
    input.assegnato === undefined && b.creditoSolidaleMensileManuale
      ? creditoIntero(b.creditoSolidaleMensileAssegnato)
      : input.assegnato == null
        ? suggested
        : creditoIntero(input.assegnato);
  const manual = assigned !== suggested;
  const motivo =
    (input.motivo === undefined
      ? b.creditoSolidaleMotivoModifica
      : input.motivo
    )?.trim() || null;
  if (manual && !motivo)
    throw new EmporioScopeError(
      400,
      "Il motivo della deroga alla quota mensile è obbligatorio.",
    );
  return {
    ...calcolo,
    assigned,
    updates: {
      creditoSolidaleMensileAssegnato: String(assigned),
      creditoSolidaleMensileManuale: manual,
      creditoSolidaleMotivoModifica: manual ? motivo : null,
      creditoSolidaleDataUltimaModificaQuota: now,
    },
  };
}

const FAMILY_FIELDS = [
  "numComponenti",
  "numMinori",
  "numAnziani",
  "numDisabili",
  "dataNascita",
] as const;
export async function riallineaQuotaNucleoTx(
  tx: Tx,
  before: typeof beneficiariTable.$inferSelect,
  after: typeof beneficiariTable.$inferSelect,
  actorId: number | null,
  detailedChange = false,
) {
  if (!detailedChange && !FAMILY_FIELDS.some((k) => before[k] !== after[k]))
    return after;
  // Non attiva servizi, non accredita e non inventa contatori dalle schede dettagliate.
  if (
    !after.creditoSolidaleAbilitato &&
    after.creditoSolidaleMensileAssegnato == null &&
    !after.creditoSolidaleMensileManuale
  ) {
    if (after.versione !== before.versione) return after;
    // Anche il nucleo non ancora configurato invalida un'anteprima rimasta aperta.
    const [updated] = await tx
      .update(beneficiariTable)
      .set({
        versione:
          after.versione === before.versione
            ? sql`${beneficiariTable.versione}+1`
            : after.versione,
        dataAggiornamento: new Date(),
      })
      .where(eq(beneficiariTable.id, after.id))
      .returning();
    return updated;
  }
  const { dettaglio } = await calcolaQuotaTx(tx, after);
  const [updated] = await tx
    .update(beneficiariTable)
    .set({
      creditoSolidaleMensileAssegnato: String(dettaglio.totaleSuggerito),
      creditoSolidaleMensileManuale: false,
      creditoSolidaleMotivoModifica: null,
      creditoSolidaleDataUltimaModificaQuota: new Date(),
      versione:
        after.versione === before.versione
          ? sql`${beneficiariTable.versione}+1`
          : after.versione,
      dataAggiornamento: new Date(),
    })
    .where(eq(beneficiariTable.id, after.id))
    .returning();
  await tx.insert(auditConfigurazioniTable).values({
    area: "beneficiari",
    chiave: `beneficiario:${after.id}:credito-solidale`,
    azione: "ricalcolo-quota-cambio-nucleo",
    utenteId: actorId,
    valorePrecedente: {
      quota: before.creditoSolidaleMensileAssegnato,
      manuale: before.creditoSolidaleMensileManuale,
      motivo: before.creditoSolidaleMotivoModifica,
    },
    valoreNuovo: {
      quota: updated.creditoSolidaleMensileAssegnato,
      manuale: false,
      campi: FAMILY_FIELDS.filter((k) => before[k] !== after[k]),
      composizioneDettagliata: detailedChange,
    },
  });
  return updated;
}
