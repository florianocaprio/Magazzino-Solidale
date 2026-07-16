export const DATA_NASCITA_FUTURA_MSG = "La data di nascita non può essere successiva alla data odierna.";

export function todayDateOnly(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function hasFutureBirthDate(value: unknown, now = new Date()): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value > todayDateOnly(now);
}

export function validateCapacita(body: Record<string, unknown>): string | null {
  if (body.capacitaColli != null) {
    const value = Number(body.capacitaColli);
    if (!Number.isInteger(value) || value < 0) return "La capacità in colli deve essere un numero intero non negativo";
  }
  if (body.capacitaKg != null) {
    const value = Number(body.capacitaKg);
    if (!Number.isFinite(value) || value < 0) return "La capacità di carico deve essere un numero non negativo";
  }
  return null;
}

export function isSupportedLogoType(contentType: string): boolean {
  return ["image/png", "image/jpeg", "image/webp"].includes(contentType.split(";")[0]);
}
