import {
  db,
  giornateServizioVolontariTable,
  matricoleVolontariTable,
  registroVolontariEventiTable,
  volontariTable,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, lte, ne, or, type SQL } from "drizzle-orm";

export const VOLUNTEER_REGISTER_CORRECTION_FIELDS = [
  "matricola",
  "nome",
  "cognome",
  "codiceFiscale",
  "dataNascita",
  "luogoNascita",
  "indirizzoResidenza",
  "indirizzoDomicilio",
  "tipoVolontario",
  "centroAscoltoId",
  "centroAscoltoNome",
  "ruoloVolontarioId",
  "ruoloNome",
  "dataInizio",
] as const;

export type VolunteerRegisterCorrectionField =
  (typeof VOLUNTEER_REGISTER_CORRECTION_FIELDS)[number];

export type StructuredVolunteerRegisterCorrection = {
  campo: VolunteerRegisterCorrectionField;
  valorePrecedente: string | number | null;
  nuovoValore: string | number | null;
};

type ResolverVolunteer = Pick<
  typeof volontariTable.$inferSelect,
  | "id"
  | "progressivoRegistro"
  | "dataIscrizione"
  | "dataInizioImportata"
  | "dataCreazione"
  | "matricola"
  | "nome"
  | "cognome"
  | "codiceFiscale"
  | "dataNascita"
  | "luogoNascita"
  | "indirizzoResidenza"
  | "indirizzoDomicilio"
  | "tipoVolontario"
  | "centroAscoltoId"
  | "ruoloVolontarioId"
  | "ruolo"
  | "gruppoImportatoOriginale"
  | "categoriaImportataOriginale"
> & {
  centroAscoltoNome?: string | null;
  ruoloCatalogoNome?: string | null;
};

export type ResolvedVolunteerRegisterState = {
  volontarioId: number;
  progressivoRegistro: number;
  reference: string;
  registrationEventProgressive: number | null;
  registrationDate: string | null;
  origin: string;
  identity: Record<string, unknown>;
  status: "ATTIVO" | "NON ATTIVO" | "CESSATO";
  statusReason: string;
  cessationDate: string | null;
  serviceDays: string[];
  incomplete: string[];
};

function identityFromLegacy(row: ResolverVolunteer): Record<string, unknown> {
  return {
    volontarioId: row.id,
    matricola: row.matricola,
    nome: row.nome,
    cognome: row.cognome,
    codiceFiscale: row.codiceFiscale,
    dataNascita: row.dataNascita,
    luogoNascita: row.luogoNascita,
    indirizzoResidenza: row.indirizzoResidenza,
    indirizzoDomicilio: row.indirizzoDomicilio,
    tipoVolontario: row.tipoVolontario,
    centroAscoltoId: row.centroAscoltoId,
    centroAscoltoNome: row.centroAscoltoNome ?? row.gruppoImportatoOriginale,
    ruoloVolontarioId: row.ruoloVolontarioId,
    ruoloNome:
      row.ruoloCatalogoNome ?? row.categoriaImportataOriginale ?? row.ruolo,
    dataInizio: row.dataIscrizione ?? row.dataInizioImportata,
  };
}

function mergeIdentitySnapshot(
  current: Record<string, unknown>,
  snapshot: Record<string, unknown>,
) {
  const next = { ...current };
  for (const field of [
    ...VOLUNTEER_REGISTER_CORRECTION_FIELDS,
    "dataInizioImportata",
    "gruppoImportatoOriginale",
    "categoriaImportataOriginale",
  ]) {
    if (Object.hasOwn(snapshot, field)) next[field] = snapshot[field];
  }
  return next;
}

function structuredCorrections(snapshot: Record<string, unknown>) {
  const eventData = snapshot.datiEvento;
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData))
    return [];
  const corrections = (eventData as Record<string, unknown>).rettifiche;
  if (!Array.isArray(corrections)) return [];
  return corrections.filter(
    (item): item is StructuredVolunteerRegisterCorrection => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        return false;
      const value = item as Record<string, unknown>;
      return (
        typeof value.campo === "string" &&
        VOLUNTEER_REGISTER_CORRECTION_FIELDS.includes(
          value.campo as VolunteerRegisterCorrectionField,
        ) &&
        (value.nuovoValore == null ||
          typeof value.nuovoValore === "string" ||
          typeof value.nuovoValore === "number")
      );
    },
  );
}

