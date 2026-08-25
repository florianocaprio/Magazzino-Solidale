export const MENSA_PERMISSIONS = [
  { key: "mensa.view", label: "Mensa: consultazione" },
  { key: "mensa.manage", label: "Mensa: configurazione mense" },
  { key: "mensa.access.scan", label: "Mensa: scansione tessere" },
  { key: "mensa.access.manual", label: "Mensa: ricerca manuale" },
  {
    key: "mensa.access.temporary",
    label: "Mensa: accesso temporaneo motivato",
  },
  { key: "mensa.meals.create", label: "Mensa: registrazione pasti" },
  { key: "mensa.meals.override", label: "Mensa: secondo pasto in deroga" },
  { key: "mensa.eligibility.manage", label: "Mensa: gestione abilitazioni" },
  {
    key: "mensa.exceptions.manage",
    label: "Mensa: eccezioni nella stessa Area Operativa",
  },
  { key: "mensa.transfers.manage", label: "Mensa: rifornimenti" },
  { key: "mensa.transfers.request", label: "Mensa: richiesta rifornimenti" },
  { key: "mensa.transfers.receive", label: "Mensa: ricezione rifornimenti" },
  { key: "mensa.consumption.manage", label: "Mensa: consumi e scarti" },
  { key: "mensa.service.close", label: "Mensa: chiusura giornata" },
  { key: "mensa.service.reopen", label: "Mensa: riapertura giornata" },
  { key: "mensa.reports.view", label: "Mensa: report" },
  { key: "mensa.cards.manage", label: "Mensa: gestione tessere" },
] as const;

export const BENEFICIARI_PERMISSIONS = [
  {
    key: "beneficiari.view",
    label: "Beneficiari: consultazione directory e anagrafica",
  },
  { key: "beneficiari.manage", label: "Beneficiari: gestione anagrafica" },
  {
    key: "beneficiari.sensitive.view",
    label: "Beneficiari: consultazione dossier sensibile",
  },
  {
    key: "beneficiari.deactivate",
    label: "Beneficiari: disattivazione e riattivazione",
  },
  { key: "beneficiari.export", label: "Beneficiari: esportazione dati" },
  {
    key: "beneficiari.fse.view",
    label: "Beneficiari FSE+: consultazione fascicolo",
  },
  {
    key: "beneficiari.fse.manage",
    label: "Beneficiari FSE+: modifica dati interoperabili",
  },
  { key: "beneficiari.fse.import", label: "Beneficiari FSE+: importazione" },
  { key: "beneficiari.fse.export", label: "Beneficiari FSE+: esportazione" },
  {
    key: "beneficiari.duplicates.search",
    label: "Beneficiari: ricerca anti-duplicato",
  },
  {
    key: "beneficiari.cards.manage",
    label: "Beneficiari: emissione tessere trasversali",
  },
] as const;

export const CREDITO_PERMISSIONS = [
  { key: "credito.view", label: "Credito Solidale: consultazione" },
  {
    key: "credito.quota.manage",
    label: "Credito Solidale: gestione quota assegnata",
  },
  {
    key: "credito.adjust",
    label: "Credito Solidale: ricariche, rettifiche e storni",
  },
  {
    key: "credito.monthly.execute",
    label: "Credito Solidale: esecuzione ricariche mensili",
  },
] as const;

export const EMPORIO_ACCESS_PERMISSIONS = [
  { key: "emporio.access.view", label: "Emporio: consultazione accessi" },
  { key: "emporio.access.manage", label: "Emporio: gestione accessi" },
] as const;

export const EMPORIO_CASSA_SALES_PERMISSIONS = [
  { key: "emporio.cassa.view", label: "Emporio: consultazione Cassa" },
  { key: "emporio.cassa.operate", label: "Emporio: operatività Cassa" },
  { key: "emporio.cassa.force", label: "Emporio: accesso forzato da Cassa" },
  { key: "emporio.sales.view", label: "Emporio: consultazione Spese" },
  {
    key: "emporio.sales.manage",
    label: "Emporio: operazioni documentali Spese",
  },
  { key: "emporio.sales.reverse", label: "Emporio: storno Spese" },
] as const;

export const SOCIALE_INTERVENTI_PERMISSIONS = [
  {
    key: "sociale.interventi.view",
    label: "Interventi Sociali: consultazione",
  },
  { key: "sociale.interventi.create", label: "Interventi Sociali: creazione" },
  {
    key: "sociale.interventi.update",
    label: "Interventi Sociali: modifica e operatività",
  },
  {
    key: "sociale.interventi.complete",
    label: "Interventi Sociali: avvio e conclusione",
  },
  {
    key: "sociale.interventi.cancel",
    label: "Interventi Sociali: annullamento e mancata presentazione",
  },
] as const;

