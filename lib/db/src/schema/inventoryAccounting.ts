export const FONDI_ORIGINE = [
  "FSE_PLUS",
  "FONDO_NAZIONALE",
  "FONDO_NAZIONALE_COFINANZIATO",
  "NESSUN_FONDO",
] as const;

export type FondoOrigine = (typeof FONDI_ORIGINE)[number];

export const ORIGINI_CARICO = [
  "AGEA_SIFEAD",
  "RACCOLTA_ALIMENTARE",
  "DONAZIONE",
  "ACQUISTO",
  "FORNITORE",
  "RETTIFICA_INVENTARIO",
  "SALDO_INIZIALE",
  "ALTRO",
  "LEGACY",
] as const;

export type OrigineCarico = (typeof ORIGINI_CARICO)[number];

export const NATURE_CONTABILI = [
  "CARICO",
  "DISTRIBUZIONE_FINALE",
  "TRASFERIMENTO_INTERNO_USCITA",
  "TRASFERIMENTO_INTERNO_ENTRATA",
  "RETTIFICA_POSITIVA",
  "RETTIFICA_NEGATIVA",
  "SCARTO",
  "RESO",
  "STORNO",
  "SALDO_INIZIALE",
  "LEGACY",
  "ALTRO",
] as const;

export type NaturaContabile = (typeof NATURE_CONTABILI)[number];

export const CANALI_OPERATIVI = [
  "PACCHI",
  "RITIRO_SEDE",
  "DOMICILIARE",
  "EMPORIO",
  "MENSA",
  "UDS_STRADA",
  "ALTRO",
] as const;

export type CanaleOperativo = (typeof CANALI_OPERATIVI)[number];
