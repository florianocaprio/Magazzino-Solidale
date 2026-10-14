import type { Request } from "express";
import {
  centriAscoltoTable,
  db,
  magazziniTable,
  menseTable,
  zoneUdsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { dataCivileEuropeRome } from "../interventiWorkflow";
import {
  canAccessAreaOperativa,
  canAccessCentro,
  canAccessMagazzino,
  canAccessZonaUds,
  callerAreaOperativaId,
  callerCentroId,
  callerZonaUdsId,
} from "../centroScope";
import type { ReportFilters } from "./types";
import { currentMensaIds, MensaScopeError } from "../mensaScope";

export class ReportingError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Read policy only: never derive global report access from a missing scope. */
export function assertReportTerritory(req: Request): void {
  const user = req.user;
  if (!user) throw new ReportingError(401, "Non autenticato");
  if (!user.isAdmin && user.areaOperativaId == null)
    throw new ReportingError(
      403,
      "Perimetro territoriale Reporting non assegnato",
    );
  if (user.areaOperativaId != null && user.areaOperativaAttiva === false)
    throw new ReportingError(403, "Area Operativa non attiva");
  if (
    user.centroAscoltoId != null &&
    (user.centroAscoltoAttivo === false ||
      (user.centroAscoltoAreaOperativaId != null &&
        user.centroAscoltoAreaOperativaId !== user.areaOperativaId))
  )
    throw new ReportingError(403, "Centro fuori dal perimetro corrente");
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCivilDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function optionalPositiveInt(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ReportingError(400, `${name} non valido`);
  }
  return parsed;
}

function optionalText(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 120) {
    throw new ReportingError(400, `${name} non valido`);
  }
  return value.trim() || null;
}

function scopedId(
  requested: number | null,
  caller: number | null,
  name: string,
): { value: number | null; mode: "all" | "caller" | "query" } {
  if (caller != null) {
    if (requested != null && requested !== caller) {
      throw new ReportingError(
        403,
        `${name} non appartiene al perimetro dell'utente`,
      );
    }
    return { value: caller, mode: "caller" };
  }
  return requested == null
    ? { value: null, mode: "all" }
    : { value: requested, mode: "query" };
}

export function parseReportFilters(req: Request): ReportFilters {
  assertReportTerritory(req);
  const today = dataCivileEuropeRome();
  const currentYear = Number(today.slice(0, 4));
  const annoRaw = optionalPositiveInt(req.query.anno, "anno");
  const anno = annoRaw ?? currentYear;
  if (anno < 2000 || anno > 2100) {
    throw new ReportingError(400, "anno non valido");
  }

  const da =
    req.query.da == null || req.query.da === ""
      ? `${anno}-01-01`
      : String(req.query.da);
  const a =
    req.query.a == null || req.query.a === ""
      ? anno === currentYear
        ? today
        : `${anno}-12-31`
      : String(req.query.a);
  if (!isCivilDate(da))
    throw new ReportingError(400, "da non è una data valida");
  if (!isCivilDate(a)) throw new ReportingError(400, "a non è una data valida");
  if (da > a)
    throw new ReportingError(400, "da non può essere successiva ad a");

  const areaOperativa = scopedId(
    optionalPositiveInt(req.query.areaOperativaId, "areaOperativaId"),
    req.user?.areaOperativaId ?? null,
    "areaOperativaId",
  );
  const centre = scopedId(
    optionalPositiveInt(req.query.centroAscoltoId, "centroAscoltoId"),
    req.user?.centroAscoltoId ?? null,
    "centroAscoltoId",
  );
  const zone = scopedId(
    optionalPositiveInt(req.query.zonaUdsId, "zonaUdsId"),
    req.user?.zonaUdsId ?? null,
    "zonaUdsId",
  );

  return {
    da,
    a,
    anno,
    areaOperativaId: areaOperativa.value,
    centroAscoltoId: centre.value,
    magazzinoId: optionalPositiveInt(req.query.magazzinoId, "magazzinoId"),
    mensaId: optionalPositiveInt(req.query.mensaId, "mensaId"),
    zonaUdsId: zone.value,
    operatoreId: optionalPositiveInt(req.query.operatoreId, "operatoreId"),
    tipoIntervento: optionalText(req.query.tipoIntervento, "tipoIntervento"),
    tipoServizio: optionalText(req.query.tipoServizio, "tipoServizio"),
    areaOperativaMode: areaOperativa.mode,
    centroMode: centre.mode,
    zonaMode: zone.mode,
    callerAreas: req.user?.aree ?? [],
    callerPermissions: req.user?.permessi ?? [],
    callerIsAdmin: req.user?.isAdmin ?? false,
    callerUserId: req.user?.id,
  };
}

