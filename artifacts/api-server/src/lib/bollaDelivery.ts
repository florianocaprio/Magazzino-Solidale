import type { Response } from "express";
import { db } from "@workspace/db";
import {
  bolleTable,
  bollaRigheTable,
  consegneTable,
  interventiStoricoStatiTable,
  interventiTable,
  lottiTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  prodottiTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { dataCivileEuropeRome } from "./interventiWorkflow";
import { requireOperationalMagazzino } from "./inventoryLedger";
import { isLottoDistribuibile } from "./lottoPolicy";
import { InventoryDecimal } from "./inventoryDecimal";
import {
  ensureDistributionOperation,
  markDistributionOperationReversed,
} from "./distributionLedger";
import { resolveInventoryQuantityDimensions } from "./inventoryQuantityDimensions";

const PRENOTAZIONE_ATTIVA = "attiva";
const PRENOTAZIONE_CONVERTITA = "convertita_in_scarico";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BollaActionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
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

export async function lockBolla(
  tx: Tx,
  bollaId: number,
): Promise<typeof bolleTable.$inferSelect> {
  await tx.execute(
    sql`SELECT id FROM ${bolleTable} WHERE ${bolleTable.id} = ${bollaId} FOR UPDATE`,
  );
  const [bolla] = await tx
    .select()
    .from(bolleTable)
    .where(eq(bolleTable.id, bollaId));
  if (!bolla) throw new BollaActionError(404, "Bolla non trovata");
  return bolla;
}

export async function lockLotto(
  tx: Tx,
  lottoId: number,
): Promise<typeof lottiTable.$inferSelect> {
  await tx.execute(
    sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${lottoId} FOR UPDATE`,
  );
  const [lotto] = await tx
    .select()
    .from(lottiTable)
    .where(eq(lottiTable.id, lottoId));
  if (!lotto) throw new BollaActionError(404, "Lotto non trovato");
  return lotto;
}

async function syncInterventoBollaTx(tx: Tx, bollaId: number) {
  const [bolla] = await tx
    .select()
    .from(bolleTable)
    .where(eq(bolleTable.id, bollaId));
  if (!bolla) return;

  const righe = await tx
    .select({ tipoProdotto: prodottiTable.tipoProdotto })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .where(eq(bollaRigheTable.bollaId, bollaId));

  const [esistente] = await tx
    .select()
    .from(interventiTable)
    .where(eq(interventiTable.bollaId, bollaId));

  if (righe.length === 0) {
    return;
  }

  const etichette: string[] = [];
  for (const r of righe) {
    const tipo = r.tipoProdotto ?? "";
    const label = TIPO_PRODOTTO_INTERVENTO[tipo] ?? (tipo || "consegna");
    if (!etichette.includes(label)) etichette.push(label);
  }
  const tipoIntervento = etichette.join(",");
  const descLabels = etichette.map((e) => LABEL_INTERVENTO[e] ?? e).join(", ");
  const descrizione = `Consegna automatica da bolla ${bolla.numeroBolla}: ${descLabels}`;

  if (esistente) {
    await tx
      .update(interventiTable)
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

export async function annullaInterventoDaBollaTx(
  tx: Tx,
  bollaId: number,
  operatoreId: number,
  motivo: string,
): Promise<void> {
  const [intervento] = await tx
    .select()
    .from(interventiTable)
    .where(eq(interventiTable.bollaId, bollaId))
    .for("update");
  if (!intervento || intervento.stato === "annullato") return;

  const now = new Date();
  await tx
    .update(interventiTable)
    .set({
      stato: "annullato",
      motivoAnnullamento: motivo,
      operatoreId,
      dataAggiornamento: now,
    })
    .where(eq(interventiTable.id, intervento.id));
  await tx.insert(interventiStoricoStatiTable).values({
    interventoId: intervento.id,
    statoPrecedente: intervento.stato,
    statoNuovo: "annullato",
    operatoreId,
    dataTransizione: now,
    motivo,
  });
}

export async function stornoRigaTx(
  tx: Tx,
  riga: { id: number },
  bollaId: number,
  operatoreId: number,
) {
  const movimenti = await tx
    .select()
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.bollaId, bollaId),
        eq(movimentiTable.bollaRigaId, riga.id),
        eq(movimentiTable.tipoMovimento, "scarico"),
      ),
    );

  for (const mov of movimenti) {
    if (!mov.lottoId) continue;
    const [stornoEsistente] = await tx
      .select({ id: movimentiTable.id })
      .from(movimentiTable)
      .where(eq(movimentiTable.movimentoOrigineId, mov.id));
    if (stornoEsistente) {
      throw new BollaActionError(
        409,
        "Il movimento della Bolla è già stato stornato",
      );
    }
    const lotto = await lockLotto(tx, mov.lottoId);
    const nuovaQta = InventoryDecimal.parse(lotto.quantitaResidua).add(
      InventoryDecimal.parse(mov.quantita),
    );
    await tx
      .update(lottiTable)
      .set({ quantitaResidua: nuovaQta.toDb() })
      .where(eq(lottiTable.id, mov.lottoId));
    await tx.insert(movimentiTable).values({
      tipoMovimento: "storno",
      tipoDettaglio: "storno_bolla",
      dataMovimento: dataCivileEuropeRome(new Date()),
      magazzinoId: mov.magazzinoId,
      prodottoId: mov.prodottoId,
      lottoId: mov.lottoId,
      quantita: mov.quantita,
      unitaMisura: mov.unitaMisura,
      fornitoreId: mov.fornitoreId,
      beneficiarioId: mov.beneficiarioId,
      bollaId: mov.bollaId,
      bollaRigaId: mov.bollaRigaId,
      trasferimentoId: mov.trasferimentoId,
      movimentoOrigineId: mov.id,
      quantitaPezzi: mov.quantitaPezzi,
      quantitaKgLt: mov.quantitaKgLt,
      fattoreKgLtPezzo: mov.fattoreKgLtPezzo,
      fondoOrigine: mov.fondoOrigine,
      naturaContabile: "STORNO",
      dominioOrigine: mov.dominioOrigine,
      entitaOrigineTipo: mov.entitaOrigineTipo,
      entitaOrigineId: mov.entitaOrigineId,
      rigaOrigineId: mov.rigaOrigineId,
      operazioneDistribuzioneId: mov.operazioneDistribuzioneId,
      canaleOperativo: mov.canaleOperativo,
      operatoreId,
      documentoRiferimento: mov.documentoRiferimento,
      note: `Storno del movimento #${mov.id}${mov.note ? ` — ${mov.note}` : ""}`,
    });
    await markDistributionOperationReversed(tx, mov.operazioneDistribuzioneId);
  }
}

