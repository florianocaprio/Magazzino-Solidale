import {
  cittaTable,
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
  cittaId: number | null;
  centroAscoltoId?: number | null;
};

export type ReportFilterOptions = {
  section: ReportSection;
  cities: ReportFilterOption[];
  centres: ReportFilterOption[];
  warehouses: ReportFilterOption[];
  mense: ReportFilterOption[];
  zones: ReportFilterOption[];
};

function where(...conditions: Array<SQL | undefined>): SQL | undefined {
  const present = conditions.filter((condition): condition is SQL => condition != null);
  return present.length > 1 ? and(...present) : present[0];
}

function cityCondition(column: Column, cityId: number | null): SQL | undefined {
  return cityId == null ? undefined : eq(column, cityId);
}

export async function buildReportFilterOptions(
  req: Request,
  section: ReportSection,
  requestedCityId: number | null,
): Promise<ReportFilterOptions> {
  const user = req.user;
  const ownCityId = user?.cittaId ?? null;
  const ownCentreId = user?.centroAscoltoId ?? null;
  const ownZoneId = user?.zonaUdsId ?? null;
  const effectiveCityId = ownCityId ?? requestedCityId;
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
  const udsSource = hasArea("uds") && uds;
  const logisticsSource =
    (hasArea("magazzino") || hasArea("logistica")) &&
    (magazzino || lotti || trasferimenti);

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
                  : pacchiSource || emporioSource || mensaSource;

  const includeWarehouses =
    (section === "generale" && (pacchiSource || emporioSource || logisticsSource)) ||
    (section === "pacchi" && pacchiSource) ||
    (section === "emporio" && emporioSource) ||
    (section === "magazzino-logistica" && logisticsSource) ||
    (section === "fse-plus" && (pacchiSource || emporioSource));
  const includeMense = section === "mensa" && mensaSource;
  const includeZones = section === "uds" && udsSource;

  const [cities, centres, warehouses, canteens, zones] = await Promise.all([
    sectionSourceEnabled
      ? db
          .select({ id: cittaTable.id, nome: cittaTable.nome, cittaId: cittaTable.id })
          .from(cittaTable)
          .where(ownCityId == null ? undefined : eq(cittaTable.id, ownCityId))
          .orderBy(asc(cittaTable.nome))
      : Promise.resolve([]),
    sectionSourceEnabled
      ? db
          .select({ id: centriAscoltoTable.id, nome: centriAscoltoTable.nome, cittaId: centriAscoltoTable.cittaId })
          .from(centriAscoltoTable)
          .where(
            ownCentreId != null
              ? eq(centriAscoltoTable.id, ownCentreId)
              : cityCondition(centriAscoltoTable.cittaId, effectiveCityId),
          )
          .orderBy(asc(centriAscoltoTable.nome))
      : Promise.resolve([]),
    includeWarehouses
      ? db
          .select({
            id: magazziniTable.id,
            nome: magazziniTable.nome,
            cittaId: magazziniTable.cittaId,
            centroAscoltoId: magazziniTable.centroAscoltoId,
          })
          .from(magazziniTable)
          .where(
            where(
              cityCondition(magazziniTable.cittaId, effectiveCityId),
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
            cittaId: menseTable.cittaId,
            centroAscoltoId: magazziniTable.centroAscoltoId,
          })
          .from(menseTable)
          .innerJoin(magazziniTable, eq(menseTable.magazzinoId, magazziniTable.id))
          .where(
            where(
              effectiveCityId == null ? undefined : eq(menseTable.cittaId, effectiveCityId),
              ownCentreId == null
                ? undefined
                : or(eq(magazziniTable.centroAscoltoId, ownCentreId), isNull(magazziniTable.centroAscoltoId)),
            ),
          )
          .orderBy(asc(menseTable.nome))
      : Promise.resolve([]),
    includeZones
      ? db
          .select({ id: zoneUdsTable.id, nome: zoneUdsTable.nome, cittaId: zoneUdsTable.cittaId })
          .from(zoneUdsTable)
          .where(
            ownZoneId != null
              ? eq(zoneUdsTable.id, ownZoneId)
              : effectiveCityId == null
                ? undefined
                : eq(zoneUdsTable.cittaId, effectiveCityId),
          )
          .orderBy(asc(zoneUdsTable.nome))
      : Promise.resolve([]),
  ]);

  return {
    section,
    cities,
    centres,
    warehouses,
    mense: canteens,
    zones,
  };
}
