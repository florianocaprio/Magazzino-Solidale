import type { Request } from "express";
import { dataCivileEuropeRome } from "../interventiWorkflow";
import type { ReportFilters } from "./types";

export class ReportingError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
  const today = dataCivileEuropeRome();
  const currentYear = Number(today.slice(0, 4));
  const annoRaw = optionalPositiveInt(req.query.anno, "anno");
  const anno = annoRaw ?? currentYear;
  if (anno < 2000 || anno > 2100) {
    throw new ReportingError(400, "anno non valido");
  }

  const da = req.query.da == null || req.query.da === ""
    ? `${anno}-01-01`
    : String(req.query.da);
  const a = req.query.a == null || req.query.a === ""
    ? (anno === currentYear ? today : `${anno}-12-31`)
    : String(req.query.a);
  if (!isCivilDate(da)) throw new ReportingError(400, "da non è una data valida");
  if (!isCivilDate(a)) throw new ReportingError(400, "a non è una data valida");
  if (da > a) throw new ReportingError(400, "da non può essere successiva ad a");

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
  };
}

export function parsePagination(req: Request): { page: number; pageSize: number } {
  const page = optionalPositiveInt(req.query.page, "page") ?? 1;
  const pageSize = optionalPositiveInt(req.query.pageSize, "pageSize") ?? 25;
  if (pageSize > 100) throw new ReportingError(400, "pageSize non può superare 100");
  return { page, pageSize };
}
