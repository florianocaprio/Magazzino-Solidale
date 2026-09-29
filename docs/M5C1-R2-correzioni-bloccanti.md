# M5C1-R2 — continuità Intervento, Bolla collegata ed Enti Esterni

Stato: sviluppo nel working tree; `##test` formale e validazione manuale non eseguiti.

## Base e perimetro

Branch `codex/magazzino-workflow-unificato`, HEAD locale/remota iniziale `95bad0aca6891a44e1c77bb54784d4d39a99050c`, divergenza `0/0`, staging e working tree iniziali vuoti. `origin/main` iniziale `787d7c5436d5fa4c0edb24be373d055946d402ce`. M5C2 non è stata avviata; nessun commit, push, merge o deploy.

## Cause e correzioni

**R2-01.** La pagina Richieste trattava anche l'invio da Intervento come un'operazione della propria workspace: dopo il `POST` rimaneva lì. Ora il submit riuscito invalida le query delle Richieste e il dettaglio Intervento e naviga al medesimo ID, con vista `Da pianificare` o `Pianificati` coerente e Area/Centro preservati. L'invio non contestuale mantiene il comportamento precedente. L'Intervento senza data continua a poter essere pianificato e quello pianificato a modificare data/ora tramite l'editor esistente; nessuna Richiesta è creata o sincronizzata automaticamente quando cambia la data.

**R2-02.** Dopo `Prendi in carico` il passo è esplicito: scegliere il Magazzino e creare la Bolla. Solo il successo del comando documentale apre il deep-link restituito dal backend; Trasferimento mantiene il proprio percorso. Il dettaglio Bolla operativo è alimentato da `GET /documenti-operativi/...`, mentre aggiunta prodotto, modifica intestazione e assegnazione incaricato invalidavano soprattutto `GET /bolle/:id`. Un helper comune ora invalida entrambi i dettagli, liste Bolle/documenti/Richieste/Consegne e Giacenze dopo le mutazioni pertinenti. L'aggiunta sequenziale di righe attende il refetch prima di consentire il prossimo inserimento, così la versione usata resta quella persistita. L'errore dell'incaricato mostra `error.data.error`, `error.response.data.error` o `error.message` prima del fallback.

Il Magazzino può proporre facoltativamente un volontario esistente dalla Bolla; non nasce alcun nuovo volontario. L'endpoint ristretto `GET /bolle/{id}/volontari-candidati` fornisce solo ID, nome, cognome e tipo, senza aprire l'anagrafica Logistica. Controlla grant/Area/documento corrente e calcola lo stato operativo sulla data della Consegna collegata, altrimenti dell'Intervento pianificato, altrimenti della Richiesta. Senza data presenta solo permanenti operativi; i temporanei senza data vengono anche respinti sul comando di assegnazione di una Bolla collegata. Il Centro conserva la decisione finale in Pianificazione Consegne, senza riottenere `bolle.manage`.

**R2-03.** La gestione inline `Nuovo Ente` dalla Bolla era nel posto sbagliato. La nuova pagina **Centro di Ascolto → Enti Esterni** offre elenco, ricerca, creazione, modifica e disattivazione/riattivazione; non elimina fisicamente. L'operatore territoriale usa la propria Area bloccata, l'admin globale la sceglie. `GET /enti-destinatari` resta un array compatibile ma è paginato (default 50, massimo 100) e accetta `search` case-insensitive su denominazione, indirizzo, telefono ed email, con input debounced di 275 ms e ricerca da due caratteri. Un combobox riusabile sostituisce il Select Bolla, disambigua con indirizzo e Area e offre solo Enti attivi. L'interfaccia segnala Ente o Magazzino mancanti e mismatch di Area, senza `return` silenzioso.

Il backend richiede `enti-destinatari.manage` **e** Area Sociale o admin per `POST/PATCH`; il solo Magazzino può leggere con `view`, anche se conserva un grant legacy `manage`. Il ruolo canonico `Operatore Magazzino` non riceve più `manage` dal seed. La migration dati candidata **46** (`20260929_m5c1_r2_enti_ownership.sql`) lo rimuove solo da quel ruolo non-admin, senza modificare Enti, ruoli custom, Sociale o Admin. Schema inventariale e migration 45 sono invariati. OpenAPI è stato esteso per ricerca/paginazione e candidati volontari; client e validatori generati sono stati rigenerati dal contratto.

