/** Allowlist v1. Changing it creates a new representation, never rewrites history. */
export const FSE_MINIMIZATION_VERSION = "FSE_MINIMIZED_V1";

function pick<T extends Record<string, unknown>>(
  value: T,
  keys: readonly string[],
): T {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {} as T;
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(value, key))
      .flatMap((key) => {
        const item = value[key];
        if (
          item == null ||
          ["string", "number", "boolean"].includes(typeof item) ||
          item instanceof Date
        )
          return [[key, item]];
        if (key === "qualityCodesJson" && Array.isArray(item))
          return [
            [
              key,
              item.filter(
                (code) =>
                  typeof code === "string" &&
                  /^[A-Z][A-Z0-9_]{1,100}$/.test(code),
              ),
            ],
          ];
        return [];
      }),
  ) as T;
}

const headerKeys = [
  "id",
  "magazzinoId",
  "dataDa",
  "dataA",
  "dataAsOf",
  "timezone",
  "formatCode",
  "modelVersion",
  "stato",
  "maxMovimentoId",
  "maxOperazioneDistribuzioneId",
  "canonicalHash",
  "coveragePurpose",
  "legacyReviewRequired",
  "eventiTotali",
  "righeTotali",
  "righeBloccanti",
  "righeWarning",
  "creatoDa",
  "dataCreazione",
  "annullatoDa",
  "dataAnnullamento",
  "marcatoInseritoDa",
  "dataInserimentoEsterno",
  "versione",
] as const;
const eventKeys = [
  "id",
  "esportazioneId",
  "eventKey",
  "contentHash",
  "sourceType",
  "sourceId",
  "eventDate",
  "officialActivity",
  "internalChannel",
  "documentNumber",
  "packs",
  "meals",
  "occasionalPeople",
  "continuousPeople",
  "status",
  "qualityCodesJson",
  "activeCoverage",
  "administrativeStatus",
  "arretrato",
  "blocking",
  "correctionOfEventKey",
  "coveredAt",
] as const;
const lineKeys = [
  "id",
  "esportazioneEventoId",
  "lineKey",
  "contentHash",
  "movimentoId",
  "movimentoOrigineId",
  "accountingNature",
  "fund",
  "productId",
  "productCodeSnapshot",
  "productNameSnapshot",
  "lotId",
  "lotCodeSnapshot",
  "expirySnapshot",
  "quantityPiecesSigned",
  "quantityKgLtSigned",
  "factorKgLtPiece",
  "unitSnapshot",
  "reportingDisposition",
  "qualityCodesJson",
  "activeCoverage",
  "openingBalancePieces",
  "openingBalanceKgLt",
  "balanceAfterPieces",
  "balanceAfterKgLt",
] as const;
const statisticsKeys = [
  "packs",
  "meals",
  "occasionalPeople",
  "continuousPeople",
];
const indicatorKeys = [
  "minori18",
  "giovani18_29",
  "donne",
  "over65",
  "personeDisabilita",
  "cittadiniPaesiTerzi",
  "origineStranieraMinoranze",
  "senzatettoEsclusioneAbitativa",
  "totaleSaltuari",
  "fonte",
  "completezza",
  "versione",
];
export function minimizedIndicatorValues(value: Record<string, unknown>) {
  return pick(value, indicatorKeys);
}
export function minimizedExportHeader<T extends Record<string, unknown>>(
  header: T,
): T {
  return {
    ...pick(header, headerKeys),
    snapshotMetadataJson: pick(
      (header.snapshotMetadataJson ?? {}) as Record<string, unknown>,
      [
        "magazzinoId",
        "magazzinoNome",
        "areaOperativaId",
        "areaOperativaNome",
        "includeArretrati",
      ],
    ),
  };
}
export function minimizedExportEvent<T extends Record<string, unknown>>(
  event: T,
): T {
  return {
    ...pick(event, eventKeys),
    grossStatisticsJson: pick(
      (event.grossStatisticsJson ?? {}) as Record<string, unknown>,
      statisticsKeys,
    ),
    netStatisticsJson: pick(
      (event.netStatisticsJson ?? {}) as Record<string, unknown>,
      statisticsKeys,
    ),
  };
}
export function minimizedExportLine<T extends Record<string, unknown>>(
  line: T,
): T {
  return {
    ...pick(line, lineKeys),
    sourceLineageJson: pick(
      (line.sourceLineageJson ?? {}) as Record<string, unknown>,
      [
        "sourceDomain",
        "sourceEntityType",
        "sourceEntityId",
        "sourceLineId",
        "caricoMagazzinoRigaId",
        "operationDistributionId",
        "originalAccountingNature",
        "loadDateSnapshot",
      ],
    ),
  };
}
