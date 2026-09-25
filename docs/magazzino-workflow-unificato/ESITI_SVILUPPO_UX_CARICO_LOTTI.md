# UX-CARICO-LOTTI — esiti Fase A di sviluppo

Stato: **`DEV-UX-CARICO-LOTTI/NE-TEST/NE-MAN`**. Base locale e remota
verificata prima dell'intervento:
`efa38a9c103186bc33946f1b5b751570911d861c`, branch
`codex/magazzino-workflow-unificato`, divergenza `0/0`, working tree pulito.
Nessuno staging, commit, push, merge o deploy Docker in questa fase.

## Delta funzionale

- **Carichi** resta l'unico percorso di registrazione ordinaria, basato su
  pratica persistente e `creaCaricoInventariale`. UX-CARICO-01 (bozze
  incomplete, errori contestuali, draft di altre righe e conferma delle
  sole righe complete/salvate/selezionate) non è stato rimpiazzato.
- Le nuove etichette operative sono presenti nelle sei lingue già offerte
  dall'applicazione; il set di chiavi è verificato da un test unitario.
- **Raccolte / Attività** usa `lotti-logici`: elenco per Area con ricerca,
  stato e storico; dettaglio con quantità/stati derivati; creazione tramite
  lo stesso Dialog di Carichi; modifica/chiusura/riapertura/archiviazione
  tramite le API esistenti. `Generale` è consultabile ma non modificabile.
- **Lotti fisici** legge i `lotti` reali, senza pulsante di creazione stock.
  Mostra prodotto/codice, lotto/scadenza, Magazzino/Area/Raccolta,
  fornitore/DDT, fondo, quantità caricata/residua/prenotata/disponibile e
  stato derivato. Filtri per Area (anche tutte le Aree accessibili, per
  consultare il legacy senza Area), Magazzino, prodotto, Raccolta,
  fornitore, fondo, scadenza, stato, testo e esauriti. La rettifica già
  esistente resta disponibile con `magazzino.stock.adjust` soltanto su
  Magazzino attivo; usa il servizio esistente, non un nuovo motore.
- GET `/lotti` aggiunge solo `includeEsauriti` (default invariato) e una
  proiezione consultiva di Area, codice prodotto, codice/descrizione della
  Raccolta, prenotazioni, provenienze, documenti e registrazioni di carico
  collegate. Le registrazioni sono caricate in batch dal lineage reale di
  `carichi_magazzino_righe`/`carichi_magazzino`, senza richieste N+1 dal
  frontend. Provenienze/documenti multipli rimangono multipli e non
  attribuiscono il residuo a un'origine arbitraria. I dati legacy senza
  lineage sono indicati come non disponibili.
- Carico manuale non FSE+: selettore Fornitore coerente con l'Area,
  numero/data documento/DDT, codice produttore, scadenza, quantità e fondo.
  `fornitoreId` è ortogonale a `origineCarico`: non è stato aggiunto
  `FORNITORE` né una migration. Il backend pratica già validava Area e
  fornitore e propagava il dato alla registrazione.
- Scanner del codice lotto produttore riusa `BarcodeScannerButton` e
  modifica solo la bozza del campo lotto; lo scanner prodotto resta
  separato. I suggerimenti provengono da partite con prodotto e Magazzino
  coincidenti e precompilano codice/scadenza/fattore, senza PATCH del lotto,
  cambio quantità o consolidamento parallelo.
- `/lotti` ora redirige a `/carico-merce?tab=lotti` o Carichi per i vecchi
  tab `carichi/agea`, preservando prodotto, Magazzino e fondo quando
  presenti; `scadenza` attiva il filtro relativo. Il vecchio writer diretto
  di nuovi lotti non è più raggiungibile via UI. L'import FSE+/AGEA resta
  nel wizard Carichi; un vecchio deep-link AGEA porta a Carichi, da cui
  l'operatore avvia il wizard. Non si apre automaticamente il wizard da
  quel link: verifica UX nel separato `##test`.

## Finding e decisioni tecniche

1. Le tabelle e i campi necessari a fornitore/DDT, Raccolta e lotto fisico
   esistevano già. **Nessuna migration o modifica schema**.
