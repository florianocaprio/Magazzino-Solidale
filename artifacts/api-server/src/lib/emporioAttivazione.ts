import { z } from "@workspace/api-zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  beneficiariTable,
  emporioAbilitazioniTable,
  centriAscoltoTable,
  areeOperativeTable,
  creditoSolidaleMovimentiTable,
  comandiOperativiTable,
  auditConfigurazioniTable,
} from "@workspace/db";
import type { InventoryTransaction as Tx } from "./scaricoInventory";
import type { AuditCommandContext } from "./auditEvent";
import { auditEmporioTx } from "./emporioAudit";
import {
  currentEmporioActor,
  requireEmporioCommandTx,
  EmporioScopeError,
} from "./emporioScope";
import { operationalCentroId } from "./serviceScope";
import { requireCreditModulesTx } from "./creditoSaldo";
import { calcolaQuotaTx, configuraQuotaTx } from "./creditoCalcolo";
import { calendarioCredito } from "./creditoMensile";
import { riconosciQuotaPeriodoTx } from "./creditoQuotaPeriodo";
import {
  commandRequestHash,
  requireIdempotencyKey,
  lockDocumentCommand,
  findDocumentCommand,
  loadDocumentCommand,
  storeDocumentCommand,
  requireExpectedVersion,
} from "./documentCommand";

const COMMAND = "emporio.attivazione.credito";
const Input = z
  .object({
    idempotencyKey: z.string(),
    versioneBeneficiario: z.number().int().positive(),
    calcoloToken: z.string().length(64),
    motivo: z.string().trim().min(1).max(1000),
    quotaMensileAssegnata: z
      .number()
      .int()
      .min(0)
      .max(99999999)
      .nullable()
      .optional(),
    motivoModificaQuota: z.string().trim().max(10000).nullable().optional(),
  })
  .strict();

