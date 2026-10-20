import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  ruoliTable,
  utentiTable,
  menseTable,
  magazziniTable,
} from "@workspace/db";
import { initDbExtensions } from "../../src/lib/dbInit";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../../src/lib/configurazioneAmbiente";
import {
  createAreaOperativa,
  createMagazzino,
  createProdotto,
  createLotto,
  createUtente,
  newScope,
} from "../scope-helpers";

export async function m67aMensaFixture() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.M67A_DISPOSABLE_DB, "verified");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "59671");
  assert.equal(url.pathname, "/m67a_dev");
  await initDbExtensions();
  await ensureAmbienteModuli();
  for (const module of [
    "MENSA",
    "TRASFERIMENTI",
    "MAGAZZINO_SOLIDALE",
    "REPORT",
  ])
    await updateModuloAmbiente(module, true, null);
  const scope = newScope();
  const area = await createAreaOperativa(scope);
  const origin = await createMagazzino(scope, null, { areaOperativaId: area });
  const destinations = await Promise.all(
    [1, 2].map(() => createMagazzino(scope, null, { areaOperativaId: area })),
  );
  const canteens = [];
  for (const destination of destinations) {
    await db
      .update(magazziniTable)
      .set({ tipoMagazzino: "mensa" })
      .where(eq(magazziniTable.id, destination));
    const [mensa] = await db
      .insert(menseTable)
      .values({
        codice: `MEN-MAG-${destination}`,
        nome: `M67A Mensa ${destination}`,
        areaOperativaId: area,
        magazzinoId: destination,
      })
      .returning();
    canteens.push(mensa);
  }
  const product = await createProdotto(scope, {
    unitaMisura: "kg",
    quantitaFrazionabile: true,
  });
  await createLotto(scope, {
    prodottoId: product,
    magazzinoId: origin,
    quantita: 12,
  });
  async function user(
    kind: string,
    grants: string[],
    areas = ["mensa", "analisi"],
    isAdmin = false,
  ) {
    const [role] = await db
      .insert(ruoliTable)
      .values({
        nome: `M67A-${kind}-${randomUUID()}`,
        aree: areas,
        permessi: grants,
        isAdmin,
      })
      .returning();
    const id = await createUtente(scope, { ruoloId: role.id });
    const password = `Synthetic-${randomUUID()}-1!`;
    const [record] = await db
      .update(utentiTable)
      .set({
        areaOperativaId: area,
        passwordHash: await bcrypt.hash(password, 4),
      })
      .where(eq(utentiTable.id, id))
      .returning();
    return { id, roleId: role.id, username: record.username, password };
  }
  const report = "mensa.reports.view";
  const warehouseGrants = [
    "richieste_magazzino.view",
    "richieste_magazzino.take",
    "richieste_magazzino.prepare",
    "magazzino.view",
    "magazzino.transfers.create",
    "magazzino.transfers.prepare",
    "magazzino.transfers.dispatch",
  ];
  const users = {
    receiver: await user("receive", ["mensa.transfers.receive", report]),
    requester: await user("request", ["mensa.transfers.request", report]),
    manager: await user("manage", ["mensa.transfers.manage", report]),
    reporter: await user("reports", [report]),
    mixed: await user(
      "mixed",
      ["mensa.transfers.receive", ...warehouseGrants],
      ["mensa", "magazzino"],
    ),
    admin: await user("admin", [], [], true),
    warehouse: await user("warehouse", warehouseGrants, ["magazzino"]),
  };
  return { area, origin, product, canteens, users };
}

export function m67aNeed(
  fixture: Awaited<ReturnType<typeof m67aMensaFixture>>,
  mensaId = fixture.canteens[0].id,
) {
  return {
    idempotencyKey: randomUUID(),
    mensaId,
    magazzinoRichiestoId: fixture.origin,
    areaOperativaId: fixture.area,
    tipoDestinatario: "magazzino",
    sorgente: "operativa",
    bisogno: `Fabbisogno sintetico ${randomUUID()}`,
    priorita: "normale",
  };
}
