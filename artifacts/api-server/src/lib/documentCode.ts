import { randomBytes } from "node:crypto";

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

export function generateDocumentCode(prefix: string, date = new Date()): string {
  const year = date.getUTCFullYear();
  const time = date.getTime().toString(36).toUpperCase();
  const entropy = randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${year}-${time}-${entropy}`.slice(0, 30);
}

/** Riprova esclusivamente le collisioni del vincolo UNIQUE sul codice. */
export async function withDocumentCodeRetry<T>(
  prefix: string,
  operation: (code: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation(generateDocumentCode(prefix));
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Impossibile generare un codice documento univoco");
}
