import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { z } from "@workspace/api-zod";
import {
  bolleTable,
  db,
  magazziniTable,
  richiesteMagazzinoTable,
  richiesteMagazzinoDocumentiTable,
  trasferimentiTable,
  type RichiestaMagazzino,
} from "@workspace/db";
import {
  auditContextFromRequest,
  auditFields,
  recordAuditEvent,
} from "../lib/auditEvent";
import { createBollaDraftTx } from "../lib/bollaDraft";
import { canAccessAreaOperativa, canAccessCentro } from "../lib/centroScope";
import {
  CurrentCommandActorError,
} from "../lib/currentCommandActor";
import {
  commandRequestHash,
  isDocumentCommandError,
  loadDocumentCommand,
  lockDocumentCommand,
  requireIdempotencyKey,
  storeDocumentCommand,
  validateDocumentCommand,
} from "../lib/documentCommand";
import { withDocumentCodeRetry } from "../lib/documentCode";
import { isModuloAttivo, requireModulo } from "../lib/featureFlags";
import { dataCivileEuropeRome } from "../lib/interventiWorkflow";
import {
  InventoryLedgerError,
  requireOperationalMagazzino,
} from "../lib/inventoryLedger";
import { InventoryDecimal } from "../lib/inventoryDecimal";
import {
  lockInterventionMaterialPath,
  delegateInterventionToM4,
  M5bDelegationError,
} from "../lib/m5bInterventionDelegation";
import {
  canReadM5bRequest as canRead,
  requireCurrentM5bActor,
} from "../lib/m5bRequestAccess";
import {
  currentM5bDocumentLink,
  linkedM5bDocument,
  lockM5bRequest,
  M5bLinkError,
  requestDocumentSummaries,
} from "../lib/m5bDocumentLink";
import {
  createTransferRequestTx,
  TransferRequestError,
} from "../lib/transferWorkflow";
import { requireLiveSubject } from "./richieste-magazzino";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/richieste-magazzino", requireModulo("MAGAZZINO_SOLIDALE"));

const rowSchema = z.strictObject({
  prodottoId: z.number().int().positive(),
  lottoId: z.number().int().positive().nullable().optional(),
  quantita: z.union([z.string().min(1), z.number().positive()]),
  unitaMisura: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
const createSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(1).max(120),
  versione: z.number().int().positive(),
  magazzinoId: z.number().int().positive(),
  righe: z.array(rowSchema).optional(),
});

class M5bCommandError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

function requestId(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new M5bCommandError(400, "ID richiesta non valido");
  return Number(value);
}

function hasPermission(
  actor: { isAdmin: boolean; permessi: string[] | null },
  key: string,
) {
  return actor.isAdmin || (actor.permessi ?? []).includes(key);
}

function quantityForHash(value: string | number) {
  try {
    return InventoryDecimal.parse(value).toCanonical();
  } catch {
    throw new M5bCommandError(400, "Quantità documento non valida");
  }
}

function canPrepare(
  actor: Awaited<ReturnType<typeof requireCurrentM5bActor>>,
  row: RichiestaMagazzino,
) {
  return (
    canRead(actor, row) &&
    (actor.isAdmin || (actor.aree ?? []).includes("magazzino")) &&
    hasPermission(actor, "richieste_magazzino.view")
  );
}

function errorResponse(res: Response, error: unknown, correlationId: string) {
  if (
    error instanceof M5bCommandError ||
    error instanceof M5bLinkError ||
    error instanceof M5bDelegationError ||
    error instanceof CurrentCommandActorError ||
    error instanceof TransferRequestError ||
    error instanceof InventoryLedgerError ||
    isDocumentCommandError(error)
  ) {
    const status =
      error instanceof CurrentCommandActorError ? 403 : error.status;
    res.status(status).json({ error: error.message, correlationId });
    return;
  }
  let cause: unknown = error;
  for (
    let index = 0;
    index < 6 && cause && typeof cause === "object";
    index += 1
  ) {
    const candidate = cause as { code?: unknown; cause?: unknown };
    if (candidate.code === "23505") {
      res.status(409).json({
        error: "Documento o collegamento già creato; ricarica la richiesta",
        correlationId,
      });
      return;
    }
    cause = candidate.cause;
  }
  throw error;
}

