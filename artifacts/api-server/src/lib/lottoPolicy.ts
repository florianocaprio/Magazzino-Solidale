import { lottiTable } from "@workspace/db";
import { gte, isNull, lt, or, type SQL } from "drizzle-orm";
import { dataCivileEuropeRome } from "./interventiWorkflow";

export type LottoSelectionPolicy = "distribuibile" | "scaduto" | "qualsiasi";

export function dataOperativaEuropeRome(now = new Date()): string {
  return dataCivileEuropeRome(now);
}

export function lottoDistribuibileCondition(
  dataOperativa = dataOperativaEuropeRome(),
): SQL {
  return or(
    isNull(lottiTable.dataScadenza),
    gte(lottiTable.dataScadenza, dataOperativa),
  )!;
}

export function lottoScadutoCondition(
  dataOperativa = dataOperativaEuropeRome(),
): SQL {
  return lt(lottiTable.dataScadenza, dataOperativa);
}

export function lottoSelectionCondition(
  policy: LottoSelectionPolicy,
  dataOperativa = dataOperativaEuropeRome(),
): SQL | undefined {
  if (policy === "distribuibile") {
    return lottoDistribuibileCondition(dataOperativa);
  }
  if (policy === "scaduto") {
    return lottoScadutoCondition(dataOperativa);
  }
  return undefined;
}

export function isLottoDistribuibile(
  dataScadenza: string | null | undefined,
  dataOperativa = dataOperativaEuropeRome(),
): boolean {
  return dataScadenza == null || dataScadenza >= dataOperativa;
}
