import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "@workspace/api-zod";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  areeOperativeTable,
  auditEventiTable,
  beneficiariTable,
  centriAscoltoTable,
  db,
  entiDestinatariTable,
  interventiTable,
  magazziniTable,
  richiesteMagazzinoTable,
  type RichiestaMagazzino,
} from "@workspace/db";
import { requireModulo, isModuloAttivo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import { isCivilDate } from "../lib/civilDate";
import {
  commandRequestHash,
  lockDocumentCommand,
  loadDocumentCommand,
  requireIdempotencyKey,
  storeDocumentCommand,
  validateDocumentCommand,
  isDocumentCommandError,
} from "../lib/documentCommand";
import {
  requireCurrentCommandActor,
  CurrentCommandActorError,
} from "../lib/currentCommandActor";
import {
  auditContextFromRequest,
  auditFields,
  recordAuditEvent,
} from "../lib/auditEvent";
import type { InventoryTransaction } from "../lib/scaricoInventory";

const router: IRouter = Router();
router.use("/richieste-magazzino", requireModulo("MAGAZZINO_SOLIDALE"));
router.use("/richieste-magazzino", async (req, res, next) => {
  if (
    req.user &&
    !hasArea(req.user, "magazzino") &&
    hasArea(req.user, "sociale") &&
    !(await isModuloAttivo("CENTRO_ASCOLTO"))
  ) {
    res.status(403).json({
      code: "RICHIESTA_MODULO_NON_DISPONIBILE",
      error: "Modulo Centro di Ascolto non disponibile",
    });
    return;
  }
  next();
});

const positive = z.number().int().positive();
const date = z.string().refine(isCivilDate, "Data civile non valida");
const priority = z.enum(["bassa", "normale", "alta", "urgente"]);
const modality = z.enum(["da_definire", "ritiro", "domicilio"]);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const envelope = { idempotencyKey: requiredText(120) };
const content = {
  bisogno: requiredText(2000),
  noteOperative: optionalText(2000),
  priorita: priority.default("normale"),
  dataDesiderata: date.nullable().optional(),
  modalitaPreferita: modality.default("da_definire"),
};
const createSchema = z.strictObject({
  ...envelope,
  tipoDestinatario: z.enum(["beneficiario", "ente", "magazzino"]),
  beneficiarioId: positive.optional(),
  enteDestinatarioId: positive.optional(),
  magazzinoDestinatarioId: positive.optional(),
  interventoId: positive.optional(),
  areaOperativaId: positive.optional(),
  centroAscoltoId: positive.optional(),
  sorgente: z.enum(["beneficiario", "intervento_sociale", "operativa"]),
  ...content,
});
const updateSchema = z.strictObject({
  ...envelope,
  versione: positive,
  bisogno: requiredText(2000).optional(),
  noteOperative: optionalText(2000),
  priorita: priority.optional(),
  dataDesiderata: date.nullable().optional(),
  modalitaPreferita: modality.optional(),
});
const takeSchema = z.strictObject({ ...envelope, versione: positive });
const cancelSchema = z.strictObject({
  ...envelope,
  versione: positive,
  motivo: requiredText(500),
});
type Create = z.infer<typeof createSchema>;
type Actor = Awaited<ReturnType<typeof requireCurrentCommandActor>>;

class RequestError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const invalid = (message: string) =>
  new RequestError(400, "RICHIESTA_INPUT_INVALIDO", message);
const denied = () =>
  new RequestError(
    403,
    "RICHIESTA_NON_AUTORIZZATA",
    "Richiesta non autorizzata",
  );
const missing = () =>
  new RequestError(404, "RICHIESTA_NON_TROVATA", "Richiesta non trovata");
const conflict = (message: string) =>
  new RequestError(409, "RICHIESTA_CONFLITTO", message);

function sendError(res: Response, error: unknown, correlationId: string) {
  if (error instanceof RequestError) {
    res
      .status(error.status)
      .json({ code: error.code, error: error.message, correlationId });
  } else if (isDocumentCommandError(error)) {
    res.status(error.status).json({
      code: "RICHIESTA_COMANDO_INVALIDO",
      error: error.message,
      correlationId,
    });
  } else if (error instanceof CurrentCommandActorError) {
    res.status(403).json({
      code: "RICHIESTA_NON_AUTORIZZATA",
      error: error.message,
      correlationId,
    });
  } else if (databaseCode(error) === "23505") {
    res.status(409).json({
      code: "RICHIESTA_GIA_ATTIVA",
      error: "Esiste già una richiesta attiva per questo Intervento o comando",
      correlationId,
    });
  } else {
    throw error;
  }
}

function databaseCode(error: unknown): string | null {
  let current = error;
  for (let i = 0; i < 6 && current && typeof current === "object"; i += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return null;
}

function hasGrant(
  actor: { isAdmin: boolean; permessi: string[] | null },
  permission: string,
) {
  return actor.isAdmin || (actor.permessi ?? []).includes(permission);
}
function hasArea(
  actor: { isAdmin: boolean; aree: string[] | null },
  area: string,
) {
  return actor.isAdmin || (actor.aree ?? []).includes(area);
}
function canRead(
  actor: {
    isAdmin: boolean;
    permessi: string[] | null;
    aree: string[] | null;
    areaOperativaId: number | null;
    centroAscoltoId: number | null;
    zonaUdsId: number | null;
  },
  row: RichiestaMagazzino,
) {
  if (!hasGrant(actor, "richieste_magazzino.view")) return false;
  if (
    actor.areaOperativaId != null &&
    actor.areaOperativaId !== row.areaOperativaId
  )
    return false;
  if (
    actor.centroAscoltoId != null &&
    actor.centroAscoltoId !== row.centroAscoltoId
  )
    return false;
  if (hasArea(actor, "magazzino")) return true;
  if (actor.zonaUdsId != null && actor.zonaUdsId !== row.zonaUdsIdSnapshot)
    return false;
  return (
    hasArea(actor, "sociale") &&
    row.tipoDestinatario === "beneficiario" &&
    (actor.centroAscoltoId == null ||
      actor.centroAscoltoId === row.centroAscoltoId)
  );
}
function canSocialWrite(actor: Actor, row: RichiestaMagazzino) {
  return (
    hasArea(actor, "sociale") &&
    row.tipoDestinatario === "beneficiario" &&
    (actor.centroAscoltoId == null ||
      actor.centroAscoltoId === row.centroAscoltoId) &&
    (actor.zonaUdsId == null || actor.zonaUdsId === row.zonaUdsIdSnapshot)
  );
}
function actorFromRequest(req: Request) {
  if (!req.user) throw denied();
  return req.user;
}
function view(
  row: RichiestaMagazzino,
  actor: {
    isAdmin: boolean;
    aree: string[] | null;
    permessi: string[] | null;
    zonaUdsId: number | null;
  },
) {
  return {
    ...row,
    // The origin link is only available to a caller who can read social interventions.
    interventoId:
      hasArea(actor, "sociale") &&
      hasGrant(actor, "sociale.interventi.view") &&
      (actor.zonaUdsId == null || actor.zonaUdsId === row.zonaUdsIdSnapshot)
        ? row.interventoId
        : null,
  };
}
function commandResult(row: RichiestaMagazzino) {
  return {
    id: row.id,
    codice: row.codice,
    stato: row.stato,
    versione: row.versione,
  };
}
function parseId(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw invalid("ID non valido");
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw invalid("ID non valido");
  return id;
}
function scopePredicate(req: Request): SQL {
  const user = actorFromRequest(req);
  const parts: SQL[] = [];
  if (user.areaOperativaId != null)
    parts.push(
      eq(richiesteMagazzinoTable.areaOperativaId, user.areaOperativaId),
    );
  if (user.centroAscoltoId != null)
    parts.push(
      eq(richiesteMagazzinoTable.centroAscoltoId, user.centroAscoltoId),
    );
  if (!hasArea(user, "magazzino")) {
    if (!hasArea(user, "sociale")) return sql`false`;
    parts.push(eq(richiesteMagazzinoTable.tipoDestinatario, "beneficiario"));
    if (user.centroAscoltoId != null)
      parts.push(
        eq(richiesteMagazzinoTable.centroAscoltoId, user.centroAscoltoId),
      );
    if (user.zonaUdsId != null)
      parts.push(eq(richiesteMagazzinoTable.zonaUdsIdSnapshot, user.zonaUdsId));
  }
  return and(...parts) ?? sql`true`;
}
async function requireLiveSubject(
  tx: InventoryTransaction,
  row: RichiestaMagazzino,
) {
  if (row.tipoDestinatario === "beneficiario") {
    const [beneficiary] = await tx
      .select({
        id: beneficiariTable.id,
        attivo: beneficiariTable.attivo,
        areaOperativaId: beneficiariTable.areaOperativaId,
        centroAscoltoId: beneficiariTable.centroAscoltoId,
        zonaUdsId: beneficiariTable.zonaUdsId,
      })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, row.beneficiarioId!))
      .for("share");
    if (
      !beneficiary?.attivo ||
      beneficiary.areaOperativaId !== row.areaOperativaId ||
      beneficiary.centroAscoltoId !== row.centroAscoltoId ||
      beneficiary.zonaUdsId !== row.zonaUdsIdSnapshot
    ) {
      throw conflict(
        "Il contesto del Beneficiario è cambiato; aggiorna l'anagrafica o annulla la richiesta",
      );
    }
    if (row.interventoId != null) {
      const [intervention] = await tx
        .select({
          beneficiarioId: interventiTable.beneficiarioId,
          ambito: interventiTable.ambito,
        })
        .from(interventiTable)
        .where(eq(interventiTable.id, row.interventoId))
        .for("share");
      if (
        !intervention ||
        intervention.ambito !== "sociale" ||
        intervention.beneficiarioId !== row.beneficiarioId
      )
        throw conflict("Intervento origine non più coerente");
    }
  } else if (row.tipoDestinatario === "ente") {
    const [entity] = await tx
      .select({
        attivo: entiDestinatariTable.attivo,
        areaOperativaId: entiDestinatariTable.areaOperativaId,
      })
      .from(entiDestinatariTable)
      .where(eq(entiDestinatariTable.id, row.enteDestinatarioId!))
      .for("share");
    if (!entity?.attivo || entity.areaOperativaId !== row.areaOperativaId)
      throw conflict("Ente destinatario non più operativo nell'Area");
  } else {
    const [warehouse] = await tx
      .select({
        stato: magazziniTable.stato,
        areaOperativaId: magazziniTable.areaOperativaId,
      })
      .from(magazziniTable)
      .where(eq(magazziniTable.id, row.magazzinoDestinatarioId!))
      .for("share");
    if (
      warehouse?.stato !== "attivo" ||
      warehouse.areaOperativaId !== row.areaOperativaId
    )
      throw conflict("Magazzino destinatario non più operativo nell'Area");
  }
  const [area] = await tx
    .select({ attivo: areeOperativeTable.attivo })
    .from(areeOperativeTable)
    .where(eq(areeOperativeTable.id, row.areaOperativaId))
    .for("share");
  if (!area?.attivo) throw conflict("Area Operativa non più attiva");
  if (row.centroAscoltoId != null) {
    const [centre] = await tx
      .select({
        attivo: centriAscoltoTable.attivo,
        areaOperativaId: centriAscoltoTable.areaOperativaId,
      })
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, row.centroAscoltoId))
      .for("share");
    if (!centre?.attivo || centre.areaOperativaId !== row.areaOperativaId)
      throw conflict("Centro richiedente non più operativo nell'Area");
  }
}

