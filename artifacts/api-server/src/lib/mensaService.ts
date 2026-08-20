import { beneficiariTable, mensaGiornateServizioTable } from "@workspace/db";
import { risolviFasciaEta } from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

export const MENSA_TIPI_SERVIZIO = ["pranzo", "cena"] as const;
export type MensaTipoServizio = (typeof MENSA_TIPI_SERVIZIO)[number];

export function tipoServizioMensa(value: unknown): MensaTipoServizio {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!MENSA_TIPI_SERVIZIO.includes(normalized as MensaTipoServizio)) {
    throw new Error("TIPO_SERVIZIO_MENSA_NON_VALIDO");
  }
  return normalized as MensaTipoServizio;
}

export function sessoSnapshotMensa(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "M" || normalized === "F") return normalized;
  if (normalized && normalized !== "ND") return "ALTRO" as const;
  return "ND" as const;
}

export function riferimentoDataServizio(dataServizio: string): Date {
  // Mezzogiorno UTC cade sempre nella stessa data civile Europe/Rome, anche ai
  // cambi d'ora, e rende il calcolo indipendente dal TZ del container.
  return new Date(`${dataServizio}T12:00:00.000Z`);
}

export async function snapshotBeneficiarioMensa(
  tx: InventoryTransaction,
  beneficiarioId: number,
  dataServizio: string,
) {
  const [beneficiario] = await tx
    .select({
      sesso: beneficiariTable.sesso,
      dataNascita: beneficiariTable.dataNascita,
      fasciaEtaPresunta: beneficiariTable.fasciaEtaPresunta,
      statoAnagrafica: beneficiariTable.statoAnagrafica,
    })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  if (!beneficiario) throw new Error("BENEFICIARIO_NON_TROVATO");
  const eta = risolviFasciaEta(
    beneficiario.dataNascita,
    beneficiario.fasciaEtaPresunta,
    riferimentoDataServizio(dataServizio),
  );
  return {
    sessoSnapshot: sessoSnapshotMensa(beneficiario.sesso),
    fasciaEtaSnapshot: eta.fascia,
    fasciaEtaOrigineSnapshot: eta.origine,
    anagraficaProvvisoriaSnapshot:
      beneficiario.statoAnagrafica === "provvisoria",
  };
}

export async function getOrCreateGiornataMensa(
  tx: InventoryTransaction,
  input: {
    mensaId: number;
    dataServizio: string;
    tipoServizio: MensaTipoServizio;
    operatoreId: number;
  },
) {
  await tx
    .insert(mensaGiornateServizioTable)
    .values({
      mensaId: input.mensaId,
      dataServizio: input.dataServizio,
      tipoServizio: input.tipoServizio,
      apertaDa: input.operatoreId,
    })
    .onConflictDoNothing({
      target: [
        mensaGiornateServizioTable.mensaId,
        mensaGiornateServizioTable.dataServizio,
        mensaGiornateServizioTable.tipoServizio,
      ],
    });
  const [giornata] = await tx
    .select()
    .from(mensaGiornateServizioTable)
    .where(
      and(
        eq(mensaGiornateServizioTable.mensaId, input.mensaId),
        eq(mensaGiornateServizioTable.dataServizio, input.dataServizio),
        eq(mensaGiornateServizioTable.tipoServizio, input.tipoServizio),
      ),
    )
    .for("update");
  if (!giornata) throw new Error("GIORNATA_MENSA_NON_DISPONIBILE");
  if (giornata.stato !== "aperta") throw new Error("GIORNATA_MENSA_CHIUSA");
  return giornata;
}
