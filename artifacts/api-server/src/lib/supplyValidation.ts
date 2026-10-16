import { and, eq } from "drizzle-orm";
import {
  magazziniTable,
  prodottiTable,
  centriAscoltoTable,
} from "@workspace/db";
import type { InventoryTransaction } from "./scaricoInventory";
import { requireCurrentM5bActor } from "./m5bRequestAccess";
import { CurrentCommandActorError } from "./currentCommandActor";
import { InventoryLedgerError } from "./inventoryLedger";
import { InventoryDecimal } from "./inventoryDecimal";
import {
  validateProductOperationalQuantity,
  ProductOperationalQuantityError,
} from "./productQuantity";

// Used after the order lock. Holds current actor/role/territory through commit.
export async function requireSupplyActor(
  tx: InventoryTransaction,
  userId: number,
  grant: string,
  warehouseId: number | null,
  centreId: number | null,
) {
  const a = await requireCurrentM5bActor(tx, userId, grant);
  const global =
    a.isAdmin && a.areaOperativaId == null && a.centroAscoltoId == null;
  if (
    (!a.isAdmin && !a.aree.includes("logistica")) ||
    (!global &&
      (a.areaOperativaId == null ||
        a.areaOperativaAttiva !== true ||
        (a.centroAscoltoId != null &&
          (!a.centroAscoltoAttivo ||
            a.centroAscoltoAreaOperativaId !== a.areaOperativaId))))
  )
    throw new CurrentCommandActorError(
      "Assegnazione territoriale valida richiesta",
    );
  if (warehouseId == null)
    throw new InventoryLedgerError(400, "Il Magazzino è obbligatorio");
  const [w] = await tx
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, warehouseId))
    .for("share");
  if (
    !w ||
    (!global &&
      (w.areaOperativaId !== a.areaOperativaId ||
        (a.centroAscoltoId != null &&
          w.centroAscoltoId != null &&
          w.centroAscoltoId !== a.centroAscoltoId)))
  )
    throw new CurrentCommandActorError(
      "Magazzino fuori dal territorio corrente",
    );
  if (centreId != null && !global) {
    const [c] = await tx
      .select()
      .from(centriAscoltoTable)
      .where(
        and(
          eq(centriAscoltoTable.id, centreId),
          eq(centriAscoltoTable.areaOperativaId, a.areaOperativaId!),
        ),
      )
      .for("share");
    if (!c || (a.centroAscoltoId != null && c.id !== a.centroAscoltoId))
      throw new CurrentCommandActorError(
        "Centro fuori dal territorio corrente",
      );
  }
  return a;
}

export async function validateSupplyRows(
  tx: InventoryTransaction,
  raw: unknown,
) {
  if (!Array.isArray(raw) || !raw.length)
    throw new InventoryLedgerError(400, "Indicare almeno una riga valida");
  const rows: Array<{
    prodottoId: number;
    quantitaRichiesta: string;
    unitaMisura: string;
    note?: string;
  }> = [];
  // Stable product lock order also protects against catalogue changes during receipt.
  const products = new Map<number, typeof prodottiTable.$inferSelect>();
  for (const id of [...new Set(raw.map((r) => r?.prodottoId))].sort(
    (a, b) => a - b,
  )) {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new InventoryLedgerError(400, "Prodotto non valido");
    const [p] = await tx
      .select()
      .from(prodottiTable)
      .where(eq(prodottiTable.id, id))
      .for("share");
    if (!p) throw new InventoryLedgerError(400, "Prodotto non trovato");
    products.set(id, p);
  }
  for (const r of raw) {
    const p = products.get(r.prodottoId)!;
    if (r.unitaMisura !== p.unitaMisura)
      throw new InventoryLedgerError(400, "Unità non coerente con il Catalogo");
    if (
      typeof r.quantitaRichiesta !== "string" &&
      typeof r.quantitaRichiesta !== "number"
    )
      throw new InventoryLedgerError(400, "Quantità non valida");
    try {
      const q = validateProductOperationalQuantity({
        quantita: r.quantitaRichiesta,
        quantitaFrazionabile: p.quantitaFrazionabile,
        prodottoLabel: p.nome,
      });
      if (q.compare(InventoryDecimal.parse("99999999.999999")) > 0)
        throw new InventoryLedgerError(
          400,
          "Quantità oltre il limite 99999999.999999",
        );
      rows.push({
        prodottoId: p.id,
        quantitaRichiesta: q.toDb(),
        unitaMisura: p.unitaMisura,
        note: r.note,
      });
    } catch (e) {
      if (e instanceof ProductOperationalQuantityError)
        throw new InventoryLedgerError(400, e.message);
      throw e;
    }
  }
  return rows;
}