async function buildCreate(
  tx: InventoryTransaction,
  actor: Actor,
  input: Create,
) {
  const social = input.tipoDestinatario === "beneficiario";
  if (social) {
    if (
      !hasArea(actor, "sociale") ||
      !hasGrant(actor, "beneficiari.view") ||
      !(await isModuloAttivo("CENTRO_ASCOLTO"))
    )
      throw denied();
    if (
      input.enteDestinatarioId != null ||
      input.magazzinoDestinatarioId != null
    )
      throw invalid("Destinatario incoerente");
    if (
      input.sorgente !== "beneficiario" &&
      input.sorgente !== "intervento_sociale"
    )
      throw invalid("Sorgente non valida");
    if (
      (input.sorgente === "intervento_sociale") !==
      (input.interventoId != null)
    )
      throw invalid("Intervento non coerente con la sorgente");
    let beneficiaryId = input.beneficiarioId;
    if (input.interventoId != null) {
      if (!hasGrant(actor, "sociale.interventi.view")) throw denied();
      const [intervention] = await tx
        .select({
          beneficiarioId: interventiTable.beneficiarioId,
          ambito: interventiTable.ambito,
        })
        .from(interventiTable)
        .where(eq(interventiTable.id, input.interventoId));
      if (!intervention || intervention.ambito !== "sociale") throw missing();
      if (
        beneficiaryId != null &&
        beneficiaryId !== intervention.beneficiarioId
      )
        throw invalid("Beneficiario e Intervento non corrispondono");
      beneficiaryId = intervention.beneficiarioId;
    }
    if (beneficiaryId == null) throw invalid("Beneficiario obbligatorio");
    const [b] = await tx
      .select({
        id: beneficiariTable.id,
        codice: beneficiariTable.codice,
        nome: beneficiariTable.nome,
        cognome: beneficiariTable.cognome,
        numComponenti: beneficiariTable.numComponenti,
        attivo: beneficiariTable.attivo,
        areaOperativaId: beneficiariTable.areaOperativaId,
        centroAscoltoId: beneficiariTable.centroAscoltoId,
        zonaUdsId: beneficiariTable.zonaUdsId,
      })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, beneficiaryId))
      .for("share");
    if (!b) throw missing();
    if (input.interventoId != null) {
      const [lockedIntervention] = await tx
        .select({
          beneficiarioId: interventiTable.beneficiarioId,
          ambito: interventiTable.ambito,
        })
        .from(interventiTable)
        .where(eq(interventiTable.id, input.interventoId))
        .for("share");
      if (
        !lockedIntervention ||
        lockedIntervention.ambito !== "sociale" ||
        lockedIntervention.beneficiarioId !== b.id
      )
        throw conflict("Intervento origine non più coerente");
    }
    if (!b.attivo || b.areaOperativaId == null || b.centroAscoltoId == null)
      throw conflict(
        "Assegna un'Area e un Centro attivi nell'anagrafica del Beneficiario",
      );
    if (
      actor.areaOperativaId != null &&
      actor.areaOperativaId !== b.areaOperativaId
    )
      throw denied();
    if (
      actor.centroAscoltoId != null &&
      actor.centroAscoltoId !== b.centroAscoltoId
    )
      throw denied();
    if (actor.zonaUdsId != null && actor.zonaUdsId !== b.zonaUdsId)
      throw denied();
    if (
      input.areaOperativaId != null &&
      input.areaOperativaId !== b.areaOperativaId
    )
      throw invalid("Area incoerente");
    if (
      input.centroAscoltoId != null &&
      input.centroAscoltoId !== b.centroAscoltoId
    )
      throw invalid("Centro incoerente");
    const [area] = await tx
      .select({
        nome: areeOperativeTable.nome,
        attivo: areeOperativeTable.attivo,
      })
      .from(areeOperativeTable)
      .where(eq(areeOperativeTable.id, b.areaOperativaId))
      .for("share");
    const [centre] = await tx
      .select({
        nome: centriAscoltoTable.nome,
        areaOperativaId: centriAscoltoTable.areaOperativaId,
        attivo: centriAscoltoTable.attivo,
      })
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, b.centroAscoltoId))
      .for("share");
    if (
      !area?.attivo ||
      !centre?.attivo ||
      centre.areaOperativaId !== b.areaOperativaId
    )
      throw conflict("Area/Centro del Beneficiario non operativi o incoerenti");
    return {
      beneficiarioId: b.id,
      enteDestinatarioId: null,
      magazzinoDestinatarioId: null,
      areaOperativaId: b.areaOperativaId,
      centroAscoltoId: b.centroAscoltoId,
      zonaUdsIdSnapshot: b.zonaUdsId,
      destinatarioCodiceSnapshot: b.codice,
      destinatarioNomeSnapshot: `${b.cognome} ${b.nome}`.trim(),
      numComponentiSnapshot: b.numComponenti,
      areaNomeSnapshot: area.nome,
      centroNomeSnapshot: centre.nome,
    };
  }
  if (
    !hasArea(actor, "magazzino") ||
    input.sorgente !== "operativa" ||
    input.interventoId != null ||
    input.beneficiarioId != null ||
    input.centroAscoltoId != null
  )
    throw denied();
  if (input.areaOperativaId == null)
    throw invalid("Area Operativa obbligatoria");
  if (
    actor.areaOperativaId != null &&
    actor.areaOperativaId !== input.areaOperativaId
  )
    throw denied();
  if (input.tipoDestinatario === "ente") {
    if (
      !hasGrant(actor, "enti-destinatari.view") ||
      input.enteDestinatarioId == null ||
      input.magazzinoDestinatarioId != null
    )
      throw denied();
    const [entity] = await tx
      .select({
        denominazione: entiDestinatariTable.denominazione,
        areaOperativaId: entiDestinatariTable.areaOperativaId,
        attivo: entiDestinatariTable.attivo,
      })
      .from(entiDestinatariTable)
      .where(eq(entiDestinatariTable.id, input.enteDestinatarioId))
      .for("share");
    if (!entity?.attivo || entity.areaOperativaId !== input.areaOperativaId)
      throw missing();
    const [area] = await tx
      .select({
        nome: areeOperativeTable.nome,
        attivo: areeOperativeTable.attivo,
      })
      .from(areeOperativeTable)
      .where(eq(areeOperativeTable.id, input.areaOperativaId))
      .for("share");
    if (!area?.attivo) throw invalid("Area Operativa non attiva");
    return {
      beneficiarioId: null,
      enteDestinatarioId: input.enteDestinatarioId,
      magazzinoDestinatarioId: null,
      areaOperativaId: input.areaOperativaId,
      centroAscoltoId: null,
      zonaUdsIdSnapshot: null,
      destinatarioCodiceSnapshot: null,
      destinatarioNomeSnapshot: entity.denominazione,
      numComponentiSnapshot: null,
      areaNomeSnapshot: area.nome,
      centroNomeSnapshot: null,
    };
  }
  if (
    !hasGrant(actor, "magazzino.view") ||
    input.magazzinoDestinatarioId == null ||
    input.enteDestinatarioId != null
  )
    throw denied();
  const [warehouse] = await tx
    .select({
      codice: magazziniTable.codice,
      nome: magazziniTable.nome,
      areaOperativaId: magazziniTable.areaOperativaId,
      stato: magazziniTable.stato,
    })
    .from(magazziniTable)
    .where(eq(magazziniTable.id, input.magazzinoDestinatarioId))
    .for("share");
  if (
    warehouse?.stato !== "attivo" ||
    warehouse.areaOperativaId !== input.areaOperativaId
  )
    throw missing();
  const [area] = await tx
    .select({
      nome: areeOperativeTable.nome,
      attivo: areeOperativeTable.attivo,
    })
    .from(areeOperativeTable)
    .where(eq(areeOperativeTable.id, input.areaOperativaId))
    .for("share");
  if (!area?.attivo) throw invalid("Area Operativa non attiva");
  return {
    beneficiarioId: null,
    enteDestinatarioId: null,
    magazzinoDestinatarioId: input.magazzinoDestinatarioId,
    areaOperativaId: input.areaOperativaId,
    centroAscoltoId: null,
    zonaUdsIdSnapshot: null,
    destinatarioCodiceSnapshot: warehouse.codice,
    destinatarioNomeSnapshot: warehouse.nome,
    numComponentiSnapshot: null,
    areaNomeSnapshot: area.nome,
    centroNomeSnapshot: null,
  };
}