export async function scarichiFisiciBolla(
  tx: Tx,
  bollaId: number,
): Promise<number> {
  const rows = await tx
    .select({ id: movimentiTable.id })
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.bollaId, bollaId),
        eq(movimentiTable.tipoMovimento, "scarico"),
      ),
    );
  return rows.length;
}

async function convertiPrenotazioniAttiveInScarico(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
  opts: { dataMovimento: string; operatoreId: number },
): Promise<number> {
  const prenotazioni = await tx
    .select({ p: prenotazioniMagazzinoTable, r: bollaRigheTable })
    .from(prenotazioniMagazzinoTable)
    .leftJoin(
      bollaRigheTable,
      eq(prenotazioniMagazzinoTable.rigaBollaId, bollaRigheTable.id),
    )
    .where(
      and(
        eq(prenotazioniMagazzinoTable.bollaId, bolla.id),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
      ),
    );

  const canaleOperativo =
    bolla.consegnaId != null ? "DOMICILIARE" : "RITIRO_SEDE";
  const operation = await ensureDistributionOperation(tx, {
    magazzinoId: bolla.magazzinoId,
    dataDistribuzione: opts.dataMovimento,
    canaleOperativo,
    dominioOrigine: "BOLLA",
    entitaOrigineTipo: "bolla",
    entitaOrigineId: bolla.id,
    numeroDocumento: bolla.numeroBolla,
    numeroPacchi: 1,
    creatoDa: opts.operatoreId,
  });

  for (const row of prenotazioni) {
    const prenotazione = row.p;
    const qta = InventoryDecimal.parse(prenotazione.quantita);
    const lotto = await lockLotto(tx, prenotazione.lottoId);
    if (!isLottoDistribuibile(lotto.dataScadenza, opts.dataMovimento)) {
      throw new BollaActionError(
        409,
        `Impossibile consegnare la bolla: il lotto ${lotto.codiceLotto ?? `#${lotto.id}`} è scaduto`,
      );
    }
    const residua = InventoryDecimal.parse(lotto.quantitaResidua);
    if (residua.compare(qta) < 0) {
      throw new BollaActionError(
        409,
        `Impossibile consegnare la bolla: il lotto ${lotto.codiceLotto ?? `#${lotto.id}`} ha ${residua.toCanonical()} disponibili ma risultano prenotati ${qta.toCanonical()}`,
      );
    }

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: residua.subtract(qta).toDb() })
      .where(eq(lottiTable.id, lotto.id));

    const unitaMisura = row.r?.unitaMisura ?? "pz";
    const dimensions = resolveInventoryQuantityDimensions({
      quantitaOperativa: prenotazione.quantita,
      unitaMisura,
      fattorePartita: lotto.fattoreKgLtPezzo,
    });

    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: opts.dataMovimento,
      magazzinoId: prenotazione.magazzinoId,
      prodottoId: prenotazione.prodottoId,
      lottoId: prenotazione.lottoId,
      quantita: prenotazione.quantita,
      quantitaPezzi: dimensions.quantitaPezzi,
      quantitaKgLt: dimensions.quantitaKgLt,
      fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
      unitaMisura,
      beneficiarioId: bolla.beneficiarioId,
      operatoreId: opts.operatoreId,
      bollaId: bolla.id,
      bollaRigaId: prenotazione.rigaBollaId,
      fondoOrigine: lotto.fondoOrigine,
      naturaContabile: "DISTRIBUZIONE_FINALE",
      dominioOrigine: "BOLLA",
      entitaOrigineTipo: "bolla",
      entitaOrigineId: bolla.id,
      rigaOrigineId: prenotazione.rigaBollaId,
      operazioneDistribuzioneId: operation.id,
      canaleOperativo,
      documentoRiferimento: bolla.numeroBolla,
      note: row.r?.note ?? undefined,
    });

    await tx
      .update(prenotazioniMagazzinoTable)
      .set({ stato: PRENOTAZIONE_CONVERTITA, updatedAt: new Date() })
      .where(eq(prenotazioniMagazzinoTable.id, prenotazione.id));
  }

  return prenotazioni.length;
}

