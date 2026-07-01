import type { Response } from "express";
import { db } from "@workspace/db";
import {
  bolleTable,
  bollaRigheTable,
  consegneTable,
  interventiTable,
  lottiTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  prodottiTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { parseDbNumber } from "./disponibilitaMagazzino";

const PRENOTAZIONE_ATTIVA = "attiva";
const PRENOTAZIONE_CONVERTITA = "convertita_in_scarico";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BollaActionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handleBollaActionError(err: unknown, res: Response): boolean {
  if (err instanceof BollaActionError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

// mappa tipo prodotto -> etichetta tipo intervento sociale
const TIPO_PRODOTTO_INTERVENTO: Record<string, string> = {
  alimentare: "pacco_alimentare",
  vestiario: "vestiti",
  igiene: "igiene",
  medicinali: "medicinali",
  farmaci: "medicinali",
};

const LABEL_INTERVENTO: Record<string, string> = {
  pacco_alimentare: "Pacco Alimentare",
  vestiti: "Vestiti",
  igiene: "Igiene",
  medicinali: "Medicinali",
};

export async function lockBolla(tx: Tx, bollaId: number): Promise<typeof bolleTable.$inferSelect> {
  await tx.execute(sql`SELECT id FROM ${bolleTable} WHERE ${bolleTable.id} = ${bollaId} FOR UPDATE`);
  const [bolla] = await tx.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) throw new BollaActionError(404, "Bolla non trovata");
  return bolla;
}

export async function lockLotto(tx: Tx, lottoId: number): Promise<typeof lottiTable.$inferSelect> {
  await tx.execute(sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${lottoId} FOR UPDATE`);
  const [lotto] = await tx.select().from(lottiTable).where(eq(lottiTable.id, lottoId));
  if (!lotto) throw new BollaActionError(404, "Lotto non trovato");
  return lotto;
}

async function syncInterventoBollaTx(tx: Tx, bollaId: number) {
  const [bolla] = await tx.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) return;

  const righe = await tx
    .select({ tipoProdotto: prodottiTable.tipoProdotto })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .where(eq(bollaRigheTable.bollaId, bollaId));

  const [esistente] = await tx.select().from(interventiTable).where(eq(interventiTable.bollaId, bollaId));

  if (righe.length === 0) {
    if (esistente) await tx.delete(interventiTable).where(eq(interventiTable.id, esistente.id));
    return;
  }

  const etichette: string[] = [];
  for (const r of righe) {
    const tipo = r.tipoProdotto ?? "";
    const label = TIPO_PRODOTTO_INTERVENTO[tipo] ?? (tipo || "consegna");
    if (!etichette.includes(label)) etichette.push(label);
  }
  const tipoIntervento = etichette.join(",");
  const descLabels = etichette.map(e => LABEL_INTERVENTO[e] ?? e).join(", ");
  const descrizione = `Consegna automatica da bolla ${bolla.numeroBolla}: ${descLabels}`;

  if (esistente) {
    await tx.update(interventiTable)
      .set({
        tipoIntervento,
        descrizione,
        beneficiarioId: bolla.beneficiarioId,
        dataIntervento: bolla.dataBolla,
        operatoreId: bolla.operatoreId,
      })
      .where(eq(interventiTable.id, esistente.id));
  } else {
    await tx.insert(interventiTable).values({
      beneficiarioId: bolla.beneficiarioId,
      bollaId,
      dataIntervento: bolla.dataBolla,
      tipoIntervento,
      descrizione,
      operatoreId: bolla.operatoreId,
    });
  }
}

export async function syncInterventoBolla(bollaId: number) {
  await db.transaction((tx) => syncInterventoBollaTx(tx, bollaId));
}

export async function removeInterventoBolla(bollaId: number) {
  await db.delete(interventiTable).where(eq(interventiTable.bollaId, bollaId));
}

export async function stornoRigaTx(tx: Tx, riga: { id: number }, bollaId: number) {
  const movimenti = await tx.select()
    .from(movimentiTable)
    .where(and(
      eq(movimentiTable.bollaId, bollaId),
      eq(movimentiTable.bollaRigaId, riga.id),
    ));

  for (const mov of movimenti) {
    if (!mov.lottoId) continue;
    const lotto = await lockLotto(tx, mov.lottoId);
    const nuovaQta = parseDbNumber(lotto.quantitaResidua) + parseDbNumber(mov.quantita);
    await tx.update(lottiTable)
      .set({ quantitaResidua: nuovaQta.toFixed(2) })
      .where(eq(lottiTable.id, mov.lottoId));
  }

  await tx.delete(movimentiTable).where(
    and(eq(movimentiTable.bollaId, bollaId), eq(movimentiTable.bollaRigaId, riga.id)),
  );
}

export async function scarichiFisiciBolla(tx: Tx, bollaId: number): Promise<number> {
  const rows = await tx
    .select({ id: movimentiTable.id })
    .from(movimentiTable)
    .where(and(eq(movimentiTable.bollaId, bollaId), eq(movimentiTable.tipoMovimento, "scarico")));
  return rows.length;
}

async function convertiPrenotazioniAttiveInScarico(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  opts: { dataMovimento: string },
): Promise<number> {
  const prenotazioni = await tx
    .select({ p: prenotazioniMagazzinoTable, r: bollaRigheTable })
    .from(prenotazioniMagazzinoTable)
    .leftJoin(bollaRigheTable, eq(prenotazioniMagazzinoTable.rigaBollaId, bollaRigheTable.id))
    .where(and(
      eq(prenotazioniMagazzinoTable.bollaId, bolla.id),
      eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
    ));

  for (const row of prenotazioni) {
    const prenotazione = row.p;
    const qta = parseDbNumber(prenotazione.quantita);
    const lotto = await lockLotto(tx, prenotazione.lottoId);
    const residua = parseDbNumber(lotto.quantitaResidua);
    if (residua < qta) {
      throw new BollaActionError(
        409,
        `Impossibile consegnare la bolla: il lotto ${lotto.codiceLotto ?? `#${lotto.id}`} ha ${residua.toFixed(2)} disponibili ma risultano prenotati ${qta.toFixed(2)}`,
      );
    }

    await tx.update(lottiTable)
      .set({ quantitaResidua: (residua - qta).toFixed(2) })
      .where(eq(lottiTable.id, lotto.id));

    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: opts.dataMovimento,
      magazzinoId: prenotazione.magazzinoId,
      prodottoId: prenotazione.prodottoId,
      lottoId: prenotazione.lottoId,
      quantita: prenotazione.quantita,
      unitaMisura: row.r?.unitaMisura ?? "pz",
      beneficiarioId: bolla.beneficiarioId,
      bollaId: bolla.id,
      bollaRigaId: prenotazione.rigaBollaId,
      documentoRiferimento: bolla.numeroBolla,
      note: row.r?.note ?? undefined,
    });

    await tx.update(prenotazioniMagazzinoTable)
      .set({ stato: PRENOTAZIONE_CONVERTITA, updatedAt: new Date() })
      .where(eq(prenotazioniMagazzinoTable.id, prenotazione.id));
  }

  return prenotazioni.length;
}

async function syncConsegnaDaBollaTx(tx: Tx, bolla: typeof bolleTable.$inferSelect) {
  const now = new Date();

  if (bolla.consegnaId != null) {
    const [consegna] = await tx.select().from(consegneTable).where(eq(consegneTable.id, bolla.consegnaId));
    if (consegna) {
      if (consegna.stato !== "effettuata") {
        await tx.update(consegneTable)
          .set({ stato: "effettuata", dataEffettuata: now })
          .where(eq(consegneTable.id, bolla.consegnaId));
      }
      return;
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const codice = `CON-${Date.now()}`;
  const [nuova] = await tx.insert(consegneTable).values({
    codice,
    beneficiarioId: bolla.beneficiarioId,
    tipoConsegna: "diretta",
    dataPrevista: today,
    magazzinoId: bolla.magazzinoId,
    stato: "effettuata",
    dataEffettuata: now,
    noteOperative: `Consegna diretta registrata dalla bolla ${bolla.numeroBolla}`,
  }).returning();
  await tx.update(bolleTable).set({ consegnaId: nuova.id }).where(eq(bolleTable.id, bolla.id));
}

export async function completeBollaDelivery(opts: {
  bollaId: number;
  userId: number;
  noteRicezione?: string | null;
  confermaRicezione?: boolean;
  allowAlreadyConsegnata?: boolean;
}): Promise<{ alreadyConsegnata: boolean }> {
  const dataMovimento = new Date().toISOString().split("T")[0];
  let alreadyConsegnata = false;

  await db.transaction(async (tx) => {
    const current = await lockBolla(tx, opts.bollaId);

    if (current.stato === "consegnato") {
      if (!opts.allowAlreadyConsegnata) {
        throw new BollaActionError(400, "La bolla risulta già consegnata");
      }
      alreadyConsegnata = true;
      await syncInterventoBollaTx(tx, opts.bollaId);
      await syncConsegnaDaBollaTx(tx, current);
      return;
    }

    if (current.stato !== "confermato") {
      throw new BollaActionError(400, "La bolla deve essere in stato confermato per essere consegnata");
    }

    const convertite = await convertiPrenotazioniAttiveInScarico(tx, current, { dataMovimento });
    if (convertite === 0) {
      const scarichiLegacy = await scarichiFisiciBolla(tx, opts.bollaId);
      if (scarichiLegacy === 0) {
        throw new BollaActionError(409, "Nessuna prenotazione attiva da convertire in scarico per questa bolla");
      }
    }

    const [updated] = await tx.update(bolleTable).set({
      stato: "consegnato",
      confermaRicezione: opts.confermaRicezione ?? true,
      noteRicezione: opts.noteRicezione ?? null,
      operatoreId: opts.userId,
    }).where(eq(bolleTable.id, opts.bollaId)).returning();

    await syncInterventoBollaTx(tx, opts.bollaId);
    await syncConsegnaDaBollaTx(tx, updated ?? { ...current, stato: "consegnato", operatoreId: opts.userId });
  });

  return { alreadyConsegnata };
}
