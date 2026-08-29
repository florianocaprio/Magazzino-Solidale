import {
  isDateOnly,
  normalizeCodiceFiscale,
  normalizeEmail,
  normalizePhone,
} from "./volontariDomain";

export const VOLONTARIO_VALIDATION_FIELDS = [
  "nome",
  "cognome",
  "matricola",
  "tipoVolontario",
  "codiceFiscale",
  "codiceFiscaleNonDisponibile",
  "codiceFiscaleNota",
  "dataNascita",
  "luogoNascita",
  "indirizzoResidenza",
  "indirizzoDomicilio",
  "telefono",
  "telefonoSecondario",
  "email",
  "centroAscoltoId",
  "ruoloVolontarioId",
  "maxConsegneTurno",
  "dataServizio",
  "patente",
  "mezzoPersonale",
  "versione",
] as const;

export type VolontarioValidationField =
  (typeof VOLONTARIO_VALIDATION_FIELDS)[number];
export type VolontarioFieldErrors = Partial<
  Record<VolontarioValidationField, string>
>;

export const VOLONTARIO_EDITABLE_FIELDS = [
  "nome",
  "cognome",
  "centroAscoltoId",
  "telefono",
  "telefonoSecondario",
  "email",
  "luogoNascita",
  "dataNascita",
  "indirizzoResidenza",
  "indirizzoDomicilio",
  "codiceFiscale",
  "codiceFiscaleNonDisponibile",
  "codiceFiscaleNota",
  "ruoloVolontarioId",
  "patente",
  "mezzoPersonale",
  "maxConsegneTurno",
  "note",
] as const;

export type VolontarioEditableField =
  (typeof VOLONTARIO_EDITABLE_FIELDS)[number];

export type VolontarioValidationState = Record<string, unknown> & {
  nome?: unknown;
  cognome?: unknown;
  matricola?: unknown;
  tipoVolontario?: unknown;
  codiceFiscale?: unknown;
  codiceFiscaleNonDisponibile?: unknown;
  codiceFiscaleNota?: unknown;
  dataNascita?: unknown;
  luogoNascita?: unknown;
  indirizzoResidenza?: unknown;
  indirizzoDomicilio?: unknown;
  telefono?: unknown;
  telefonoSecondario?: unknown;
  email?: unknown;
  centroAscoltoId?: unknown;
  ruoloVolontarioId?: unknown;
  maxConsegneTurno?: unknown;
  dataServizio?: unknown;
  patente?: unknown;
  mezzoPersonale?: unknown;
  versione?: unknown;
};

const TEXT_LIMITS = {
  nome: 80,
  cognome: 80,
  telefono: 20,
  telefonoSecondario: 20,
  email: 120,
  luogoNascita: 120,
  indirizzoResidenza: 240,
  indirizzoDomicilio: 240,
  codiceFiscale: 32,
  codiceFiscaleNota: 240,
} as const;

const NULLABLE_TEXT_FIELDS = [
  "telefono",
  "telefonoSecondario",
  "email",
  "indirizzoDomicilio",
  "codiceFiscaleNota",
  "note",
] as const;

function normalizeText(value: unknown): string | null | unknown {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeVolontarioPatch(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const field of VOLONTARIO_EDITABLE_FIELDS) {
    if (source[field] === undefined) continue;
    if (field === "codiceFiscale") {
      normalized.codiceFiscale = normalizeCodiceFiscale(source[field]);
      normalized.codiceFiscaleNormalizzato = normalized.codiceFiscale;
    } else if (field === "email") {
      normalized.email = normalizeEmail(source[field]);
    } else if (field === "telefono" || field === "telefonoSecondario") {
      normalized[field] = normalizePhone(source[field]);
    } else if (
      field === "nome" ||
      field === "cognome" ||
      field === "luogoNascita" ||
      field === "indirizzoResidenza" ||
      field === "indirizzoDomicilio" ||
      field === "codiceFiscaleNota" ||
      field === "note"
    ) {
      normalized[field] = normalizeText(source[field]);
    } else {
      normalized[field] = source[field];
    }
  }
  return normalized;
}