router.get(
  "/richieste-magazzino",
  requirePermission("richieste_magazzino.view"),
  async (req, res) => {
    const correlationId = randomUUID();
    try {
      const allowed = new Set([
        "page",
        "limit",
        "stato",
        "priorita",
        "areaOperativaId",
        "centroAscoltoId",
        "tipoDestinatario",
        "beneficiarioId",
        "enteDestinatarioId",
        "magazzinoDestinatarioId",
        "interventoId",
        "sorgente",
        "dataDa",
        "dataA",
        "ricerca",
      ]);
      if (Object.keys(req.query).some((key) => !allowed.has(key)))
        throw invalid("Filtro non supportato");
      const string = (key: string) => {
        const value = req.query[key];
        if (value == null) return null;
        if (typeof value !== "string")
          throw invalid(`Filtro ${key} non valido`);
        return value;
      };
      const integer = (key: string, fallback: number | null = null) => {
        const value = string(key);
        if (value == null) return fallback;
        if (
          !/^[1-9][0-9]*$/.test(value) ||
          !Number.isSafeInteger(Number(value))
        )
          throw invalid(`Filtro ${key} non valido`);
        return Number(value);
      };
      const page = integer("page", 1)!;
      const limit = integer("limit", 30)!;
      if (limit > 100) throw invalid("Limite massimo 100");
      const filters: SQL[] = [scopePredicate(req)];
      const state = string("stato");
      if (
        state != null &&
        ![
          "inviata",
          "presa_in_carico",
          "chiusa",
          "annullata",
          "aperte",
        ].includes(state)
      )
        throw invalid("Stato non valido");
      if (state === "aperte" || state == null)
        filters.push(
          or(
            eq(richiesteMagazzinoTable.stato, "inviata"),
            eq(richiesteMagazzinoTable.stato, "presa_in_carico"),
          )!,
        );
      else filters.push(eq(richiesteMagazzinoTable.stato, state));
      const p = string("priorita");
      if (
        p != null &&
        !priority.options.includes(p as (typeof priority.options)[number])
      )
        throw invalid("Priorità non valida");
      if (p) filters.push(eq(richiesteMagazzinoTable.priorita, p));
      const kind = string("tipoDestinatario");
      if (kind != null && !["beneficiario", "ente", "magazzino"].includes(kind))
        throw invalid("Destinatario non valido");
      if (kind)
        filters.push(eq(richiesteMagazzinoTable.tipoDestinatario, kind));
      const source = string("sorgente");
      if (
        source != null &&
        !["beneficiario", "intervento_sociale", "operativa"].includes(source)
      )
        throw invalid("Sorgente non valida");
      if (source) filters.push(eq(richiesteMagazzinoTable.sorgente, source));
      for (const [key, column] of [
        ["areaOperativaId", richiesteMagazzinoTable.areaOperativaId],
        ["centroAscoltoId", richiesteMagazzinoTable.centroAscoltoId],
        ["beneficiarioId", richiesteMagazzinoTable.beneficiarioId],
        ["enteDestinatarioId", richiesteMagazzinoTable.enteDestinatarioId],
        [
          "magazzinoDestinatarioId",
          richiesteMagazzinoTable.magazzinoDestinatarioId,
        ],
        ["interventoId", richiesteMagazzinoTable.interventoId],
      ] as const) {
        const value = integer(key);
        if (value != null) filters.push(eq(column, value));
      }
      const from = string("dataDa"),
        to = string("dataA");
      if (
        (from != null && !isCivilDate(from)) ||
        (to != null && !isCivilDate(to)) ||
        (from != null && to != null && from > to)
      )
        throw invalid("Intervallo date non valido");
      if (from)
        filters.push(
          gte(
            sql`(${richiesteMagazzinoTable.dataCreazione} AT TIME ZONE 'Europe/Rome')::date`,
            from,
          ),
        );
      if (to)
        filters.push(
          lte(
            sql`(${richiesteMagazzinoTable.dataCreazione} AT TIME ZONE 'Europe/Rome')::date`,
            to,
          ),
        );
      const search = string("ricerca")?.trim();
      if (search != null && (search.length < 2 || search.length > 80))
        throw invalid("Ricerca da 2 a 80 caratteri");
      if (search) {
        const escaped = search.replace(/[\\%_]/g, (char) => `\\${char}`);
        filters.push(
          or(
            ilike(richiesteMagazzinoTable.codice, `%${escaped}%`),
            ilike(
              richiesteMagazzinoTable.destinatarioNomeSnapshot,
              `%${escaped}%`,
            ),
          )!,
        );
      }
      const where = and(...filters);
      const [totalRow] = await db
        .select({ value: count() })
        .from(richiesteMagazzinoTable)
        .where(where);
      const rows = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(where)
        .orderBy(
          desc(richiesteMagazzinoTable.dataCreazione),
          desc(richiesteMagazzinoTable.id),
        )
        .limit(limit)
        .offset((page - 1) * limit);
      res.json({
        items: rows.map((row) => view(row, actorFromRequest(req))),
        total: totalRow.value,
        page,
        limit,
      });
    } catch (error) {
      sendError(res, error, correlationId);
    }
  },
);

