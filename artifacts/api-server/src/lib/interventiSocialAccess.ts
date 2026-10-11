import { and, eq, sql, type SQL } from "drizzle-orm";
import { beneficiariTable, zoneUdsTable } from "@workspace/db";
import type { M5bRequestActor } from "./m5bRequestAccess";
import { requireCurrentM5bActor } from "./m5bRequestAccess";
import { CurrentCommandActorError } from "./currentCommandActor";
import type { InventoryTransaction } from "./scaricoInventory";

export type SocialActor = M5bRequestActor & {
  zonaAttiva?: boolean;
  zonaAreaOperativaId?: number | null;
};

/** Social policy only: never widen M4/UDS/Emporio by changing centroScope. */
export function socialTerritory(actor: SocialActor | undefined) {
  if (!actor || !(actor.isAdmin || actor.aree?.includes("sociale")))
    return "none";
  if (actor.areaOperativaId == null)
    return actor.isAdmin &&
      actor.centroAscoltoId == null &&
      actor.zonaUdsId == null
      ? "global"
      : "none";
  if (actor.areaOperativaAttiva !== true) return "none";
  if (
    actor.centroAscoltoId != null &&
    (actor.centroAscoltoAttivo !== true ||
      actor.centroAscoltoAreaOperativaId !== actor.areaOperativaId)
  )
    return "none";
  if (
    actor.zonaUdsId != null &&
    (actor.zonaAttiva !== true ||
      actor.zonaAreaOperativaId !== actor.areaOperativaId)
  )
    return "none";
  // An explicitly assigned Area was already a supported social scope. It is
  // not global, and an existing Centro assignment can never be ignored.
  return actor.centroAscoltoId == null ? "area" : "centro";
}

export function canReadSocialSubject(
  actor: SocialActor | undefined,
  subject: {
    areaOperativaId: number | null;
    centroAscoltoId: number | null;
    zonaUdsId: number | null;
  },
) {
  const scope = socialTerritory(actor);
  if (scope === "none") return false;
  if (scope === "global") return true;
  return (
    subject.areaOperativaId === actor!.areaOperativaId &&
    subject.centroAscoltoId != null &&
    (actor!.centroAscoltoId == null ||
      subject.centroAscoltoId === actor!.centroAscoltoId) &&
    (actor!.zonaUdsId == null || subject.zonaUdsId === actor!.zonaUdsId)
  );
}

export function socialSubjectPredicate(actor: SocialActor | undefined): SQL {
  const scope = socialTerritory(actor);
  if (scope === "none") return sql`false`;
  if (scope === "global") return sql`true`;
  return and(
    eq(beneficiariTable.areaOperativaId, actor!.areaOperativaId!),
    sql`${beneficiariTable.centroAscoltoId} is not null`,
    actor!.centroAscoltoId == null
      ? undefined
      : eq(beneficiariTable.centroAscoltoId, actor!.centroAscoltoId),
    actor!.zonaUdsId == null
      ? undefined
      : eq(beneficiariTable.zonaUdsId, actor!.zonaUdsId),
  )!;
}

export async function requireCurrentSocialActor(
  tx: InventoryTransaction,
  id: number,
  permission: string,
) {
  const actor = await requireCurrentM5bActor(tx, id, permission);
  const [zone] =
    actor.zonaUdsId == null
      ? []
      : await tx
          .select()
          .from(zoneUdsTable)
          .where(eq(zoneUdsTable.id, actor.zonaUdsId))
          .for("share");
  const current = {
    ...actor,
    zonaAttiva: zone?.attivo ?? false,
    zonaAreaOperativaId: zone?.areaOperativaId ?? null,
  };
  if (socialTerritory(current) === "none")
    throw new CurrentCommandActorError(
      "Assegnazione territoriale sociale non disponibile",
    );
  return current;
}
