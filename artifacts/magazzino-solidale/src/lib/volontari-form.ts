export type VolunteerFormField =
  | "nome"
  | "cognome"
  | "matricola"
  | "tipoVolontario"
  | "codiceFiscale"
  | "codiceFiscaleNonDisponibile"
  | "codiceFiscaleNota"
  | "dataNascita"
  | "luogoNascita"
  | "indirizzoResidenza"
  | "indirizzoDomicilio"
  | "telefono"
  | "telefonoSecondario"
  | "email"
  | "centroAscoltoId"
  | "ruoloVolontarioId"
  | "maxConsegneTurno"
  | "dataServizio"
  | "patente"
  | "mezzoPersonale"
  | "versione";

export type VolunteerFormErrors = Partial<Record<VolunteerFormField, string>>;

export type VolunteerDraft = {
  nome: string;
  cognome: string;
  tipoVolontario: "PERMANENTE" | "TEMPORANEO";
  centroAscoltoId: number | null;
  ruoloVolontarioId: number;
  telefono: string;
  telefonoSecondario: string;
  email: string;
  luogoNascita: string;
  dataNascita: string;
  indirizzoResidenza: string;
  indirizzoDomicilio: string;
  domicilioCoincideResidenza: boolean;
  codiceFiscale: string;
  codiceFiscaleNonDisponibile: boolean;
  codiceFiscaleNota: string;
  patente: boolean;
  mezzoPersonale: boolean;
  maxConsegneTurno: number;
  note: string;
  dataServizio: string;
};

export type VolunteerApiErrorData = {
  error?: string;
  code?: string;
  message?: string;
  fieldErrors?: VolunteerFormErrors;
  missingFields?: string[];
  correlationId?: string;
  details?: {
    fieldErrors?: VolunteerFormErrors;
    missingFields?: string[];
  } | null;
};

const CF_RE = /^[A-Z0-9]{16}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeVolunteerFiscalCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function validateVolunteerDraft(
  draft: VolunteerDraft,
  options: { editing: boolean },
): VolunteerFormErrors {
  const errors: VolunteerFormErrors = {};
  if (!draft.nome.trim()) errors.nome = "Il nome è obbligatorio";
  if (!draft.cognome.trim()) errors.cognome = "Il cognome è obbligatorio";
  if (!draft.luogoNascita.trim())
    errors.luogoNascita = "Il luogo di nascita è obbligatorio";
  if (!DATE_RE.test(draft.dataNascita))
    errors.dataNascita =
      "La data di nascita è obbligatoria e deve essere valida";
  if (!draft.indirizzoResidenza.trim())
    errors.indirizzoResidenza = "L'indirizzo di residenza è obbligatorio";
  if (!draft.domicilioCoincideResidenza && !draft.indirizzoDomicilio.trim())
    errors.indirizzoDomicilio = "Inserisci l'indirizzo di domicilio";

  const cf = normalizeVolunteerFiscalCode(draft.codiceFiscale);
  if (cf && draft.codiceFiscaleNonDisponibile) {
    errors.codiceFiscale =
      "Rimuovi il codice fiscale oppure deseleziona l'indisponibilità";
    errors.codiceFiscaleNonDisponibile =
      "Il codice fiscale risulta già presente";
  } else if (!cf && !draft.codiceFiscaleNonDisponibile) {
    errors.codiceFiscale =
      "Inserisci il codice fiscale oppure dichiaralo non disponibile";
    errors.codiceFiscaleNonDisponibile =
      "Conferma se il codice fiscale non è disponibile";
  } else if (cf && !CF_RE.test(cf)) {
    errors.codiceFiscale =
      "Il codice fiscale deve contenere 16 caratteri alfanumerici";
  }

  if (
    draft.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())
  )
    errors.email = "Indirizzo email non valido";
  if (
    !Number.isSafeInteger(draft.ruoloVolontarioId) ||
    draft.ruoloVolontarioId <= 0
  )
    errors.ruoloVolontarioId = "Seleziona un ruolo attivo";
  if (
    !Number.isSafeInteger(draft.maxConsegneTurno) ||
    draft.maxConsegneTurno < 0
  )
    errors.maxConsegneTurno =
      "Inserisci un numero intero maggiore o uguale a zero";
  if (
    !options.editing &&
    draft.tipoVolontario === "TEMPORANEO" &&
    !DATE_RE.test(draft.dataServizio)
  )
    errors.dataServizio = "Indica la prima giornata di servizio";
  return errors;
}

function normalizedPayload(
  draft: VolunteerDraft,
  lockedCenterId: number | null,
) {
  return {
    nome: draft.nome.trim(),
    cognome: draft.cognome.trim(),
    centroAscoltoId: lockedCenterId ?? draft.centroAscoltoId,
    ruoloVolontarioId: draft.ruoloVolontarioId,
    telefono: draft.telefono.trim() || null,
    telefonoSecondario: draft.telefonoSecondario.trim() || null,
    email: draft.email.trim().toLowerCase() || null,
    luogoNascita: draft.luogoNascita.trim(),
    dataNascita: draft.dataNascita,
    indirizzoResidenza: draft.indirizzoResidenza.trim(),
    indirizzoDomicilio: draft.domicilioCoincideResidenza
      ? null
      : draft.indirizzoDomicilio.trim() || null,
    codiceFiscale: normalizeVolunteerFiscalCode(draft.codiceFiscale) || null,
    codiceFiscaleNonDisponibile: draft.codiceFiscaleNonDisponibile,
    codiceFiscaleNota: draft.codiceFiscaleNonDisponibile
      ? draft.codiceFiscaleNota.trim() || null
      : null,
    patente: draft.patente,
    mezzoPersonale: draft.mezzoPersonale,
    maxConsegneTurno: draft.maxConsegneTurno,
    note: draft.note.trim() || null,
  };
}

export function buildVolunteerCreatePayload(
  draft: VolunteerDraft,
  lockedCenterId: number | null,
): Record<string, unknown> {
  return {
    ...normalizedPayload(draft, lockedCenterId),
    tipoVolontario: draft.tipoVolontario,
    ...(draft.tipoVolontario === "TEMPORANEO"
      ? { dataServizio: draft.dataServizio }
      : {}),
  };
}

export function buildVolunteerUpdatePayload(
  draft: VolunteerDraft,
  initialDraft: VolunteerDraft,
  lockedCenterId: number | null,
  versione: number,
): Record<string, unknown> {
  const current = normalizedPayload(draft, lockedCenterId);
  const initial = normalizedPayload(initialDraft, lockedCenterId);
  const delta = Object.fromEntries(
    Object.entries(current).filter(
      ([key, value]) => !Object.is(value, initial[key as keyof typeof initial]),
    ),
  );
  return { ...delta, versione };
}

export function volunteerApiErrorData(error: unknown): VolunteerApiErrorData {
  const data = (error as { data?: VolunteerApiErrorData })?.data ?? {};
  return {
    ...data,
    fieldErrors: data.fieldErrors ?? data.details?.fieldErrors ?? {},
    missingFields: data.missingFields ?? data.details?.missingFields ?? [],
  };
}
