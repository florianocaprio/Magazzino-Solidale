import {
  ambienteModuliTable,
  db,
  moduliFunzionaliTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  CONFIGURAZIONE_AMBIENTE_ID,
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "./configurazioneAmbiente";

export const EMPORIO_DISABLED_MSG = "Il modulo Emporio Solidale è disabilitato. Abilitalo da Impostazioni Moduli per utilizzare questa funzione.";
export const UNITA_STRADA_DISABLED_MSG = "La gestione Unità di Strada è disabilitata.";

const EMPORIO_CODICE = "EMPORIO_SOLIDALE";
const UDS_CODICE = "UDS";
const LEGACY_MODULO_CODES = [EMPORIO_CODICE, UDS_CODICE] as const;

export type ImpostazioniModuliDto = {
  emporioAbilitato: boolean;
  unitaStradaAbilitata: boolean;
  dataAggiornamento: string | null;
};

function selectLegacyModuli() {
  return db
    .select({
      codice: moduliFunzionaliTable.codice,
      core: moduliFunzionaliTable.core,
      attivoDefault: moduliFunzionaliTable.attivoDefault,
      attivo: ambienteModuliTable.attivo,
      dataAggiornamento: ambienteModuliTable.dataAggiornamento,
    })
    .from(moduliFunzionaliTable)
    .leftJoin(
      ambienteModuliTable,
      and(
        eq(ambienteModuliTable.moduloId, moduliFunzionaliTable.id),
        eq(ambienteModuliTable.configurazioneAmbienteId, CONFIGURAZIONE_AMBIENTE_ID),
      ),
    )
    .where(inArray(moduliFunzionaliTable.codice, [...LEGACY_MODULO_CODES]));
}

export async function getImpostazioniModuli(): Promise<ImpostazioniModuliDto> {
  let rows = await selectLegacyModuli();
  if (rows.length < LEGACY_MODULO_CODES.length) {
    await ensureAmbienteModuli();
    rows = await selectLegacyModuli();
  }

  const byCode = new Map(rows.map((row) => [row.codice, row]));
  const isActive = (codice: string): boolean => {
    const row = byCode.get(codice);
    return row ? row.core || (row.attivo ?? row.attivoDefault) : false;
  };
  const lastUpdate = rows.reduce<Date | null>((latest, row) => {
    if (!row.dataAggiornamento) return latest;
    return !latest || row.dataAggiornamento > latest ? row.dataAggiornamento : latest;
  }, null);

  return {
    emporioAbilitato: isActive(EMPORIO_CODICE),
    unitaStradaAbilitata: isActive(UDS_CODICE),
    dataAggiornamento: lastUpdate?.toISOString() ?? null,
  };
}

export async function updateImpostazioniModuli(
  values: Partial<Pick<ImpostazioniModuliDto, "emporioAbilitato" | "unitaStradaAbilitata">>,
  abilitatoDaId: number | null = null,
): Promise<ImpostazioniModuliDto> {
  const before = await getImpostazioniModuli();
  if (
    values.emporioAbilitato !== undefined &&
    values.emporioAbilitato !== before.emporioAbilitato
  ) {
    await updateModuloAmbiente(
      EMPORIO_CODICE,
      values.emporioAbilitato,
      abilitatoDaId,
    );
  }
  if (
    values.unitaStradaAbilitata !== undefined &&
    values.unitaStradaAbilitata !== before.unitaStradaAbilitata
  ) {
    await updateModuloAmbiente(
      UDS_CODICE,
      values.unitaStradaAbilitata,
      abilitatoDaId,
    );
  }
  return getImpostazioniModuli();
}

export async function isEmporioEnabled(): Promise<boolean> {
  return (await getImpostazioniModuli()).emporioAbilitato;
}

export async function isUnitaStradaEnabled(): Promise<boolean> {
  return (await getImpostazioniModuli()).unitaStradaAbilitata;
}
