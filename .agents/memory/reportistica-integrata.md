---
name: Reportistica integrata
description: Architettura, KPI, scoping, FSE+, export e compatibilità della Fase 5-6.1.
---

# Reportistica integrata

## Regola architetturale

La reportistica è un livello di sola lettura sul database operativo. Le
definizioni vivono in `artifacts/api-server/src/lib/reporting`; il frontend e gli
export non ricalcolano i KPI. Ogni builder restituisce lo stesso DTO
`ReportingDashboard` con filtri applicati, KPI, serie, tabelle, qualità dati,
definizioni, istante di generazione e timezone `Europe/Rome`.

Route UI:

- `/report` landing;
- `/report/dashboard` generale;
- `/report/pacchi`, `/report/centro-ascolto`, `/report/emporio`;
- `/report/mensa`, `/report/uds`;
- `/report/magazzino-logistica`, `/report/fse-plus`.

Endpoint nuovi: gli equivalenti sotto `/api/report`, più
`GET /api/report/drilldown`. Il drill-down è paginato server-side (massimo 100
record) e restituisce codici/ID e dati operativi, non note, contatti, codice
fiscale o informazioni sanitarie.

## Scoping e autorizzazioni

`REPORT` e area `analisi` sono il gate generale. Le dashboard dedicate
richiedono inoltre area e modulo della sorgente; Mensa richiede anche
`mensa.reports.view`. La dashboard generale interroga soltanto sorgenti il cui
modulo è attivo e la cui area è concessa al caller. FSE+ è trasversale e rimane
nell'area Analisi, ma ogni sorgente entra nelle aggregazioni soltanto se il
relativo modulo e la relativa area sono disponibili al caller; i dati Mensa
richiedono anche `mensa.reports.view`.

`parseReportFilters` valida date civili ISO, anno e ID positivi. `da > a` è 400.
Un caller con Area Operativa, Centro o Zona UDS assegnati viene sempre fissato al proprio
scope; un parametro diverso è 403. Gli scope SQL seguono la compatibilità
corrente: in modalità caller includono i record condivisi `NULL`, mentre un
filtro esplicito globale richiede corrispondenza esatta. La UI locked è solo UX:
il controllo autorevole è server-side.

## Regole principali

- Evento = operazione valida; persona = `COUNT(DISTINCT beneficiario_id)`;
  nucleo = titolare/famiglia servita; persone del nucleo = titolare più membri
  registrati soltanto nei report che lo richiedono.
- Pacco distribuito = bolla `consegnato` non associata a una
  `spese_emporio` chiusa; bozze, annullati e distribuzioni Emporio non contano.
  La condizione è condivisa da KPI, serie, tabelle, dashboard generale e
  drill-down. Le righe non moltiplicano il numero di pacchi.
- Sociale = intervento `ambito='sociale'` oppure `NULL` legacy, come la vista
  corrente; `ambito='uds'` è escluso. Persone servite, interventi, serie,
  tabelle e drill-down includono soltanto lo stato `concluso`; pianificati,
  annullati, mancate presentazioni e scaduti restano KPI separati. Il cutoff
  degli scaduti è il minore tra fine periodo e ora corrente Europe/Rome.
- Emporio = `spese_emporio.stato_spesa='chiusa'`; sessioni/carrelli non chiusi
  non sono erogazioni.
- Mensa = righe `mensa_pasti`; accesso negato non è persona servita. Le date di
  accesso sono convertite a data civile `Europe/Rome`.
- UDS = beneficiario `uds=true` e intervento `ambito='uds'` oppure `NULL`
  legacy. Il numero cronologico è calcolato sull'intera storia territoriale
  prima di data, tipo e operatore del report.
- Giacenza per prodotto = somma `lotti.quantita_residua` omogenei; i movimenti
  sono audit, non una seconda giacenza. Quantità di unità differenti non sono
  mai sommate: Pacchi, Emporio, FSE+ e Logistica espongono quantità per prodotto
  e/o unità, conteggi confrontabili e un KPI kg soltanto per valori già in kg.
  Le sezioni Logistica vengono restituite soltanto per i moduli attivi.
- Persona unica generale = beneficiario distinto sull'unione degli eventi
  effettivamente erogati nelle sorgenti autorizzate; non si sommano KPI di aree
  e non si espandono i nuclei.

## Fasce di età

L'unica definizione è in `reporting/ageBands.ts`, sia JS sia SQL:
`0_17`, `18_29`, `30_64`, `65_plus`, `non_determinata`. La data di riferimento è
sempre esplicita ed è la data finale del report. La data di nascita prevale;
`fascia_eta_presunta` è fallback soltanto se manca la data.

## FSE+ e data gap

La provenienza è determinata esclusivamente dal lotto realmente movimentato
(`lotti.fse_plus`), mai dal flag prodotto quando esiste un lotto specifico. I kg
sono sommati soltanto per unità già espressa in kg; non si inventano conversioni.
Il workbook contiene sempre i fogli `00`–`09` previsti. Il foglio
`09_Dettaglio_Controllo` viene popolato dal drill-down paginato FSE+ con data,
documento, codice beneficiario, prodotto, lotto, quantità, unità e canale;
nominativi e dati sociali sensibili non vengono esportati. Le etichette export
seguono la lingua UI e gli scope usano il nome leggibile quando disponibile,
con fallback all'ID.

Disponibili: prodotti/quantità da movimenti e lotti, documenti/nuclei, persone
registrate nel nucleo, sesso e fascia età con warning di completezza.
Non disponibili senza decisione/modello aggiuntivo: origine straniera/minoranze
normativa, disabilità individuale, cittadino di Paese Terzo, esclusione
abitativa, classificazione continuativo/saltuario, mapping strutturato delle
misure di accompagnamento e consumo FSE+ del singolo pasto. Questi valori sono
`MANCANTE`, non zero; note e testo libero non vengono interpretati.

## Compatibilità

Non sono stati rimossi endpoint legacy. `/report-uds` è alias UI della nuova
vista UDS; `/mensa/report` conserva permesso e comportamento precedenti. Gli
endpoint storici sotto `/report` restano disponibili come compatibility layer.
Prima di rimuoverli occorre un test di parità per ogni metrica semanticamente
equivalente. Questa fase non modifica lo schema e non richiede update DB.
