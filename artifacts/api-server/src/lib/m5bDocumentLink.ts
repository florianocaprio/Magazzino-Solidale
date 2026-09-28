import type { Request } from "express";
import { and, eq, exists, inArray, notExists, or, sql, type Column, type SQL } from "drizzle-orm";
import {
  bolleTable,
  db,
  magazziniTable,
  richiesteMagazzinoDocumentiTable,
  richiesteMagazzinoTable,
  trasferimentiTable,
} from "@workspace/db";
import type { InventoryTransaction } from "./scaricoInventory";
import {
  auditContextFromRequest,
  auditFields,
  recordAuditEvent,
} from "./auditEvent";
import { logicalDocumentProgress, type M5bDocumentType } from "./m5bProgress";
import { canAccessAreaOperativa, canAccessCentro } from "./centroScope";
import {
  canReadM5bRequest,
  m5bRequestScopePredicate,
  requireCurrentM5bActor,
  type M5bRequestActor,
} from "./m5bRequestAccess";

export type { M5bDocumentType } from "./m5bProgress";
export type M5bDocumentLink =
  typeof richiesteMagazzinoDocumentiTable.$inferSelect;

export async function requestDocumentSummaries(
  richiestaIds: number[],
  grants: {
    bolla: boolean;
    trasferimento: boolean;
    areaOperativaId: number | null;
    centroAscoltoId: number | null;
  },
) {
  if (richiestaIds.length === 0)
    return new Map<number, ReturnType<typeof summary>[]>();
  const rows = await db
    .select({
      link: richiesteMagazzinoDocumentiTable,
      numeroBolla: bolleTable.numeroBolla,
      statoBolla: bolleTable.stato,
      versioneBolla: bolleTable.versione,
      bollaMagazzinoId: bolleTable.magazzinoId,
      codiceTrasferimento: trasferimentiTable.codice,
      statoTrasferimento: trasferimentiTable.stato,
      versioneTrasferimento: trasferimentiTable.versione,
      trasferimentoOrigineId: trasferimentiTable.magazzinoOrigineId,
      trasferimentoDestinoId: trasferimentiTable.magazzinoDestinoId,
    })
    .from(richiesteMagazzinoDocumentiTable)
    .leftJoin(
      bolleTable,
      eq(richiesteMagazzinoDocumentiTable.bollaId, bolleTable.id),
    )
    .leftJoin(
      trasferimentiTable,
      eq(
        richiesteMagazzinoDocumentiTable.trasferimentoId,
        trasferimentiTable.id,
      ),
    )
    .where(inArray(richiesteMagazzinoDocumentiTable.richiestaId, richiestaIds))
    .orderBy(
      richiesteMagazzinoDocumentiTable.creatoAt,
      richiesteMagazzinoDocumentiTable.id,
    );
  const ids = [
    ...new Set(
      rows
        .flatMap((row) => [
          row.bollaMagazzinoId,
          row.trasferimentoOrigineId,
          row.trasferimentoDestinoId,
        ])
        .filter((id): id is number => id != null),
    ),
  ];
  const warehouses =
    ids.length > 0
      ? await db
          .select({
            id: magazziniTable.id,
            areaOperativaId: magazziniTable.areaOperativaId,
            centroAscoltoId: magazziniTable.centroAscoltoId,
          })
          .from(magazziniTable)
          .where(inArray(magazziniTable.id, ids))
      : [];
  const permitted = new Set(
    warehouses
      .filter(
        (warehouse) =>
          canAccessAreaOperativa(
            warehouse.areaOperativaId,
            grants.areaOperativaId,
          ) &&
          canAccessCentro(warehouse.centroAscoltoId, grants.centroAscoltoId),
      )
      .map((warehouse) => warehouse.id),
  );
  function summary(row: (typeof rows)[number]) {
    const type = row.link.tipoDocumento as M5bDocumentType;
    const id = type === "bolla" ? row.link.bollaId : row.link.trasferimentoId;
    const state = type === "bolla" ? row.statoBolla : row.statoTrasferimento;
    const canOpen =
      grants[type] &&
      (type === "bolla"
        ? row.bollaMagazzinoId != null && permitted.has(row.bollaMagazzinoId)
        : (row.trasferimentoOrigineId != null &&
            permitted.has(row.trasferimentoOrigineId)) ||
          (row.trasferimentoDestinoId != null &&
            permitted.has(row.trasferimentoDestinoId)));
    return {
      relazioneId: row.link.id,
      tipoDocumento: type,
      codice: type === "bolla" ? row.numeroBolla : row.codiceTrasferimento,
      statoDocumento: state,
      avanzamento: logicalDocumentProgress(type, state),
      corrente: row.link.corrente,
      versioneDocumento:
        type === "bolla" ? row.versioneBolla : row.versioneTrasferimento,
      percorsoDocumento:
        canOpen && id != null
          ? type === "bolla"
            ? `/bolle?bollaId=${id}`
            : `/trasferimenti?trasferimentoId=${id}`
          : null,
      creatoAt: row.link.creatoAt,
      cessatoAt: row.link.cessatoAt,
      eventoCessazione: row.link.eventoCessazione,
    };
  }
  const result = new Map<number, ReturnType<typeof summary>[]>();
  for (const row of rows) {
    const values = result.get(row.link.richiestaId) ?? [];
    values.push(summary(row));
    result.set(row.link.richiestaId, values);
  }
  return result;
}