router.get(
  "/richieste-magazzino/:id/storico",
  requirePermission("richieste_magazzino.view"),
  async (req, res) => {
    const correlationId = randomUUID();
    try {
      const id = parseId(req.params.id as string);
      const [row] = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, id));
      if (!row || !canRead(actorFromRequest(req), row)) throw missing();
      const events = await db
        .select({
          id: auditEventiTable.id,
          azione: auditEventiTable.azione,
          registratoAt: auditEventiTable.registratoAt,
          actorCodeSnapshot: auditEventiTable.actorCodeSnapshot,
          changes: auditEventiTable.changes,
          motivo: auditEventiTable.motivo,
          correlationId: auditEventiTable.correlationId,
        })
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.entitaTipo, "richiesta_magazzino"),
            eq(auditEventiTable.entitaId, id),
          ),
        )
        .orderBy(asc(auditEventiTable.id));
      res.json(events);
    } catch (error) {
      sendError(res, error, correlationId);
    }
  },
);

router.get(
  "/richieste-magazzino/:id",
  requirePermission("richieste_magazzino.view"),
  async (req, res) => {
    const correlationId = randomUUID();
    try {
      const id = parseId(req.params.id as string);
      const [row] = await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, id));
      if (!row || !canRead(actorFromRequest(req), row)) throw missing();
      res.json(view(row, actorFromRequest(req)));
    } catch (error) {
      sendError(res, error, correlationId);
    }
  },
);

