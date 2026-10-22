# Profilo personale — email e password

Stato: **verifica manuale sulla 8082 confermata PASS da Floriano; merge autorizzato**. Branch `codex/profilo-email-password`, codice applicativo `bd117a12d1462d4827961b8832e29583f717132c`. Il deploy Hetzner resta da concordare separatamente secondo l'ultima istruzione. Il punto precedente UDS è stato confermato chiuso da Floriano; la configurazione produttiva UDS non viene modificata da questo intervento.

## Comportamento

Il nome dell'utente nel fondo del menu laterale è un collegamento accessibile a **Il mio profilo** (`/profilo`), disponibile senza ruolo amministrativo. Su mobile il collegamento chiude il menu e apre la pagina. Nome, username, ruolo e territorio non sono modificabili da questa interfaccia.

- **Email:** salvataggio dedicato, normalizzazione, controllo formato/lunghezza e unicità, messaggio di successo e aggiornamento dell'identità corrente. In caso di errore l'email registrata resta invariata. I link di recupero password emessi prima del cambio email vengono invalidati nella stessa transazione; l'indirizzo nuovo non viene marcato come verificato. Nessun invio email aggiunto.
- **Password:** riutilizza il servizio e la policy esistenti, con nuova password e conferma, icone a occhio indipendenti e messaggio di esito. I campi vengono svuotati dopo il successo; le altre sessioni vengono revocate e quella corrente resta valida, come nel servizio preesistente. Nessuna richiesta di password attuale aggiunta al flusso già esistente.

L'API aggiuntiva `PATCH /api/auth/profile` modifica esclusivamente l'email dell'utente autenticato. ID destinatario e attributi di privilegi non sono accettati; i campi estranei sono rifiutati. Sono applicati controlli transazionali sulle credenziali correnti e sull'account attivo. Il salvataggio è disponibile anche senza Area assegnata, senza estendere l'accesso ai servizi territoriali. Audit `USER_EMAIL_CHANGED` senza password o link di recupero.

OpenAPI aggiornata in modo additivo per endpoint, input email ed evento audit; client React e Zod rigenerati con `pnpm --filter @workspace/api-spec run codegen`. Nessuna modifica allo schema DB, alle migrazioni, allo stack, alle dipendenze o ai ruoli.

## File coinvolti

- Frontend: `artifacts/magazzino-solidale/src/pages/profilo.tsx`, `pages/change-password.tsx`, `App.tsx`, `components/layout.tsx`, `components/ui/password-input.tsx`.
- Traduzioni: `artifacts/magazzino-solidale/src/lib/i18n/index.ts`, `namespaces/profile.ts`, `namespaces/logSistema.ts`.
- Backend: `artifacts/api-server/src/routes/auth.ts`, `middlewares/auth.ts`, `lib/systemLog.ts`.
- Contratto e generati: `lib/api-spec/openapi.yaml`, `lib/api-client-react/src/generated/{api.ts,api.schemas.ts}`, `lib/api-zod/src/generated/api.ts` e relativi tipi `index.ts`, `systemLogEventType.ts`, `updateMyProfileInput.ts`.
- Test: `artifacts/api-server/tests/self-profile.test.ts`, `artifacts/magazzino-solidale/src/pages/profilo.test.tsx`, `components/layout-maps-navigation.test.tsx`.

## Verifiche eseguite

- `pnpm install --frozen-lockfile`: PASS, lockfile invariato.
- `pnpm run typecheck`: PASS.
- Codegen canonico e controllo `git diff --check`: PASS.
- Suite UI completa: **133 file, 866 PASS**. Cinque prove aggiuntive coprono il collegamento dal profilo non amministrativo, salvataggio/errore email, occhi indipendenti senza submit e conferma/password ripulite al successo.
- API tramite runner canonico: `CI_RESULTS_DIR=test-results/quality-gates/api/self-profile-local node scripts/quality-gates-run.mjs api general`: **1.596 PASS, 7 condizionali SKIP, zero FAIL**. Inclusi **15 nuovi casi** con login, sessioni e middleware reali: modifica solo del proprio account, email normalizzata, campi estranei/privilegi rifiutati, email non valide e duplicate, rollback dei token, invalidazione dei vecchi link, assenza di scritture al salvataggio invariato e cambio password con revoca dell'altra sessione e verifica vecchie/nuove credenziali. Nessun test contro il DB della 8082 o di Hetzner. Database e rete temporanei rimossi.
- Build Docker **API e WEB PASS** da archivio Git del candidato esatto. Budget canonico verificato sugli asset dell'immagine WEB: **393,8 KiB gzip / 400 KiB**.

Le altre sette campagne API e le suite browser non sono state rieseguite in questa verifica mirata. Nessun risultato precedente è contato come nuova esecuzione. La vista autenticata nel browser locale resta alla prova manuale: la nuova scheda aperta mostra il login, senza usare o modificare credenziali dell'utente.

## Ricevuta 8082

Immagini attive `magazzino-profilo-uat-api:sha-bd117a12d146` e `magazzino-profilo-uat-web:sha-bd117a12d146`, etichette di revisione complete corrispondenti al candidato. Ricreati esclusivamente API e WEB, conservando progetto Compose e tutti gli override esistenti. Override finale persistente e ricevute private in `/Users/florianocaprio/Backups/Magazzino-Solidale/PROFILO-UAT-bd117a12d146-20261022/`.

