# UX-CARICO-01 — test formale e validazione Floriano

Base verificata: `d96680eeee82b2b5a4690602534168623826b544`, branch
`codex/magazzino-workflow-unificato`. Il riferimento remoto effettivo
coincideva con la base, divergenza 0/0, index inizialmente vuoto. È stato
preservato il working tree UX esistente; nessuna modifica al motore
inventariale, alle route API, a schema/migrazioni, OpenAPI o generated.

Floriano ha dichiarato **PASS** per il dry run manuale UX-CARICO-01 sul
Docker locale: nuova pratica, Raccolta/attività e relativo pulsante, campi
obbligatori ed errori persistenti, bozza, conservazione degli altri draft,
conferma delle sole righe complete/salvate/selezionate e giacenza aggiornata
una volta. Questa attestazione è registrata come **`OK-MAN-UX-CARICO-01`**;
non costituisce `OK-MAN-M4` né prova su fotocamera reale/tablet fisico.

## UX-CARICO-01-A…J

| ID  | Esito | Evidenza                                                                                                                       |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| A   | PASS  | Unit `validateCaricoRow`/`blocksCaricoDraftSave` ed E2E: una riga incompleta è salvabile come bozza, con avviso.               |
| B   | PASS  | E2E: testata, quantità, lotto fisico richiesto e scadenza mostrano i rispettivi messaggi e `aria-invalid` già al salvataggio.  |
| C   | PASS  | E2E: errore API della nuova raccolta visibile ancora dopo 6 secondi; valore inserito e messaggio di riga restano nel contesto. |
| D   | PASS  | Unit: salvare A conserva il draft locale non salvato di B; E2E verifica anche il caso inverso e la conservazione dopo refetch. |
| E   | PASS  | E2E: B completa, salvata e selezionata abilita **Conferma carico a magazzino**.                                                |
| F   | PASS  | E2E: A incompleta selezionata blocca la conferma; deselezionata non impedisce il carico valido di B.                           |
| G   | PASS  | E2E: il dialog mostra Magazzino e soltanto B; dopo la conferma B ha stock 3, A stock 0.                                        |
| H   | PASS  | E2E: retry della stessa richiesta con chiave idempotente restituisce replay, una integrazione e stock B fermo a 3.             |
| I   | PASS  | E2E: raccolta creata dopo errore simulato, refetch, selezione automatica e draft A/B preservati.                               |
| J   | PASS  | Unit: parità delle chiavi i18n nelle sei lingue e nuova etichetta araba; E2E verifica le etichette italiane principali.        |

L'azione principale, il testo d'aiuto e il dialog descrivono il carico
effettivo delle sole righe salvate, complete e selezionate. La review del
delta conferma che non sono stati introdotti un secondo writer di stock o
modifiche a `createWarehouseLoad`/ledger.

## Regressione e build

| Controllo                            | Esito                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend Carico mirato               | 1 file, 11 pass.                                                                                                                                                                            |
| Frontend completo                    | 77 file, 418 pass.                                                                                                                                                                          |
| API Carico/FSE/policy lotti/Giacenze | 4 file, 49 pass, 1 skip preesistente, su PostgreSQL disposable.                                                                                                                             |
| Fresh DB per test browser            | 42/42 su due database disposable separati; seed, replay e verify verdi.                                                                                                                     |
| E2E UX + M3A                         | 4 pass, 2 skip storici M3A su desktop/tablet simulato.                                                                                                                                      |
| E2E FSE M3B                          | 3 pass, 7 skip previsti dai progetti/fixture del test.                                                                                                                                      |
| Typecheck workspace                  | PASS.                                                                                                                                                                                       |
| Build API                            | PASS.                                                                                                                                                                                       |
| Build WEB                            | PASS su macOS con `PORT`/`BASE_PATH` di produzione e i soli binding Darwin LightningCSS/Tailwind installati in directory temporanea esterna al repo; warning sourcemap/chunk non bloccanti. |

La suite API **completa** non è stata ripetuta in questa fase, poiché
nessun file backend/API è cambiato. L'ultima suite completa della fase di
sviluppo, sul medesimo delta applicativo, era 119 file/1376 pass/4 skip;
non è presentata come nuova esecuzione. OpenAPI/generated non sono cambiati,
perciò il codegen non è stato lanciato.

## Failure intermedie e isolamento

Una prima run E2E UX sul database condiviso con M3A ha incontrato il menu
Magazzino molto popolato: l'opzione della fixture era fuori dal viewport.
È stato corretto **solo** l'ordinamento del nome del Magazzino creato dal
test (`A0 UX…`), mantenendo gli assert; il rerun UX/M3A è verde. La prima
run FSE, sul medesimo database già popolato dai test UX, incontrava lo
stesso limite sul selettore Prodotto. Senza modificare il test FSE, il suo
rerun su un secondo database disposable fresco è verde.

Il primo tentativo `pnpm install` in sandbox aveva perso l'accesso alla
registry dopo la ricreazione di `node_modules`; l'installazione con
accesso autorizzato, sul medesimo lockfile, è poi riuscita. Il build WEB
nativo richiedeva due binari Darwin esclusi dalla policy multipiattaforma
del lockfile: sono stati installati **solo fuori dal repository** per la
prova e non sono state cambiate policy o dipendenze tracciate. Nessun build,
recreate, reset, prune o migrazione sul Docker persistente durante questo
`##test`.

## Ambito della chiusura

Stato UX: **`OK-UX-CARICO-01/OK-MAN-UX-CARICO-01`**. La pubblicazione è
consentita solo dopo i controlli finali di hygiene e staged diff sul branch
dedicato. M4 nel suo complesso non viene dichiarata validata manualmente.
M5 non è avviata.