router.post(
  "/richieste-magazzino",
  requirePermission("richieste_magazzino.create"),
  async (req, res) => {
    const correlationId = randomUUID();
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) throw invalid("Campi della richiesta non validi");
      const input = {
        ...parsed.data,
        noteOperative: parsed.data.noteOperative || null,
        dataDesiderata: parsed.data.dataDesiderata ?? null,
      };
      const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
      const tipoComando = "RICHIESTA_MAGAZZINO_INVIA";
      const requestHash = commandRequestHash({
        ...input,
        idempotencyKey: undefined,
      });
      const result = await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const actor = await requireCurrentCommandActor(
          tx,
          req.user!.id,
          "richieste_magazzino.create",
        );
        if (
          !(await isModuloAttivo("MAGAZZINO_SOLIDALE")) ||
          (input.tipoDestinatario === "beneficiario" &&
            !(await isModuloAttivo("CENTRO_ASCOLTO")))
        )
          throw denied();
        const receipt = await loadDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
        });
        if (receipt) {
          const [row] = await tx
            .select()
            .from(richiesteMagazzinoTable)
            .where(eq(richiesteMagazzinoTable.id, receipt.aggregatoId));
          if (!row || !canRead(actor, row)) throw missing();
          validateDocumentCommand(receipt, {
            tipoComando,
            idempotencyKey,
            requestHash,
            actorUserId: actor.id,
            aggregatoTipo: "richiesta_magazzino",
          });
          return receipt.resultSnapshot;
        }
        const subject = await buildCreate(tx, actor, input);
        const sequence = await tx.execute(
          sql`SELECT nextval('richieste_magazzino_codice_seq')::text AS codice_progressivo`,
        );
        const progressive = sequence.rows[0]?.codice_progressivo;
        if (
          typeof progressive !== "string" ||
          !/^[1-9][0-9]*$/.test(progressive)
        )
          throw new Error("RICHIESTA_CODICE_GENERATION_FAILED");
        const codice = `RM-${progressive.padStart(8, "0")}`;
        const [created] = await tx
          .insert(richiesteMagazzinoTable)
          .values({
            ...subject,
            codice,
            tipoDestinatario: input.tipoDestinatario,
            sorgente: input.sorgente,
            interventoId: input.interventoId ?? null,
            bisogno: input.bisogno,
            noteOperative: input.noteOperative ?? null,
            priorita: input.priorita,
            dataDesiderata: input.dataDesiderata ?? null,
            modalitaPreferita: input.modalitaPreferita,
            inviatoDa: actor.id,
          })
          .returning();
        const command = auditContextFromRequest(req, {
          correlationId,
          operationKey: `m5a:${tipoComando}:${idempotencyKey}`,
        });
        await recordAuditEvent(tx, {
          command,
          azione: "richiesta_magazzino.invia",
          entitaTipo: "richiesta_magazzino",
          entitaId: created.id,
          areaOperativaIdSnapshot: created.areaOperativaId,
          centroAscoltoIdSnapshot: created.centroAscoltoId,
          changes: auditFields(
            {
              versione: 1,
              stato: "inviata",
              tipoDestinatario: created.tipoDestinatario,
            },
            ["versione", "stato", "tipoDestinatario"],
          ),
        });
        const snapshot = commandResult(created);
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "richiesta_magazzino",
          aggregatoId: created.id,
          versioneRisultante: 1,
          resultSnapshot: snapshot,
          actorUserId: actor.id,
        });
        return snapshot;
      });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error, correlationId);
    }
  },
);