Dump DB locale prima dell'avvio conservato nella stessa directory, SHA-256 `f01f8ba077fa93bd18e44ad173fd2255d6dc6b145a24318b6a62fc640135d4a7`. PostgreSQL conserva container e data di avvio; mount e variabili applicative invariati, esclusi i soli metadati della versione runtime. Impronte account, ruoli e scelte dei moduli identiche prima/dopo. Nessun account sintetico inserito nella UAT. `/login`, `/profilo`, `/api/healthz`, `/api/readyz` HTTP 200; HTML effettivamente servito dalla porta 8082 confrontato con l'immagine candidata.

La prima preparazione dell'archivio si era fermata per un riferimento Git errato, prima di costruire o sostituire servizi. Il riferimento è stato riletto da Git; tutte le build e l'attivazione riuscite sopra riportate usano il candidato esatto `bd117a12d1462d4827961b8832e29583f717132c`.

## Prova manuale richiesta prima di merge e deploy

1. Accedere a `http://localhost:8082` e premere il proprio nome nel fondo del menu, oppure aprire `/profilo` dopo il login.
2. Salvare un'email valida, verificare il messaggio e ritrovare l'indirizzo dopo un nuovo accesso. Un'email duplicata deve essere rifiutata senza modificare l'account.
3. Inserire nuova password e conferma; provare gli occhi, poi salvare. Verificare messaggio di successo, accesso con la nuova password e rifiuto di quella precedente.
4. Verificare che ruolo, Area e normali funzionalità dell'account restino quelli previsti. La procedura è disponibile anche a un operatore, senza gestione degli account altrui.

## OK manuale e mandato di merge

Floriano ha confermato: «Perfetto funziona ho testo fai pure il merge e poi concordiamo come portalo in produzione su Hetzener». La prova manuale è quindi PASS e il merge è autorizzato; il precedente piano di deploy dopo il test è sostituito dal rinvio esplicito del rilascio a un accordo successivo. Nessun accesso SSH, riallineamento produttivo o deploy viene eseguito in questa fase.

Preflight Git: `origin/main` ancora `6d659e45687f8ea75b1dac829f21a347d4c21267`, nessun avanzamento concorrente. Il ramo include la funzionalità locale e due precedenti ricevute documentali del deploy BUG6 e della restrizione UDS, già pubblicate nei rispettivi branch: nessun altro cambiamento applicativo. Prima della PR il diff applicativo rispetto al candidato manuale `bd117a1` deve essere nullo, escludendo soltanto questo audit. Si attende la CI completa prevista dal workflow prima del merge. Il workflow non contiene distribuzioni automatiche.

La 8082 conserva le immagini del candidato approvato; un aggiornamento della sola documentazione non richiede ricompilazione. `scripts/post-merge.sh` non viene eseguito: nessuna modifica DB è necessaria. Credenziali, `.env`, log, dump e screenshot restano esclusi da Git; i cinque documenti locali estranei restano intatti e non inclusi.

## Diagnosi e correzione del 403 Mensa nella CI

Prima esecuzione della [CI PR #31](https://github.com/florianocaprio/Magazzino-Solidale/actions/runs/39834345104): static/frontend/Docker e API completati con successo; `bug6-rbac.spec.ts` ha registrato **74 PASS e un FAIL** su Operatore Mensa, tablet 820×1180, per `GET /api/mensa/consumi` HTTP 403. Nessun merge eseguito con questo risultato.

La fixture assegnava l'operatore a un'Area appena creata senza alcuna Mensa. `currentMensaScope` nega intenzionalmente il servizio quando nell'Area non esistono Mense. La prova navigava poi alle pagine successive appena appariva il contenitore, senza attendere la risposta dei consumi: l'errore poteva essere osservato oppure la richiesta poteva essere interrotta dalla navigazione. Non è una regressione dei permessi introdotta dal profilo personale.

Correzione minima in `artifacts/magazzino-solidale/e2e/bug6-rbac.spec.ts`: verifica esplicita del 403 e del messaggio «Nessuna Mensa disponibile nell'Area» prima della preparazione; creazione tramite API ordinaria di una Mensa e del suo magazzino dedicato per ciascuna delle due Aree della fixture; cleanup mirato; attesa e verifica **HTTP 200** della richiesta consumi dalla pagina; controllo che l'operatore veda la Mensa della propria Area e riceva ancora **403** su quella dell'altra Area. Nessuna aspettativa negativa rimossa, nessun grant aggiunto, nessun retry automatico. Nessuna modifica a codice applicativo, schema DB o configurazioni della 8082/Hetzner.

Floriano ha richiesto di risolvere il 403 e completare il merge soltanto con tutti i test passati. Installazione frozen, typecheck e controllo diff PASS dopo la modifica. La specifica completa viene rieseguita sul database temporaneo attestato del runner locale; la CI completa della PR deve poi passare sul nuovo candidato. I risultati precedenti falliti restano documentati e non sono contati come PASS.