export async function resolveVolunteerRegisterStatesAt(
  rows: ResolverVolunteer[],
  reference: string,
  options: {
    servizioDa?: string | null;
    servizioA?: string | null;
    allowedCenterIds?: number[] | null;
  } = {},
): Promise<ResolvedVolunteerRegisterState[]> {
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];
  const serviceConditions: SQL[] = [
    inArray(giornateServizioVolontariTable.volontarioId, ids),
    ne(giornateServizioVolontariTable.stato, "ANNULLATA"),
    lte(
      giornateServizioVolontariTable.dataServizio,
      options.servizioA ?? reference,
    ),
  ];
  if (options.servizioDa)
    serviceConditions.push(
      gte(giornateServizioVolontariTable.dataServizio, options.servizioDa),
    );
  if (options.allowedCenterIds != null)
    serviceConditions.push(
      options.allowedCenterIds.length
        ? inArray(
            giornateServizioVolontariTable.centroAscoltoId,
            options.allowedCenterIds,
          )
        : eq(giornateServizioVolontariTable.id, -1),
    );
  const [events, identifiers, serviceDays] = await Promise.all([
    db
      .select()
      .from(registroVolontariEventiTable)
      .where(
        and(
          inArray(registroVolontariEventiTable.volontarioId, ids),
          lte(registroVolontariEventiTable.dataEffettiva, reference),
        ),
      )
      .orderBy(
        asc(registroVolontariEventiTable.dataEffettiva),
        asc(registroVolontariEventiTable.progressivo),
      ),
    db
      .select()
      .from(matricoleVolontariTable)
      .where(
        and(
          inArray(matricoleVolontariTable.volontarioId, ids),
          lte(matricoleVolontariTable.dataInizioValidita, reference),
          or(
            eq(matricoleVolontariTable.dataFineValidita, reference),
            gte(matricoleVolontariTable.dataFineValidita, reference),
            eq(matricoleVolontariTable.stato, "ATTIVA"),
          ),
        ),
      )
      .orderBy(
        asc(matricoleVolontariTable.dataInizioValidita),
        asc(matricoleVolontariTable.id),
      ),
    db
      .select()
      .from(giornateServizioVolontariTable)
      .where(and(...serviceConditions))
      .orderBy(asc(giornateServizioVolontariTable.dataServizio)),
  ]);

  const result: ResolvedVolunteerRegisterState[] = [];
  for (const row of rows) {
    const volunteerEvents = events.filter(
      (event) => event.volontarioId === row.id,
    );
    const registration = volunteerEvents.find(
      (event) => event.tipoEvento === "REGISTRAZIONE",
    );
    const registrationDate =
      (typeof registration?.snapshot.dataInizio === "string"
        ? registration.snapshot.dataInizio
        : null) ??
      registration?.dataEffettiva ??
      row.dataIscrizione ??
      row.dataInizioImportata;
    if (registrationDate && registrationDate > reference) continue;
    let identity = registration
      ? mergeIdentitySnapshot({}, registration.snapshot)
      : identityFromLegacy(row);
    let status: ResolvedVolunteerRegisterState["status"] = "NON ATTIVO";
    let statusReason = "registrazione";
    let cessationDate: string | null = null;
    for (const event of volunteerEvents) {
      if (
        event.tipoEvento === "AGGIORNAMENTO_ANAGRAFICA" ||
        event.tipoEvento === "CONVERSIONE_PERMANENTE"
      )
        identity = mergeIdentitySnapshot(identity, event.snapshot);
      if (event.tipoEvento === "RETTIFICA") {
        for (const correction of structuredCorrections(event.snapshot))
          identity[correction.campo] = correction.nuovoValore;
      }
      if (event.tipoEvento === "REGISTRAZIONE") {
        status = "ATTIVO";
        statusReason = "registrazione";
      }
      if (event.tipoEvento === "SOSPENSIONE_CESSAZIONE") {
        const isCessation =
          event.snapshot.motivo === "dimissioni_cessazione" ||
          (event.snapshot.datiEvento as Record<string, unknown> | undefined)
            ?.tipo === "CESSAZIONE";
        status = isCessation ? "CESSATO" : "NON ATTIVO";
        statusReason =
          typeof event.snapshot.motivo === "string"
            ? event.snapshot.motivo
            : "sospensione";
        cessationDate = isCessation ? event.dataEffettiva : null;
      }
      if (event.tipoEvento === "RIATTIVAZIONE") {
        status = "ATTIVO";
        statusReason = "riattivazione";
        cessationDate = null;
      }
    }
    const identifier = identifiers
      .filter((item) => item.volontarioId === row.id)
      .at(-1);
    if (identifier) identity.matricola = identifier.matricola;
    const type = identity.tipoVolontario;
    const volunteerServices =
      type === "TEMPORANEO"
        ? serviceDays
            .filter((day) => day.volontarioId === row.id)
            .map((day) => day.dataServizio)
        : [];
    const incomplete: string[] = [];
    if (!registrationDate) incomplete.push("dataIscrizione");
    for (const field of ["nome", "cognome", "tipoVolontario", "matricola"])
      if (!identity[field]) incomplete.push(field);
    result.push({
      volontarioId: row.id,
      progressivoRegistro: row.progressivoRegistro,
      reference,
      registrationEventProgressive: registration?.progressivo ?? null,
      registrationDate,
      origin:
        typeof registration?.snapshot.origine === "string"
          ? registration.snapshot.origine
          : "LEGACY",
      identity,
      status,
      statusReason,
      cessationDate,
      serviceDays: volunteerServices,
      incomplete,
    });
  }
  return result;
}
