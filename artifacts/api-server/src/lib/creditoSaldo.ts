import { and, eq } from "drizzle-orm";
import {
  beneficiariTable,
  centriAscoltoTable,
  areeOperativeTable,
  creditoSolidaleMovimentiTable,
  db,
  utentiTable,
  ambienteModuliTable,
  moduliFunzionaliTable,
} from "@workspace/db";
import type { InventoryTransaction as Tx } from "./scaricoInventory";
import { creditoIntero } from "./creditoIntero";
import { requireEmporioCommandTx } from "./emporioScope";
import {
  auditFields,
  recordAuditEvent,
  type AuditCommandContext,
} from "./auditEvent";
import {
  commandRequestHash,
  findDocumentCommand,
  loadDocumentCommand,
  lockDocumentCommand,
  requireIdempotencyKey,
  storeDocumentCommand,
} from "./documentCommand";

export class CreditoSaldoError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** No bootstrap/attivazione implicita. Il lock resta valido fino al commit. */
export async function requireCreditModulesTx(tx: Tx): Promise<void> {
  for (const code of ["EMPORIO_SOLIDALE", "CREDITO_SOLIDALE"]) {
    const [module] = await tx
      .select()
      .from(moduliFunzionaliTable)
      .where(eq(moduliFunzionaliTable.codice, code))
      .for("share");
    const [setting] = module
      ? await tx
          .select()
          .from(ambienteModuliTable)
          .where(
            and(
              eq(ambienteModuliTable.moduloId, module.id),
              eq(ambienteModuliTable.configurazioneAmbienteId, 1),
            ),
          )
          .for("share")
      : [];
    if (!module || !(module.core || (setting?.attivo ?? module.attivoDefault)))
      throw new CreditoSaldoError(
        403,
        "Modulo Credito Solidale/Emporio non abilitato.",
      );
  }
}

/** Chiamata soltanto dopo autorizzazione/eleggibilità e lock UPDATE del beneficiario.
 * Un unico ledger economico, nessuna scrittura inventariale. */
export async function appendCreditTx(
  tx: Tx,
  input: {
    beneficiary: typeof beneficiariTable.$inferSelect;
    variazione: number;
    tipo: "rettifica_positiva" | "rettifica_negativa" | "ricarica_mensile";
    motivo: string;
    note?: string | null;
    periodo?: string;
    origine?: "attivazione_emporio" | "scheduler_mensile";
    politicaId?: number | null;
    command: AuditCommandContext;
  },
) {
  const { beneficiary: b } = input;
  const before = creditoIntero(b.creditoSolidaleSaldo);
  const delta = creditoIntero(input.variazione, { signed: true });
  if (!delta)
    throw new CreditoSaldoError(400, "La variazione non può essere zero.", {
      variazioneCredito: "Inserisci un numero intero positivo.",
    });
  if (before + delta < 0)
    throw new CreditoSaldoError(
      400,
      "Il saldo Credito Solidale non può diventare negativo.",
      { variazioneCredito: "La riduzione supera il saldo disponibile." },
    );
  const after = creditoIntero(before + delta);
  const [movement] = await tx
    .insert(creditoSolidaleMovimentiTable)
    .values({
      beneficiarioId: b.id,
      areaOperativaId: b.areaOperativaId,
      centroAscoltoId: b.centroAscoltoId,
      tipoMovimento: input.tipo,
      variazioneCredito: String(delta),
      saldoPrima: String(before),
      saldoDopo: String(after),
      motivo: input.motivo,
      note: input.note ?? null,
      periodoRiferimento: input.periodo ?? null,
      quotaMensileAssegnata: input.periodo ? String(delta) : null,
      origine: input.origine ?? (input.periodo ? "scheduler_mensile" : "manuale"),
      politicaCreditoSolidaleId: input.politicaId ?? null,
      operatoreId:
        input.command.actor.actorType === "user"
          ? input.command.actor.actorUserId
          : null,
    })
    .returning();
  await tx
    .update(beneficiariTable)
    .set({
      creditoSolidaleSaldo: String(after),
      creditoSolidaleDataUltimoMovimento: movement.dataMovimento,
      dataAggiornamento: new Date(),
    })
    .where(eq(beneficiariTable.id, b.id));
  await recordAuditEvent(tx, {
    command: input.command,
    azione: input.origine === "attivazione_emporio" ? "CREDITO_PRIMA_QUOTA" : input.periodo
      ? "CREDITO_RICARICA_MENSILE"
      : "CREDITO_SALDO_RETTIFICATO",
    entitaTipo: "credito_solidale_movimento",
    entitaId: movement.id,
    areaOperativaIdSnapshot: b.areaOperativaId,
    centroAscoltoIdSnapshot: b.centroAscoltoId,
    motivo: input.motivo,
    changes: auditFields(
      {
        beneficiarioId: b.id,
        saldoPrima: before,
        variazione: delta,
        saldoDopo: after,
        periodo: input.periodo ?? null,
      },
      ["beneficiarioId", "saldoPrima", "variazione", "saldoDopo", "periodo"],
    ),
  });
  const [center] =
    b.centroAscoltoId == null
      ? []
      : await tx
          .select({ nome: centriAscoltoTable.nome })
          .from(centriAscoltoTable)
          .where(eq(centriAscoltoTable.id, b.centroAscoltoId));
  const [area] =
    b.areaOperativaId == null
      ? []
      : await tx
          .select({ nome: areeOperativeTable.nome })
          .from(areeOperativeTable)
          .where(eq(areeOperativeTable.id, b.areaOperativaId));
  return {
    ...movement,
    beneficiarioNome: `${b.cognome ?? ""} ${b.nome ?? ""}`.trim(),
    centroAscoltoNome: center?.nome ?? null,
    areaOperativaNome: area?.nome ?? null,
    variazioneCredito: delta,
    saldoPrima: before,
    saldoDopo: after,
    quotaMensileAssegnata: input.periodo ? delta : null,
    dataMovimento: movement.dataMovimento.toISOString(),
    dataCreazione: movement.dataCreazione.toISOString(),
  };
}

