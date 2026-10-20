import type {
  beneficiariTable,
  fseFascicoliSocialiTable,
  nucleoFamiliareTable,
} from "@workspace/db";
import {
  calcolaDemografiaNucleo,
  mapDeliveryToFseActivity,
  mapFseActivityToDelivery,
  type FseBeneficiariRow,
} from "./fseBeneficiari";
type Beneficiary = typeof beneficiariTable.$inferSelect;
type Profile = typeof fseFascicoliSocialiTable.$inferSelect;

export function anagraficaImportValues(row: FseBeneficiariRow) {
  return {
    nome: row.nome,
    cognome: row.cognome,
    dataPresaInCarico: row.dataPresaInCarico,
    numComponenti: row.numeroComponenti,
    numMinori: row.eta017,
    numAnziani: row.eta65Plus,
    numDisabili: row.disabili,
    consegnaDomicilio: mapFseActivityToDelivery(row.tipologiaAttivita)!,
    attivo: true,
    ...(row.anagrafica?.codiceFiscale
      ? { codiceFiscale: row.anagrafica.codiceFiscale }
      : {}),
    ...(row.anagrafica?.dataNascita
      ? { dataNascita: row.anagrafica.dataNascita, fasciaEtaPresunta: null }
      : {}),
    ...(row.anagrafica?.sesso ? { sesso: row.anagrafica.sesso } : {}),
  };
}
const normalize = (value: unknown) =>
  value == null
    ? null
    : String(value).trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");

export function fseImportComparison(
  row: FseBeneficiariRow,
  target?: Beneficiary,
  profile?: Profile,
  family: Array<typeof nucleoFamiliareTable.$inferSelect> = [],
) {
  const demographic = target
    ? calcolaDemografiaNucleo(target, family, new Date(), null)
    : null;
  const registered: Record<string, string | number | null> = {
    nome: target?.nome ?? null,
    cognome: target?.cognome ?? null,
    codiceFiscale: target?.codiceFiscale ?? null,
    dataNascita: target?.dataNascita ?? null,
    sesso: target?.sesso ?? null,
    codiceFascicolo: profile?.codiceFascicolo ?? null,
    dataPresaInCarico: target?.dataPresaInCarico ?? null,
    numeroComponenti: target?.numComponenti ?? null,
    tipologiaAttivita: target
      ? mapDeliveryToFseActivity(target.consegnaDomicilio)
      : null,
    statoAttuale: target ? (target.attivo ? "Attivo" : "Disattivato") : null,
    donne:
      profile?.donneImportate ??
      (demographic?.dettaglioCompleto ? demographic.donne : null),
    uomini:
      profile?.uominiImportati ??
      (demographic?.dettaglioCompleto ? demographic.uomini : null),
    eta017: target?.numMinori ?? null,
    eta1829:
      profile?.eta1829Importata ??
      (demographic?.dettaglioCompleto ? demographic.eta1829 : null),
    eta3064:
      profile?.eta3064Importata ??
      (demographic?.dettaglioCompleto ? demographic.eta3064 : null),
    eta65Plus: target?.numAnziani ?? null,
    origineStranieraMinoranze: profile?.origineStranieraMinoranze ?? null,
    disabili: target?.numDisabili ?? null,
    cittadiniPaesiTerzi: profile?.cittadiniPaesiTerzi ?? null,
    senzaTettoEsclusioneAbitativa:
      profile?.senzaTettoEsclusioneAbitativa ?? null,
  };
  const incoming: Record<string, string | number | null> = {
    nome: row.nome,
    cognome: row.cognome,
    codiceFiscale: row.anagrafica?.codiceFiscale ?? null,
    dataNascita: row.anagrafica?.dataNascita ?? null,
    sesso: row.anagrafica?.sesso ?? null,
    codiceFascicolo: row.codiceFascicolo,
    dataPresaInCarico: row.dataPresaInCarico,
    numeroComponenti: row.numeroComponenti,
    tipologiaAttivita: row.tipologiaAttivita,
    statoAttuale: row.statoAttuale,
    donne: row.donne,
    uomini: row.uomini,
    eta017: row.eta017,
    eta1829: row.eta1829,
    eta3064: row.eta3064,
    eta65Plus: row.eta65Plus,
    origineStranieraMinoranze: row.origineStranieraMinoranze,
    disabili: row.disabili,
    cittadiniPaesiTerzi: row.cittadiniPaesiTerzi,
    senzaTettoEsclusioneAbitativa: row.senzaTettoEsclusioneAbitativa,
  };
  const localFields = new Set([
    "nome",
    "cognome",
    "codiceFiscale",
    "dataNascita",
    "sesso",
    "dataPresaInCarico",
    "codiceFascicolo",
    "numeroComponenti",
    "eta017",
    "eta65Plus",
    "disabili",
    "tipologiaAttivita",
    "statoAttuale",
  ]);
  return Object.entries(incoming).map(([campo, value]) => ({
    campo,
    attuale: registered[campo] == null ? null : String(registered[campo]),
    importato: value == null ? null : String(value),
    differente:
      value != null && normalize(registered[campo]) !== normalize(value),
    esito:
      value == null
        ? ("conserva" as const)
        : localFields.has(campo)
          ? ("aggiorna" as const)
          : ("solo_fse" as const),
  }));
}