router.get(
  "/richieste-magazzino/:id/documenti",
  requirePermission("richieste_magazzino.view"),
  async (req, res) => {
    const correlationId = randomUUID();
    try {
      const id = requestId(req.params.id as string);
      const [row] = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, id));
      if (!row || !canRead(req.user!, row))
        throw new M5bCommandError(404, "Richiesta non trovata");
      const grouped = await requestDocumentSummaries([id], {
        bolla:
          req.user!.isAdmin ||
          (req.user!.permessi ?? []).includes("bolle.view"),
        trasferimento:
          req.user!.isAdmin ||
          (req.user!.permessi ?? []).includes("magazzino.view"),
        areaOperativaId: req.user!.areaOperativaId,
        centroAscoltoId: req.user!.centroAscoltoId,
      });
      const documents = grouped.get(id) ?? [];
      res.json({
        corrente: documents.find((item) => item.corrente) ?? null,
        precedenti: documents.filter((item) => !item.corrente),
      });
    } catch (error) {
      errorResponse(res, error, correlationId);
    }
  },
);

router.get(
  "/documenti-operativi/:tipo/:id/richiesta",
  requireModulo("MAGAZZINO_SOLIDALE"),
  requirePermission("richieste_magazzino.view"),
  async (req, res) => {
    const correlationId = randomUUID();
    try {
      const tipo = req.params.tipo;
      if (tipo !== "bolla" && tipo !== "trasferimento")
        throw new M5bCommandError(400, "Tipo documento non valido");
      const id = requestId(req.params.id as string);
      if (
        !hasPermission(
          req.user!,
          tipo === "bolla" ? "bolle.view" : "magazzino.view",
        )
      )
        throw new M5bCommandError(403, "Documento non accessibile");
      const link = await db.transaction((tx) =>
        linkedM5bDocument(tx, tipo, id),
      );
      if (!link) {
        res.json({ richiesta: null });
        return;
      }
      const warehouseIds =
        tipo === "bolla"
          ? (
              await db
                .select({ origin: bolleTable.magazzinoId })
                .from(bolleTable)
                .where(eq(bolleTable.id, id))
            ).map((item) => item.origin)
          : (
              await db
                .select({
                  origin: trasferimentiTable.magazzinoOrigineId,
                  destination: trasferimentiTable.magazzinoDestinoId,
                })
                .from(trasferimentiTable)
                .where(eq(trasferimentiTable.id, id))
            ).flatMap((item) => [item.origin, item.destination]);
      const warehouses =
        warehouseIds.length > 0
          ? await db
              .select({
                areaOperativaId: magazziniTable.areaOperativaId,
                centroAscoltoId: magazziniTable.centroAscoltoId,
              })
              .from(magazziniTable)
              .where(inArray(magazziniTable.id, warehouseIds))
          : [];
      if (
        !warehouses.some(
          (warehouse) =>
            canAccessAreaOperativa(
              warehouse.areaOperativaId,
              req.user!.areaOperativaId,
            ) &&
            canAccessCentro(
              warehouse.centroAscoltoId,
              req.user!.centroAscoltoId,
            ),
        )
      )
        throw new M5bCommandError(404, "Documento non trovato nel perimetro");
      const [row] = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, link.richiestaId));
      if (!row || !canRead(req.user!, row))
        throw new M5bCommandError(404, "Richiesta non trovata nel perimetro");
      res.json({
        richiesta: {
          id: row.id,
          codice: row.codice,
          percorso: `/richieste-magazzino?richiestaId=${row.id}`,
        },
      });
    } catch (error) {
      errorResponse(res, error, correlationId);
    }
  },
);

