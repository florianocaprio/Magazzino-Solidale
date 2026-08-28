import { createHash } from "node:crypto";
import {
  centriAscoltoTable,
  db,
  registroVolontariEventiTable,
  ruoliVolontariTable,
  volontariTable,
} from "@workspace/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { VolontariTx } from "./volontariOperational";

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

type VolunteerSnapshotSource = Pick<
  typeof volontariTable.$inferSelect,
  | "id"
  | "matricola"
  | "nome"
  | "cognome"
  | "codiceFiscale"
  | "dataNascita"
  | "luogoNascita"
  | "indirizzoResidenza"
  | "indirizzoDomicilio"
  | "codiceFiscaleNonDisponibile"
  | "codiceFiscaleNota"
  | "dataIscrizione"
  | "progressivoRegistro"
  | "tipoVolontario"
  | "centroAscoltoId"
  | "ruoloVolontarioId"
  | "ruolo"
  | "statoApprovazione"
  | "dataInizioImportata"
  | "gruppoImportatoOriginale"
  | "categoriaImportataOriginale"
  | "versione"
>;

async function volunteerIdentitySnapshot(
  tx: VolontariTx,
  volunteer: VolunteerSnapshotSource,
) {
  const [[center], [role]] = await Promise.all([
    volunteer.centroAscoltoId == null
      ? Promise.resolve([])
      : tx
          .select({ nome: centriAscoltoTable.nome })
          .from(centriAscoltoTable)
          .where(eq(centriAscoltoTable.id, volunteer.centroAscoltoId))
          .limit(1),
    volunteer.ruoloVolontarioId == null
      ? Promise.resolve([])
      : tx
          .select({ nome: ruoliVolontariTable.nome })
          .from(ruoliVolontariTable)
          .where(eq(ruoliVolontariTable.id, volunteer.ruoloVolontarioId))
          .limit(1),
  ]);
  return {
    volontarioId: volunteer.id,
    matricola: volunteer.matricola ?? null,
    nome: volunteer.nome,
    cognome: volunteer.cognome,
    codiceFiscale: volunteer.codiceFiscale ?? null,
    dataNascita: volunteer.dataNascita ?? null,
    luogoNascita: volunteer.luogoNascita ?? null,
    indirizzoResidenza: volunteer.indirizzoResidenza ?? null,
    indirizzoDomicilio: volunteer.indirizzoDomicilio ?? null,
    codiceFiscaleNonDisponibile: volunteer.codiceFiscaleNonDisponibile,
    codiceFiscaleNota: volunteer.codiceFiscaleNota ?? null,
    dataIscrizione: volunteer.dataIscrizione ?? null,
    progressivoRegistro: volunteer.progressivoRegistro,
    tipoVolontario: volunteer.tipoVolontario,
    centroAscoltoId: volunteer.centroAscoltoId ?? null,
    centroAscoltoNome: center?.nome ?? null,
    ruoloVolontarioId: volunteer.ruoloVolontarioId ?? null,
    ruoloNome: role?.nome ?? volunteer.ruolo,
    ruoloVolontarioNome: role?.nome ?? volunteer.ruolo,
    statoApprovazione: volunteer.statoApprovazione,
    dataInizioImportata: volunteer.dataInizioImportata ?? null,
    gruppoImportatoOriginale: volunteer.gruppoImportatoOriginale ?? null,
    categoriaImportataOriginale: volunteer.categoriaImportataOriginale ?? null,
  };
}

export async function buildVolunteerRegistrationSnapshot(
  tx: VolontariTx,
  volunteer: VolunteerSnapshotSource,
  input: {
    origine: "MANUALE" | "IMPORT_VOLONTARI_2_0";
    dataInizio: string;
    importazioneId?: number | null;
    numeroRiga?: number | null;
  },
): Promise<Record<string, unknown>> {
  return {
    ...(await volunteerIdentitySnapshot(tx, volunteer)),
    origine: input.origine,
    dataInizio: input.dataInizio,
    importazioneId: input.importazioneId ?? null,
    numeroRiga: input.numeroRiga ?? null,
  };
}