export function mergeVolontarioNextState(
  existing: VolontarioValidationState | null,
  patch: Record<string, unknown>,
): VolontarioValidationState {
  return { ...(existing ?? {}), ...patch };
}

export function validateVolontarioState(
  state: VolontarioValidationState,
  options: {
    requireCenter?: boolean;
    validateTemporaryServiceDate?: boolean;
  } = {},
): VolontarioFieldErrors {
  const errors: VolontarioFieldErrors = {};

  for (const [field, max] of Object.entries(TEXT_LIMITS) as Array<
    [keyof typeof TEXT_LIMITS, number]
  >) {
    const value = state[field];
    if (value == null) continue;
    if (typeof value !== "string") {
      errors[field] = "Valore non valido";
    } else if (value.trim().length > max) {
      errors[field] = `Massimo ${max} caratteri`;
    }
  }

  for (const [field, label] of [
    ["nome", "Il nome è obbligatorio"],
    ["cognome", "Il cognome è obbligatorio"],
    ["luogoNascita", "Il luogo di nascita è obbligatorio"],
    ["indirizzoResidenza", "L'indirizzo di residenza è obbligatorio"],
  ] as const) {
    if (typeof state[field] !== "string" || !state[field].trim()) {
      errors[field] = label;
    }
  }

  if (!isDateOnly(state.dataNascita)) {
    errors.dataNascita =
      "La data di nascita è obbligatoria e deve essere valida";
  }

  const cf = normalizeCodiceFiscale(state.codiceFiscale);
  const unavailable = state.codiceFiscaleNonDisponibile === true;
  if (
    state.codiceFiscaleNonDisponibile != null &&
    typeof state.codiceFiscaleNonDisponibile !== "boolean"
  ) {
    errors.codiceFiscaleNonDisponibile = "Valore non valido";
  }
  if (cf && unavailable) {
    errors.codiceFiscale =
      "Rimuovi il codice fiscale oppure deseleziona l'indisponibilità";
    errors.codiceFiscaleNonDisponibile =
      "Il codice fiscale risulta già presente";
  } else if (!cf && !unavailable) {
    errors.codiceFiscale =
      "Inserisci il codice fiscale oppure dichiaralo non disponibile";
    errors.codiceFiscaleNonDisponibile =
      "Conferma se il codice fiscale non è disponibile";
  } else if (cf && !/^[A-Z0-9]{16}$/.test(cf)) {
    errors.codiceFiscale =
      "Il codice fiscale deve contenere 16 caratteri alfanumerici";
  }

  if (
    typeof state.email === "string" &&
    state.email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)
  ) {
    errors.email = "Indirizzo email non valido";
  }

  const roleId = Number(state.ruoloVolontarioId);
  if (!Number.isSafeInteger(roleId) || roleId <= 0) {
    errors.ruoloVolontarioId = "Seleziona un ruolo attivo";
  }

  const max = Number(state.maxConsegneTurno);
  if (!Number.isSafeInteger(max) || max < 0) {
    errors.maxConsegneTurno =
      "Inserisci un numero intero maggiore o uguale a zero";
  }

  for (const field of ["patente", "mezzoPersonale"] as const) {
    if (state[field] != null && typeof state[field] !== "boolean") {
      errors[field] = "Valore booleano non valido";
    }
  }

  if (options.requireCenter) {
    const centerId = Number(state.centroAscoltoId);
    if (!Number.isSafeInteger(centerId) || centerId <= 0) {
      errors.centroAscoltoId = "Seleziona un centro valido";
    }
  } else if (state.centroAscoltoId != null) {
    const centerId = Number(state.centroAscoltoId);
    if (!Number.isSafeInteger(centerId) || centerId <= 0) {
      errors.centroAscoltoId = "Centro non valido";
    }
  }

  if (
    options.validateTemporaryServiceDate &&
    state.tipoVolontario === "TEMPORANEO" &&
    !isDateOnly(state.dataServizio)
  ) {
    errors.dataServizio =
      "La prima giornata di servizio è obbligatoria e deve essere valida";
  }

  return errors;
}

export function hasVolontarioFieldErrors(
  errors: VolontarioFieldErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

export function nullableVolontarioTextFields(): readonly string[] {
  return NULLABLE_TEXT_FIELDS;
}
