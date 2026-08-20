import { calcolaEta, isFasciaEtaPresunta, z } from "@workspace/api-zod";

const emptyToNull = (value: unknown) => value === "" ? null : value;
const nullableText = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());
const nullableId = z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable().optional());
const nullableDate = z.preprocess(
  emptyToNull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
);
const booleanValue = z.preprocess((value) => {
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return value;
}, z.boolean());

const beneficiarioFields = {
  codice: z.string().trim().min(1).max(20).optional(),
  codiceFiscale: nullableText(16),
  statoAnagrafica: z.enum(["provvisoria", "completa"]).optional(),
  cognome: z.string().trim().min(1).max(80),
  nome: z.string().trim().min(1).max(80),
  soprannome: nullableText(80),
  dataNascita: nullableDate,
  fasciaEtaPresunta: z.preprocess(emptyToNull, z.enum(["0_17", "18_29", "30_64", "65_plus"]).nullable().optional()),
  sesso: z.enum(["M", "F", "ALTRO"]),
  cittadinanza: nullableText(60),
  areaProvenienza: nullableText(10),
  residenza: nullableText(200),
  domicilio: nullableText(200),
  comune: nullableText(80),
  zonaMunicipio: nullableText(80),
  telefono: nullableText(20),
  email: nullableText(120),
  statoCivile: nullableText(30),
  numComponenti: z.coerce.number().int().min(1).optional(),
  numFigliMaschi: z.coerce.number().int().min(0).optional(),
  numFiglieFemmine: z.coerce.number().int().min(0).optional(),
  numMinori: z.coerce.number().int().min(0).optional(),
  numAnziani: z.coerce.number().int().min(0).optional(),
  numDisabili: z.coerce.number().int().min(0).optional(),
  restrizioniAlimentari: nullableText(10_000),
  allergie: nullableText(10_000),
  notePaccoAlimentare: nullableText(10_000),
  priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
  consegnaDomicilio: booleanValue.optional(),
  motivoConsegnaDomicilio: nullableText(60),
  centroAscoltoId: nullableId,
  magazzinoEmporioPreferitoId: nullableId,
  uds: booleanValue.optional(),
  areaOperativaId: nullableId,
  zonaUdsId: nullableId,
  dataPresaInCarico: nullableDate,
  noteInterne: nullableText(10_000),
};

const BeneficiarioBaseInput = z.object(beneficiarioFields);
export const CreateBeneficiarioInput = BeneficiarioBaseInput.strict();
export const UpdateBeneficiarioInput = BeneficiarioBaseInput.partial().extend({
  versione: z.coerce.number().int().positive(),
}).strict();

export const UpdateBeneficiarioCreditoInput = z.object({
  creditoSolidaleAbilitato: booleanValue.optional(),
  creditoSolidaleStato: z.enum(["non_abilitato", "attivo", "sospeso", "revocato"]).optional(),
  creditoSolidaleNote: nullableText(10_000),
  creditoSolidaleMensileAssegnato: z.preprocess(emptyToNull, z.coerce.number().min(0).nullable().optional()),
  creditoSolidaleMensileSuggerito: z.preprocess(emptyToNull, z.coerce.number().min(0).nullable().optional()),
  creditoSolidaleMotivoModifica: nullableText(10_000),
}).strict();

export const UpdateBeneficiarioStatusInput = z.object({
  attivo: z.boolean(),
  versione: z.coerce.number().int().positive(),
}).strict();

export const AuthorizeBeneficiariExportInput = z.object({
  tipo: z.enum(["lista", "scheda", "dossier", "interventi"]),
  beneficiarioId: z.coerce.number().int().positive().nullable().optional(),
  numeroRecord: z.coerce.number().int().min(0).max(100_000),
}).strict();

const NucleoFamiliareBaseInput = z.object({
  nome: nullableText(80),
  cognome: nullableText(80),
  dataNascita: nullableDate,
  sesso: z.preprocess(emptyToNull, z.enum(["M", "F", "ALTRO"]).nullable().optional()),
  areaProvenienza: nullableText(10),
  relazione: nullableText(60),
  tagliaVestiti: nullableText(20),
  numeroScarpe: nullableText(10),
  esigenzeParticolari: nullableText(10_000),
  note: nullableText(10_000),
}).strict();
export const NucleoFamiliareInput = NucleoFamiliareBaseInput.refine((value) => Boolean(value.nome || value.cognome || value.relazione), {
  message: "Indica almeno nome, cognome o relazione del membro del nucleo.",
});
export const NucleoFamiliareUpdateInput = NucleoFamiliareBaseInput.partial().strict();

export function normalizeCodiceFiscale(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase() || null;
}

export function validateBeneficiarioCompleto(input: {
  statoAnagrafica: string;
  nome: string;
  cognome: string;
  sesso: string | null;
  dataNascita: string | null;
  fasciaEtaPresunta: string | null;
  centroAscoltoId: number | null;
}): string | null {
  if (input.statoAnagrafica !== "completa") return null;
  if (!input.nome.trim() || !input.cognome.trim() || !["M", "F", "ALTRO"].includes(input.sesso ?? "")) {
    return "Completa nome, cognome e sesso per completare l'anagrafica.";
  }
  if (calcolaEta(input.dataNascita ?? "") == null && !isFasciaEtaPresunta(input.fasciaEtaPresunta)) {
    return "Indica una data di nascita valida o una fascia d'età presunta.";
  }
  if (input.centroAscoltoId == null) return "Associa un Centro di Ascolto prima di completare l'anagrafica.";
  return null;
}

export function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => {
    const field = issue.path.join(".");
    if (field === "sesso") return "Il campo Sesso è obbligatorio.";
    if (field === "dataNascita") return "Data di nascita non valida.";
    if (field === "fasciaEtaPresunta") return "Fascia d'età presunta non valida.";
    return `${field || "body"}: ${issue.message}`;
  }).join("; ");
}
