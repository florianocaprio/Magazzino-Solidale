# UX-CARICO-LOTTI — esiti del test formale finale

Base pubblicata: `efa38a9c103186bc33946f1b5b751570911d861c`.
Branch esclusivo: `codex/magazzino-workflow-unificato`. Il working tree
di sviluppo e i fix preview sono stati preservati; nessun reset, stash,
rebase o merge. Stato del candidato:
**`OK-TEST-UX-CARICO-LOTTI/OK-MAN-UX-CARICO-LOTTI`**. Questo non
attribuisce `OK-MAN-M4` alla milestone M4.

## Perimetro e review del delta

- Carico Merce presenta Carichi, Raccolte / Attività e Lotti fisici;
  query string, deep-link, reload, back/forward e fallback sono reattivi.
  `/lotti` rimane un redirect compatibile. FSE+/AGEA conserva il wizard
  dedicato.
- Raccolte/Attività riusa `lotti_logici` e le API di lifecycle già
  presenti; `Generale` è protetto. Nessuna azione del lifecycle crea o
  modifica stock.
- I lotti fisici sono partite reali; GET `/lotti` estende il contratto in
  modo additivo con storico esauriti opt-in, filtri, disponibilità e
  lineage di carichi/provenienze/documenti multipli. Non sono stati
  introdotti saldo, writer inventariale o FEFO paralleli.
- Il carico ordinario usa pratica persistente e motore inventariale
  esistenti: fornitore non FSE+, DDT/data, scanner e suggerimenti
  compilano la bozza; lo stock cambia solo alla conferma. Il codice
  lotto è obbligatorio **solo** con `lottoFisicoObbligatorio=true`, senza
  eccezioni per origine o FSE+.
- UX-CARICO-01 resta integro: errori persistenti, campi mancanti,
  salvataggio bozze incomplete e draft delle altre righe. Il salvataggio
  seleziona soltanto la riga completa appena salvata. Una riga non
  selezionata, vuota o incompleta, non blocca il carico di quelle valide;
  una riga selezionata ma dirty blocca fino a nuovo salvataggio.
- Il requisito visivo usa testo normale per lotto facoltativo e blu con
  «Lotto richiesto» per obbligatorio in Catalogo, selettore prodotto e
  righe Carico; sono coperte varianti light/dark e viewport simulate.

Non è stata introdotta alcuna migration. OpenAPI è la sorgente dei tipi
client/Zod rigenerati: le differenze generated derivano da codegen, non
da editing manuale. Il solo adeguamento fuori dal nuovo flusso è il
limite di altezza del menu prodotti nel wizard FSE, necessario a rendere
selezionabile un prodotto su catalogo popolato nel test storico M3B.

## Evidenze automatiche

| Gate                        | Risultato finale                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend mirati e completo  | 81 file, 436 test passati; include tab/routing, colori, scanner/suggerimenti, UX-CARICO-01 e regressioni SEL-01…10.                                   |
| API mirate                  | 10 file, 181 test passati per lotti logici/fisici, carico, Giacenze, prenotazioni, Trasferimenti e reporting.                                         |
| API completa                | 119 file, 1.377 passati, 4 skip storici; `--maxWorkers=1`, clone PostgreSQL pulito, `SESSION_SECRET` sintetico.                                       |
| E2E pertinenti              | 26 passati, 29 skip viewport preesistenti, 0 failure, 0 retry; cinque progetti Playwright, database isolato e XLSX originali M3B in sola lettura.     |
| Fresh DB e migrazioni       | Fresh 42/42 con seed e CRUD/replay; verify ufficiale `applicate=42 pending=0`; runner PostgreSQL 24/24.                                               |
| Contratto e codice generato | Due codegen consecutivi con hash aggregato invariato `9f8c4eaff3b7f5ae26702c9480c1a63326d30483a7592e9a2ea463bb12747780`.                              |
| Qualità                     | Typecheck workspace, build API, build WEB Linux compatibile, budget iniziale 1.347,2 KiB / 373,3 KiB gzip, runtime config e `git diff --check` verdi. |

La prova E2E nuova copre il lifecycle completo Raccolta, la protezione
di `Generale`, la parità dello stock prima/dopo, il lotto fisico con
due carichi da provenienze/DDT distinti, filtri, quantità e storico
esauriti. Le altre prove UI/API coprono conferma stock una volta,
retry idempotente, draft pendenti, lotto facoltativo/obbligatorio,
scanner e suggerimenti. Gli skip E2E sono esclusioni già esistenti per
viewport non pertinenti, non aggiunte per ottenere un risultato verde.

## Failure incontrate e risoluzione

1. Il primo run API completo sul DB già usato dai test mirati e in
   concorrenza con altre prove ha avuto due failure: `socket hang up`
   in M2 Catalogo e stato modulo VOLONTARI inatteso. Un secondo run
   completo su clone pulito ha avuto due failure intermittenti analoghe
   in test storici Sociali/Volontari (1.375 pass). I due file falliti
   sono poi passati isolati su un altro clone (45/45). Il rerun finale
   **non concorrente**, su clone fresh distinto, è passato integralmente
   (1.377/1.377, quattro skip storici). Nessun assert o controllo
   autorizzativo è stato indebolito; resta un rischio di isolamento
   della suite storica da trattare separatamente se ricompare.
2. Il primo E2E completo ha intercettato il vecchio test con i due XLSX
   M3B: il menu prodotti esteso usciva dal viewport e il test leggeva
   le checkbox prima della chiusura del dialog. Il menu FSE è stato
   limitato all'altezza disponibile; il test attende la chiusura
   osservabile del dialog e sette righe/checkbox importate, senza sleep,
   skip o retry. Il test originale è poi passato con 1.177 pezzi e il
   rerun E2E completo finale è verde.
3. La build WEB nativa macOS non ha il binding Darwin di LightningCSS
   nell'installazione locale. La build di produzione e il budget sono
   stati eseguiti nella copia Linux con installazione lockfile frozen;
   non sono state cambiate dipendenze o policy multipiattaforma.

Prettier ha evidenziato che `src/pages/prodotti.tsx` era non conforme
già nella base pubblicata. Poiché il file è modificato per l'evidenza
«Lotto richiesto», è stato formattato integralmente per rendere verde
il gate senza esclusioni: il diff include quindi circa mille righe di
solo formato oltre al piccolo delta funzionale del Catalogo. Questo
rumore di review è dichiarato esplicitamente; `git diff --check` è
verde.

## Validazione umana, limiti e ambiente

Floriano ha dichiarato **PASS** per i tre tab e la navigazione reale,
Raccolte, Lotti fisici, Carico Merce, Salva bozza, auto-selezione,
carico parziale, righe incomplete non bloccanti, colori e policy
obbligatorio/facoltativo. Stato **`OK-MAN-UX-CARICO-LOTTI`** limitato a
questa UX. Fotocamera reale e tablet fisico restano
`NE-MAN-CAMERA`/`NE-MAN-TABLET`, non dichiarati superati.

Il banco prova era un PostgreSQL `--rm` su tmpfs e runner Linux one-shot;
il Docker persistente locale, i volumi pgdata/uploads e la rete del
progetto non sono stati aggiornati. Il database temporaneo e la copia
Linux sono stati rimossi nominativamente; nessun container, rete o
volume disposable UX-Lotti residuo. Gli ID dei tre container originali
sono invariati; inventario dettagliato in `AMBIENTE_TEST.md`. Nessun
M5, merge o push su `main`.
