import {
  approvvigionamentiTable,
  beneficiariTable,
  bolleTable,
  consegneTable,
  db,
  interventiMaterialiTable,
  lottiTable,
  menseTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  scarichiTable,
  sessioniCassaEmporioTable,
  speseEmporioTable,
  trasferimentiTable,
} from "@workspace/db";
import { eq, or } from "drizzle-orm";

/**
 * Restituisce il motivo che impedisce la cancellazione fisica di un magazzino.
 * Le bolle hanno precedenza perché costituiscono documenti storici emessi.
 */
export async function magazzinoDeletionBlockReason(
  magazzinoId: number,
  options: { ignoreMensaId?: number } = {},
): Promise<string | null> {
  const linkedBolla = await db
    .select({ id: bolleTable.id })
    .from(bolleTable)
    .where(eq(bolleTable.magazzinoId, magazzinoId))
    .limit(1);
  if (linkedBolla.length > 0) {
    return "Il magazzino è presente in una bolla e non può essere eliminato. Puoi disattivarlo.";
  }

  if (options.ignoreMensaId == null) {
    const linkedMensa = await db
      .select({ id: menseTable.id })
      .from(menseTable)
      .where(eq(menseTable.magazzinoId, magazzinoId))
      .limit(1);
    if (linkedMensa.length > 0) {
      return "Il magazzino è collegato a una Mensa e non può essere eliminato. Puoi disattivarlo.";
    }
  }

  const checks = await Promise.all([
    db
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, magazzinoId))
      .limit(1),
    db
      .select({ id: lottiTable.id })
      .from(lottiTable)
      .where(eq(lottiTable.magazzinoId, magazzinoId))
      .limit(1),
    db
      .select({ id: trasferimentiTable.id })
      .from(trasferimentiTable)
      .where(
        or(
          eq(trasferimentiTable.magazzinoOrigineId, magazzinoId),
          eq(trasferimentiTable.magazzinoDestinoId, magazzinoId),
        ),
      )
      .limit(1),
    db
      .select({ id: consegneTable.id })
      .from(consegneTable)
      .where(
        or(
          eq(consegneTable.magazzinoId, magazzinoId),
          eq(consegneTable.magazzinoEmporioId, magazzinoId),
        ),
      )
      .limit(1),
    db
      .select({ id: scarichiTable.id })
      .from(scarichiTable)
      .where(eq(scarichiTable.magazzinoId, magazzinoId))
      .limit(1),
    db
      .select({ id: approvvigionamentiTable.id })
      .from(approvvigionamentiTable)
      .where(eq(approvvigionamentiTable.magazzinoId, magazzinoId))
      .limit(1),
    db
      .select({ id: prenotazioniMagazzinoTable.id })
      .from(prenotazioniMagazzinoTable)
      .where(eq(prenotazioniMagazzinoTable.magazzinoId, magazzinoId))
      .limit(1),
    db
      .select({ id: interventiMaterialiTable.id })
      .from(interventiMaterialiTable)
      .where(eq(interventiMaterialiTable.magazzinoId, magazzinoId))
      .limit(1),
    db
      .select({ id: sessioniCassaEmporioTable.id })
      .from(sessioniCassaEmporioTable)
      .where(eq(sessioniCassaEmporioTable.magazzinoEmporioId, magazzinoId))
      .limit(1),
    db
      .select({ id: speseEmporioTable.id })
      .from(speseEmporioTable)
      .where(eq(speseEmporioTable.magazzinoEmporioId, magazzinoId))
      .limit(1),
    db
      .select({ id: beneficiariTable.id })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.magazzinoEmporioPreferitoId, magazzinoId))
      .limit(1),
  ]);
  if (checks.some((rows) => rows.length > 0)) {
    return "Il magazzino possiede dati o storico operativo e non può essere eliminato. Puoi disattivarlo.";
  }
  return null;
}