export class M5bLinkError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Advisory serialisation shared by request, linked M4 and cancellation paths. */
export async function lockM5bRequest(
  tx: InventoryTransaction,
  richiestaId: number,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('m5b.richiesta'), ${richiestaId})`,
  );
  const [row] = await tx
    .select()
    .from(richiesteMagazzinoTable)
    .where(eq(richiesteMagazzinoTable.id, richiestaId))
    .for("update");
  if (!row) throw new M5bLinkError(404, "Richiesta non trovata");
  return row;
}

export async function currentM5bDocumentLink(
  tx: InventoryTransaction,
  richiestaId: number,
) {
  const [link] = await tx
    .select()
    .from(richiesteMagazzinoDocumentiTable)
    .where(
      and(
        eq(richiesteMagazzinoDocumentiTable.richiestaId, richiestaId),
        eq(richiesteMagazzinoDocumentiTable.corrente, true),
      ),
    );
  return link ?? null;
}

export async function linkedM5bDocument(
  tx: InventoryTransaction,
  tipo: M5bDocumentType,
  documentoId: number,
) {
  const [link] = await tx
    .select()
    .from(richiesteMagazzinoDocumentiTable)
    .where(
      tipo === "bolla"
        ? eq(richiesteMagazzinoDocumentiTable.bollaId, documentoId)
        : eq(richiesteMagazzinoDocumentiTable.trasferimentoId, documentoId),
    );
  return link ?? null;
}

/** Direct M4 reads must not bypass the currently authorized M5 request. */
export async function canReadLinkedM4Document(
  actor: M5bRequestActor,
  tipo: M5bDocumentType,
  documentoId: number,
) {
  const [link] = await db
    .select({ richiestaId: richiesteMagazzinoDocumentiTable.richiestaId })
    .from(richiesteMagazzinoDocumentiTable)
    .where(
      tipo === "bolla"
        ? eq(richiesteMagazzinoDocumentiTable.bollaId, documentoId)
        : eq(richiesteMagazzinoDocumentiTable.trasferimentoId, documentoId),
    );
  if (!link) return true;
  const [row] = await db
    .select()
    .from(richiesteMagazzinoTable)
    .where(eq(richiesteMagazzinoTable.id, link.richiestaId));
  return Boolean(row && canReadM5bRequest(actor, row));
}

/** Exclude unreadable linked documents before M4 count and pagination. */
export function m5bLinkedM4ListScope(
  actor: M5bRequestActor,
  tipo: M5bDocumentType,
  documentId: Column | SQL,
) {
  const linkColumn =
    tipo === "bolla"
      ? richiesteMagazzinoDocumentiTable.bollaId
      : richiesteMagazzinoDocumentiTable.trasferimentoId;
  const relation = sql`${linkColumn} = ${documentId}`;
  const linked = db
    .select({ id: richiesteMagazzinoDocumentiTable.id })
    .from(richiesteMagazzinoDocumentiTable)
    .where(relation);
  const allowed = db
    .select({ id: richiesteMagazzinoDocumentiTable.id })
    .from(richiesteMagazzinoDocumentiTable)
    .innerJoin(
      richiesteMagazzinoTable,
      eq(
        richiesteMagazzinoDocumentiTable.richiestaId,
        richiesteMagazzinoTable.id,
      ),
    )
    .where(and(relation, m5bRequestScopePredicate(actor)));
  return or(notExists(linked), exists(allowed))!;
}

/** Called before locking the M4 document: request -> link -> M4 document. */
export async function guardLinkedM4Mutation(
  tx: InventoryTransaction,
  req: Request,
  tipo: M5bDocumentType,
  documentoId: number,
  options?: { allowHistoricalCancellationReplay?: boolean },
) {
  const observed = await linkedM5bDocument(tx, tipo, documentoId);
  if (!observed) return null;
  const actor = await requireCurrentM5bActor(
    tx,
    req.user!.id,
    "richieste_magazzino.prepare",
  );
  if (
    !actor.isAdmin &&
    (!(actor.aree ?? []).includes("magazzino") ||
      !(actor.permessi ?? []).includes("richieste_magazzino.view"))
  )
    throw new M5bLinkError(403, "Preparazione richiesta non autorizzata");
  const richiesta = await lockM5bRequest(tx, observed.richiestaId);
  if (!canReadM5bRequest(actor, richiesta))
    throw new M5bLinkError(404, "Documento non trovato nel perimetro");
  const link = await linkedM5bDocument(tx, tipo, documentoId);
  if (!link || link.id !== observed.id)
    throw new M5bLinkError(409, "Collegamento documento cambiato; ricarica");
  // An annulled document keeps its historical link. Only cancellation may
  // reach the M4 receipt lookup again; all other writes remain forbidden.
  if (!link.corrente) {
    if (options?.allowHistoricalCancellationReplay) return null;
    throw new M5bLinkError(409, "Collegamento documento cessato; ricarica");
  }
  if (richiesta.stato !== "presa_in_carico")
    throw new M5bLinkError(409, "Richiesta non più preparabile");
  return { richiesta, link, actor };
}

/** Same transaction as the successful M4 pre-exit cancellation. */
export async function ceaseLinkedM4Document(
  tx: InventoryTransaction,
  req: Request,
  guarded: Awaited<ReturnType<typeof guardLinkedM4Mutation>>,
  motivo: string,
) {
  if (!guarded) return;
  const { richiesta, link, actor } = guarded;
  const [ceased] = await tx
    .update(richiesteMagazzinoDocumentiTable)
    .set({
      corrente: false,
      cessatoDa: actor.id,
      cessatoAt: new Date(),
      eventoCessazione: "annullamento_m4",
      motivoCessazione: motivo,
    })
    .where(
      and(
        eq(richiesteMagazzinoDocumentiTable.id, link.id),
        eq(richiesteMagazzinoDocumentiTable.corrente, true),
      ),
    )
    .returning({ id: richiesteMagazzinoDocumentiTable.id });
  if (!ceased)
    throw new M5bLinkError(409, "Collegamento già cessato; ricarica");
  await tx
    .update(richiesteMagazzinoTable)
    .set({
      versione: richiesta.versione + 1,
      dataAggiornamento: new Date(),
    })
    .where(eq(richiesteMagazzinoTable.id, richiesta.id));
  await recordAuditEvent(tx, {
    command: auditContextFromRequest(req, {
      operationKey: `m5b:documento-annullato:${link.id}`,
    }),
    azione: "richiesta_magazzino.documento_annullato",
    entitaTipo: "richiesta_magazzino",
    entitaId: richiesta.id,
    areaOperativaIdSnapshot: richiesta.areaOperativaId,
    centroAscoltoIdSnapshot: richiesta.centroAscoltoId,
    motivo,
    changes: auditFields(
      {
        versione: richiesta.versione + 1,
        relazioneId: link.id,
        tipoDocumento: link.tipoDocumento,
      },
      ["versione", "relazioneId", "tipoDocumento"],
    ),
  });
}

/** Prevent a linked document from being retargeted by a direct M4 endpoint. */
export async function assertLinkedM4Identity(
  tx: InventoryTransaction,
  guarded: Awaited<ReturnType<typeof guardLinkedM4Mutation>>,
  document:
    | typeof bolleTable.$inferSelect
    | typeof trasferimentiTable.$inferSelect,
  changes: Record<string, unknown>,
) {
  if (!guarded) return;
  const protectedKeys =
    guarded.link.tipoDocumento === "bolla"
      ? [
          "tipoDestinatario",
          "beneficiarioId",
          "enteDestinatarioId",
          "magazzinoId",
        ]
      : ["magazzinoOrigineId", "magazzinoDestinoId"];
  if (
    protectedKeys.some(
      (key) =>
        key in changes &&
        changes[key] !== document[key as keyof typeof document],
    )
  )
    throw new M5bLinkError(
      409,
      "Per cambiare destinatario o Magazzino annulla prima il documento collegato",
    );
  // The row is locked by the caller after guardLinkedM4Mutation.
  void tx;
}