export const CONSEGNE_PERMISSIONS = [
  { key: "consegne.view", label: "Consegne: consultazione" },
  { key: "consegne.manage", label: "Consegne: pianificazione e gestione" },
  { key: "consegne.complete", label: "Consegne: completamento" },
  { key: "consegne.cancel", label: "Consegne: annullamento pianificazione" },
  { key: "consegne.export", label: "Consegne: esportazione" },
] as const;

export const UDS_PERMISSIONS = [
  { key: "uds.directory.view", label: "UDS: directory minimizzata" },
  { key: "uds.interventi.view", label: "UDS: consultazione interventi" },
  { key: "uds.interventi.create", label: "UDS: registrazione interventi" },
  { key: "uds.interventi.update", label: "UDS: rettifica interventi" },
  { key: "uds.interventi.note", label: "UDS: annotazioni operative" },
  { key: "uds.bisogni.manage", label: "UDS: gestione Bisogni Pianificati" },
  { key: "uds.reports.view", label: "UDS: consultazione report" },
] as const;

export const MAPS_PERMISSIONS = [
  {
    key: "maps.route",
    label: "MAPS: apertura percorsi su attività autorizzate",
  },
  {
    key: "maps.operational",
    label: "MAPS: accesso alla mappa operativa",
  },
] as const;

export const LOGISTICA_PERMISSIONS = [
  {
    key: "logistica.volontari.view",
    label: "Logistica: consultazione volontari",
  },
  { key: "logistica.volontari.manage", label: "Logistica: gestione volontari" },
  {
    key: "logistica.volontari.export",
    label: "Logistica: esportazione volontari",
  },
  { key: "logistica.mezzi.view", label: "Logistica: consultazione mezzi" },
  { key: "logistica.mezzi.manage", label: "Logistica: gestione mezzi" },
  { key: "logistica.mezzi.export", label: "Logistica: esportazione mezzi" },
  { key: "logistica.turni.view", label: "Logistica: consultazione turni" },
  { key: "logistica.turni.manage", label: "Logistica: gestione turni" },
  {
    key: "logistica.approvazioni.view",
    label: "Logistica: consultazione approvazioni",
  },
  {
    key: "logistica.approvazioni.manage",
    label: "Logistica: gestione approvazioni",
  },
] as const;

export const MAGAZZINO_PERMISSIONS = [
  { key: "magazzino.view", label: "Magazzino: consultazione" },
  {
    key: "magazzino.fse.view",
    label: "Magazzino FSE+: consultazione rendicontazione",
  },
  {
    key: "magazzino.fse.export",
    label: "Magazzino FSE+: generazione e gestione export",
  },
  {
    key: "magazzino.fse.reconcile",
    label: "Magazzino FSE+: calcolo riconciliazioni",
  },
  {
    key: "magazzino.fse.reconcile.manage",
    label: "Magazzino FSE+: risoluzione e chiusura riconciliazioni",
  },
  {
    key: "magazzino.fse.monitoring.manage",
    label: "Magazzino FSE+: gestione indicatori mensili",
  },
  {
    key: "magazzino.fse.return",
    label: "Magazzino FSE+: gestione resi verso OpC",
  },
  { key: "magazzino.agea.view", label: "Magazzino AGEA: consultazione import" },
  { key: "magazzino.agea.import", label: "Magazzino AGEA: analisi e import" },
  {
    key: "magazzino.agea.mapping.manage",
    label: "Magazzino AGEA: gestione mapping prodotti",
  },
  {
    key: "magazzino.agea.bootstrap",
    label: "Magazzino AGEA: prima acquisizione",
  },
  { key: "magazzino.products.manage", label: "Magazzino: gestione prodotti" },
  { key: "magazzino.stock.receive", label: "Magazzino: carico merce" },
  { key: "magazzino.stock.issue", label: "Magazzino: scarico merce" },
  {
    key: "magazzino.stock.adjust",
    label: "Magazzino: rettifiche inventariali",
  },
  {
    key: "magazzino.transfers.create",
    label: "Magazzino: creazione trasferimenti",
  },
  {
    key: "magazzino.transfers.dispatch",
    label: "Magazzino: spedizione trasferimenti",
  },
  {
    key: "magazzino.transfers.receive",
    label: "Magazzino: ricezione trasferimenti",
  },
] as const;

export const BOLLE_PERMISSIONS = [
  { key: "bolle.view", label: "Bolle: consultazione" },
  { key: "bolle.manage", label: "Bolle: creazione e modifica bozze" },
  { key: "bolle.deliver", label: "Bolle: conferma e consegna" },
  { key: "bolle.cancel", label: "Bolle: annullamento e storno" },
] as const;