router.post(
  "/richieste-magazzino/:id/documento",
  requirePermission("richieste_magazzino.prepare"),
  async (req, res) => {
    const correlationId = randomUUID();
    try {
      const id = requestId(req.params.id as string);
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success)
        throw new M5bCommandError(400, "Comando documento non valido");
      const input = parsed.data;
      const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
      const tipoComando = "RICHIESTA_MAGAZZINO_DOCUMENTO_CREA";
      const requestHash = commandRequestHash({
        richiestaId: id,
        versione: input.versione,
        magazzinoId: input.magazzinoId,
        righe:
          input.righe?.map((r) => ({
            prodottoId: r.prodottoId,
            lottoId: r.lottoId ?? null,
            quantita: quantityForHash(r.quantita),
            unitaMisura: r.unitaMisura?.trim() ?? null,
            note: r.note?.trim() ?? null,
          })) ?? null,
      });
      // The retry wraps the whole transaction, including relation, audit and receipt.
      const result = await withDocumentCodeRetry("TRASM", (code) =>
        db.transaction(async (tx) => {
          await lockDocumentCommand(tx, tipoComando, idempotencyKey);
          const actor = await requireCurrentM5bActor(
            tx,
            req.user!.id,
            "richieste_magazzino.prepare",
          );
          if (!(await isModuloAttivo("MAGAZZINO_SOLIDALE")))
            throw new M5bCommandError(403, "Modulo Magazzino non disponibile");
          const receipt = await loadDocumentCommand(tx, {
            tipoComando,
            idempotencyKey,
          });
          const [visible] = await tx
            .select()
            .from(richiesteMagazzinoTable)
            .where(eq(richiesteMagazzinoTable.id, id));
          if (!visible || !canPrepare(actor, visible))
            throw new M5bCommandError(
              404,
              "Richiesta non trovata nel perimetro",
            );
          const replayType =
            visible.tipoDestinatario === "magazzino"
              ? "trasferimento"
              : "bolla";
          const replayModule =
            replayType === "bolla" ? "BOLLE" : "TRASFERIMENTI";
          const replayGrant =
            replayType === "bolla"
              ? "bolle.manage"
              : "magazzino.transfers.create";
          if (
            !(await isModuloAttivo(replayModule)) ||
            !hasPermission(actor, replayGrant)
          )
            throw new M5bCommandError(
              403,
              "Modulo o permesso del documento non disponibile",
            );
          if (receipt) {
            validateDocumentCommand(receipt, {
              tipoComando,
              idempotencyKey,
              requestHash,
              actorUserId: actor.id,
              aggregatoTipo: "richiesta_magazzino",
              aggregatoId: id,
            });
            return { ...receipt.resultSnapshot, replay: true };
          }
          if (visible.interventoId != null)
            await lockInterventionMaterialPath(tx, visible.interventoId);
          const row = await lockM5bRequest(tx, id);
          if (!canPrepare(actor, row))
            throw new M5bCommandError(
              404,
              "Richiesta non trovata nel perimetro",
            );
          if (row.versione !== input.versione)
            throw new M5bCommandError(
              409,
              "Versione richiesta superata; ricarica",
            );
          if (row.stato !== "presa_in_carico")
            throw new M5bCommandError(
              409,
              "La richiesta non è presa in carico",
            );
          if (await currentM5bDocumentLink(tx, id))
            throw new M5bCommandError(
              409,
              "Documento già presente: apri quello corrente",
            );
          const tipo = replayType;
          if (tipo === "bolla" && input.righe != null)
            throw new M5bCommandError(
              400,
              "Le righe della Bolla si compilano nell'editor M4",
            );
          if (
            tipo === "trasferimento" &&
            (!input.righe || input.righe.length === 0)
          )
            throw new M5bCommandError(
              400,
              "Il Trasferimento richiede almeno una riga",
            );
          const warehouse = await requireOperationalMagazzino(
            tx,
            input.magazzinoId,
          );
          if (
            warehouse.areaOperativaId !== row.areaOperativaId ||
            !canAccessCentro(warehouse.centroAscoltoId, row.centroAscoltoId) ||
            !canAccessCentro(
              warehouse.centroAscoltoId,
              actor.centroAscoltoId,
            ) ||
            (actor.areaOperativaId != null &&
              actor.areaOperativaId !== warehouse.areaOperativaId)
          )
            throw new M5bCommandError(
              403,
              "Magazzino non ammesso per questa richiesta",
            );
          if (
            tipo === "trasferimento" &&
            row.magazzinoDestinatarioId === warehouse.id
          )
            throw new M5bCommandError(
              400,
              "Origine e destinazione devono essere diverse",
            );
          if (tipo === "trasferimento") {
            const destination = await requireOperationalMagazzino(
              tx,
              row.magazzinoDestinatarioId!,
            );
            if (
              destination.areaOperativaId !== row.areaOperativaId ||
              !canAccessCentro(
                destination.centroAscoltoId,
                actor.centroAscoltoId,
              )
            )
              throw new M5bCommandError(
                403,
                "Destinazione non ammessa per questo operatore",
              );
          }
          await requireLiveSubject(tx, row);
          const delegated =
            row.interventoId != null
              ? await delegateInterventionToM4(tx, {
                  interventoId: row.interventoId,
                  beneficiarioId: row.beneficiarioId!,
                  richiestaId: id,
                  actorId: actor.id,
                })
              : false;
          const command = auditContextFromRequest(req, {
            correlationId,
            operationKey: `m5b:${tipoComando}:${idempotencyKey}`,
          });
          if (delegated && row.interventoId != null)
            await recordAuditEvent(tx, {
              command,
              azione: "intervento.materiali_delegati_m4",
              entitaTipo: "intervento",
              entitaId: row.interventoId,
              areaOperativaIdSnapshot: row.areaOperativaId,
              centroAscoltoIdSnapshot: row.centroAscoltoId,
              changes: auditFields({ richiestaId: id }, ["richiestaId"]),
            });
          const today = dataCivileEuropeRome(new Date());
          const document =
            tipo === "bolla"
              ? await createBollaDraftTx(tx, {
                  dataBolla: today,
                  tipoDestinatario: row.tipoDestinatario,
                  beneficiarioId: row.beneficiarioId,
                  enteDestinatarioId: row.enteDestinatarioId,
                  magazzinoId: warehouse.id,
                  operatoreId: actor.id,
                  areaOperativaIdSnapshot:
                    row.tipoDestinatario === "ente"
                      ? row.areaOperativaId
                      : null,
                  centroAscoltoIdSnapshot: null,
                  destinatarioSnapshotCongelato: false,
                })
              : await createTransferRequestTx(
                  tx,
                  {
                    magazzinoOrigineId: warehouse.id,
                    magazzinoDestinoId: row.magazzinoDestinatarioId!,
                    dataRichiesta: today,
                    operatoreId: actor.id,
                    audit: command,
                    righe: input.righe!,
                  },
                  code,
                );
          const [link] = await tx
            .insert(richiesteMagazzinoDocumentiTable)
            .values({
              richiestaId: id,
              tipoDocumento: tipo,
              bollaId: tipo === "bolla" ? document.id : null,
              trasferimentoId: tipo === "trasferimento" ? document.id : null,
              creatoDa: actor.id,
            })
            .returning();
          const [updated] = await tx
            .update(richiesteMagazzinoTable)
            .set({ versione: row.versione + 1, dataAggiornamento: new Date() })
            .where(eq(richiesteMagazzinoTable.id, id))
            .returning();
          if (tipo === "bolla")
            await recordAuditEvent(tx, {
              command,
              azione: "BOLLA_CREATA",
              entitaTipo: "bolla",
              entitaId: document.id,
              documentoTipo: "bolla",
              documentoId: document.id,
              areaOperativaIdSnapshot: row.areaOperativaId,
              centroAscoltoIdSnapshot: row.centroAscoltoId,
              magazzinoIdSnapshot: warehouse.id,
              dataOperativa: today,
              changes: auditFields({ statoNuovo: "bozza" }, ["statoNuovo"]),
            });
          await recordAuditEvent(tx, {
            command,
            azione: "richiesta_magazzino.documento_creato",
            entitaTipo: "richiesta_magazzino",
            entitaId: id,
            areaOperativaIdSnapshot: row.areaOperativaId,
            centroAscoltoIdSnapshot: row.centroAscoltoId,
            changes: auditFields(
              {
                relazioneId: link.id,
                tipoDocumento: tipo,
                versione: updated.versione,
                delegaIntervento: delegated,
              },
              ["relazioneId", "tipoDocumento", "versione", "delegaIntervento"],
            ),
          });
          const snapshot = {
            richiestaId: id,
            codiceRichiesta: row.codice,
            versioneRichiesta: updated.versione,
            tipoDocumento: tipo,
            documentoId: document.id,
            codiceDocumento:
              tipo === "bolla"
                ? "numeroBolla" in document
                  ? document.numeroBolla
                  : null
                : "codice" in document
                  ? document.codice
                  : null,
            versioneDocumento: document.versione,
            percorsoDocumento:
              tipo === "bolla"
                ? `/bolle?bollaId=${document.id}`
                : `/trasferimenti?trasferimentoId=${document.id}`,
          };
          await storeDocumentCommand(tx, {
            tipoComando,
            idempotencyKey,
            requestHash,
            aggregatoTipo: "richiesta_magazzino",
            aggregatoId: id,
            versioneRichiesta: row.versione,
            versioneRisultante: updated.versione,
            resultSnapshot: snapshot,
            actorUserId: actor.id,
          });
          return { ...snapshot, replay: false };
        }),
      );
      res.status(result.replay ? 200 : 201).json(result);
    } catch (error) {
      errorResponse(res, error, correlationId);
    }
  },
);

export default router;
