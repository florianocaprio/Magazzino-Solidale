import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "./inventoryDecimal";

const FACTOR_SCALE = 9;
const FACTOR_BASE = 10n ** BigInt(FACTOR_SCALE);

export class InventoryQuantityDimensionsError extends Error {
  constructor(
    public readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

function parseFactor(raw: string | number | null | undefined): {
  units: bigint;
  db: string;
} | null {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim().replace(",", ".");
  if (typeof raw === "number" && /[eE]/.test(text)) {
    throw new InventoryQuantityDimensionsError(
      400,
      "Il fattore deve essere inviato come stringa decimale",
    );
  }
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (!match) {
    throw new InventoryQuantityDimensionsError(
      400,
      "Il fattore deve avere al massimo 9 decimali",
    );
  }
  const units =
    BigInt(match[1]) * FACTOR_BASE +
    BigInt((match[2] ?? "").padEnd(FACTOR_SCALE, "0"));
  if (units <= 0n) {
    throw new InventoryQuantityDimensionsError(
      400,
      "Il fattore Kg/Lt per pezzo deve essere positivo",
    );
  }
  return {
    units,
    db: `${match[1]}.${(match[2] ?? "").padEnd(FACTOR_SCALE, "0")}`,
  };
}

export function canonicalInventoryFactor(
  raw: string | number | null | undefined,
): string | null {
  return parseFactor(raw)?.db ?? null;
}

function parseOptionalQuantity(
  raw: string | number | null | undefined,
  field: string,
): InventoryDecimal | null {
  if (raw == null || raw === "") return null;
  try {
    return positiveInventoryDecimal(raw);
  } catch (error) {
    if (error instanceof InventoryDecimalError) {
      throw new InventoryQuantityDimensionsError(400, `${field}: ${error.message}`);
    }
    throw error;
  }
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function multiplyByFactor(
  quantity: InventoryDecimal,
  factorUnits: bigint,
): InventoryDecimal {
  return InventoryDecimal.fromUnits(
    roundHalfUp(quantity.toUnits() * factorUnits, FACTOR_BASE),
  );
}

function divideByFactor(
  quantity: InventoryDecimal,
  factorUnits: bigint,
): InventoryDecimal {
  return InventoryDecimal.fromUnits(
    roundHalfUp(quantity.toUnits() * FACTOR_BASE, factorUnits),
  );
}

function requireEqual(
  actual: InventoryDecimal,
  expected: InventoryDecimal,
  field: string,
): void {
  if (actual.compare(expected) !== 0) {
    throw new InventoryQuantityDimensionsError(
      400,
      `${field} non coerente con quantità operativa e fattore`,
    );
  }
}

export interface InventoryQuantityDimensionsInput {
  quantitaOperativa: string | number;
  unitaMisura: string;
  quantitaPezzi?: string | number | null;
  quantitaKgLt?: string | number | null;
  fattoreKgLtPezzo?: string | number | null;
  fattorePartita?: string | number | null;
}

export interface InventoryQuantityDimensions {
  quantitaOperativa: string;
  quantitaPezzi: string | null;
  quantitaKgLt: string | null;
  fattoreKgLtPezzo: string | null;
}

/**
 * Risolve le dimensioni inventariali usando fixed-point. Le moltiplicazioni e
 * divisioni applicano HALF_UP alla scala 6; i valori forniti devono coincidere
 * esattamente con il risultato canonico.
 */
export function resolveInventoryQuantityDimensions(
  input: InventoryQuantityDimensionsInput,
): InventoryQuantityDimensions {
  let operational: InventoryDecimal;
  try {
    operational = positiveInventoryDecimal(input.quantitaOperativa);
  } catch (error) {
    if (error instanceof InventoryDecimalError) {
      throw new InventoryQuantityDimensionsError(400, error.message);
    }
    throw error;
  }
  const suppliedFactor = parseFactor(input.fattoreKgLtPezzo);
  const partyFactor = parseFactor(input.fattorePartita);
  if (
    suppliedFactor != null &&
    partyFactor != null &&
    suppliedFactor.units !== partyFactor.units
  ) {
    throw new InventoryQuantityDimensionsError(
      409,
      "Fattore Pezzi/KgLt incompatibile con la Partita",
    );
  }
  const factor = partyFactor ?? suppliedFactor;
  const suppliedPieces = parseOptionalQuantity(input.quantitaPezzi, "quantitaPezzi");
  const suppliedKgLt = parseOptionalQuantity(input.quantitaKgLt, "quantitaKgLt");
  const unit = input.unitaMisura.trim().toLowerCase();

  let pieces: InventoryDecimal | null = null;
  let kgLt: InventoryDecimal | null = null;
  if (unit === "pz") {
    pieces = operational;
    if (suppliedPieces) requireEqual(suppliedPieces, pieces, "quantitaPezzi");
    if (factor) {
      kgLt = multiplyByFactor(pieces, factor.units);
      if (suppliedKgLt) requireEqual(suppliedKgLt, kgLt, "quantitaKgLt");
    } else if (suppliedKgLt) {
      throw new InventoryQuantityDimensionsError(
        400,
        "quantitaKgLt richiede il fattore Kg/Lt per pezzo",
      );
    }
  } else if (["kg", "lt", "l"].includes(unit)) {
    kgLt = operational;
    if (suppliedKgLt) requireEqual(suppliedKgLt, kgLt, "quantitaKgLt");
    if (factor) {
      pieces = suppliedPieces ?? divideByFactor(kgLt, factor.units);
      requireEqual(multiplyByFactor(pieces, factor.units), kgLt, "quantitaPezzi");
    } else if (suppliedPieces) {
      throw new InventoryQuantityDimensionsError(
        400,
        "quantitaPezzi richiede il fattore Kg/Lt per pezzo",
      );
    }
  } else {
    if (suppliedPieces || suppliedKgLt || factor) {
      throw new InventoryQuantityDimensionsError(
        400,
        "Le dimensioni Pezzi/KgLt non sono applicabili all'unità del Prodotto",
      );
    }
  }

  return {
    quantitaOperativa: operational.toDb(),
    quantitaPezzi: pieces?.toDb() ?? null,
    quantitaKgLt: kgLt?.toDb() ?? null,
    fattoreKgLtPezzo: factor?.db ?? null,
  };
}