export const APPROVVIGIONAMENTI_PERMISSIONS = [
  {
    key: "approvvigionamenti.view",
    label: "Approvvigionamenti: consultazione",
  },
  {
    key: "approvvigionamenti.manage",
    label: "Approvvigionamenti: gestione ordini",
  },
  {
    key: "approvvigionamenti.receive",
    label: "Approvvigionamenti: ricezione merce",
  },
] as const;

export const ALL_PERMISSIONS = [
  ...MENSA_PERMISSIONS,
  ...BENEFICIARI_PERMISSIONS,
  ...CREDITO_PERMISSIONS,
  ...EMPORIO_ACCESS_PERMISSIONS,
  ...EMPORIO_CASSA_SALES_PERMISSIONS,
  ...SOCIALE_INTERVENTI_PERMISSIONS,
  ...CONSEGNE_PERMISSIONS,
  ...UDS_PERMISSIONS,
  ...MAPS_PERMISSIONS,
  ...LOGISTICA_PERMISSIONS,
  ...MAGAZZINO_PERMISSIONS,
  ...BOLLE_PERMISSIONS,
  ...APPROVVIGIONAMENTI_PERMISSIONS,
] as const;

export type PermissionKey = (typeof ALL_PERMISSIONS)[number]["key"];
export const ALL_PERMISSION_KEYS: PermissionKey[] = ALL_PERMISSIONS.map(
  (item) => item.key,
);

const permissionKeys = <T extends readonly { readonly key: PermissionKey }[]>(
  catalog: T,
): PermissionKey[] => catalog.map((item) => item.key);

/**
 * Catalogo esplicito Area -> permessi usato esclusivamente dalla UX Ruoli.
 *
 * Non è un enforcement implicito: il ruolo continua a persistere `aree` e
 * `permessi` separatamente e ogni route continua ad applicare areaGuard e
 * requirePermission. Le associazioni trasversali seguono le route e la UI:
 * - Bolle è condiviso fra Sociale e Magazzino;
 * - MAPS usa le aree sorgente Sociale/Magazzino, non il gruppo menu Logistica;
 * - Analisi condivide i permessi dei report che hanno già un gate dedicato;
 * - UDS riceve solo i permessi Beneficiari realmente usati dai suoi flussi.
 */
export const AREA_PERMISSION_MAP = {
  generale: [],
  magazzino: [
    ...permissionKeys(MAGAZZINO_PERMISSIONS),
    ...permissionKeys(BOLLE_PERMISSIONS),
    "maps.operational",
  ],
  sociale: [
    ...permissionKeys(BENEFICIARI_PERMISSIONS),
    "credito.view",
    "credito.quota.manage",
    "credito.adjust",
    ...permissionKeys(EMPORIO_ACCESS_PERMISSIONS),
    ...permissionKeys(SOCIALE_INTERVENTI_PERMISSIONS),
    ...permissionKeys(CONSEGNE_PERMISSIONS),
    ...permissionKeys(BOLLE_PERMISSIONS),
    "logistica.turni.view",
    "logistica.turni.manage",
    "logistica.volontari.view",
    "logistica.volontari.manage",
    "logistica.mezzi.view",
    "logistica.mezzi.manage",
    "maps.route",
    "maps.operational",
  ],
  emporio: [
    ...permissionKeys(CREDITO_PERMISSIONS),
    ...permissionKeys(EMPORIO_ACCESS_PERMISSIONS),
    ...permissionKeys(EMPORIO_CASSA_SALES_PERMISSIONS),
  ],
  mensa: [
    ...permissionKeys(MENSA_PERMISSIONS),
    // La vista rifornimenti Mensa espone la spedizione solo con questo grant.
    "magazzino.transfers.dispatch",
  ],
  uds: [
    ...permissionKeys(UDS_PERMISSIONS),
    "beneficiari.view",
    "beneficiari.manage",
    "beneficiari.sensitive.view",
    "beneficiari.export",
    "beneficiari.fse.view",
    "beneficiari.fse.manage",
    "beneficiari.duplicates.search",
    "beneficiari.cards.manage",
    "credito.view",
    "credito.quota.manage",
    "credito.adjust",
    ...permissionKeys(EMPORIO_ACCESS_PERMISSIONS),
  ],
  logistica: [
    ...permissionKeys(LOGISTICA_PERMISSIONS),
    ...permissionKeys(APPROVVIGIONAMENTI_PERMISSIONS),
  ],
  analisi: [
    "mensa.reports.view",
    "uds.reports.view",
    "magazzino.fse.view",
    "magazzino.fse.export",
    "magazzino.fse.reconcile",
    "magazzino.fse.reconcile.manage",
    "magazzino.fse.monitoring.manage",
    "magazzino.fse.return",
  ],
  // L'Area amministrazione resta riservata agli admin e non assegna grant UX.
  amministrazione: [],
} as const satisfies Record<string, readonly PermissionKey[]>;
