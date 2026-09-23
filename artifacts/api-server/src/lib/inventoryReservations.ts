import {
  db,
  lottiTable,
  prenotazioniMagazzinoTable,
  prodottiTable,
} from "@workspace/db";
import { and, asc, eq, gt, sum } from "drizzle-orm";
import { InventoryDecimal } from "./inventoryDecimal";
import {
  dataOperativaEuropeRome,
  isLottoDistribuibile,
  lottoDistribuibileCondition,
} from "./lottoPolicy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const PRENOTAZIONE_ATTIVA = "attiva";
export const PRENOTAZIONE_RILASCIATA = "rilasciata";
export const PRENOTAZIONE_CONVERTITA_TRASFERIMENTO =
  "convertita_in_trasferimento";

export class InventoryReservationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function committedQuantityForLot(
  tx: Tx,
  lottoId: number,
): Promise<InventoryDecimal> {
  const [row] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(
      and(
        eq(prenotazioniMagazzinoTable.lottoId, lottoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
      ),
    );
  return InventoryDecimal.parse(row?.totale ?? "0");
}

type ReservationOwner =
  | {
      bollaId: number;
      rigaBollaId: number;
      trasferimentoId?: never;
      rigaTrasferimentoId?: never;
    }
  | {
      trasferimentoId: number;
      rigaTrasferimentoId: number;
      bollaId?: never;
      rigaBollaId?: never;
    };

/** Called inside the document transaction, after the global inventory lock. */
export async function reserveInventoryRow(
  tx: Tx,
  opts: ReservationOwner & {
    prodottoId: number;
    magazzinoId: number;
    lottoId: number | null;
    quantita: string;
  },
): Promise<{
  firstLotId: number;
  allocations: Array<{ lottoId: number; quantita: string }>;
}> {
  const richiesta = InventoryDecimal.parse(opts.quantita);
  let rimanente = richiesta;
  const allocations: Array<{ lottoId: number; quantita: string }> = [];
  const [product] = await tx
    .select({ nome: prodottiTable.nome })
    .from(prodottiTable)
    .where(eq(prodottiTable.id, opts.prodottoId));
  const productName = product?.nome ?? `prodotto #${opts.prodottoId}`;

  const reserve = async (lottoId: number, quantita: InventoryDecimal) => {
    await tx.insert(prenotazioniMagazzinoTable).values({
      bollaId: opts.bollaId ?? null,
      rigaBollaId: opts.rigaBollaId ?? null,
      trasferimentoId: opts.trasferimentoId ?? null,
      rigaTrasferimentoId: opts.rigaTrasferimentoId ?? null,
      prodottoId: opts.prodottoId,
      lottoId,
      magazzinoId: opts.magazzinoId,
      quantita: quantita.toDb(),
      stato: PRENOTAZIONE_ATTIVA,
    });
    allocations.push({ lottoId, quantita: quantita.toDb() });
  };

  if (opts.lottoId != null) {
    const [lotto] = await tx
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, opts.lottoId))
      .for("update");
    if (
      !lotto ||
      lotto.prodottoId !== opts.prodottoId ||
      lotto.magazzinoId !== opts.magazzinoId
    ) {
      throw new InventoryReservationError(
        400,
        `Il lotto selezionato non appartiene al prodotto o al magazzino ${opts.bollaId != null ? "della bolla" : "del trasferimento"}`,
      );
    }
    if (!isLottoDistribuibile(lotto.dataScadenza)) {
      throw new InventoryReservationError(
        409,
        "Il lotto selezionato è scaduto e non può essere distribuito",
      );
    }
    const available = InventoryDecimal.parse(lotto.quantitaResidua).subtract(
      await committedQuantityForLot(tx, lotto.id),
    );
    if (available.compare(richiesta) < 0) {
      throw new InventoryReservationError(
        409,
        `Disponibilità reale insufficiente nel lotto ${lotto.codiceLotto ?? `#${lotto.id}`} per ${productName}: disponibili ${available.isNegative() ? "0" : available.toCanonical()}, richiesti ${richiesta.toCanonical()}`,
      );
    }
    await reserve(lotto.id, richiesta);
    return { firstLotId: lotto.id, allocations };
  }

  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, opts.prodottoId),
        eq(lottiTable.magazzinoId, opts.magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
        lottoDistribuibileCondition(dataOperativaEuropeRome()),
      ),
    )
    .orderBy(
      asc(lottiTable.dataScadenza),
      asc(lottiTable.dataCarico),
      asc(lottiTable.id),
    )
    .for("update");
  for (const lotto of lotti) {
    if (!rimanente.isPositive()) break;
    const available = InventoryDecimal.parse(lotto.quantitaResidua).subtract(
      await committedQuantityForLot(tx, lotto.id),
    );
    if (!available.isPositive()) continue;
    const portion = available.min(rimanente);
    await reserve(lotto.id, portion);
    rimanente = rimanente.subtract(portion);
  }
  if (rimanente.isPositive()) {
    throw new InventoryReservationError(
      409,
      `Disponibilità reale insufficiente per ${productName}: disponibili ${richiesta.subtract(rimanente).toCanonical()}, richiesti ${richiesta.toCanonical()}`,
    );
  }
  return { firstLotId: allocations[0].lottoId, allocations };
}
