import type { Request, Response } from "express";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import {
  db,
  beneficiariTable,
  centriAscoltoTable,
  areeOperativeTable,
  consegneTable,
} from "@workspace/db";
import {
  requireCurrentCommandActor,
  CurrentCommandActorError,
} from "./currentCommandActor";
import {
  beneficiarioAccessScopeFromRequest,
  canAccessBeneficiarioScope,
} from "./beneficiarioPolicy";
import { zonaUdsScopeFilter } from "./centroScope";
import { emporioValidCardCondition } from "./emporioBeneficiarySearch";

class LookupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const positiveId = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : typeof value === "string" &&
        /^[1-9][0-9]*$/.test(value) &&
        Number.isSafeInteger(Number(value))
      ? Number(value)
      : null;
const projection = {
  id: beneficiariTable.id,
  nome: beneficiariTable.nome,
  cognome: beneficiariTable.cognome,
  codice: beneficiariTable.codice,
  areaOperativaId: beneficiariTable.areaOperativaId,
  centroAscoltoId: beneficiariTable.centroAscoltoId,
  consegnaDomicilio: beneficiariTable.consegnaDomicilio,
};

/** Lookup minimo del comando Bolla: nessun dossier o effetto operativo. */
export async function bollaBeneficiariLookup(
  req: Request,
  res: Response,
  mode: "search" | "card" | "locked",
) {
  try {
    const input = mode === "card" ? (req.body ?? {}) : req.query;
    const areaId = positiveId(input.areaOperativaId);
    const centroId = positiveId(input.centroAscoltoId);
    const page = input.page === undefined ? 1 : positiveId(input.page);
    const limit = input.limit === undefined ? 50 : positiveId(input.limit);
    const card = input.codiceTessera;
    const search: string =
      typeof input.search === "string" ? input.search.trim() : "";
    if (mode !== "locked" && (!areaId || !centroId))
      throw new LookupError(400, "Seleziona Area e Centro di Ascolto");
    if (!page || !limit || limit > 100 || page > 1000000)
      throw new LookupError(400, "Paginazione non valida");
    if (
      mode === "search" &&
      input.search !== undefined &&
      (typeof input.search !== "string" ||
        search.length < 2 ||
        search.length > 200)
    )
      throw new LookupError(400, "Ricerca non valida");
    if (
      mode === "card" &&
      (typeof card !== "string" || !card.length || card.length > 256)
    )
      throw new LookupError(400, "Tessera non valida");
    const result = await db.transaction(async (tx) => {
      const actor = await requireCurrentCommandActor(
        tx,
        req.user!.id,
        "bolle.manage",
      );
      if (!actor.isAdmin && !actor.aree.includes("magazzino"))
        throw new LookupError(403, "Operazione riservata al Magazzino");
      const caller = beneficiarioAccessScopeFromRequest(req);
      const scope = {
        areaOperativaId: actor.areaOperativaId,
        centroAscoltoId: actor.centroAscoltoId,
        zonaUdsId: actor.zonaUdsId,
      };
      if (mode === "locked") {
        const id = positiveId(req.params.id),
          consegnaId = positiveId(input.consegnaId);
        if (!id || !consegnaId)
          throw new LookupError(400, "Consegna e beneficiario non validi");
        const [delivery] = await tx
          .select({ id: consegneTable.id })
          .from(consegneTable)
          .where(
            and(
              eq(consegneTable.id, consegnaId),
              eq(consegneTable.beneficiarioId, id),
            ),
          );
        const [person] = delivery
          ? await tx
              .select({ ...projection, zonaUdsId: beneficiariTable.zonaUdsId })
              .from(beneficiariTable)
              .where(
                and(
                  eq(beneficiariTable.id, id),
                  eq(beneficiariTable.attivo, true),
                ),
              )
          : [];
        if (
          !person ||
          !canAccessBeneficiarioScope(person, caller) ||
          !canAccessBeneficiarioScope(person, scope)
        )
          throw new LookupError(
            403,
            "Destinatario della Consegna non accessibile",
          );
        const { zonaUdsId: _zona, ...candidate } = person;
        return candidate;
      }
      const context = {
        areaOperativaId: areaId!,
        centroAscoltoId: centroId!,
        zonaUdsId: null,
      };
      // Il vincolo Zona è applicato alle persone, non al contenitore Area/Centro.
      if (
        (caller.areaOperativaId != null && caller.areaOperativaId !== areaId) ||
        (caller.centroAscoltoId != null &&
          caller.centroAscoltoId !== centroId) ||
        (scope.areaOperativaId != null && scope.areaOperativaId !== areaId) ||
        (scope.centroAscoltoId != null && scope.centroAscoltoId !== centroId)
      )
        throw new LookupError(403, "Contesto fuori dal perimetro autorizzato");
      const [centre] = await tx
        .select({ id: centriAscoltoTable.id })
        .from(centriAscoltoTable)
        .innerJoin(
          areeOperativeTable,
          eq(areeOperativeTable.id, centriAscoltoTable.areaOperativaId),
        )
        .where(
          and(
            eq(centriAscoltoTable.id, centroId!),
            eq(areeOperativeTable.id, areaId!),
            eq(centriAscoltoTable.attivo, true),
            eq(areeOperativeTable.attivo, true),
          ),
        );
      if (!centre)
        throw new LookupError(
          400,
          "Area e Centro devono essere attivi e coerenti",
        );
      const terms = search
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => {
          const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
          return or(
            ilike(beneficiariTable.nome, pattern),
            ilike(beneficiariTable.cognome, pattern),
            ilike(beneficiariTable.codice, pattern),
          );
        });
      const rows = await tx
        .select(projection)
        .from(beneficiariTable)
        .where(
          and(
            eq(beneficiariTable.attivo, true),
            eq(beneficiariTable.areaOperativaId, context.areaOperativaId),
            // Centro NULL resta visibile altrove, ma non è un destinatario del Centro scelto.
            eq(beneficiariTable.centroAscoltoId, context.centroAscoltoId),
            zonaUdsScopeFilter(beneficiariTable.zonaUdsId, caller.zonaUdsId),
            zonaUdsScopeFilter(beneficiariTable.zonaUdsId, scope.zonaUdsId),
            mode === "card" ? emporioValidCardCondition(card) : and(...terms),
          ),
        )
        .orderBy(
          asc(beneficiariTable.cognome),
          asc(beneficiariTable.nome),
          asc(beneficiariTable.id),
        )
        .limit(mode === "card" ? 1 : limit)
        .offset(mode === "card" ? 0 : (page - 1) * limit);
      if (mode === "card" && !rows.length)
        throw new LookupError(
          404,
          "Tessera non valida o non appartenente al Centro selezionato",
        );
      return mode === "card" ? rows[0] : rows;
    });
    res.json(result);
  } catch (error) {
    if (
      error instanceof LookupError ||
      error instanceof CurrentCommandActorError
    ) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
}