export function parsePagination(req: Request): {
  page: number;
  pageSize: number;
} {
  const page = optionalPositiveInt(req.query.page, "page") ?? 1;
  const pageSize = optionalPositiveInt(req.query.pageSize, "pageSize") ?? 25;
  if (pageSize > 100)
    throw new ReportingError(400, "pageSize non può superare 100");
  return { page, pageSize };
}

export async function assertReportFilterScope(
  req: Request,
  filters: ReportFilters,
): Promise<void> {
  assertReportTerritory(req);
  filters.callerMensaIds = req.user?.isAdmin ? null : [];
  if (
    !req.user?.isAdmin &&
    req.user?.aree.includes("mensa") &&
    req.user.permessi.includes("mensa.reports.view")
  ) {
    try {
      const current = await db.transaction((tx) =>
        currentMensaIds(tx, req.user!.id),
      );
      filters.callerMensaIds = current.ids;
    } catch (error) {
      if (!(error instanceof MensaScopeError)) throw error;
      throw new ReportingError(403, error.message);
    }
  }
  const callerArea = callerAreaOperativaId(req);
  const callerCentre = callerCentroId(req);
  const callerZone = callerZonaUdsId(req);
  const forbidden = () =>
    new ReportingError(403, "Filtro fuori dal perimetro del ruolo");

  if (filters.centroAscoltoId != null) {
    const [centre] = await db
      .select()
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, filters.centroAscoltoId));
    if (
      !centre ||
      !canAccessCentro(centre.id, callerCentre) ||
      !canAccessAreaOperativa(centre.areaOperativaId, callerArea)
    )
      throw forbidden();
  }
  if (
    filters.magazzinoId != null &&
    !(await canAccessMagazzino(filters.magazzinoId, callerCentre, callerArea))
  ) {
    throw forbidden();
  }
  if (filters.mensaId != null) {
    if (
      filters.callerMensaIds !== null &&
      !filters.callerMensaIds?.includes(filters.mensaId)
    )
      throw forbidden();
    const [canteen] = await db
      .select({
        id: menseTable.id,
        areaOperativaId: menseTable.areaOperativaId,
        centroAscoltoId: magazziniTable.centroAscoltoId,
      })
      .from(menseTable)
      .innerJoin(magazziniTable, eq(menseTable.magazzinoId, magazziniTable.id))
      .where(eq(menseTable.id, filters.mensaId));
    if (
      !canteen ||
      !canAccessAreaOperativa(canteen.areaOperativaId, callerArea) ||
      !canAccessCentro(canteen.centroAscoltoId, callerCentre)
    )
      throw forbidden();
  }
  if (filters.zonaUdsId != null) {
    const [zone] = await db
      .select()
      .from(zoneUdsTable)
      .where(eq(zoneUdsTable.id, filters.zonaUdsId));
    if (
      !zone ||
      !canAccessZonaUds(zone.id, callerZone) ||
      !canAccessAreaOperativa(zone.areaOperativaId, callerArea)
    )
      throw forbidden();
  }
}