2. La GET `/lotti` precedente nascondeva sempre il residuo zero e non
   esponeva provenance multi-evento. L'estensione è opt-in per lo storico
   e additiva per i campi; OpenAPI è stata aggiornata prima della
   rigenerazione client/Zod.
3. La provenienza del lotto non è un singolo campo autorevole quando più
   carichi convergono sulla stessa partita; la vista espone l'elenco delle
   registrazioni collegate, inclusi eventuali carichi stornati marcati.
   Le loro quantità sono storiche, non quote del residuo corrente.
4. Il vecchio `/lotti` conteneva anche la rettifica inventariale. È stata
   conservata con permesso/regola Magazzino attivo; soltanto il writer
   diretto di nuovi lotti è stato dismesso dalla navigazione.

## Prove di sviluppo (non equivalgono a `##test`)

- Typecheck workspace: verde.
- Frontend completo sul candidato finale: **79 file, 426 test verdi**;
  include unit test di tab/deep-link, filtri/stato e scanner/suggerimenti.
- API M2/lotti mirati: 15/15 verdi dopo aver corretto un assert del test
  che presumeva una rappresentazione testuale fissa del DECIMAL (`3.000000`
  anziché il valore restituito `3.00`); il valore numerico non era errato.
- API completa, primo tentativo: 113 file verdi, 6 file non verdi; quattro
  richiedevano `SESSION_SECRET` non impostato e due test storici sono
  andati in timeout con worker concorrenti. Nessun finding sulla nuova
  GET. Rerun con secret sintetico e worker singolo: **119 file,
  1377 passati, 4 skip storici**. Rerun sul candidato con dettaglio
  lineage: **119 file, 1377 passati, 4 skip storici**.
- Build API: verde. Build WEB macOS nativa inizialmente bloccata dal
  binding LightningCSS Darwin assente. Build Linux x64 in container
  one-shot, senza rete, verde (5037 moduli); primi due tentativi Linux
  hanno solo evidenziato piattaforma esbuild e variabili Vite mancanti.
- Build WEB Linux x64 ripetuta dopo le rifiniture finali: verde, 5038
  moduli. Typecheck finale verde; codegen ripetuto con hash aggregato
  identico `9f8c4eaff3b7f5ae26702c9480c1a63326d30483a7592e9a2ea463bb12747780`;
  Prettier e `git diff --check` verdi.
- `pnpm install --frozen-lockfile` non ha rimosso le dipendenze esistenti:
  in sessione non TTY ha rifiutato il purge di `node_modules`. Nessuna
  dipendenza o lockfile è stata modificata.

## Verifiche rinviate al separato `##test`

Le prove di sviluppo non sostituiscono UX-LOT-01…22 in browser e sul DB
dedicato della fase formale, in particolare: dialog condiviso e draft
conservato, lifecycle completo senza effetti inventariali, carico reale
multi-prodotto/multi-lotto, fornitore/DDT, scanner su camera reale,
precompilazione suggerimenti senza effetti, replay unico, FSE+ e redirect
legacy. `NE-MAN-CAMERA` e `NE-MAN-TABLET` restano non eseguiti. Nessuna
validazione manuale della nuova UX è dichiarata.

Il Docker persistente `magazzino-web`, `magazzino-api`, `magazzino-postgres`
e i suoi volumi non è stato aggiornato o usato come database di test.
Il solo PostgreSQL di sviluppo è stato avviato nominativamente su tmpfs e
auto-rimosso dopo i test; l'inventario/cleanup è registrato in
`AMBIENTE_TEST.md`.

## Passaggio alla fase formale

Questo verbale conserva lo stato storico della Fase A. I successivi fix
preview dei tab, dell'auto-selezione/carico parziale e dell'evidenza del
lotto obbligatorio sono confluiti nello stesso working tree senza commit
intermedi. Floriano ne ha dichiarato il PASS manuale specifico; la prova
automatica finale e i relativi esiti sono nel verbale separato
`ESITI_TEST_UX_CARICO_LOTTI.md`. La vecchia etichetta `NE-TEST/NE-MAN`
in testa descrive il punto di arresto della **sola Fase A**, non lo stato
finale del candidato consolidato.
