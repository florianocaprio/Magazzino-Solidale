import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  db,
  magazziniTable,
  zoneUdsTable,
} from "@workspace/db";
import {
  callerCentroId,
  callerCittaId,
  callerZonaUdsId,
  canAccessCentro,
  canAccessCitta,
  canAccessZonaUds,
} from "./centroScope";
import type { PermissionKey } from "./permissions";

export function hasPermission(req: Request, permission: PermissionKey): boolean {
  return Boolean(req.user?.isAdmin || req.user?.permessi?.includes(permission));
}

export function canAccessBeneficiarioRecord(
  beneficiario: Pick<typeof beneficiariTable.$inferSelect, "cittaId" | "centroAscoltoId" | "zonaUdsId">,
  req: Request,
): boolean {
  return canAccessCentro(beneficiario.centroAscoltoId, callerCentroId(req))
    && canAccessCitta(beneficiario.cittaId, callerCittaId(req))
    && canAccessZonaUds(beneficiario.zonaUdsId, callerZonaUdsId(req));
}

/**
 * La directory UDS è intenzionalmente condivisa nell'intera Area per consentire
 * il riconoscimento di una persona senza duplicarla. Questo allargamento vale
 * solo per la lettura anagrafica minimizzata: le mutazioni conservano i vincoli
 * Centro/Zona applicati da {@link canAccessBeneficiarioRecord}.
 */
export function canViewBeneficiarioRecord(
  beneficiario: Pick<typeof beneficiariTable.$inferSelect, "cittaId" | "centroAscoltoId" | "zonaUdsId">,
  req: Request,
): boolean {
  if (req.user?.aree?.includes("uds") && !req.user?.aree?.includes("sociale")) {
    return canAccessCitta(beneficiario.cittaId, callerCittaId(req));
  }
  return canAccessBeneficiarioRecord(beneficiario, req);
}

export function visibleInterventoAmbiti(req: Request): Array<"sociale" | "uds"> {
  if (req.user?.isAdmin) return ["sociale", "uds"];
  const ambiti: Array<"sociale" | "uds"> = [];
  if (hasPermission(req, "beneficiari.sensitive.view") && req.user?.aree?.includes("sociale")) ambiti.push("sociale");
  if (req.user?.aree?.includes("uds")) ambiti.push("uds");
  return ambiti;
}

export type BeneficiarioTerritorialAssignment = {
  cittaId: number | null;
  centroAscoltoId: number | null;
  zonaUdsId: number | null;
  magazzinoEmporioPreferitoId: number | null;
};

export async function validateBeneficiarioTerritorialAssignment(
  assignment: BeneficiarioTerritorialAssignment,
  options: { requireArea: boolean; requireActiveArea: boolean },
): Promise<{ status: number; error: string } | null> {
  const { cittaId, centroAscoltoId, zonaUdsId, magazzinoEmporioPreferitoId } = assignment;
  if (cittaId == null) {
    return options.requireArea ? { status: 400, error: "Seleziona un'Area per il Beneficiario." } : null;
  }

  const [area] = await db.select({ id: cittaTable.id, attivo: cittaTable.attivo })
    .from(cittaTable).where(eq(cittaTable.id, cittaId));
  if (!area) return { status: 400, error: "L'Area selezionata non esiste." };
  if (options.requireActiveArea && !area.attivo) return { status: 400, error: "L'Area selezionata non è attiva." };

  if (centroAscoltoId != null) {
    const [centro] = await db.select({ cittaId: centriAscoltoTable.cittaId, attivo: centriAscoltoTable.attivo })
      .from(centriAscoltoTable).where(eq(centriAscoltoTable.id, centroAscoltoId));
    if (!centro) return { status: 400, error: "Il Centro di Ascolto selezionato non esiste." };
    if (!centro.attivo) return { status: 400, error: "Il Centro di Ascolto selezionato non è attivo." };
    if (centro.cittaId !== cittaId) return { status: 400, error: "Il Centro di Ascolto deve appartenere alla stessa Area del Beneficiario." };
  }

  if (zonaUdsId != null) {
    const [zona] = await db.select({ cittaId: zoneUdsTable.cittaId, attivo: zoneUdsTable.attivo })
      .from(zoneUdsTable).where(eq(zoneUdsTable.id, zonaUdsId));
    if (!zona) return { status: 400, error: "La Zona UDS selezionata non esiste." };
    if (!zona.attivo) return { status: 400, error: "La Zona UDS selezionata non è attiva." };
    if (zona.cittaId !== cittaId) return { status: 400, error: "La Zona UDS deve appartenere alla stessa Area del Beneficiario." };
  }

  if (magazzinoEmporioPreferitoId != null) {
    const [emporio] = await db.select({
      cittaId: magazziniTable.cittaId,
      stato: magazziniTable.stato,
      tipoMagazzino: magazziniTable.tipoMagazzino,
    }).from(magazziniTable).where(and(
      eq(magazziniTable.id, magazzinoEmporioPreferitoId),
    ));
    if (!emporio) return { status: 400, error: "L'Emporio selezionato non esiste." };
    if (emporio.stato !== "attivo") return { status: 400, error: "L'Emporio selezionato non è attivo." };
    if (emporio.tipoMagazzino !== "emporio" && emporio.tipoMagazzino !== "misto") {
      return { status: 400, error: "Il magazzino selezionato non è un Emporio Solidale." };
    }
    if (emporio.cittaId !== cittaId) return { status: 400, error: "L'Emporio deve appartenere alla stessa Area del Beneficiario." };
  }
  return null;
}

export async function canCreateActivityForBeneficiario(beneficiarioId: number, req: Request): Promise<boolean> {
  const [beneficiario] = await db.select({
    attivo: beneficiariTable.attivo,
    cittaId: beneficiariTable.cittaId,
    centroAscoltoId: beneficiariTable.centroAscoltoId,
    zonaUdsId: beneficiariTable.zonaUdsId,
  }).from(beneficiariTable).where(eq(beneficiariTable.id, beneficiarioId));
  return Boolean(beneficiario?.attivo && canAccessBeneficiarioRecord(beneficiario, req));
}

export async function isBeneficiarioActive(beneficiarioId: number | null | undefined): Promise<boolean> {
  if (beneficiarioId == null) return false;
  const [beneficiario] = await db.select({ attivo: beneficiariTable.attivo })
    .from(beneficiariTable).where(eq(beneficiariTable.id, beneficiarioId));
  return beneficiario?.attivo === true;
}
