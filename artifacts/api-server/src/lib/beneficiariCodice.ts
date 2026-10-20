import {
  areeOperativeTable,
  beneficiariTable,
  configurazioniCodiciBeneficiariTable,
  progressiviCodiciBeneficiariTable,
  db,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  formatPermanentVolunteerIdentifier,
  validatePermanentIdentifierConfiguration,
} from "./volontariMatricola";

type BeneficiarioTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class BeneficiaryCodeError extends Error {}

export function validateBeneficiaryCodeConfiguration(
  input: Parameters<typeof validatePermanentIdentifierConfiguration>[0],
) {
  if (typeof input.includiCodiceArea !== "boolean")
    throw new Error("Indicare se includere il codice Area");
  const config = validatePermanentIdentifierConfiguration(input);
  if (config.numeroIniziale >= 10 ** config.cifreProgressivo)
    throw new Error("Il numero iniziale supera le cifre del progressivo");
  // La colonna anagrafica resta di 20 caratteri: riservare fino a 8 per l'Area.
  const example = formatPermanentVolunteerIdentifier(
    { ...config, id: 0, versione: 0 },
    "XXXXXXXX",
    config.numeroIniziale,
  );
  if (example.length > 20)
    throw new Error(
      "La configurazione può superare i 20 caratteri del codice beneficiario: riduci prefisso, segmento o cifre",
    );
  return config;
}

/** Chiamare nella stessa transazione dell'inserimento del beneficiario. */
export async function allocateBeneficiaryCode(
  tx: BeneficiarioTx,
  areaId: number | null,
): Promise<string> {
  // Stessa serratura del cambio configurazione, prima di leggere regola e contatore.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('beneficiari-codici'))`,
  );
  const [config] = await tx
    .select()
    .from(configurazioniCodiciBeneficiariTable)
    .where(eq(configurazioniCodiciBeneficiariTable.attiva, true))
    .orderBy(desc(configurazioniCodiciBeneficiariTable.versione))
    .limit(1);
  if (!config)
    throw new BeneficiaryCodeError(
      "Configurazione codici beneficiari non disponibile",
    );
  let areaCode: string | null = null;
  if (config.includiCodiceArea || config.ambitoProgressivo === "PER_AREA") {
    const [area] =
      areaId == null
        ? []
        : await tx
            .select()
            .from(areeOperativeTable)
            .where(eq(areeOperativeTable.id, areaId));
    if (!area)
      throw new BeneficiaryCodeError(
        "Assegna un’Area Operativa per generare il codice beneficiario",
      );
    areaCode =
      (area.codiceMatricola ?? area.sigla)?.trim().toUpperCase() || null;
    if (config.includiCodiceArea && !areaCode)
      throw new BeneficiaryCodeError(
        "Configura il codice o la sigla dell’Area Operativa",
      );
  }
  const scopeKey =
    config.ambitoProgressivo === "PER_AREA" ? `AREA:${areaId}` : "GLOBALE";
  const [counter] = await tx
    .select()
    .from(progressiviCodiciBeneficiariTable)
    .where(
      and(
        eq(progressiviCodiciBeneficiariTable.configurazioneId, config.id),
        eq(progressiviCodiciBeneficiariTable.scopeKey, scopeKey),
      ),
    );
  let number = counter ? counter.ultimoNumero + 1 : config.numeroIniziale;
  for (; number < 10 ** config.cifreProgressivo; number += 1) {
    const codice = formatPermanentVolunteerIdentifier(config, areaCode, number);
    if (codice.length > 20)
      throw new BeneficiaryCodeError(
        "Il codice beneficiario supera i 20 caratteri",
      );
    const [used] = await tx
      .select({ id: beneficiariTable.id })
      .from(beneficiariTable)
      .where(sql`upper(trim(${beneficiariTable.codice})) = ${codice}`)
      .limit(1);
    if (used) continue;
    if (counter)
      await tx
        .update(progressiviCodiciBeneficiariTable)
        .set({
          ultimoNumero: number,
          versione: counter.versione + 1,
          dataAggiornamento: new Date(),
        })
        .where(eq(progressiviCodiciBeneficiariTable.id, counter.id));
    else
      await tx
        .insert(progressiviCodiciBeneficiariTable)
        .values({
          configurazioneId: config.id,
          scopeKey,
          scopeTipo:
            config.ambitoProgressivo === "PER_AREA" ? "AREA" : "GLOBALE",
          areaOperativaId:
            config.ambitoProgressivo === "PER_AREA" ? areaId : null,
          ultimoNumero: number,
        });
    return codice;
  }
  throw new BeneficiaryCodeError(
    "Progressivo codici beneficiari esaurito: aggiorna la configurazione in Super Admin",
  );
}