async function mutate(
  req: Request,
  res: Response,
  kind: "update" | "take" | "cancel",
) {
  const correlationId = randomUUID();
  try {
    const id = parseId(req.params.id as string);
    const parsed = (
      kind === "update"
        ? updateSchema
        : kind === "take"
          ? takeSchema
          : cancelSchema
    ).safeParse(req.body);
    if (!parsed.success) throw invalid("Comando non valido");
    const input = Object.fromEntries(
      Object.entries(parsed.data).map(([key, value]) => [
        key,
        key === "noteOperative" && value === "" ? null : value,
      ]),
    ) as typeof parsed.data;
    if (
      kind === "update" &&
      Object.keys(input).every(
        (key) => key === "idempotencyKey" || key === "versione",
      )
    )
      throw invalid("Nessun campo da modificare");
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const permission =
      kind === "update"
        ? "richieste_magazzino.update"
        : kind === "take"
          ? "richieste_magazzino.take"
          : "richieste_magazzino.cancel";
    const tipoComando =
      kind === "update"
        ? "RICHIESTA_MAGAZZINO_MODIFICA"
        : kind === "take"
          ? "RICHIESTA_MAGAZZINO_PRENDI_IN_CARICO"
          : "RICHIESTA_MAGAZZINO_ANNULLA";
    const requestHash = commandRequestHash({
      id,
      ...input,
      idempotencyKey: undefined,
    });
    const result = await db.transaction(async (tx) => {
      await lockDocumentCommand(tx, tipoComando, idempotencyKey);
      const actor = await requireCurrentCommandActor(
        tx,
        req.user!.id,
        permission,
      );
      if (!(await isModuloAttivo("MAGAZZINO_SOLIDALE"))) throw denied();
      const receipt = await loadDocumentCommand(tx, {
        tipoComando,
        idempotencyKey,
      });
      const [before] = await tx
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, id));
      if (!before || !canRead(actor, before)) throw missing();
      if (receipt) {
        validateDocumentCommand(receipt, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: actor.id,
          aggregatoTipo: "richiesta_magazzino",
          aggregatoId: id,
        });
        return receipt.resultSnapshot;
      }
      if (kind !== "cancel") await requireLiveSubject(tx, before);
      const [row] = await tx
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, id))
        .for("update");
      if (!row || !canRead(actor, row)) throw missing();
      if (row.versione !== input.versione)
        throw conflict("Versione superata; ricarica la richiesta");
      if (kind === "take") {
        if (!hasArea(actor, "magazzino") || row.stato !== "inviata")
          throw conflict("Presa in carico non disponibile");
      } else if (kind === "update") {
        if (
          !hasArea(actor, "sociale") ||
          !canSocialWrite(actor, row) ||
          row.stato !== "inviata" ||
          !(await isModuloAttivo("CENTRO_ASCOLTO"))
        )
          throw denied();
      } else if (row.stato === "inviata") {
        if (
          !canSocialWrite(actor, row) ||
          !(await isModuloAttivo("CENTRO_ASCOLTO"))
        )
          throw denied();
      } else if (row.stato === "presa_in_carico") {
        if (!hasArea(actor, "magazzino")) throw denied();
      } else throw conflict("Annullamento non disponibile");
      const command = auditContextFromRequest(req, {
        correlationId,
        operationKey: `m5a:${tipoComando}:${idempotencyKey}`,
      });
      const changes =
        kind === "update"
          ? Object.fromEntries(
              Object.entries(input).filter(
                ([key]) => !["idempotencyKey", "versione"].includes(key),
              ),
            )
          : {};
      const values =
        kind === "update"
          ? changes
          : kind === "take"
            ? {
                stato: "presa_in_carico",
                presoInCaricoDa: actor.id,
                presoInCaricoCodiceSnapshot: command.actor.actorCodeSnapshot,
                presoInCaricoAt: new Date(),
              }
            : {
                stato: "annullata",
                annullatoDa: actor.id,
                annullatoAt: new Date(),
                motivoAnnullamento: (input as z.infer<typeof cancelSchema>)
                  .motivo,
              };
      const [updated] = await tx
        .update(richiesteMagazzinoTable)
        .set({
          ...values,
          versione: row.versione + 1,
          dataAggiornamento: new Date(),
        })
        .where(
          and(
            eq(richiesteMagazzinoTable.id, id),
            eq(richiesteMagazzinoTable.versione, row.versione),
          ),
        )
        .returning();
      if (!updated) throw conflict("Versione superata; ricarica la richiesta");
      await recordAuditEvent(tx, {
        command,
        azione: `richiesta_magazzino.${kind}`,
        entitaTipo: "richiesta_magazzino",
        entitaId: id,
        areaOperativaIdSnapshot: row.areaOperativaId,
        centroAscoltoIdSnapshot: row.centroAscoltoId,
        motivo:
          kind === "cancel"
            ? (input as z.infer<typeof cancelSchema>).motivo
            : null,
        changes: auditFields(
          {
            versione: updated.versione,
            stato: updated.stato,
            campiModificati: kind === "update" ? Object.keys(changes) : [],
          },
          ["versione", "stato", "campiModificati"],
        ),
      });
      const snapshot = commandResult(updated);
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
      return snapshot;
    });
    res.json(result);
  } catch (error) {
    sendError(res, error, correlationId);
  }
}

router.patch(
  "/richieste-magazzino/:id",
  requirePermission("richieste_magazzino.update"),
  (req, res) => mutate(req, res, "update"),
);
router.post(
  "/richieste-magazzino/:id/presa-in-carico",
  requirePermission("richieste_magazzino.take"),
  (req, res) => mutate(req, res, "take"),
);
router.post(
  "/richieste-magazzino/:id/annulla",
  requirePermission("richieste_magazzino.cancel"),
  (req, res) => mutate(req, res, "cancel"),
);

export default router;