export async function buildVolunteerEventSnapshot(
  tx: VolontariTx,
  volunteer: VolunteerSnapshotSource,
  input: {
    statoPrecedente: string | null;
    nuovoStato: string;
    motivo: string | null;
    dataEffettiva: string;
    riferimentoEventoId?: number | null;
    versione?: number;
    datiEvento?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  return {
    ...(await volunteerIdentitySnapshot(tx, volunteer)),
    statoPrecedente: input.statoPrecedente,
    nuovoStato: input.nuovoStato,
    motivo: input.motivo,
    dataEffettiva: input.dataEffettiva,
    riferimentoEventoId: input.riferimentoEventoId ?? null,
    versione: input.versione ?? volunteer.versione,
    datiEvento: input.datiEvento ?? {},
  };
}

type LedgerEventHashInput = {
  sezione: "PERMANENTE" | "TEMPORANEO";
  tipoEvento:
    | "REGISTRAZIONE"
    | "SOSPENSIONE_CESSAZIONE"
    | "RIATTIVAZIONE"
    | "GIORNATA_TEMPORANEA"
    | "CONVERSIONE_PERMANENTE"
    | "AGGIORNAMENTO_ANAGRAFICA"
    | "RETTIFICA";
  volontarioId: number;
  centroAscoltoId?: number | null;
  dataEffettiva: string;
  snapshot: Record<string, unknown>;
  utenteId?: number | null;
  eventoRettificatoId?: number | null;
};

function normalizedLedgerInput(input: LedgerEventHashInput) {
  return {
    sezione: input.sezione,
    tipoEvento: input.tipoEvento,
    volontarioId: input.volontarioId,
    centroAscoltoId: input.centroAscoltoId ?? null,
    dataEffettiva: input.dataEffettiva,
    snapshot: input.snapshot,
    utenteId: input.utenteId ?? null,
    eventoRettificatoId: input.eventoRettificatoId ?? null,
  };
}

export function canonicalLedgerEventHash(
  input: LedgerEventHashInput & {
    progressivo: number;
    hashPrecedente: string | null;
  },
): string {
  return createHash("sha256")
    .update(stable(normalizedLedgerInput(input)))
    .digest("hex");
}

export async function appendVolontarioLedgerEvent(
  tx: VolontariTx,
  input: LedgerEventHashInput,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('registro-volontari-ledger'))`,
  );
  const [previous] = await tx
    .select({
      progressivo: registroVolontariEventiTable.progressivo,
      hashEvento: registroVolontariEventiTable.hashEvento,
    })
    .from(registroVolontariEventiTable)
    .orderBy(desc(registroVolontariEventiTable.progressivo))
    .limit(1);
  const hashPrecedente = previous?.hashEvento ?? null;
  const progressivo = (previous?.progressivo ?? 0) + 1;
  const normalized = normalizedLedgerInput(input);
  const hashEvento = canonicalLedgerEventHash({
    ...normalized,
    progressivo,
    hashPrecedente,
  });
  const [event] = await tx
    .insert(registroVolontariEventiTable)
    .values({
      ...normalized,
      progressivo,
      hashPrecedente,
      hashEvento,
    })
    .returning();
  return event;
}

export function canonicalSnapshotHash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export async function verifyVolontarioLedgerChain(
  executor: typeof db | VolontariTx = db,
) {
  const rows = await executor
    .select()
    .from(registroVolontariEventiTable)
    .orderBy(asc(registroVolontariEventiTable.progressivo));
  const eventById = new Map(rows.map((row) => [row.id, row]));
  let previousHash: string | null = null;
  let expectedProgressive = 1;
  for (const row of rows) {
    const referencedEvent =
      row.eventoRettificatoId == null
        ? null
        : eventById.get(row.eventoRettificatoId);
    if (
      (row.tipoEvento === "RETTIFICA" && row.eventoRettificatoId == null) ||
      (row.eventoRettificatoId != null &&
        (!referencedEvent || referencedEvent.progressivo >= row.progressivo))
    ) {
      return {
        valid: false,
        eventoId: row.id,
        progressivo: row.progressivo,
        reason: "RIFERIMENTO_RETTIFICA_NON_VALIDO",
      };
    }
    const calculated = canonicalLedgerEventHash({
      sezione: row.sezione as LedgerEventHashInput["sezione"],
      tipoEvento: row.tipoEvento as LedgerEventHashInput["tipoEvento"],
      volontarioId: row.volontarioId,
      centroAscoltoId: row.centroAscoltoId,
      dataEffettiva: row.dataEffettiva,
      snapshot: row.snapshot,
      utenteId: row.utenteId,
      eventoRettificatoId: row.eventoRettificatoId,
      progressivo: row.progressivo,
      hashPrecedente: row.hashPrecedente,
    });
    if (
      row.progressivo !== expectedProgressive ||
      row.hashPrecedente !== previousHash ||
      row.hashEvento !== calculated
    ) {
      return {
        valid: false,
        eventoId: row.id,
        progressivo: row.progressivo,
        reason:
          row.progressivo !== expectedProgressive
            ? "PROGRESSIVO_NON_CONSECUTIVO"
            : row.hashPrecedente !== previousHash
              ? "HASH_PRECEDENTE_NON_VALIDO"
              : "HASH_EVENTO_NON_VALIDO",
        expectedProgressive,
        expectedPreviousHash: previousHash,
        calculatedHash: calculated,
      };
    }
    previousHash = row.hashEvento;
    expectedProgressive += 1;
  }
  return {
    valid: true,
    eventi: rows.length,
    ultimoProgressivo: rows.at(-1)?.progressivo ?? 0,
    ultimoHash: previousHash,
  };
}
