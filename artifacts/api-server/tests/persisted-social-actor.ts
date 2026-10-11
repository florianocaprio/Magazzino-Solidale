import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, ruoliTable, utentiTable } from "@workspace/db";

/** Prepared once per scenario, never in the request middleware. */
export async function createPersistedSocialActor(input: {
  areaOperativaId: number | null;
  centroAscoltoId: number | null;
  aree: string[];
  permessi: string[];
  isAdmin?: boolean;
}) {
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `m63-r2-${randomUUID()}`,
      aree: input.aree,
      permessi: input.permessi,
      isAdmin: input.isAdmin ?? false,
    })
    .returning();
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `m63-r2-${randomUUID()}`,
      passwordHash: "test-only-no-login",
      nome: "Fixture sintetica",
      ruoloId: role.id,
      areaOperativaId: input.areaOperativaId,
      centroAscoltoId: input.centroAscoltoId,
      attivo: true,
      mustChangePassword: false,
    })
    .returning();
  const {
    rows: [current],
  } = await pool.query(
    `select u.attivo, r.aree, r.permessi, r.is_admin,
       a.attivo as area_attiva, c.attivo as centro_attivo,
       c.area_operativa_id as centro_area
     from utenti u join ruoli r on r.id=u.ruolo_id
     left join aree_operative a on a.id=u.area_operativa_id
     left join centri_di_ascolto c on c.id=u.centro_ascolto_id where u.id=$1`,
    [user.id],
  );
  assert.equal(current.attivo, true);
  assert.deepEqual(current.aree, input.aree);
  assert.deepEqual(current.permessi, input.permessi);
  assert.equal(current.is_admin, input.isAdmin ?? false);
  if (input.areaOperativaId != null) assert.equal(current.area_attiva, true);
  if (input.centroAscoltoId != null) {
    assert.equal(current.centro_attivo, true);
    assert.equal(current.centro_area, input.areaOperativaId);
  }
  return {
    id: user.id,
    ruoloId: role.id,
    username: user.username,
    ...input,
    zonaUdsId: null,
    isAdmin: input.isAdmin ?? false,
    isSuperAdmin: false,
  };
}