**R2-04 — Rifornimenti Mensa e selezione lotto fisico.** La UI formava la riga senza `lottoId` e la route Mensa lo scartava in normalizzazione: per i prodotti che lo richiedono, M4 respingeva correttamente il trasferimento. `GET /mensa/logistica/giacenze` ora espone `lottoFisicoObbligatorio`; il nuovo `GET /mensa/logistica/lotti` richiede lo stesso grant del rifornimento, rivalida Mensa e Magazzino origine e restituisce solo lotti del Prodotto con disponibilità reale positiva, non scaduti e ordinati FEFO. La disponibilità sottrae le prenotazioni M4 attive, senza saldo parallelo. La UI azzera il lotto al cambio di Mensa, origine o Prodotto, ne impone la scelta quando obbligatorio e limita la quantità al disponibile del lotto selezionato. Il `POST /mensa/trasferimenti` include `lottoId` nell'hash idempotente e lo inoltra a `createTransferRequest()`; prima della creazione verifica appartenenza, scadenza e disponibile reale, mentre **Prepara M4** resta il controllo transazionale definitivo e crea la prenotazione. Un rifornimento UI resta una sola riga/lotto: il prelievo da più lotti richiede una futura estensione esplicita. Nessuna nuova migration è necessaria per R2-04.

## Confini e rinvii

Le Richieste verso Ente esistono nel backend M5 come `sorgente=operativa` Magazzino/admin. La creazione ordinaria Sociale resta focalizzata sul Beneficiario. Se il Centro debba chiedere merce per un Ente serve una decisione esplicita di Floriano prima di M5C2; non è stato aggiunto un workflow implicito. Il motore M4 di stock, prenotazioni, FEFO, scarichi e movimenti non è stato modificato. Raccordo e autorità finale di Pianificazione Consegne restano per M5C2-A.

## Prove di sviluppo

- Typecheck workspace: PASS.
- Test API mirati R2/seed ruoli: 2 file, 22 PASS su PostgreSQL effimero.
- Test frontend mirati: 3 file, 9 PASS.
- Suite frontend completa: 86 file, 456 PASS.
- Fresh temporaneo: schema corrente e ledger 46/46 applicati; secondo run 0 applicazioni, 46 skip con checksum verificato. Non è una prova autentica di upgrade popolato 45→46.
- Suite API completa finale su PostgreSQL effimero: 129 file, 1.479 PASS e 4 skip preesistenti.
- R2-04: test API Mensa/Trasferimenti M4/policy lotti mirati, 3 file e 113 PASS. Il test R2-04 prova lotto obbligatorio, FEFO, scaduto/altro prodotto/altro Magazzino, quantità 23 contro lotto da 10, lotto persistito, prenotazione M4 da 10, replay uguale e conflitto con lotto diverso, non tracciato senza lotto. E2E browser R2-04 desktop sullo stack effimero: 1 PASS; verifica UI richiesta/opzionale, limite lotto, payload, riga persistita e prenotazione M4.
- Codegen OpenAPI: PASS; due rigenerazioni consecutive producono lo stesso diff dei file generati. Typecheck workspace finale: PASS. `git diff --check`: PASS. Prettier sui soli file R2 toccati: PASS.
- Build Linux API e WEB da Dockerfile del working tree: PASS in due immagini temporanee non distribuite. La build WEB macOS locale resta non avviabile perché l'installazione locale manca di `lightningcss.darwin-arm64.node`; non indica un errore del codice R2. Le suite E2E complete e il collaudo formale restano per `##test` separato.
- `pnpm install --frozen-lockfile`: bloccato da `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` prima di cambiare dipendenze; non si è forzata la purga di `node_modules`.

I test browser esistenti per M5C1 e M5B sono stati aggiornati per richiedere ritorno automatico all'Intervento e apertura automatica della Bolla; quello M4A verifica combobox e feedback dei campi mancanti. Non sono conteggiati come eseguiti. Il solo E2E browser R2-04 è stato eseguito. Nessuna prova manuale è dichiarata superata.

Il database usato dai test è PostgreSQL 16 in container `--rm` con dati su `tmpfs`, senza volumi. Le tre istanze R2 iniziali e la quarta istanza R2-04 sono state fermate e auto-rimosse. Per l'E2E R2-04 sono stati creati soltanto due container API/WEB, una rete e due tag immagine temporanei: tutti rimossi nominativamente. La verifica finale per nome non trova container, reti, volumi o immagini R2-04 residui. Nessun accesso o modifica allo stack o DB persistenti.
