import {
  auditConfigurazioniTable,
  db,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { loadSessionUser } from "../../src/middlewares/auth";
const users = new Set<number>(),
  roles: number[] = [],
  createdUsers: number[] = [];
export async function cleanupEmporioActorFixtures() {
  if (users.size)
    await db
      .update(utentiTable)
      .set({
        areaOperativaId: null,
        centroAscoltoId: null,
        zonaUdsId: null,
        ruoloId: null,
      })
      .where(inArray(utentiTable.id, [...users]));
  if (roles.length)
    await db.delete(ruoliTable).where(inArray(ruoliTable.id, roles.splice(0)));
  if (createdUsers.length) {
    await db
      .delete(auditConfigurazioniTable)
      .where(inArray(auditConfigurazioniTable.utenteId, createdUsers));
    await db
      .delete(utentiTable)
      .where(inArray(utentiTable.id, createdUsers.splice(0)));
  }
  users.clear();
}

/** Fixture DB reale: req.user non può sostituire l'autorità persistita M6.2-A.
 * Non attribuisce territorio o privilegi mancanti; usa solo il setup esplicito del test. */
export async function emporioActorFixture(input: {
  id?: number;
  isAdmin: boolean;
  aree: string[];
  permessi: string[];
  areaOperativaId: number | null;
  centroAscoltoId: number | null;
  zonaUdsId?: number | null;
  isSuperAdmin?: boolean;
}) {
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `Emporio fixture ${Math.random().toString(36).slice(2)}`,
      isAdmin: input.isAdmin,
      aree: input.aree,
      permessi: input.permessi,
    })
    .returning();
  roles.push(role.id);
  const values = {
    ruoloId: role.id,
    areaOperativaId: input.areaOperativaId,
    centroAscoltoId: input.centroAscoltoId,
    zonaUdsId: input.zonaUdsId ?? null,
    ...(input.isSuperAdmin == null ? {} : { isSuperAdmin: input.isSuperAdmin }),
  };
  let id = input.id;
  if (id == null) {
    const [user] = await db
      .insert(utentiTable)
      .values({
        ...values,
        username: `emporio_fixture_${Math.random().toString(36).slice(2)}`,
        passwordHash: "synthetic-test-only",
        nome: "Fixture autorizzativa",
      })
      .returning();
    id = user.id;
    createdUsers.push(id);
  } else await db.update(utentiTable).set(values).where(eq(utentiTable.id, id));
  users.add(id);
  return (await loadSessionUser(id))!;
}
