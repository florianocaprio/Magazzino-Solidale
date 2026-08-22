const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

export class InventoryDecimalError extends Error {}

function exactNumberText(value: number): string {
  if (!Number.isFinite(value))
    throw new InventoryDecimalError("Valore decimale non finito");
  const text = String(value);
  if (/[eE]/.test(text)) {
    throw new InventoryDecimalError(
      "Le quantità numeriche in notazione scientifica non sono ammesse; usare una stringa decimale",
    );
  }
  return text;
}

export class InventoryDecimal {
  private constructor(private readonly units: bigint) {}

  static fromUnits(units: bigint): InventoryDecimal {
    return new InventoryDecimal(units);
  }

  static parse(
    raw: string | number,
    options: { allowNegative?: boolean; maxScale?: number } = {},
  ): InventoryDecimal {
    const text = (typeof raw === "number" ? exactNumberText(raw) : raw)
      .trim()
      .replace(",", ".");
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) throw new InventoryDecimalError("Formato quantità non valido");
    const negative = match[1] === "-";
    if (negative && !options.allowNegative) {
      throw new InventoryDecimalError("La quantità non può essere negativa");
    }
    const fraction = match[3] ?? "";
    const maxScale = options.maxScale ?? SCALE;
    if (fraction.length > maxScale || fraction.length > SCALE) {
      throw new InventoryDecimalError(
        `Sono ammessi al massimo ${maxScale} decimali`,
      );
    }
    const absolute =
      BigInt(match[2]) * FACTOR +
      BigInt((fraction + "0".repeat(SCALE)).slice(0, SCALE));
    return new InventoryDecimal(negative ? -absolute : absolute);
  }

  static zero(): InventoryDecimal {
    return new InventoryDecimal(0n);
  }

  add(other: InventoryDecimal): InventoryDecimal {
    return new InventoryDecimal(this.units + other.units);
  }

  subtract(other: InventoryDecimal): InventoryDecimal {
    return new InventoryDecimal(this.units - other.units);
  }

  abs(): InventoryDecimal {
    return new InventoryDecimal(this.units < 0n ? -this.units : this.units);
  }

  min(other: InventoryDecimal): InventoryDecimal {
    return this.units <= other.units ? this : other;
  }

  compare(other: InventoryDecimal): number {
    return this.units < other.units ? -1 : this.units > other.units ? 1 : 0;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  toUnits(): bigint {
    return this.units;
  }

  toDb(): string {
    const negative = this.units < 0n;
    const absolute = negative ? -this.units : this.units;
    const integer = absolute / FACTOR;
    const fraction = String(absolute % FACTOR).padStart(SCALE, "0");
    return `${negative ? "-" : ""}${integer}.${fraction}`;
  }

  toCanonical(): string {
    return this.toDb()
      .replace(/\.0+$/, "")
      .replace(/(\.\d*?)0+$/, "$1");
  }
}

export function positiveInventoryDecimal(
  raw: string | number,
): InventoryDecimal {
  const value = InventoryDecimal.parse(raw);
  if (!value.isPositive()) {
    throw new InventoryDecimalError("La quantità deve essere maggiore di zero");
  }
  return value;
}

export function nonNegativeInventoryDecimal(
  raw: string | number,
): InventoryDecimal {
  const value = InventoryDecimal.parse(raw);
  if (value.isNegative()) {
    throw new InventoryDecimalError("La quantità non può essere negativa");
  }
  return value;
}