const COMMAND = "credito.saldo.rettifica";
export async function rettificaCredito(input: {
  beneficiarioId: number;
  userId: number;
  body: Record<string, unknown>;
  command: AuditCommandContext;
}) {
  const key = requireIdempotencyKey(input.body.idempotencyKey);
  const delta = creditoIntero(input.body.variazioneCredito, { signed: true });
  const motivo =
    typeof input.body.motivo === "string" ? input.body.motivo.trim() : "";
  const note =
    typeof input.body.note === "string" ? input.body.note.trim() || null : null;
  if (!motivo)
    throw new CreditoSaldoError(
      400,
      "Il motivo della rettifica è obbligatorio.",
      { motivo: "Campo obbligatorio" },
    );
  if (motivo.length > 1000 || (note?.length ?? 0) > 1000)
    throw new CreditoSaldoError(
      400,
      "Motivo e note possono contenere al massimo 1000 caratteri.",
    );
  if (!delta)
    throw new CreditoSaldoError(400, "La variazione non può essere zero.", {
      variazioneCredito: "Inserisci un numero intero positivo.",
    });
  const identity = {
    tipoComando: COMMAND,
    idempotencyKey: key,
    actorUserId: input.userId,
    aggregatoTipo: "beneficiario",
    aggregatoId: input.beneficiarioId,
    requestHash: commandRequestHash({
      beneficiarioId: input.beneficiarioId,
      variazioneCredito: delta,
      motivo,
      note,
    }),
  };
  return db.transaction(async (tx) => {
    await lockDocumentCommand(tx, COMMAND, key);
    await requireEmporioCommandTx(
      tx,
      input.userId,
      "credito.adjust",
      { beneficiarioId: input.beneficiarioId },
      false,
    );
    const existing = await findDocumentCommand(tx, identity);
    if (existing) return existing.resultSnapshot;
    const { beneficiary } = await requireEmporioCommandTx(
      tx,
      input.userId,
      "credito.adjust",
      { beneficiarioId: input.beneficiarioId },
      true,
    );
    await requireCreditModulesTx(tx);
    const [user] = await tx
      .select({
        username: utentiTable.username,
        matricola: utentiTable.matricola,
      })
      .from(utentiTable)
      .where(eq(utentiTable.id, input.userId));
    const command: AuditCommandContext = {
      ...input.command,
      operationKey: `credito.rettifica:${key}`,
      actor: {
        actorType: "user",
        actorUserId: input.userId,
        actorCodeSnapshot: user.matricola || user.username,
        initiatedByUserId: null,
        initiatedByCodeSnapshot: null,
      },
    };
    const result = await appendCreditTx(tx, {
      beneficiary,
      variazione: delta,
      tipo: delta > 0 ? "rettifica_positiva" : "rettifica_negativa",
      motivo,
      note,
      command,
    });
    await storeDocumentCommand(tx, { ...identity, resultSnapshot: result });
    return result;
  });
}

export async function esitoRettificaCredito(
  beneficiarioId: number,
  userId: number,
  rawKey: unknown,
) {
  const key = requireIdempotencyKey(rawKey);
  return db.transaction(async (tx) => {
    await lockDocumentCommand(tx, COMMAND, key);
    await requireEmporioCommandTx(
      tx,
      userId,
      "credito.adjust",
      { beneficiarioId },
      false,
    );
    const receipt = await loadDocumentCommand(tx, {
      tipoComando: COMMAND,
      idempotencyKey: key,
    });
    if (
      !receipt ||
      receipt.actorUserId !== userId ||
      receipt.aggregatoId !== beneficiarioId ||
      receipt.aggregatoTipo !== "beneficiario"
    )
      throw new CreditoSaldoError(
        404,
        "Esito rettifica non disponibile per questa operazione.",
      );
    return receipt.resultSnapshot;
  });
}
