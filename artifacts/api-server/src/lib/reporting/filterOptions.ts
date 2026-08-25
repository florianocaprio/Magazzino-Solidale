import {
  areeOperativeTable,
  centriAscoltoTable,
  db,
  magazziniTable,
  menseTable,
  zoneUdsTable,
} from "@workspace/db";
import { and, asc, eq, isNull, or, type Column, type SQL } from "drizzle-orm";
import type { Request } from "express";
import { isModuloAttivo } from "../featureFlags";
import type { ReportSection } from "./types";

export type ReportFilterOption = {
  id: number;
  nome: string;
  areaOperativaId: number | null;
  centroAscoltoId?: number | null;
};

export type ReportFilterOptions = {
  section: ReportSection;
  areeOperative: ReportFilterOption[];
  centres: ReportFilterOption[];
  warehouses: ReportFilterOption[];
  mense: ReportFilterOption[];
  zones: ReportFilterOption[];
};

function where(...conditions: Array<SQL | undefined>): SQL | undefined {
  const present = conditions.filter((condition): condition is SQL => condition != null);
  return present.length > 1 ? and(...present) : present[0];
}

function areaOperativaCondition(column: Column, areaOperativaId: number | null): SQL | undefined {
  return areaOperativaId == null ? undefined : eq(column, areaOperativaId);
}

export async function buildReportFilterOptions(
  req: Request,
  section: ReportSection,
  requestedAreaOperativaId: number | null,
): Promise<ReportFilterOptions> {
  const user = req.user;
  const ownAreaOperativaId = user?.areaOperativaId ?? null;
  const ownCentreId = user?.centroAscoltoId ?? null;
  const ownZoneId = user?.zonaUdsId ?? null;
  const effectiveAreaOperativaId = ownAreaOperativaId ?? requestedAreaOperativaId;
  const isAdmin = user?.isAdmin ?? false;
  const hasArea = (area: string) => isAdmin || Boolean(user?.aree.includes(area));
  const hasPermission = (permission: string) =>
    isAdmin || Boolean(user?.permessi.includes(permission));

  const [magazzino, bolle, centroAscolto, emporio, mensa, uds, lotti, trasferimenti] =
    await Promise.all([
      isModuloAttivo("MAGAZZINO_SOLIDALE"),
      isModuloAttivo("BOLLE"),
      isModuloAttivo("CENTRO_ASCOLTO"),
      isModuloAttivo("EMPORIO_SOLIDALE"),
      isModuloAttivo("MENSA"),
      isModuloAttivo("UDS"),
      isModuloAttivo("LOTTI"),
      isModuloAttivo("TRASFERIMENTI"),
    ]);

  const pacchiSource = hasArea("sociale") && magazzino && bolle;
  const socialSource = hasArea("sociale") && centroAscolto;
  const emporioSource = hasArea("emporio") && emporio;
  const mensaSource = hasArea("mensa") && hasPermission("mensa.reports.view") && mensa;
  const udsSource = hasArea("uds") && hasPermission("uds.reports.view") && uds;
  const logisticsSource =
    (hasArea("magazzino") || hasArea("logistica")) &&
    (magazzino || lotti || trasferimenti);
  const fseSource =
    hasPermission("magazzino.fse.view") &&
    ((hasArea("sociale") && magazzino && bolle) ||
      (hasArea("emporio") && emporio) ||
      (hasArea("mensa") && mensa) ||
      (hasArea("uds") && uds) ||
      ((hasArea("magazzino") || hasArea("logistica")) &&
        (magazzino || lotti || trasferimenti)));

  const sectionSourceEnabled =
    section === "generale"
      ? pacchiSource || socialSource || emporioSource || mensaSource || udsSource || logisticsSource
      : section === "pacchi"
        ? pacchiSource
        : section === "centro-ascolto"
          ? socialSource
          : section === "emporio"
            ? emporioSource
            : section === "mensa"
              ? mensaSource
              : section === "uds"
                ? udsSource
                : section === "magazzino-logistica"
                  ? logisticsSource
                  : fseSource;

  const includeWarehouses =
    (section === "generale" &&
      (pacchiSource || emporioSource || logisticsSource)) ||
    (section === "pacchi" && pacchiSource) ||
    (section === "emporio" && emporioSource) ||
    (section === "magazzino-logistica" && logisticsSource) ||
    (section === "fse-plus" && fseSource);
  const includeMense = section === "mensa" && mensaSource;
  const includeZones = section === "uds" && udsSource;

  const [areeOperative, centres, warehouses, canteens, zones] = await Promise.all([
    sectionSourceEnabled
      ? db
          .select({ id: areeOperativeTable.id, nome: areeOperativeTable.nome, areaOperativaId: areeOperativeTable.id })
          .from(areeOperativeTable)
          .where(ownAreaOperativaId == null ? undefined : eq(areeOperativeTable.id, ownAreaOperativaId))
          .orderBy(asc(areeOperativeTable.nome))
      : Promise.resolve([]),
    sectionSourceEnabled
      ? db
          .select({ id: centriAscoltoTable.id, nome: centriAscoltoTable.nome, areaOperativaId: centriAscoltoTable.areaOperativaId })
          .from(centriAscoltoTable)
          .where(
            ownCentreId != null
              ? eq(centriAscoltoTable.id, ownCentreId)
              : areaOperativaCondition(centriAscoltoTable.areaOperativaId, effectiveAreaOperativaId),
          )
          .orderBy(asc(centriAscoltoTable.nome))
      : Promise.resolve([]),
    includeWarehouses
      ? db
          .select({
            id: magazziniTable.id,
            nome: magazziniTable.nome,
            areaOperativaId: magazziniTable.areaOperativaId,
            centroAscoltoId: magazziniTable.centroAscoltoId,
          })
          .from(magazziniTable)
          .where(
            where(
              areaOperativaCondition(magazziniTable.areaOperativaId, effectiveAreaOperativaId),
              ownCentreId == null
                ? undefined
                : or(eq(magazziniTable.centroAscoltoId, ownCentreId), isNull(magazziniTable.centroAscoltoId)),
            ),
          )
          .orderBy(asc(magazziniTable.nome))
      : Promise.resolve([]),
    includeMense
      ? db
          .select({
            id: menseTable.id,
            nome: menseTable.nome,
            areaOperativaId: menseTable.areaOperativaId,
            centroAscoltoId: magazziniTable.centroAscoltoId,
          })
          .from(menseTable)
          .innerJoin(magazziniTable, eq(menseTable.magazzinoId, magazziniTable.id))
          .where(
            where(
              effectiveAreaOperativaId == null ? undefined : eq(menseTable.areaOperativaId, effectiveAreaOperativaId),
              ownCentreId == null
                ? undefined
                : or(eq(magazziniTable.centroAscoltoId, ownCentreId), isNull(magazziniTable.centroAscoltoId)),
            ),
          )
          .orderBy(asc(menseTable.nome))
      : Promise.resolve([]),
    includeZones
      ? db
          .select({ id: zoneUdsTable.id, nome: zoneUdsTable.nome, areaOperativaId: zoneUdsTable.areaOperativaId })
          .from(zoneUdsTable)
          .where(
            ownZoneId != null
              ? eq(zoneUdsTable.id, ownZoneId)
              : effectiveAreaOperativaId == null
                ? undefined
                : eq(zoneUdsTable.areaOperativaId, effectiveAreaOperativaId),
          )
          .orderBy(asc(zoneUdsTable.nome))
      : Promise.resolve([]),
  ]);

  return {
    section,
    areeOperative,
    centres,
    warehouses,
    mense: canteens,
    zones,
  };
}