async function authorized(tx: Tx, userId: number, id: number) {
  const { actor, beneficiary: b } = await requireEmporioCommandTx(
    tx,
    userId,
    "emporio.eligibility.manage",
    { beneficiarioId: id },
    false,
  );
  await currentEmporioActor(tx, userId, "credito.quota.manage");
  if (
    !actor.isAdmin &&
    (!actor.aree.includes("sociale") ||
      (operationalCentroId(actor) != null &&
        operationalCentroId(actor) !== b.centroAscoltoId))
  )
    throw new EmporioScopeError(
      403,
      "Attivazione riservata agli operatori sociali autorizzati.",
    );
  await requireCreditModulesTx(tx);
  return { actor, b };
}
async function territory(tx: Tx, b: typeof beneficiariTable.$inferSelect) {
  const [area] = await tx
    .select()
    .from(areeOperativeTable)
    .where(eq(areeOperativeTable.id, b.areaOperativaId ?? -1))
    .for("share");
  const [center] = await tx
    .select()
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, b.centroAscoltoId ?? -1))
    .for("share");
  if (
    !b.attivo ||
    !area?.attivo ||
    !center?.attivo ||
    center.areaOperativaId !== area.id
  )
    throw new EmporioScopeError(
      400,
      "Beneficiario, Area o Centro non disponibile/coerente.",
    );
  return area;
}
async function firstDecision(tx: Tx, b: typeof beneficiariTable.$inferSelect) {
  const [receipt] = await tx
    .select({ id: comandiOperativiTable.id })
    .from(comandiOperativiTable)
    .where(
      and(
        eq(comandiOperativiTable.tipoComando, COMMAND),
        eq(comandiOperativiTable.aggregatoTipo, "beneficiario"),
        eq(comandiOperativiTable.aggregatoId, b.id),
      ),
    )
    .limit(1);
  const [past] = await tx
    .select({ id: creditoSolidaleMovimentiTable.id })
    .from(creditoSolidaleMovimentiTable)
    .where(and(eq(creditoSolidaleMovimentiTable.beneficiarioId, b.id)))
    .limit(1);
  const [interruptedRight] = await tx
    .select({ id: emporioAbilitazioniTable.id })
    .from(emporioAbilitazioniTable)
    .where(
      and(
        eq(emporioAbilitazioniTable.beneficiarioId, b.id),
        inArray(emporioAbilitazioniTable.stato, ["sospeso", "revocato"]),
      ),
    )
    .limit(1);
  // Una configurazione storica già assegnata non è una nuova prima attivazione.
  // Un diritto già attivo ma senza quota né accrediti può invece essere completato esplicitamente.
  return (
    !receipt &&
    !past &&
    !interruptedRight &&
    b.creditoSolidaleMensileAssegnato == null
  );
}
function calculationToken(
  b: typeof beneficiariTable.$inferSelect,
  suggested: number,
  policyId: number | null,
  first: boolean,
) {
  return commandRequestHash({
    id: b.id,
    versione: b.versione,
    suggested,
    policyId,
    first,
  });
}
export async function anteprimaAttivazioneEmporio(id: number, userId: number) {
  return db.transaction(async (tx) => {
    const { b } = await authorized(tx, userId, id);
    const area = await territory(tx, b);
    const { politica, dettaglio } = await calcolaQuotaTx(tx, b);
    const first = await firstDecision(tx, b);
    return {
      beneficiarioId: id,
      versioneBeneficiario: b.versione,
      areaNome: area.nome,
      politicaNome: politica.nome,
      totaleSuggerito: dettaglio.totaleSuggerito,
      quotaMensileAssegnata:
        b.creditoSolidaleMensileManuale &&
        b.creditoSolidaleMensileAssegnato != null
          ? Number(b.creditoSolidaleMensileAssegnato)
          : dettaglio.totaleSuggerito,
      motivoModificaQuota: b.creditoSolidaleMotivoModifica,
      primaQuotaAmmessa: first,
      calcoloToken: calculationToken(
        b,
        dettaglio.totaleSuggerito,
        politica.id,
        first,
      ),
    };
  });
}
export async function attivaEmporioCredito(input: {
  id: number;
  userId: number;
  body: unknown;
  command: AuditCommandContext;
  now?: Date;
}) {
  const parsed = Input.safeParse(input.body);
  if (!parsed.success)
    throw new EmporioScopeError(
      400,
      "Conferma motivo, quota e anteprima corrente dell'attivazione.",
    );
  const data = parsed.data,
    key = requireIdempotencyKey(data.idempotencyKey),
    now = input.now ?? new Date();
  const identity = {
    tipoComando: COMMAND,
    idempotencyKey: key,
    actorUserId: input.userId,
    aggregatoTipo: "beneficiario",
    aggregatoId: input.id,
    requestHash: commandRequestHash({
      id: input.id,
      ...data,
      idempotencyKey: undefined,
    }),
  };
  return db.transaction(async (tx) => {
    await lockDocumentCommand(tx, COMMAND, key);
    const { actor, b } = await authorized(tx, input.userId, input.id);
    const receipt = await findDocumentCommand(tx, identity);
    if (receipt) return receipt.resultSnapshot;
    const area = await territory(tx, b);
    if (requireExpectedVersion(data.versioneBeneficiario) !== b.versione)
      throw new EmporioScopeError(
        409,
        "Anagrafica o nucleo modificati: ricarica l'anteprima.",
      );
    if (["sospeso", "revocato"].includes(b.creditoSolidaleStato))
      throw new EmporioScopeError(
        409,
        "Il credito è sospeso o revocato: usa la configurazione autorizzata prima di proseguire.",
      );
    const first = await firstDecision(tx, b);
    const quota = await configuraQuotaTx(
      tx,
      b,
      {
        assegnato: data.quotaMensileAssegnata,
        motivo: data.motivoModificaQuota,
      },
      now,
    );
    if (
      data.calcoloToken !==
      calculationToken(
        b,
        quota.dettaglio.totaleSuggerito,
        quota.politica.id,
        first,
      )
    )
      throw new EmporioScopeError(
        409,
        "Calcolo o prima quota cambiati: ricarica l'anteprima.",
      );
    const [before] = await tx
      .select()
      .from(emporioAbilitazioniTable)
      .where(
        and(
          eq(emporioAbilitazioniTable.beneficiarioId, b.id),
          eq(emporioAbilitazioniTable.areaOperativaId, area.id),
        ),
      )
      .for("update");
    if (before?.stato === "attivo" && before.dataEffetto > now)
      throw new EmporioScopeError(
        409,
        "Abilitazione programmata: non anticipare la decorrenza.",
      );
    let right = before;
    if (before?.stato !== "attivo") {
      const values = {
        beneficiarioId: b.id,
        areaOperativaId: area.id,
        stato: "attivo",
        dataEffetto: now,
        operatoreId: actor.id,
        motivo: data.motivo,
      };
      [right] = before
        ? await tx
            .update(emporioAbilitazioniTable)
            .set(values)
            .where(eq(emporioAbilitazioniTable.id, before.id))
            .returning()
        : await tx.insert(emporioAbilitazioniTable).values(values).returning();
    }
    const [configured] = await tx
      .update(beneficiariTable)
      .set({
        ...quota.updates,
        creditoSolidaleAbilitato: true,
        creditoSolidaleStato: "attivo",
        creditoSolidaleDataAbilitazione:
          b.creditoSolidaleDataAbilitazione ?? now,
        versione: b.versione + 1,
        dataAggiornamento: now,
      })
      .where(eq(beneficiariTable.id, b.id))
      .returning();
    const period = calendarioCredito(now).periodo;
    const credited = first
      ? await riconosciQuotaPeriodoTx(tx, configured, {
          quota: quota.assigned,
          periodo: period,
          origine: "attivazione_emporio",
          politicaId: quota.politica.id,
          motivo: data.motivo,
          command: {
            ...input.command,
            operationKey: `emporio.attivazione:${key}`,
          },
        })
      : null;
    await auditEmporioTx(tx, {
      entityType: "abilitazione",
      entityId: right!.id,
      action: before?.stato === "attivo" ? "completamento-credito" : "attivo",
      operatoreId: actor.id,
      motivo: data.motivo,
      before: before ? { stato: before.stato } : null,
      after: {
        stato: "attivo",
        beneficiarioId: b.id,
        quota: quota.assigned,
        primaQuota: first,
        accreditato: credited?.nuova ? credited.quota : 0,
      },
    });
    await tx.insert(auditConfigurazioniTable).values({
      area: "beneficiari",
      chiave: `beneficiario:${b.id}:credito-solidale`,
      azione: "attivazione-integrata-emporio-credito",
      utenteId: actor.id,
      valorePrecedente: {
        quota: b.creditoSolidaleMensileAssegnato,
        manuale: b.creditoSolidaleMensileManuale,
        motivo: b.creditoSolidaleMotivoModifica,
      },
      valoreNuovo: {
        quota: quota.assigned,
        manuale: configured.creditoSolidaleMensileManuale,
        motivo: configured.creditoSolidaleMotivoModifica,
      },
    });
    const result = {
      beneficiarioId: b.id,
      quotaMensile: quota.assigned,
      quotaAccreditata: credited?.nuova ? credited.quota : 0,
      primaQuotaValutata: first,
      periodo: period,
      movimentoId: credited?.movimentoId ?? null,
      stato: "attivo",
    };
    await storeDocumentCommand(tx, {
      ...identity,
      versioneRichiesta: b.versione,
      versioneRisultante: configured.versione,
      resultSnapshot: result,
    });
    return result;
  });
}
export async function esitoAttivazioneEmporio(
  id: number,
  userId: number,
  rawKey: unknown,
) {
  const key = requireIdempotencyKey(rawKey);
  return db.transaction(async (tx) => {
    await lockDocumentCommand(tx, COMMAND, key);
    await authorized(tx, userId, id);
    const receipt = await loadDocumentCommand(tx, {
      tipoComando: COMMAND,
      idempotencyKey: key,
    });
    if (
      !receipt ||
      receipt.actorUserId !== userId ||
      receipt.aggregatoTipo !== "beneficiario" ||
      receipt.aggregatoId !== id
    )
      throw new EmporioScopeError(404, "Esito non disponibile.");
    return receipt.resultSnapshot;
  });
}