async function syncConsegnaDaBollaTx(
  tx: Tx,
  bolla: typeof bolleTable.$inferSelect,
) {
  const now = new Date();

  if (bolla.consegnaId != null) {
    const [consegna] = await tx
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, bolla.consegnaId));
    if (consegna) {
      if (consegna.stato !== "effettuata") {
        await tx
          .update(consegneTable)
          .set({ stato: "effettuata", dataEffettuata: now })
          .where(eq(consegneTable.id, bolla.consegnaId));
      }
      return;
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const codice = `CON-${Date.now()}`;
  const [nuova] = await tx
    .insert(consegneTable)
    .values({
      codice,
      beneficiarioId: bolla.beneficiarioId,
      tipoConsegna: "diretta",
      dataPrevista: today,
      magazzinoId: bolla.magazzinoId,
      stato: "effettuata",
      dataEffettuata: now,
      noteOperative: `Consegna diretta registrata dalla bolla ${bolla.numeroBolla}`,
    })
    .returning();
  await tx
    .update(bolleTable)
    .set({ consegnaId: nuova.id })
    .where(eq(bolleTable.id, bolla.id));
}

export async function completeBollaDelivery(opts: {
  bollaId: number;
  userId: number;
  noteRicezione?: string | null;
  confermaRicezione?: boolean;
  allowAlreadyConsegnata?: boolean;
}): Promise<{ alreadyConsegnata: boolean }> {
  const dataMovimento = dataCivileEuropeRome(new Date());
  let alreadyConsegnata = false;

  await db.transaction(async (tx) => {
    const current = await lockBolla(tx, opts.bollaId);
    await requireOperationalMagazzino(tx, current.magazzinoId);

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
      throw new BollaActionError(
        400,
        "La bolla deve essere in stato confermato per essere consegnata",
      );
    }

    const convertite = await convertiPrenotazioniAttiveInScarico(tx, current, {
      dataMovimento,
      operatoreId: opts.userId,
    });
    if (convertite === 0) {
      const scarichiLegacy = await scarichiFisiciBolla(tx, opts.bollaId);
      if (scarichiLegacy === 0) {
        throw new BollaActionError(
          409,
          "Nessuna prenotazione attiva da convertire in scarico per questa bolla",
        );
      }
    }

    const [updated] = await tx
      .update(bolleTable)
      .set({
        stato: "consegnato",
        confermaRicezione: opts.confermaRicezione ?? true,
        noteRicezione: opts.noteRicezione ?? null,
        operatoreId: opts.userId,
      })
      .where(eq(bolleTable.id, opts.bollaId))
      .returning();

    await syncInterventoBollaTx(tx, opts.bollaId);
    await syncConsegnaDaBollaTx(
      tx,
      updated ?? { ...current, stato: "consegnato", operatoreId: opts.userId },
    );
  });

  return { alreadyConsegnata };
}
